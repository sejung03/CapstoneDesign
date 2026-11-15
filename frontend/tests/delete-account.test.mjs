import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeleteAccountHandler} from '../lib/delete-account.mjs';
function fixture(overrides={}){
 const deleted=[],cleared=[];
 const handler=createDeleteAccountHandler({sameOrigin:r=>r.headers.get('origin')==='http://app.test',resolveUser:async()=>({id:'verified-owner'}),isConfigured:()=>true,deleteUser:async id=>{deleted.push(id);return {error:null};},clearSession:async()=>cleared.push(true),...overrides});
 const request=(body={confirmation:'탈퇴'},origin='http://app.test')=>new Request('http://app.test/api/auth/account',{method:'DELETE',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {handler,deleted,cleared,request};
}
test('account deletion rejects cross-origin, guests and missing explicit confirmation',async()=>{
 const f=fixture();assert.equal((await f.handler(f.request(undefined,'https://other.test'))).status,403);
 for(const payload of [{},{confirmation:'no'},{confirmation:'탈퇴',user_id:'other-user'}])assert.equal((await f.handler(f.request(payload))).status,400);
 assert.deepEqual(f.deleted,[]);
 const guest=fixture({resolveUser:async()=>null});assert.equal((await guest.handler(guest.request())).status,401);
});
test('account deletion uses only verified owner and clears session after successful deletion',async()=>{
 const f=fixture();const response=await f.handler(f.request());assert.equal(response.status,200);assert.deepEqual(f.deleted,['verified-owner']);assert.equal(f.cleared.length,1);
});
test('missing admin key and failed Auth deletion never report success or clear session',async()=>{
 const missing=fixture({isConfigured:()=>false});assert.equal((await missing.handler(missing.request())).status,503);assert.deepEqual(missing.deleted,[]);
 const failed=fixture({deleteUser:async()=>({error:{message:'database constraint'}})});const response=await failed.handler(failed.request());assert.equal(response.status,409);assert.deepEqual(failed.cleared,[]);assert.doesNotMatch(await response.text(),/database constraint/);
});
