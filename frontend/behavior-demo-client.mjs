/** Browser demo transport only, never an authenticated Supabase client. */
import {createBehaviorClient} from './behavior-client.mjs';
export function createBehaviorDemoClient({fetchImpl = fetch} = {}) {
  const base = '/api/behavior-demo';
  const behavior = createBehaviorClient({fetchImpl,base});
  async function callSession(method='GET',account) {
    const response = await fetchImpl(`${base}/session`, {
      method, credentials:'same-origin', cache:'no-store',
      ...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({account})}:{})
    });
    if(!response.ok)throw new Error(`Demo session ${response.status}`);
    return response.json();
  }
  return Object.freeze({
    ...behavior,
    demo:Object.freeze({getSession:()=>callSession(), selectAccount:account=>callSession('POST',account)}),
  });
}
