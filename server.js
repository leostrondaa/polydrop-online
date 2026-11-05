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
const io = new Server(httpServer, { transports: ['websocket', 'polling'], maxHttpBufferSize: 12000 });
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '10m' }));

const PORT = process.env.PORT || 3000;
const LIMIT = 12;
const ROUND_MS = 22000;
const STAGES = 5;
const TICK = 50;
const COLORS = ['#5eead4', '#818cf8', '#fb7185', '#fbbf24', '#38bdf8', '#c084fc', '#4ade80', '#f472b6', '#f97316', '#a3e635', '#fda4af', '#22d3ee'];
const DATA = [
  { polymer: 'PVC', monomer: 'Cloreto de vinila', color: '#34d399', formula: 'n CH₂=CHCl → [–CH₂–CHCl–]ₙ', use: 'Canos e revestimentos', fact: 'O cloreto de vinila se une em cadeias para formar PVC.' },
  { polymer: 'Polietileno', monomer: 'Eteno', color: '#60a5fa', formula: 'n CH₂=CH₂ → [–CH₂–CH₂–]ₙ', use: 'Sacolas e embalagens', fact: 'Muitas moléculas de eteno formam uma cadeia de polietileno.' },
  { polymer: 'Poliestireno', monomer: 'Estireno', color: '#fbbf24', formula: 'n CH₂=CH–C₆H₅ → [–CH₂–CH(C₆H₅)–]ₙ', use: 'Copos e isopor (EPS)', fact: 'O estireno se repete na cadeia que forma o poliestireno.' },
  { polymer: 'PTFE (Teflon)', monomer: 'Tetrafluoroetileno', color: '#a78bfa', formula: 'n CF₂=CF₂ → [–CF₂–CF₂–]ₙ', use: 'Revestimentos de baixo atrito', fact: 'O tetrafluoroetileno forma cadeias de PTFE, resistentes a reagentes químicos.' },
  { polymer: 'Polipropileno', monomer: 'Propeno', color: '#f472b6', formula: 'n CH₂=CH–CH₃ → [–CH₂–CH(CH₃)–]ₙ', use: 'Potes e tampas', fact: 'Moléculas de propeno se ligam formando longas cadeias de polipropileno.' }
];

const rooms = new Map();
const letterSet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const random = (a,b) => a + Math.random() * (b-a);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
function roomCode() {
  let code;
  do { code = Array.from(crypto.randomBytes(5), b => letterSet[b % letterSet.length]).join(''); }
  while (rooms.has(code));
  return code;
}
function safeName(v) {
  if (typeof v !== 'string') return 'Cientista';
  return v.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 18) || 'Cientista';
}
function publicPlayer(p) {
  return { id:p.id, name:p.name, x:p.x, score:p.score, hits:p.hits, mistakes:p.mistakes, streak:p.streak, color:p.color };
}
function roster(room) {
  return [...room.players.values()].map(publicPlayer).sort((a,b) => b.score-a.score || b.hits-a.hits || a.name.localeCompare(b.name));
}
function roomInfo(room) {
  return { code:room.code, mode:room.mode, state:room.state, hostId:room.hostId,
    players:roster(room), stage:room.stage, maxPlayers:LIMIT,
    countdown: room.countdownUntil ? Math.max(0,Math.ceil((room.countdownUntil-Date.now())/1000)) : 0 };
}
function emitInfo(room) { io.to(room.code).emit('room:info', roomInfo(room)); }
function leave(socket) {
  const code = socket.data.room;
  if (!code) return;
  socket.leave(code);
  socket.data.room = null;
  const room = rooms.get(code);
  if (!room) return;
  room.players.delete(socket.id);
  room.privateDrops.delete(socket.id);
  if (room.players.size === 0) { rooms.delete(code); return; }
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;
  emitInfo(room);
}
function participant(socket, room, name) {
  if (room.players.size >= LIMIT) throw Error('Essa sala está cheia (12 jogadores).');
  if (room.state !== 'lobby' && room.state !== 'finished') throw Error('A partida já começou. Entre na próxima rodada.');
  leave(socket);
  const p = { id:socket.id, name:safeName(name), x:0.5, score:0, hits:0, mistakes:0, streak:0, learned:new Set(), color:COLORS[room.players.size%COLORS.length], moveAt:0 };
  room.players.set(socket.id, p);
  room.privateDrops.set(socket.id, []);
  socket.join(room.code);
  socket.data.room = room.code;
  socket.emit('room:joined', roomInfo(room));
  emitInfo(room);
}
function createRoom(mode) {
  const room = { code:roomCode(), mode, state:'lobby', hostId:null, players:new Map(), privateDrops:new Map(), drops:[], stage:0, nextId:1,
    countdownUntil:0, stageUntil:0, spawnAt:0, lastTick:Date.now() };
  rooms.set(room.code, room);
  return room;
}
function spawn(room, now) {
  const right = Math.random() < .56;
  const pool = right ? [room.stage] : DATA.map((_,i)=>i).filter(i=>i!==room.stage);
  const idx = pool[Math.floor(Math.random()*pool.length)];
  return { id:room.nextId++, x:random(.07,.93), y:-.055, idx, vy:random(.185,.255) + room.stage * .015, birth:now };
}
function applyCatch(room,p,drop) {
  const correct = drop.idx===room.stage;
  if (correct) {
    p.streak++;
    p.hits++;
    const bonus = p.streak%3===0 ? 5 : 0;
    p.score += 10+bonus;
    io.to(p.id).emit('game:hit', { ok:true, bonus, x:drop.x, color:DATA[drop.idx].color });
    if (!p.learned.has(room.stage)) {
      p.learned.add(room.stage);
      io.to(p.id).emit('game:discovery', DATA[room.stage]);
    }
  } else {
    p.streak=0;
    p.mistakes++;
    p.score=Math.max(0,p.score-5);
    io.to(p.id).emit('game:hit', { ok:false, bonus:0, x:drop.x, color:'#fb7185' });
  }
}
function updateDrops(room, dt) {
  if (room.mode==='arena') {
    for(let i=room.drops.length-1;i>=0;i--) {
      const drop=room.drops[i]; drop.y+=drop.vy*dt;
      let winner=null, dist=Infinity;
      if (drop.y>=.833 && drop.y<=.977) {
        for(const p of room.players.values()) {
          const d=Math.abs(p.x-drop.x);
          if(d<.059 && (d<dist-0.00001 || (Math.abs(d-dist)<0.00001 && Math.random()<.5))) { winner=p; dist=d; }
        }
      }
      if(winner) { applyCatch(room,winner,drop); room.drops.splice(i,1); }
      else if(drop.y>1.08) room.drops.splice(i,1);
    }
  } else {
    for(const [id,arr] of room.privateDrops.entries()) {
      const p=room.players.get(id);
      if(!p) continue;
      for(let i=arr.length-1;i>=0;i--) {
        const drop=arr[i]; drop.y+=drop.vy*dt;
        if(drop.y>=.833 && drop.y<=.977 && Math.abs(p.x-drop.x)<.059) {
          applyCatch(room,p,drop); arr.splice(i,1);
        } else if(drop.y>1.08) arr.splice(i,1);
      }
    }
  }
}
function startMatch(room) {
  room.state='countdown'; room.stage=0;
  room.drops=[]; room.nextId=1; room.privateDrops.clear();
  const activePlayers=[...room.players.values()];
  for(const [index,p] of activePlayers.entries()) {
    p.x=room.mode==='arena' ? .10 + .80*(index+.5)/activePlayers.length : .5; p.score=0; p.hits=0; p.mistakes=0; p.streak=0; p.learned.clear();
    room.privateDrops.set(p.id, []);
  }
  room.countdownUntil=Date.now()+3500;
  emitInfo(room);
}
function finish(room) {
  room.state='finished'; room.countdownUntil=0; room.drops=[];
  const rankings=roster(room);
  io.to(room.code).emit('game:finished', { players:rankings, mode:room.mode });
  emitInfo(room);
}
function tick() {
  const now=Date.now();
  for(const room of rooms.values()) {
    const dt=clamp((now-room.lastTick)/1000,0,.12);
    room.lastTick=now;
    if(room.state==='countdown' && now>=room.countdownUntil) {
      room.state='playing'; room.stageUntil=now+ROUND_MS; room.spawnAt=now+400;
      emitInfo(room);
      io.to(room.code).emit('game:stage', { stage:room.stage });
    }
    if(room.state!=='playing') continue;
    if(now>=room.stageUntil) {
      if(room.stage===STAGES-1) { finish(room); continue; }
      room.stage++;
      room.stageUntil=now+ROUND_MS;
      room.spawnAt=now+500;
      room.drops=[];
      for(const p of room.players.values()) room.privateDrops.set(p.id,[]);
      io.to(room.code).emit('game:stage', { stage:room.stage });
      emitInfo(room);
    }
    const amount=room.players.size;
    const interval=room.mode==='arena' ? Math.max(310,880/Math.sqrt(amount)) : 850;
    let spawns=0;
    while(now>=room.spawnAt && spawns++<3) {
      if(room.mode==='arena') room.drops.push(spawn(room,now));
      else for(const [id,arr] of room.privateDrops.entries()) if(room.players.has(id)) arr.push(spawn(room,now));
      room.spawnAt+=interval;
    }
    updateDrops(room,dt);
  }
}
setInterval(tick,TICK);
setInterval(() => {
  const now=Date.now();
  for(const room of rooms.values()) {
    if(room.state!=='playing') continue;
    const people=roster(room);
    const base={ stage:room.stage, remaining:Math.max(0,room.stageUntil-now), players:people, mode:room.mode };
    if(room.mode==='arena') io.to(room.code).emit('game:world', {...base, drops:room.drops.map(d=>({id:d.id,x:d.x,y:d.y,idx:d.idx}))});
    else for(const id of room.players.keys()) io.to(id).emit('game:world',{...base,drops:(room.privateDrops.get(id)||[]).map(d=>({id:d.id,x:d.x,y:d.y,idx:d.idx}))});
  }
},100);

io.on('connection',socket => {
  socket.on('room:create',(args={},ack=()=>{})=>{
    try {
      if(!['race','arena'].includes(args.mode)) throw Error('Modo inválido.');
      const room=createRoom(args.mode);
      room.hostId=socket.id;
      participant(socket,room,args.name);
      ack({ok:true,room:roomInfo(room)});
    } catch(e) { ack({ok:false,error:e.message}); }
  });
  socket.on('room:join',(args={},ack=()=>{})=>{
    try {
      const code=String(args.code||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,5);
      const room=rooms.get(code);
      if(!room) throw Error('Sala não encontrada. Confira o código.');
      participant(socket,room,args.name);
      ack({ok:true,room:roomInfo(room)});
    } catch(e) { ack({ok:false,error:e.message}); }
  });
  socket.on('room:leave',()=>leave(socket));
  socket.on('room:start',(_args,ack=()=>{})=>{
    const room=rooms.get(socket.data.room);
    if(!room || room.hostId!==socket.id) return ack({ok:false,error:'Só quem criou a sala pode iniciar.'});
    if(!['lobby','finished'].includes(room.state)) return ack({ok:false,error:'Partida já em andamento.'});
    if(room.players.size<1) return ack({ok:false,error:'A sala não tem jogadores.'});
    startMatch(room); ack({ok:true});
  });
  socket.on('game:move',x=>{
    const room=rooms.get(socket.data.room);
    if(!room || room.state!=='playing') return;
    const p=room.players.get(socket.id);
    if(!p||!Number.isFinite(x)) return;
    const now=Date.now();
    if(now-p.moveAt<19) return;
    p.moveAt=now;
    p.x=clamp(x,.045,.955);
  });
  socket.on('disconnect',()=>leave(socket));
});

app.get('/api/qr/:code', async (req,res)=>{
  const code=String(req.params.code||'').toUpperCase();
  if(!/^[A-Z2-9]{5}$/.test(code) || !rooms.has(code)) return res.status(404).send('Sala não encontrada');
  const proto=req.headers['x-forwarded-proto']==='https'?'https':req.protocol;
  const host=req.get('host');
  const link=`${proto}://${host}/?sala=${code}`;
  try { res.set('Content-Type','image/svg+xml'); res.set('Cache-Control','no-store'); res.send(await QRCode.toString(link,{type:'svg',margin:1,scale:6,color:{dark:'#11283b',light:'#ffffffff'}})); }
  catch { res.status(500).send('Não foi possível gerar o QR Code.'); }
});
app.get('/health',(req,res)=>res.json({ok:true,rooms:rooms.size}));
httpServer.listen(PORT,()=>console.log(`PolyDrop online disponível na porta ${PORT}`));
