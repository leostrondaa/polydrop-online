'use strict';
// Teste local sem dependências: simula mensagens Socket.IO, estados e reconexões.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const events=[];
let clock=1700000000000;
const timers=[];
let io;
class TestSocket {
 constructor(server,id){this.server=server;this.id=id;this.data={};this.handlers=new Map();this.rooms=new Set();this.received=[];}
 on(event,cb){this.handlers.set(event,cb)}
 join(code){this.rooms.add(code)}
 leave(code){this.rooms.delete(code)}
 emit(event,payload){this.received.push({event,payload})}
 send(event,args={}){let result;const cb=x=>{result=x}; const handler=this.handlers.get(event);assert.ok(handler,'handler '+event);handler(args,cb);return result;}
 disconnect(){this.server.sockets.sockets.delete(this.id);this.handlers.get('disconnect')?.()}
 find(event){return this.received.filter(e=>e.event===event).at(-1)?.payload}
}
class FakeIO {
 constructor(){io=this;this.sockets={sockets:new Map()};this.handlers={};this.sent=[];}
 on(event,cb){this.handlers[event]=cb;}
 connect(id){const s=new TestSocket(this,id);this.sockets.sockets.set(id,s);this.handlers.connection(s);return s;}
 to(key){return {emit:(event,payload)=>{
  this.sent.push({key,event,payload});
  for(const s of this.sockets.sockets.values())if(s.id===key||s.rooms.has(key))s.emit(event,payload);
 }};}
}
function express(){return {disable(){},use(){},get(){}}}
express.static=()=>()=>{};
let actualDate=Date;
class MockDate extends actualDate{static now(){return clock;}}
const fakeRequire=name=>{
 if(name==='express')return express;
 if(name==='http')return {createServer:()=>({listen:()=>{}})};
 if(name==='socket.io')return {Server:FakeIO};
 if(name==='qrcode')return {toString:async()=>'<svg></svg>'};
 return require(name);
};
const src=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
const controlledMath=Object.create(Math);controlledMath.random=()=>.5;
vm.runInNewContext(src,{require:fakeRequire,__dirname:path.join(__dirname,'..'),process:{env:{}},console,Date:MockDate,Math:controlledMath,setInterval:(cb,ms)=>timers.push({cb,ms})});
const tick=()=>timers.find(t=>t.ms===50).cb();
const broadcast=()=>timers.find(t=>t.ms===100).cb();
const sweep=()=>timers.find(t=>t.ms===5000).cb();
const advance=(ms)=>{const steps=Math.ceil(ms/50);for(let i=0;i<steps;i++){clock+=50;tick();if(i%2===0)broadcast()}};
const create=(s,token,mode)=>{const r=s.send('room:create',{name:'Pessoa',mode,token});assert.equal(r.ok,true);return r.room};
const join=(s,roomCode,token)=>{const r=s.send('room:join',{code:roomCode,name:'Pessoa',token});assert.equal(r.ok,true,JSON.stringify(r));return r.room};
const ta='token-'+('A'.repeat(24)),tb='token-'+('B'.repeat(24));
for(const mode of ['race','arena']){
 const host=io.connect(mode+'-host1');
 const created=create(host,ta,mode);
 const guest=io.connect(mode+'-guest1');
 const joined=join(guest,created.code,tb);
 assert.equal(joined.players.length,2);
 assert.notEqual(created.youId,joined.youId);
 assert.equal(host.send('room:start',{}).ok,true);
 assert.equal(host.find('room:info').state,'countdown');
 assert.equal(guest.find('room:info').state,'countdown');
 advance(3650);
 assert.equal(host.find('room:info').state,'playing');
 assert.equal(guest.find('room:info').state,'playing');
 host.send('game:move',.5);guest.send('game:move',.5);
 advance(8000);
 assert.ok(host.find('game:discovery'),'primeiro acerto gera dica química');
 assert.ok(host.find('game:world').players.some(p=>p.score>0),'pontuação ativa');
 const originalId=created.youId;
 const originalHost=host.find('room:info').hostId;
 // Simula troca de rede durante partida: reconecta sem duplicar avatar.
 host.disconnect();
 const reconnected=io.connect(mode+'-host2');
 const restored=join(reconnected,created.code,ta);
 assert.equal(restored.youId,originalId);
 assert.equal(restored.hostId,originalHost);
 assert.equal(restored.players.length,2);
 assert.equal(restored.state,'playing');
 assert.equal(guest.find('room:info').players.length,2);
 advance(1000);
 assert.ok(reconnected.find('game:world'));
 assert.ok(guest.find('game:world'));
 reconnected.send('game:move',0.7);
 advance(23000*5);
 assert.equal(reconnected.find('game:finished').players.length,2);
 assert.equal(guest.find('room:info').state,'finished');
 assert.equal(reconnected.send('room:start',{}).ok,true);
 assert.equal(guest.find('room:info').state,'countdown');
 console.log('PASSOU:',mode,'criar / entrar / começar / reconectar / terminar / revancha');
 // host voluntarily leaves; host automatically transfers to remaining player.
 reconnected.send('room:leave');
 assert.equal(guest.find('room:info').hostId,joined.youId);
 guest.disconnect();
 sweep();
}
console.log('PASSOU: duas modalidades e recuperação de sessão.');
