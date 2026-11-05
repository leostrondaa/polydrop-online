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
const LIMIT = 12;
const STAGES = 5;
const ROUND_MS = 22000;
const GRACE_MS = 90000;
const COLORS = ['#5eead4','#818cf8','#fb7185','#fbbf24','#38bdf8','#c084fc','#4ade80','#f472b6','#f97316','#a3e635','#fda4af','#22d3ee'];
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
 return { id:p.id, name:p.name, x:p.x, score:p.score, hits:p.hits, mistakes:p.mistakes, streak:p.streak, color:p.color, connected:p.connected };
}
function roster(r) { return [...r.players.values()].map(publicPlayer).sort((a,b)=>b.score-a.score || b.hits-a.hits || a.name.localeCompare(b.name)); }
function info(r) {
 return {code:r.code,mode:r.mode,state:r.state,hostId:r.hostId,players:roster(r),stage:r.stage,maxPlayers:LIMIT,
  countdown:r.state==='countdown'?Math.max(0,Math.ceil((r.countdownUntil-Date.now())/1000)):0,
  countdownUntil:r.countdownUntil,remaining:r.state==='playing'?Math.max(0,r.stageUntil-Date.now()):0,roundId:r.roundId};
}
function emitInfo(r){ io.to(r.code).emit('room:info',info(r)); }
function createRoom(mode){
 const r={code:makeCode(),mode,state:'lobby',hostId:null,players:new Map(),privateDrops:new Map(),drops:[],nextId:1,
  stage:0,roundId:0,countdownUntil:0,stageUntil:0,spawnAt:0,lastTick:Date.now()};
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
  if(r.players.size>=LIMIT)throw Error('Sala cheia (12 jogadores).');
 }
 // Troca de sala é intencional; reentrada na mesma sala não é.
 if(socket.data.code && (socket.data.code!==r.code || socket.data.playerId!==p?.id)) detach(socket,true);
 if(!p){
  const id=makeId();
  p={id,token:args.token,socketId:null,connected:false,disconnectedAt:0,name:nameOf(args.name),x:.5,score:0,hits:0,mistakes:0,streak:0,
    learned:new Set(),color:COLORS[r.players.size%COLORS.length],moveAt:0};
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
function spawn(r){
 const correct=Math.random()<.56;
 const options=correct?[r.stage]:DATA.map((_,i)=>i).filter(i=>i!==r.stage);
 const idx=options[Math.floor(Math.random()*options.length)];
 return{id:r.nextId++,x:random(.07,.93),y:-.055,idx,vy:random(.185,.255)+r.stage*.015};
}
function catchDrop(r,p,d){
 if(d.idx===r.stage){
  p.streak++;p.hits++;const bonus=p.streak%3===0?5:0;p.score+=10+bonus;
  io.to(p.socketId).emit('game:hit',{ok:true,bonus,x:d.x,color:DATA[d.idx].color});
  if(!p.learned.has(r.stage)){p.learned.add(r.stage);io.to(p.socketId).emit('game:discovery',DATA[r.stage]);}
 }else{
  p.streak=0;p.mistakes++;p.score=Math.max(0,p.score-5);
  io.to(p.socketId).emit('game:hit',{ok:false,bonus:0,x:d.x,color:'#fb7185'});
 }
}
function updateDrops(r,dt){
 if(r.mode==='arena'){
  for(let i=r.drops.length-1;i>=0;i--){
   const d=r.drops[i];d.y+=d.vy*dt;
   let winner=null,dist=Infinity;
   if(d.y>=.833&&d.y<=.977)for(const p of r.players.values()){
    if(!p.connected)continue;
    const gap=Math.abs(p.x-d.x);
    if(gap<.062 && gap<dist){winner=p;dist=gap;}
   }
   if(winner){catchDrop(r,winner,d);r.drops.splice(i,1);}
   else if(d.y>1.08)r.drops.splice(i,1);
  }
 }else for(const [id,drops] of r.privateDrops){
  const p=r.players.get(id);if(!p||!p.connected)continue;
  for(let i=drops.length-1;i>=0;i--){
   const d=drops[i];d.y+=d.vy*dt;
   if(d.y>=.833&&d.y<=.977&&Math.abs(p.x-d.x)<.062){catchDrop(r,p,d);drops.splice(i,1);}
   else if(d.y>1.08)drops.splice(i,1);
  }
 }
}
function startMatch(r){
 r.state='countdown';r.stage=0;r.roundId++;r.drops=[];r.nextId=1;r.privateDrops.clear();
 const all=[...r.players.values()];
 for(const [i,p] of all.entries()){
  p.x=r.mode==='arena'?.10+.80*(i+.5)/all.length:.5;
  p.score=0;p.hits=0;p.mistakes=0;p.streak=0;p.learned.clear();r.privateDrops.set(p.id,[]);
 }
 r.countdownUntil=Date.now()+3500;r.stageUntil=0;r.spawnAt=0;r.lastTick=Date.now();emitInfo(r);
}
function finish(r){
 r.state='finished';r.countdownUntil=0;r.drops=[];
 io.to(r.code).emit('game:finished',{players:roster(r),mode:r.mode,roundId:r.roundId});emitInfo(r);
}
function tick(){
 const now=Date.now();
 for(const r of rooms.values()){
  const dt=clamp((now-r.lastTick)/1000,0,.12);r.lastTick=now;
  if(r.state==='countdown'&&now>=r.countdownUntil){
   r.state='playing';r.countdownUntil=0;r.stageUntil=now+ROUND_MS;r.spawnAt=now+400;
   emitInfo(r);io.to(r.code).emit('game:stage',{stage:r.stage,roundId:r.roundId});
  }
  if(r.state!=='playing')continue;
  if(now>=r.stageUntil){
   if(r.stage===STAGES-1){finish(r);continue;}
   r.stage++;r.stageUntil=now+ROUND_MS;r.spawnAt=now+500;r.drops=[];
   for(const p of r.players.values())r.privateDrops.set(p.id,[]);
   io.to(r.code).emit('game:stage',{stage:r.stage,roundId:r.roundId});emitInfo(r);
  }
  const interval=r.mode==='arena'?Math.max(310,880/Math.sqrt(Math.max(1,r.players.size))):850;
  let count=0;
  while(now>=r.spawnAt&&count++<3){
   if(r.mode==='arena')r.drops.push(spawn(r));
   else for(const [id,arr] of r.privateDrops)if(r.players.get(id)?.connected)arr.push(spawn(r));
   r.spawnAt+=interval;
  }
  updateDrops(r,dt);
 }
}
setInterval(tick,50);
setInterval(()=>{
 const now=Date.now();
 for(const r of rooms.values()){
  if(r.state!=='playing')continue;
  const base={stage:r.stage,roundId:r.roundId,remaining:Math.max(0,r.stageUntil-now),players:roster(r),mode:r.mode};
  if(r.mode==='arena')io.to(r.code).emit('game:world',{...base,drops:r.drops.map(d=>({id:d.id,x:d.x,y:d.y,idx:d.idx}))});
  else for(const p of r.players.values())if(p.connected)io.to(p.socketId).emit('game:world',{
   ...base,drops:(r.privateDrops.get(p.id)||[]).map(d=>({id:d.id,x:d.x,y:d.y,idx:d.idx}))});
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
 socket.on('game:move',x=>{
  const r=rooms.get(socket.data.code);
  if(!r||r.state!=='playing')return;
  const p=r.players.get(socket.data.playerId);
  if(!p||p.socketId!==socket.id||!Number.isFinite(x))return;
  const now=Date.now();if(now-p.moveAt<19)return;p.moveAt=now;p.x=clamp(x,.045,.955);
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
httpServer.listen(PORT,()=>console.log(`PolyDrop v2 multiplayer na porta ${PORT}`));
