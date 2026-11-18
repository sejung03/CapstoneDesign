import {createBehaviorClient} from './behavior-client.mjs';
import {createHealthProfileClient} from './health-profile-client.mjs';
export function createAccountClient({fetchImpl=fetch}={}){
 const healthProfile=createHealthProfileClient({fetchImpl});
 let sessionSequence=0;
 const call=async(path,options={})=>{const response=await fetchImpl('/api/auth/'+path,{credentials:'same-origin',cache:'no-store',...options});if(!response.ok)throw Error('Account API '+response.status);return response.json();};
 // 가입 동의를 마치지 않은 로그인(pendingSignup)은 페이지를 열 때마다 /signup으로 보내지 않고 비회원으로 둔다.
 // 로그인 직후 가입 화면 이동은 카카오 콜백(app/api/auth/kakao/callback)이 맡는다. 메인 화면·채팅은 비회원으로 계속 쓸 수 있다.
 return {getSession:async({signal}={})=>{const token=++sessionSequence,session=await call('session',{signal});if(token===sessionSequence)healthProfile.setScope(session.authenticated?session.accountId:null);return session;},logout:async({signal}={})=>{const token=++sessionSequence,result=await call('logout',{method:'POST',signal});if(token===sessionSequence)healthProfile.setScope(null);return result;},favorites:createBehaviorClient({fetchImpl}).favorites,healthProfile};
}
