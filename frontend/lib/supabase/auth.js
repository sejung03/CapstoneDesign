import 'server-only';
import {createClient} from './server.js';
import {signupConsentPolicy} from '../../signup-consent.mjs';
import {appOriginFrom,allowedOriginsFrom,isSameOrigin,appUrlInvalid} from '../app-origin.mjs';
// APP_URL이 잘못되어도 예외를 던지지 않는다(lib/app-origin.mjs). Vercel 배포 주소도 같은 사이트로 인정한다.
let warned=false;
const checked=()=>{if(!warned&&appUrlInvalid()){warned=true;console.warn('[config] APP_URL is not a valid URL; using the Vercel deployment address instead.');}};
export const appOrigin=()=>{checked();return appOriginFrom();};
export const allowedOrigins=()=>{checked();return allowedOriginsFrom();};
export const sameOrigin=request=>{checked();return isSameOrigin(request);};
export async function verifiedAccount(client=null){
 client??=await createClient();
 const {data:{user},error}=await client.auth.getUser();
 if(error){if(error.name==='AuthSessionMissingError'||error.status===401||error.status===403)return {client,user:null,ready:false};throw error;}
 if(!user)return {client,user:null,ready:false};
 const {data,error:dbError}=await client.from('capstone_account_consents').select('item_id,agreed').eq('user_id',user.id).eq('policy_version',signupConsentPolicy.version);
 if(dbError)throw dbError;
 const ready=signupConsentPolicy.sections.filter(item=>item.required).every(item=>data.some(row=>row.item_id===item.id&&row.agreed));
 return {client,user,ready};
}
