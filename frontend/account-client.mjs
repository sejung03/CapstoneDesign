import {createBehaviorClient} from './behavior-client.mjs';
import {createHealthProfileClient} from './health-profile-client.mjs';
export function createAccountClient({fetchImpl=fetch}={}){
 const healthProfile=createHealthProfileClient({fetchImpl});
 let sessionSequence=0;
 const call=async(path,options={})=>{const response=await fetchImpl('/api/auth/'+path,{credentials:'same-origin',cache:'no-store',...options});if(!response.ok)throw Error('Account API '+response.status);const data=await response.json();if(data.pendingSignup)location.assign('/signup');return data;};
 return {getSession:async({signal}={})=>{const token=++sessionSequence,session=await call('session',{signal});if(token===sessionSequence)healthProfile.setScope(session.authenticated?session.accountId:null);return session;},logout:async({signal}={})=>{const token=++sessionSequence,result=await call('logout',{method:'POST',signal});if(token===sessionSequence)healthProfile.setScope(null);return result;},favorites:createBehaviorClient({fetchImpl}).favorites,healthProfile};
}
