import {healthStoragePolicyVersion} from './health-storage.mjs';
export function createHealthProfileClient({fetchImpl=fetch}={}){
 let scope=null;
 const call=async(method,{profile,grant=false,signal}={})=>{
  const response=await fetchImpl('/api/health-profile',{method,credentials:'same-origin',cache:'no-store',signal,headers:{...(scope?{'X-Account-Scope':scope}:{}),...(method==='PUT'?{'Content-Type':'application/json'}:{})},...(method==='PUT'?{body:JSON.stringify({profile,...(grant?{consent:{version:healthStoragePolicyVersion,granted:true}}:{})})}:{})});
  if(!response.ok)throw Error('health_storage_failed');return response.json();
 };
 return {setScope:id=>{scope=id;},get:options=>call('GET',options),save:(profile,options={})=>call('PUT',{...options,profile}),remove:options=>call('DELETE',options)};
}
