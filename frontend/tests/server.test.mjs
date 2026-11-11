import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {startServer} from '../server.mjs';
test('사용 중인 포트가 있으면 다음 포트로 시작',async()=>{
 const first=await startServer({port:0,log:()=>{}});
 let second;
 try{
  const occupied=first.address().port;
  const messages=[];
  second=await startServer({port:occupied,log:message=>messages.push(message)});
  assert.ok(second.address().port>occupied);
  assert.ok(messages.some(message=>message.includes('is in use')));
 }finally{
  const servers=[first,second].filter(Boolean);
  await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
 }
});
test('잘못된 포트는 명확한 오류로 처리',()=>{
 assert.throws(()=>startServer({port:NaN}),/PORT/);
 assert.throws(()=>startServer({port:65536}),/PORT/);
});
