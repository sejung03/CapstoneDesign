import {createBehaviorClient} from './behavior-client.mjs';
export function createAccountClient({fetchImpl=fetch}={}){
 const call=async(path,options={})=>{const response=await fetchImpl('/api/auth/'+path,{credentials:'same-origin',cache:'no-store',...options});if(!response.ok)throw Error('Account API '+response.status);const data=await response.json();if(data.pendingSignup)location.assign('/signup');return data;};
 return {getSession:({signal}={})=>call('session',{signal}),logout:({signal}={})=>call('logout',{method:'POST',signal}),favorites:createBehaviorClient({fetchImpl}).favorites};
}
