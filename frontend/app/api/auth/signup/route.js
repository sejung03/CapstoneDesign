import {NextResponse} from 'next/server';
import {signupConsentPolicy} from '../../../../signup-consent.mjs';
import {verifiedAccount,sameOrigin} from '../../../../lib/supabase/auth.js';
export const runtime='nodejs';
export async function POST(request){
 if(!sameOrigin(request))return Response.json({error:'invalid_origin'},{status:403});
 // Demo until the service's legal / privacy documentation is finalized.
 if(process.env.NODE_ENV==='production'&&!signupConsentPolicy.operationalReady)
  return Response.json({error:'policy_not_ready'},{status:503});
 let account;
 try{account=await verifiedAccount();}catch{return Response.json({error:'supabase_unavailable'},{status:503});}
 if(!account.user)return Response.json({error:'signup_expired'},{status:401});
 let data;
 try{data=await request.json();}catch{return Response.json({error:'invalid_json'},{status:400});}
 if(data?.policyVersion!==signupConsentPolicy.version||!Array.isArray(data.decisions))
  return Response.json({error:'invalid_policy'},{status:400});
 const items=signupConsentPolicy.sections;
 const provided=new Map();
 for(const value of data.decisions){
  if(typeof value?.id!=='string'||typeof value?.agreed!=='boolean'||provided.has(value.id))return Response.json({error:'invalid_decisions'},{status:400});
  provided.set(value.id,value.agreed);
 }
 if(provided.size!==items.length||items.some(x=>!provided.has(x.id)||x.required&&!provided.get(x.id)||x.dependsOn&&provided.get(x.id)&&!provided.get(x.dependsOn)))
  return Response.json({error:'invalid_decisions'},{status:400});
 try{
  const {error}=await account.client.rpc('capstone_record_consents',{version:data.policyVersion,decisions:items.map(x=>({id:x.id,agreed:provided.get(x.id)}))});
  if(error)throw error;
  return NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'signup_failed'},{status:500});}
}
