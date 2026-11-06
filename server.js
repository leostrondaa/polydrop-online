'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');
const Collision = require('./public/collision.js');

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
const RULES_MS = 5400; // Três telas rápidas, uma regra por vez, sincronizadas na sala.
const BRIEFING_MS = 4800; // Cartão de química por fase.
const FIRST_BRIEFING_MS = 3600; // Evita uma espera longa depois das regras iniciais.
const STAGE_COUNTDOWN_MS = 1800;
// Cooperativo: objetivo por etapa, 5 erros individuais e funções herdadas.
const COOP_LIVES = 5;
const COOP_GOALS = [80,110,140,170,200];
const COOP_SPEED = [.84,1.02,1.24,1.52,1.65];
// 5ª fase levemente mais lenta (~12,5% no individual e ~10,8% no cooperativo).
const SPEED = [1,1.28,1.72,2.7,3.5];
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
const COLORS = ['#F5CF20','#F0F0F0','#AFAFAF','#777777'];
const DATA = [
 {polymer:'PVC',monomer:'Cloreto de vinila',color:'#F5CF20',formula:'n CH₂=CHCl → [–CH₂–CHCl–]ₙ',use:'Canos e revestimentos',fact:'Muitas moléculas de cloreto de vinila se ligam em uma longa cadeia de PVC.'},
 {polymer:'Polietileno',monomer:'Eteno',color:'#F5CF20',formula:'n CH₂=CH₂ → [–CH₂–CH₂–]ₙ',use:'Sacolas e embalagens',fact:'Várias moléculas de eteno se ligam para formar polietileno.'},
 {polymer:'Poliestireno',monomer:'Estireno',color:'#F5CF20',formula:'n CH₂=CH–C₆H₅ → [–CH₂–CH(C₆H₅)–]ₙ',use:'Copos e isopor (EPS)',fact:'Estirenos se unem em cadeias de poliestireno.'},
 {polymer:'PTFE (Teflon)',monomer:'Tetrafluoroetileno',color:'#F5CF20',formula:'n CF₂=CF₂ → [–CF₂–CF₂–]ₙ',use:'Revestimentos de baixo atrito',fact:'O tetrafluoroetileno forma cadeias de PTFE.'},
 {polymer:'Polipropileno',monomer:'Propeno',color:'#F5CF20',formula:'n CH₂=CH–CH₃ → [–CH₂–CH(CH₃)–]ₙ',use:'Potes e tampas',fact:'Propenos se ligam em cadeias de polipropileno.'}
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
 return { id:p.id, name:p.name, x:p.x, score:p.score, hits:p.hits, mistakes:p.mistakes, streak:p.streak, targetIdx:p.targetIdx, targets:[...p.targets], lives:p.lives, eliminated:p.eliminated, chain:p.chain, pendingSpecial:p.pendingSpecial, specialCooldownUntil:p.specialCooldownUntil,
  effect:p.effect && p.effect.until>Date.now()?p.effect:null,
  color:p.color, connected:p.connected };
}
function roster(r) { return [...r.players.values()].map(publicPlayer).sort((a,b)=>b.score-a.score || b.hits-a.hits || a.name.localeCompare(b.name)); }
function info(r) {
 return {code:r.code,mode:r.mode,state:r.state,hostId:r.hostId,players:roster(r),stage:r.stage,maxPlayers:LIMIT,
  rulesUntil:r.state==='rules'?r.rulesUntil:0,
  briefingUntil:r.state==='briefing'?r.briefingUntil:0,
  countdown:r.state==='countdown'?Math.max(0,Math.ceil((r.countdownUntil-Date.now())/1000)):0,
  countdownUntil:r.countdownUntil,remaining:r.state==='playing'&&r.mode==='race'?Math.max(0,r.stageUntil-Date.now()):0,
  teamScore:r.teamScore,stageScore:r.stageScore,stageGoal:r.stageGoal,coopLives:COOP_LIVES,result:r.result,roundId:r.roundId};
}
function emitInfo(r){ io.to(r.code).emit('room:info',info(r)); }
function createRoom(mode){
 const r={code:makeCode(),mode,state:'lobby',hostId:null,players:new Map(),privateDrops:new Map(),drops:[],nextId:1,
  stage:0,roundId:0,rulesUntil:0,briefingUntil:0,countdownUntil:0,stageUntil:0,spawnAt:0,nextSpecialAt:0,lastTick:Date.now(),
  stageRoles:[],coopRoleCount:0,teamScore:0,stageScore:0,stageGoal:COOP_GOALS[0],result:null};
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
 if(r.mode==='arena'&&r.state!=='lobby')rebalanceRoles(r);
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
    targetIdx:0,targets:[],lives:COOP_LIVES,eliminated:false,learned:new Set(),color:COLORS[r.players.size%COLORS.length],moveAt:0,
    chain:0,pendingSpecial:false,specialCooldownUntil:0,effect:null,shieldUntil:0,
    collisionGeometry:Collision.geometryForLane(376,480),moveSeq:-1};
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
 if(r.mode==='arena'&&r.state!=='lobby')rebalanceRoles(r);
 socket.join(r.code);socket.data.code=r.code;socket.data.playerId=p.id;
 const snapshot={...info(r),youId:p.id};
 socket.emit('room:joined',snapshot);
 emitInfo(r);
 return snapshot;
}
// Cada etapa mantém o mesmo número de monômeros da equipe inicial.
// Se um jogador morrer ou desconectar, outro herda os elementos sem dono.
function coopActive(r){return [...r.players.values()].filter(p=>p.connected&&!p.eliminated);}
function rebalanceRoles(r){
 if(r.mode!=='arena')return;
 const active=coopActive(r);
 for(const p of r.players.values()){p.targets=[];p.targetIdx=-1;}
 if(!active.length)return;
 for(const role of r.stageRoles){
  let owner=active.find(p=>p.id===role.ownerId);
  if(!owner)owner=active.reduce((best,p)=>!best||p.targets.length<best.targets.length?p:best,null);
  owner.targets.push(role.idx);
 }
 for(const p of active)p.targetIdx=p.targets[0]??-1;
}
function assignMissions(r){
 const deck=DATA.map((_,i)=>i);
 for(let i=deck.length-1;i>0;i--){
  const j=Math.floor(Math.random()*(i+1));
  [deck[i],deck[j]]=[deck[j],deck[i]];
 }
 if(r.mode==='arena'){
  const active=coopActive(r);
  const count=Math.min(4,r.coopRoleCount||1);
  r.stageRoles=deck.slice(0,count).map((idx,i)=>({idx,ownerId:active.length?active[i%active.length].id:null}));
  rebalanceRoles(r);
 }else{
  r.stageRoles=[];
  for(const p of r.players.values()){p.targetIdx=r.stage;p.targets=[r.stage];}
 }
}
// Não há geração, queda nem pontuação durante a apresentação da missão.
function beginBriefing(r,now){
 if(r.mode==='arena'){r.stageScore=0;r.stageGoal=COOP_GOALS[r.stage];}
 assignMissions(r);
 r.state='briefing';r.rulesUntil=0;r.briefingUntil=now+(r.stage===0?FIRST_BRIEFING_MS:BRIEFING_MS);
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
  const assigned=r.stageRoles.map(role=>role.idx);
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
 return{id:r.nextId++,x:random(.19,.81),y:-.065,idx,vy:random(.19,.255)*(r.mode==='arena'?COOP_SPEED[r.stage]:SPEED[r.stage]),toxic:forcedWrong};
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
function catchDrop(r,p,d,observedY=d.y){
 const cooperative=r.mode==='arena';
 const right=cooperative?p.targets.includes(d.idx):d.idx===r.stage;
 let points=0,eliminatedNow=false;
 if(right){
  p.streak++;p.hits++;
  const bonus=p.streak%3===0?5:0;
  const nominal=10+bonus;
  const inhibited=!cooperative&&p.effect?.type==='inhibitor'&&p.effect.until>Date.now();
  points=inhibited?0:nominal;
  p.score+=points;
  if(cooperative){r.stageScore+=points;r.teamScore+=points;}
  if(!cooperative&&!p.pendingSpecial&&!inhibited){
   p.chain++;
   if(p.chain>=SPECIAL_STREAK){p.chain=0;p.pendingSpecial=true;}
  }
  if(!p.learned.has(d.idx)){
   p.learned.add(d.idx);
   if(p.socketId)io.to(p.socketId).emit('game:discovery',DATA[d.idx]);
  }
 }else{
  p.streak=0;p.chain=0;p.mistakes++;
  if(cooperative){
   p.lives=Math.max(0,p.lives-1);
   if(p.lives===0){p.eliminated=true;eliminatedNow=true;rebalanceRoles(r);}
  }else{
   const contaminated=p.effect?.type==='contamination'&&p.effect.until>Date.now();
   const penalty=contaminated?10:5;
   points=-Math.min(penalty,p.score);p.score=Math.max(0,p.score-penalty);
  }
 }
 io.to(r.code).emit('game:hit',{
  playerId:p.id,mode:r.mode,ok:right,points,lifeLost:cooperative&&!right,
  lives:p.lives,eliminated:p.eliminated,inhibited:right&&points===0,
  bonus:right&&p.streak%3===0,id:d.id,x:d.x,y:observedY,
  color:right?DATA[d.idx].color:'#F2F2F2',chain:p.chain,pendingSpecial:p.pendingSpecial,roundId:r.roundId
 });
 if(cooperative){
  if(eliminatedNow)io.to(r.code).emit('game:eliminated',{playerId:p.id,name:p.name,roundId:r.roundId});
  if(![...r.players.values()].some(v=>!v.eliminated)){
   finish(r,'defeat');return;
  }
  if(r.stageScore>=r.stageGoal){
   if(r.stage===STAGES-1){finish(r,'victory');return;}
   r.stage++;beginBriefing(r,Date.now());return;
  }
  emitInfo(r);
 }else if(right)launchSpecial(r,p,Date.now());
}
// v13: NENHUMA captura automática. O cliente detecta o toque real que está
// mostrando na tela e envia uma tentativa. O servidor valida a geometria,
// identificação da molécula e o instante antes de pontuar. Isso elimina o
// acerto retroativo após um desvio rápido, independente do ping.
function updateDrops(r,dt,now){
 if(r.mode==='arena'){
  for(let i=r.drops.length-1;i>=0;i--){
   const d=r.drops[i];d.y+=d.vy*dt;
   // Margem após sair da tela para a confirmação chegar pela rede.
   if(d.y>1.42)r.drops.splice(i,1);
  }
 }else for(const [id,drops] of r.privateDrops){
  const p=r.players.get(id);if(!p||!p.connected)continue;
  const speed=p.effect?.type==='acceleration'&&p.effect.until>now
   ?(r.stage>=3?1.45:1.85):1;
  for(let i=drops.length-1;i>=0;i--){
   const d=drops[i];d.y+=d.vy*dt*speed;
   if(d.y>1.42)drops.splice(i,1);
  }
 }
}
function validateClientCatch(r,p,g,now){
 if(!g||!Number.isSafeInteger(g.dropId)||g.roundId!==r.roundId)return null;
 if(!Number.isFinite(g.x)||!Number.isFinite(g.observedY))return null;
 if(g.x<.045||g.x>.955||g.observedY<.5||g.observedY>1.3)return null;
 // Eventos game:move e game:catch do mesmo socket chegam na mesma ordem.
 // Não confie no x isolado enviado pelo cliente.
 if(Math.abs(g.x-p.x)>.027 || !p.connected)return null;
 const drops=r.mode==='arena'?r.drops:r.privateDrops.get(p.id);
 if(!drops)return null;
 const index=drops.findIndex(d=>d.id===g.dropId);
 if(index<0)return null;
 const d=drops[index];
 if(!Collision.touchesCup(p.x,d.x,g.observedY,p.collisionGeometry))return null;
 const rate=d.vy*(r.mode==='race'&&p.effect?.type==='acceleration'&&p.effect.until>now?(r.stage>=3?1.45:1.85):1);
 // A estimativa do servidor é comparada ao quadro mostrado no celular.
 // A janela cobre ping/jitter, mas impede capturar uma molécula distante.
 const sampleAt=Number.isFinite(g.at)?g.at:now;
 if(sampleAt>now+100||sampleAt<now-700)return null;
 const expectedNowY=g.observedY+rate*Math.max(0,(now-sampleAt)/1000);
 if(Math.abs(d.y-expectedNowY)>.045+rate*.22)return null;
 return {drops,index,d,observedY:g.observedY};
}
function startMatch(r){
 const now=Date.now();
 r.stage=0;r.roundId++;r.drops=[];r.nextId=1;r.privateDrops.clear();
 r.teamScore=0;r.stageScore=0;r.stageGoal=COOP_GOALS[0];r.result=null;
 r.coopRoleCount=r.mode==='arena'?[...r.players.values()].filter(p=>p.connected).length:0;
 const all=[...r.players.values()];
 for(const [i,p] of all.entries()){
  p.x=r.mode==='arena'?.10+.80*(i+.5)/all.length:.5;
  p.score=0;p.hits=0;p.mistakes=0;p.streak=0;p.chain=0;
  p.lives=COOP_LIVES;p.eliminated=false;p.targets=[];
  p.pendingSpecial=false;p.specialCooldownUntil=now+FIRST_SPECIAL_DELAY;
  p.effect=null;p.shieldUntil=0;p.moveSeq=-1;p.learned.clear();
  r.privateDrops.set(p.id,[]);
 }
 r.nextSpecialAt=now+FIRST_SPECIAL_DELAY;
 r.lastTick=now;
 // Todos veem as regras antes de o servidor sortear as missões e liberar a fase.
 r.state='rules';r.rulesUntil=now+RULES_MS;r.briefingUntil=0;r.countdownUntil=0;r.stageUntil=0;r.spawnAt=0;
 emitInfo(r);
}
function finish(r,result='time'){
 r.state='finished';r.result=result;r.rulesUntil=0;r.briefingUntil=0;r.countdownUntil=0;r.drops=[];
 io.to(r.code).emit('game:finished',{players:roster(r),mode:r.mode,result,
  teamScore:r.teamScore,stage:r.stage,stageGoal:r.stageGoal,roundId:r.roundId});emitInfo(r);
}
function tick(){
 const now=Date.now();
 for(const r of rooms.values()){
  const dt=clamp((now-r.lastTick)/1000,0,.12);r.lastTick=now;
  if(r.state==='rules'&&now>=r.rulesUntil){
   beginBriefing(r,now);
   continue;
  }
  if(r.state==='briefing'&&now>=r.briefingUntil){
   r.state='countdown';r.briefingUntil=0;r.countdownUntil=now+STAGE_COUNTDOWN_MS;
   emitInfo(r);
  }
  if(r.state==='countdown'&&now>=r.countdownUntil){
   r.state='playing';r.countdownUntil=0;r.stageUntil=r.mode==='race'?now+ROUND_MS:0;r.spawnAt=now+400;
   emitInfo(r);io.to(r.code).emit('game:stage',{stage:r.stage,roundId:r.roundId});
  }
  if(r.state!=='playing')continue;
  if(r.mode==='race'&&now>=r.stageUntil){
   if(r.stage===STAGES-1){finish(r);continue;}
   r.stage++;
   beginBriefing(r,now);
   continue; // Evita gerar moléculas durante o cartão.
  }
  processSpecials(r,now);
  const interval=r.mode==='arena'?Math.max(270,SPAWN_MS[r.stage]/Math.sqrt(Math.max(1,coopActive(r).length))):SPAWN_MS[r.stage];
  let count=0;
  while(now>=r.spawnAt&&count++<3){
   if(r.mode==='arena'){
    if(coopActive(r).length)r.drops.push(spawn(r));
   }
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
  const base={serverNow:now,stage:r.stage,roundId:r.roundId,
   remaining:r.mode==='race'?Math.max(0,r.stageUntil-now):0,players:roster(r),mode:r.mode,
   teamScore:r.teamScore,stageScore:r.stageScore,stageGoal:r.stageGoal,coopLives:COOP_LIVES};
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
  if(r.mode==='arena'&&r.state==='playing')rebalanceRoles(r);
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
 // A mesma geometria das linhas visíveis é usada pelos dois lados.
 socket.on('game:layout',g=>{
  const r=rooms.get(socket.data.code),p=r?.players.get(socket.data.playerId);
  if(!p||p.socketId!==socket.id||!g||typeof g!=='object')return;
  const keys=['barHalfX','barY','sideTopHalfX','sideBottomHalfX','sideDepth','dropRx','dropRy'];
  if(!keys.every(k=>Number.isFinite(g[k])))return;
  const limits={barHalfX:[.008,.08],barY:[-.006,0],sideTopHalfX:[.01,.10],sideBottomHalfX:[.008,.095],sideDepth:[.02,.2],dropRx:[.013,.11],dropRy:[.013,.12]};
  p.collisionGeometry=Object.fromEntries(keys.map(k=>[k,clamp(g[k],...limits[k])]));
 });
 // Relógio de referência: resposta com timestamp para estimar ida/volta.
 socket.on('game:clock',(_payload,ack)=>{
  if(typeof ack==='function')ack({serverNow:Date.now()});
 });
 socket.on('game:move',payload=>{
  const r=rooms.get(socket.data.code);
  if(!r||r.state!=='playing')return;
  const p=r.players.get(socket.data.playerId);
  if(!p||p.socketId!==socket.id||(r.mode==='arena'&&p.eliminated))return;
  const x=typeof payload==='number'?payload:payload?.x;
  if(!Number.isFinite(x))return;
  const now=Date.now();
  const seq=Number.isSafeInteger(payload?.seq)?payload.seq:p.moveSeq+1;
  if(seq<=p.moveSeq)return;
  p.moveSeq=seq;
  const next=clamp(x,.045,.955);
  p.x=next;p.moveAt=now;
 });
 // Somente o contato confirmado pelo próprio quadro pode virar pontuação.
 socket.on('game:catch',(payload={},ack=()=>{})=>{
  const r=rooms.get(socket.data.code);
  if(!r||r.state!=='playing')return ack({ok:false,reason:'not-playing'});
  const p=r.players.get(socket.data.playerId);
  if(!p||p.socketId!==socket.id)return ack({ok:false,reason:'not-player'});
  if(r.mode==='arena'&&p.eliminated)return ack({ok:false,reason:'eliminated'});
  const hit=validateClientCatch(r,p,payload,Date.now());
  if(!hit)return ack({ok:false,reason:'invalid-contact'});
  hit.drops.splice(hit.index,1);
  catchDrop(r,p,hit.d,hit.observedY);
  ack({ok:true});
 });
 socket.on('disconnect',()=>detach(socket,false));
});
app.get('/api/qr/:code',async(req,res)=>{
 const code=String(req.params.code||'').toUpperCase();
 if(!/^[A-Z2-9]{5}$/.test(code)||!rooms.has(code))return res.status(404).send('Sala não encontrada');
 const proto=req.headers['x-forwarded-proto']==='https'?'https':req.protocol;
 const link=`${proto}://${req.get('host')}/?sala=${code}`;
 try{res.set('Content-Type','image/svg+xml');res.set('Cache-Control','no-store');res.send(await QRCode.toString(link,{type:'svg',margin:1,scale:6,color:{dark:'#080808',light:'#ffffffff'}}));}
 catch{res.status(500).send('Não foi possível gerar o QR Code.');}
});
app.get('/health',(_req,res)=>res.json({ok:true,rooms:rooms.size}));
httpServer.listen(PORT,()=>console.log(`PolyDrop v16: regras animadas e revisao de quimica na porta ${PORT}`));
