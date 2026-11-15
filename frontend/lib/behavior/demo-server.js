/**
 * DEVELOPMENT-ONLY behavior demo. Every record is ephemeral and scoped to one of
 * two explicitly fictional identities; this is NOT user authentication or RLS.
 * Do not mount against a real DB or enable in production.
 */
import {createBehaviorApi} from './api.js';
import {createMockBehaviorRepository} from './mock-repository.js';

const IDS = Object.freeze({
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
});
const COOKIE = 'behavior_demo_account';
const headers = {'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff'};
const json = (value,status=200,other={}) => Response.json(value,{status,headers:{...headers,...other}});
function selectedAccount(request) {
  const value = (request.headers.get('cookie')||'').split(';').map(v=>v.trim())
    .find(value=>value.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  return value === 'b' ? 'b' : 'a';
}
function sameOrigin(request) {
  return request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('sec-fetch-site') !== 'cross-site';
}
/** dependency injection makes all transport tests possible without Next.js. */
export function createBehaviorDemoHandler({enabled = process.env.NODE_ENV === 'development', repository = createMockBehaviorRepository()} = {}) {
  const api = createBehaviorApi({repository, resolveSession: async request => ({user:{id:IDS[selectedAccount(request)]}})});
  return async function handle(request, action) {
    if(!enabled) return json({error:'not_found'},404);
    if(action === 'session') {
      if(request.method === 'GET')return json({account:selectedAccount(request),demo:true});
      if(request.method !== 'POST')return json({error:'method_not_allowed'},405);
      if(!sameOrigin(request))return json({error:'invalid_origin'},403);
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json({error:'invalid_payload'},400);
      const raw = await request.text();
      if(Buffer.byteLength(raw,'utf8') > 512)return json({error:'invalid_payload'},400);
      let payload;
      try{payload=JSON.parse(raw);}catch{return json({error:'invalid_payload'},400);}
      if(!payload||Object.keys(payload).length!==1||!['a','b'].includes(payload.account))return json({error:'invalid_payload'},400);
      return json({account:payload.account,demo:true},200,{
        'Set-Cookie': `${COOKIE}=${payload.account}; HttpOnly; Path=/api/behavior-demo; SameSite=Strict; Max-Age=86400`,
      });
    }
    if(!['favorites','settings','signal','statements','all'].includes(action))return json({error:'not_found'},404);
    return api(request,action);
  };
}
