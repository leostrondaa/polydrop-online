'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');
const httpServer = http.createServer(app);
const io = new Server(httpServer, { transports: ['polling', 'websocket'], maxHttpBufferSize: 12000 });
// HTML sempre atualizado depois de um deploy: evita misturar cliente antigo com servidor novo.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0, setHeaders: res => res.setHeader('Cache-Control', 'no-store') }));
const PORT = process.env.PORT || 3000;
const LIMIT = 4;
const STAGES = 5;
const ROUND_MS = 22000;
const BRIEFING_MS = 6000; // Cartão de missão antes de cada fase; jogo pausado.
const STAGE_COUNTDOWN_MS = 1800;
// As duas últimas fases aceleram de verdade, mantendo a dificuldade gradual.
const SPEED = [1,1.28,1.72,2.7,4.0];
const SPAWN_MS = [1000,850,650,425,265];
const GRACE_MS = 90000;
// Reação Surpresa: só Corrida Individual, após 5 acertos consecutivos.
const SPECIAL_STREAK = 5;
const SPECIAL_COOLDOWN = 28000; // 28s por atacante
const GLOBAL_SPECIAL_COOLDOWN = 9000; // 9s entre ataques da sala
const FIRST_SPECIAL_DELAY = 10000; // ninguém ataca na largada
const TARGET_SHIELD = 10000; // 10s de proteção após o efeito
const POWERS = {
 contamination: { duration: 6500, title: 'CONTAMINAÇÃO TOTAL' },
 acceleration: { duration: 5500, title: 'REAÇÃO TURBO' },
 inhibitor: { duration: 6500, title: 'INIBIDOR EXTREMO' }
};
const COLORS = ['#5eead4','#818cf8','#fb7185','#fbbf24'];
const DATA = [
 {polymer:'PVC',monomer:'Cloreto de vinila',color:'#34d399',formula:'n CH₂=CHCl → [–CH₂–CHCl–]ₙ',use:'Canos e revestimentos',fact:'Muitas moléculas de cloreto de vinila se ligam em uma longa cadeia de PVC.'},
 {polymer:'Polietileno',monomer:'Eteno',color:'#60a5fa',formula:'n CH₂=CH₂ → [–CH₂–CH₂–]ₙ',use:'Sacolas e embalagens',fact:'Várias moléculas de eteno se ligam para formar polietileno.'},
 {polymer:'Poliestireno',monomer:'Estireno',color:'#fbbf24',formula:'n CH₂=CH–C₆H₅ → [–CH₂–CH(C₆H₅)–]ₙ',use:'Copos e isopor (EPS)',fact:'Estirenos se unem em cadeias de poliestireno.'},
 {polymer:'PTFE (Teflon)',monomer:'Tetrafluoroetileno',color:'#a78bfa',formula:'n CF₂=CF₂ → [–CF₂–CF₂–]ₙ',use:'Revestimentos de baixo atrito',fact:'O tetrafluoroetileno forma cadeias de PTFE.'},
 {polymer:'Polipropileno',monomer:'Propeno',color:'#f472b6',formula:'n CH₂=CH–CH₃ → [–CH₂–CH(CH₃)–]ₙ',use:'Potes e tampas',fact:'Propenos se ligam em cadeias de polipropileno.'}
];
const rooms = new Map();
const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const random = (a,b) => a + Math.random() * (b-a);
const clamp = (n,a,b) => Math.max(a, Math.min(b,n));
const makeId = () => crypto.randomBytes(12).toString('hex');
function makeCode() {
 let code;
 do { code = Array.from(crypto.randomBytes(5),b=>letters[b%letters.length]).join(''); }
 while(rooms.has(code));
 return code;
}
function validToken(t) { return typeof t==='string' && /^[a-zA-Z0-9_-]{20,120}$/.test(t); }
function nameOf(n) { return typeof n==='string' ? (n.replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,18)||'Cientista'):'Cientista'; }
function publicPlayer(p) {
 return { id:p.id, name:p.name, x:p.x, score:p.score, hits:p.hits, mistakes:p.mistakes, streak:p.streak, targetIdx:p.targetIdx, chain:p.chain, pendingSpecial:p.pendingSpecial, specialCooldownUntil:p.specialCooldownUntil,
  effect:p.effect && p.effect.until>Date.now()?p.effect:null,
  color:p.color, connected:p.connected };
}
function roster(r) { return [...r.players.values()].map(publicPlayer).sort((a,b)=>b.score-a.score || b.hits-a.hits || a.name.localeCompare(b.name)); }
function info(r) {
 return {code:r.code,mode:r.mode,state:r.state,hostId:r.hostId,players:roster(r),stage:r.stage,maxPlayers:LIMIT,
  briefingUntil:r.state==='briefing'?r.briefingUntil:0,
  countdown:r.state==='countdown'?Math.max(0,Math.ceil((r.countdownUntil-Date.now())/1000)):0,
  countdownUntil:r.countdownUntil,remaining:r.state==='playing'?Math.max(0,r.stageUntil-Date.now()):0,roundId:r.roundId};
}
function emitInfo(r){ io.to(r.code).emit('room:info',info(r)); }
function createRoom(mode){
 const r={code:makeCode(),mode,state:'lobby',hostId:null,players:new Map(),privateDrops:new Map(),drops:[],nextId:1,
  stage:0,roundId:0,briefingUntil:0,countdownUntil:0,stageUntil:0,spawnAt:0,nextSpecialAt:0,lastTick:Date.now()};
 rooms.set(r.code,r);return r;
}
function detach(socket, intentional=false){
 const code=socket.data.code, id=socket.data.playerId;
 socket.data.code=null;socket.data.playerId=null;
 if(!code||!id) return;
 socket.leave(code);
 const r=rooms.get(code), p=r?.players.get(id);
 // Desconexão antiga de uma aba substituída nunca expulsa a sessão nova.
 if(!p || p.socketId!==socket.id) return;
 p.socketId=null;p.connected=false;p.disconnectedAt=Date.now();
 if(intentional){
  r.players.delete(id);r.privateDrops.delete(id);
  if(r.hostId===id)r.hostId=[...r.players.keys()][0]||null;
 }
 if(r.players.size===0){rooms.delete(code);return;}
 emitInfo(r);
}
function findToken(r,token){return [...r.players.values()].find(p=>p.token===token);}
function enter(socket,r,args){
 if(!validToken(args.token))throw Error('Atualize a página e tente novamente.');
 let p=findToken(r,args.token);
 if(!p){
  if(!['lobby','finished'].includes(r.state))throw Error('A partida já começou. Aguarde a próxima.');
  if(r.players.size>=LIMIT)throw Error('Sala cheia (4 jogadores).');
 }
 // Troca de sala é intencional; reentrada na mesma sala não é.
 if(socket.data.code && (socket.data.code!==r.code || socket.data.playerId!==p?.id)) detach(socket,true);
 if(!p){
  const id=makeId();
  p={id,token:args.token,socketId:null,connected:false,disconnectedAt:0,name:nameOf(args.name),x:.5,score:0,hits:0,mistakes:0,streak:0,
    targetIdx:0,learned:new Set(),color:COLORS[r.players.size%COLORS.length],moveAt:0,
    chain:0,pendingSpecial:false,specialCooldownUntil:0,effect:null,shieldUntil:0,
    barHalfX:.036,dropRx:.065,dropRy:.054,barLineHalfY:.005,
    cupSideHalfX:.042,cupSideDepth:.048,moveHistory:[],moveSeq:-1};
  r.players.set(id,p);
  r.privateDrops.set(id,[]);
  if(!r.hostId)r.hostId=id;
 }
 // Se outra conexão usou esta sessão, só ela sai; o participante continua.
 if(p.socketId && p.socketId!==socket.id){
  const old=io.sockets.sockets.get(p.socketId);
  if(old){old.data.playerId=null;old.data.code=null;old.leave(r.code);old.emit('room:replaced');old.disconnect(true);}
 }
 p.socketId=socket.id;p.connected=true;p.disconnectedAt=0;
 socket.join(r.code);socket.data.code=r.code;socket.data.playerId=p.id;
 const snapshot={...info(r),youId:p.id};
 socket.emit('room:joined',snapshot);
 emitInfo(r);
 return snapshot;
}
// A missão no laboratório é uma responsabilidade exclusiva por jogador.
// São sorteados sem repetição 1 dos 5 monômeros disponíveis, a cada fase.
function assignMissions(r){
 const deck=DATA.map((_,i)=>i);
 for(let i=deck.length-1;i>0;i--){
  const j=Math.floor(Math.random()*(i+1));
  [deck[i],deck[j]]=[deck[j],deck[i]];
 }
 let slot=0;
 for(const p of r.players.values()){
  p.targetIdx=r.mode==='arena'?deck[slot++]:r.stage;
 }
}
// Não há geração, queda nem pontuação durante a apresentação da missão.
function beginBriefing(r,now){
 assignMissions(r);
 r.state='briefing';r.briefingUntil=now+BRIEFING_MS;
 r.countdownUntil=0;r.stageUntil=0;r.spawnAt=0;
 r.drops=[];
 for(const p of r.players.values()){
  r.privateDrops.set(p.id,[]);
  // Evita ataques de uma fase anterior atrapalharem a nova missão.
  p.effect=null;
 }
 emitInfo(r);
}
function spawn(r,forcedWrong=false){
 let idx;
 if(r.mode==='arena'){
  const assigned=[...r.players.values()].filter(p=>p.connected).map(p=>p.targetIdx);
  const unassigned=DATA.map((_,i)=>i).filter(i=>!assigned.includes(i));
  // Distribuição justa: cerca de 75% dos itens são missões ativas,
  // divididos igualmente entre as responsabilidades dos jogadores.
  // Os demais são distrações, que ninguém deve pegar.
  const pool=assigned.length && (Math.random()<.75 || !unassigned.length)?assigned:unassigned;
  idx=pool[Math.floor(Math.random()*pool.length)] ?? r.stage;
 }else{
  const correct=!forcedWrong&&Math.random()<.56;
  const pool=correct?[r.stage]:DATA.map((_,i)=>i).filter(i=>i!==r.stage);
  idx=pool[Math.floor(Math.random()*pool.length)];
 }
 return{id:r.nextId++,x:random(.19,.81),y:-.065,idx,vy:random(.19,.255)*SPEED[r.stage],toxic:forcedWrong};
}
// O servidor decide ataque, alvo e duração. Nunca aceita um 'acerto' enviado pelo cliente.
function launchSpecial(r,p,now){
 if(r.mode!=='race'||!p.connected||!p.pendingSpecial||
    now<p.specialCooldownUntil||now<r.nextSpecialAt)return;
 const targets=[...r.players.values()].filter(v=>v.id!==p.id&&v.connected&&
  (!v.effect||v.effect.until<=now)&&v.shieldUntil<=now);
 if(!targets.length)return; // Um especial fica armazenado, sem acumular outro.
 const target=targets[Math.floor(Math.random()*targets.length)];
 const types=Object.keys(POWERS),type=types[Math.floor(Math.random()*types.length)];
 const duration=POWERS[type].duration;
 target.effect={type,until:now+duration,fromId:p.id};
 target.shieldUntil=now+duration+TARGET_SHIELD;
 p.pendingSpecial=false;p.specialCooldownUntil=now+SPECIAL_COOLDOWN;
 r.nextSpecialAt=now+GLOBAL_SPECIAL_COOLDOWN;
 io.to(r.code).emit('game:power',{
  sourceId:p.id,sourceName:p.name,targetId:target.id,targetName:target.name,
  type,title:POWERS[type].title,until:target.effect.until,
  durationMs:duration,roundId:r.roundId
 });
}
function processSpecials(r,now){
 if(r.mode!=='race')return;
 for(const p of r.players.values()){
  if(p.effect&&p.effect.until<=now)p.effect=null;
 }
 for(const p of r.players.values())if(p.pendingSpecial)launchSpecial(r,p,now);
}
function catchDrop(r,p,d){
 const correctIdx=r.mode==='arena'?p.targetIdx:r.stage;
 const right=d.idx===correctIdx;
 let points=0;
 if(right){
  p.streak++;p.hits++;
  const bonus=p.streak%3===0?5:0;
  const nominal=10+bonus;
  const inhibited=r.mode==='race'&&p.effect?.type==='inhibitor'&&p.effect.until>Date.now();
  points=inhibited?0:nominal;
  p.score+=points;
  if(r.mode==='race'&&!p.pendingSpecial&&!inhibited){
   p.chain++;
   if(p.chain>=SPECIAL_STREAK){p.chain=0;p.pendingSpecial=true;}
  }
  if(!p.learned.has(correctIdx)){
   p.learned.add(correctIdx);
   if(p.socketId)io.to(p.socketId).emit('game:discovery',DATA[correctIdx]);
  }
 }else{
  p.streak=0;p.chain=0;p.mistakes++;
  const contaminated=r.mode==='race'&&p.effect?.type==='contamination'&&p.effect.until>Date.now();
  const penalty=contaminated?10:5;
  points=-Math.min(penalty,p.score);p.score=Math.max(0,p.score-penalty);
 }
 // Difundido para TODOS: a pista da pessoa correta mostra brilho/partículas.
 io.to(r.code).emit('game:hit',{
  playerId:p.id,ok:right,points,inhibited:right&&points===0,bonus:right&&p.streak%3===0,
  id:d.id,x:d.x,y:d.y,color:right?DATA[d.idx].color:'#fb7185',
  chain:p.chain,pendingSpecial:p.pendingSpecial,roundId:r.roundId
 });
 if(right&&r.mode==='race')launchSpecial(r,p,Date.now());
}
// v11: o movimento do celular é carimbado no instante do gesto.
// A decisão da captura espera até 200 ms por pacotes em trânsito, e compara
// a posição HISTÓRICA do copo ao momento em que a molécula passou pela borda.
// Atrasar a confirmação é preferível a punir um desvio que já aconteceu.
const CATCH_PLANE=.81;
const COLLISION_BUFFER_MS=200;
function cupXAt(p, t){
 const history=p.moveHistory||[];
 if(!history.length)return p.x;
 // Posição em degraus, nunca varrer/interpolar a trajetória lateral do copo.
 for(let i=history.length-1;i>=0;i--)if(history[i].t<=t)return history[i].x;
 return history[0].x;
}
function crossesCup(previousY,newY,p,d,atTime){
 if(!p.connected||newY<previousY)return false;
 const x=cupXAt(p,atTime);
 const rx=p.dropRx,ry=p.dropRy+p.barLineHalfY;
 const dx=Math.abs(x-d.x);
 const beyondBar=Math.max(0,dx-p.barHalfX);
 const closestY=clamp(CATCH_PLANE,previousY,newY);
 const gapY=Math.abs(CATCH_PLANE-closestY);
 if(beyondBar<=rx && (beyondBar/rx)**2+(gapY/ry)**2<=1)return true;
 const sideGap=Math.abs(dx-p.cupSideHalfX);
 if(sideGap>rx)return false;
 const top=CATCH_PLANE,bottom=top+p.cupSideDepth;
 const verticalGap=previousY>bottom?previousY-bottom:(newY<top?top-newY:0);
 return (sideGap/rx)**2+(verticalGap/ry)**2<=1;
}
function pendingCollision(r,p,d,previousY,newY,now,dt){
 if(!d.collisionSamples)d.collisionSamples=[];
 const top=CATCH_PLANE-p.dropRy-p.barLineHalfY;
 const bottom=CATCH_PLANE+p.cupSideDepth+p.dropRy;
 // Registra somente trechos em que a molécula realmente está próxima ao copo.
 if(newY>=top && previousY<=bottom){
  d.collisionSamples.push({a:previousY,b:newY,t:now-Math.round(dt*500)});
 }
 let caught=false;
 while(d.collisionSamples.length && now-d.collisionSamples[0].t>=COLLISION_BUFFER_MS){
  const sample=d.collisionSamples.shift();
  if(crossesCup(sample.a,sample.b,p,d,sample.t)){caught=true;break;}
 }
 return caught;
}
function updateDrops(r,dt,now){
 if(r.mode==='arena'){
  // Modo compartilhado permanece sem compensação histórica nesta versão.
  for(let i=r.drops.length-1;i>=0;i--){
   const d=r.drops[i],previousY=d.y;d.y+=d.vy*dt;
   let winner=null,dist=Infinity;
   for(const p of r.players.values()){
    // Arena: usar posição atual (sem fila, para não alterar as regras compartilhadas).
    const current={...p,moveHistory:[{t:now-1,x:p.x}]};
    if(!crossesCup(previousY,d.y,current,d,now))continue;
    const gap=Math.abs(p.x-d.x);
    if(gap<dist){winner=p;dist=gap;}
   }
   if(winner){catchDrop(r,winner,d);r.drops.splice(i,1);}
   else if(d.y>1.08)r.drops.splice(i,1);
  }
 }else for(const [id,drops] of r.privateDrops){
  const p=r.players.get(id);if(!p||!p.connected)continue;
  const speed=p.effect?.type==='acceleration'&&p.effect.until>now
   ?(r.stage>=3?1.45:1.85):1;
  for(let i=drops.length-1;i>=0;i--){
   const d=drops[i],previousY=d.y;d.y+=d.vy*dt*speed;
   if(pendingCollision(r,p,d,previousY,d.y,now,dt)){
    catchDrop(r,p,d);drops.splice(i,1);
   }else if(d.y>1.08 && !(d.collisionSamples?.length))drops.splice(i,1);
  }
 }
}
function startMatch(r){
 const now=Date.now();
 r.stage=0;r.roundId++;r.drops=[];r.nextId=1;r.privateDrops.clear();
 const all=[...r.players.values()];
 for(const [i,p] of all.entries()){
  p.x=r.mode==='arena'?.10+.80*(i+.5)/all.length:.5;
  p.score=0;p.hits=0;p.mistakes=0;p.streak=0;p.chain=0;
  p.pendingSpecial=false;p.specialCooldownUntil=now+FIRST_SPECIAL_DELAY;
  p.effect=null;p.shieldUntil=0;p.moveHistory=[{t:now-1000,x:p.x}];p.moveSeq=-1;p.learned.clear();
  r.privateDrops.set(p.id,[]);
 }
 r.nextSpecialAt=now+FIRST_SPECIAL_DELAY;
 r.lastTick=now;
 beginBriefing(r,now);
}
function finish(r){
 r.state='finished';r.briefingUntil=0;r.countdownUntil=0;r.drops=[];
 io.to(r.code).emit('game:finished',{players:roster(r),mode:r.mode,roundId:r.roundId});emitInfo(r);
}
function tick(){
 const now=Date.now();
 for(const r of rooms.values()){
  const dt=clamp((now-r.lastTick)/1000,0,.12);r.lastTick=now;
  if(r.state==='briefing'&&now>=r.briefingUntil){
   r.state='countdown';r.briefingUntil=0;r.countdownUntil=now+STAGE_COUNTDOWN_MS;
   emitInfo(r);
  }
  if(r.state==='countdown'&&now>=r.countdownUntil){
   r.state='playing';r.countdownUntil=0;r.stageUntil=now+ROUND_MS;r.spawnAt=now+400;
   emitInfo(r);io.to(r.code).emit('game:stage',{stage:r.stage,roundId:r.roundId});
  }
  if(r.state!=='playing')continue;
  if(now>=r.stageUntil){
   if(r.stage===STAGES-1){finish(r);continue;}
   r.stage++;
   beginBriefing(r,now);
   continue; // Evita gerar moléculas durante o cartão.
  }
  processSpecials(r,now);
  const interval=r.mode==='arena'?Math.max(205,SPAWN_MS[r.stage]/Math.sqrt(Math.max(1,[...r.players.values()].filter(p=>p.connected).length))):SPAWN_MS[r.stage];
  let count=0;
  while(now>=r.spawnAt&&count++<3){
   if(r.mode==='arena')r.drops.push(spawn(r));
   else for(const [id,arr] of r.privateDrops){
    const p=r.players.get(id);if(!p?.connected)continue;
    arr.push(spawn(r));
    // Tempestade: 2 a 3 impurezas extras a CADA pulso de geração.
    if(p.effect?.type==='contamination'&&p.effect.until>now){
     arr.push(spawn(r,true),spawn(r,true));
     if(Math.random()<.65)arr.push(spawn(r,true));
    }
   }
   r.spawnAt+=interval;
  }
  updateDrops(r,dt,now);
 }
}
setInterval(tick,50);
setInterval(()=>{
 const now=Date.now();
 for(const r of rooms.values()){
  if(r.state!=='playing')continue;
  const base={stage:r.stage,roundId:r.roundId,remaining:Math.max(0,r.stageUntil-now),players:roster(r),mode:r.mode};
  // 10 atualizações por segundo; cada navegador desenha suas 4 pistas a até 60 FPS.
  // Corrida envia as 4 coleções de gotas, não apenas a coleção do próprio jogador.
  const mapDrops=arr=>arr.map(d=>({id:d.id,x:d.x,y:d.y,idx:d.idx,vy:d.vy,toxic:!!d.toxic}));
  if(r.mode==='arena')io.to(r.code).emit('game:world',{...base,drops:mapDrops(r.drops)});
  else {
   const lanes={};
   for(const p of r.players.values()){
    const speed=p.effect?.type==='acceleration'&&p.effect.until>now?(r.stage>=3?1.45:1.85):1;
    lanes[p.id]=mapDrops(r.privateDrops.get(p.id)||[]).map(d=>({...d,vy:d.vy*speed}));
   }
   io.to(r.code).emit('game:world',{...base,lanes});
  }
 }
},100);
setInterval(()=>{
 const now=Date.now();
 for(const r of rooms.values()){
  for(const p of [...r.players.values()])if(!p.connected&&now-p.disconnectedAt>GRACE_MS){
   r.players.delete(p.id);r.privateDrops.delete(p.id);
   if(r.hostId===p.id)r.hostId=null;
  }
  if(!r.players.size){rooms.delete(r.code);continue;}
  if(!r.hostId||!r.players.get(r.hostId)?.connected){
   const connected=[...r.players.values()].find(p=>p.connected);
   if(connected && (!r.hostId || now-r.players.get(r.hostId).disconnectedAt>10000))r.hostId=connected.id;
  }
  emitInfo(r);
 }
},5000);

io.on('connection',socket=>{
 socket.data.code=null;socket.data.playerId=null;
 socket.on('room:create',(args={},ack=()=>{})=>{
  try{
   if(!['race','arena'].includes(args.mode))throw Error('Modo inválido.');
   if(!validToken(args.token))throw Error('Atualize a página e tente novamente.');
   // Evita sala abandonada quando alguém cria outra.
   detach(socket,true);
   const r=createRoom(args.mode);
   const result=enter(socket,r,args);
   ack({ok:true,room:result});
  }catch(e){ack({ok:false,error:e.message});}
 });
 socket.on('room:join',(args={},ack=()=>{})=>{
  try{
   const code=String(args.code||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,5);
   const r=rooms.get(code);
   if(!r)throw Error('Sala não encontrada. Se o servidor reiniciou, crie outra.');
   ack({ok:true,room:enter(socket,r,args)});
  }catch(e){ack({ok:false,error:e.message});}
 });
 socket.on('room:leave',()=>detach(socket,true));
 socket.on('room:start',(_args={},ack=()=>{})=>{
  const r=rooms.get(socket.data.code);
  if(!r||r.hostId!==socket.data.playerId)return ack({ok:false,error:'Só o líder pode iniciar.'});
  if(!['lobby','finished'].includes(r.state))return ack({ok:false,error:'Partida já iniciada.'});
  if(![...r.players.values()].some(p=>p.connected))return ack({ok:false,error:'Sem jogadores conectados.'});
  startMatch(r);ack({ok:true});
 });
 // O cliente manda as dimensões NORMALIZADAS da bolinha e da linha visível.
 // Limites defensivos impedem hitboxes absurdas. A regra permanece no servidor.
 socket.on('game:layout',g=>{
  const r=rooms.get(socket.data.code),p=r?.players.get(socket.data.playerId);
  if(!p||p.socketId!==socket.id||!g||typeof g!=='object')return;
  const keys=['barHalfX','dropRx','dropRy','barLineHalfY','cupSideHalfX','cupSideDepth'];
  if(!keys.every(k=>Number.isFinite(g[k])))return;
  p.barHalfX=clamp(g.barHalfX,.008,.075);
  p.cupSideHalfX=clamp(g.cupSideHalfX,.012,.09);
  p.cupSideDepth=clamp(g.cupSideDepth,.008,.09);
  p.dropRx=clamp(g.dropRx,.014,.105);
  p.dropRy=clamp(g.dropRy,.014,.115);
  p.barLineHalfY=clamp(g.barLineHalfY,.001,.02);
 });
 // Relógio de referência: resposta com timestamp para estimar ida/volta.
 socket.on('game:clock',(_payload,ack)=>{
  if(typeof ack==='function')ack({serverNow:Date.now()});
 });
 socket.on('game:move',payload=>{
  const r=rooms.get(socket.data.code);
  if(!r||r.state!=='playing')return;
  const p=r.players.get(socket.data.playerId);
  if(!p||p.socketId!==socket.id)return;
  const x=typeof payload==='number'?payload:payload?.x;
  if(!Number.isFinite(x))return;
  const now=Date.now();
  const seq=Number.isSafeInteger(payload?.seq)?payload.seq:p.moveSeq+1;
  if(seq<=p.moveSeq)return;
  p.moveSeq=seq;
  const next=clamp(x,.045,.955);
  const requested=Number.isFinite(payload?.t)?payload.t:now;
  const time=clamp(requested,now-300,now+20);
  // Inserção ordenada: um pacote atrasado pode ter ocorrido antes de uma captura.
  const history=p.moveHistory||(p.moveHistory=[]);
  let i=history.length;
  while(i>0&&history[i-1].t>time)i--;
  history.splice(i,0,{t:time,x:next});
  while(history.length>2&&history[1].t<now-1000)history.shift();
  p.x=next;p.moveAt=now;
 });
 socket.on('disconnect',()=>detach(socket,false));
});
app.get('/api/qr/:code',async(req,res)=>{
 const code=String(req.params.code||'').toUpperCase();
 if(!/^[A-Z2-9]{5}$/.test(code)||!rooms.has(code))return res.status(404).send('Sala não encontrada');
 const proto=req.headers['x-forwarded-proto']==='https'?'https':req.protocol;
 const link=`${proto}://${req.get('host')}/?sala=${code}`;
 try{res.set('Content-Type','image/svg+xml');res.set('Cache-Control','no-store');res.send(await QRCode.toString(link,{type:'svg',margin:1,scale:6,color:{dark:'#11283b',light:'#ffffffff'}}));}
 catch{res.status(500).send('Não foi possível gerar o QR Code.');}
});
app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
httpServer.listen(PORT,()=>console.log(`PolyDrop v9: missões por fase, responsabilidades no laboratório e pontuação única na porta ${PORT}`));