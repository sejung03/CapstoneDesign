import 'server-only';
import {createClient} from './server.js';
import {signupConsentPolicy} from '../../signup-consent.mjs';
export const appOrigin=()=>new URL(process.env.APP_URL||'http://127.0.0.1:3080').origin;
export const sameOrigin=request=>request.headers.get('origin')===appOrigin()&&request.headers.get('sec-fetch-site')!=='cross-site';
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
