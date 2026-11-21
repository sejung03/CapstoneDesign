import {validateStoredHealth,healthStoragePolicyVersion,emptyHealth,storedHealthFields} from '../health-storage.mjs';
export function createHealthProfileRepository(client){
 const db=client.schema('app');
 const result=async query=>{const {data,error}=await query;if(error)throw error;return data;};
 return {
  consents:id=>result(db.from('consent_current').select('item,agreed,policy_version').eq('user_id',id).in('item',['healthProcessing','healthStorage'])),
  read:id=>result(db.from('health_profile').select('age,sex,allergies,medications,history,confirmed_at').eq('user_id',id).maybeSingle()),
  grant:id=>result(db.from('consent_event').insert(['healthProcessing','healthStorage'].map(item=>({user_id:id,item,agreed:true,policy_version:healthStoragePolicyVersion})))),
  save:(id,profile)=>result(db.from('health_profile').upsert({user_id:id,...profile,age:profile.age===''?null:Number(profile.age),sex:profile.sex||null,confirmed_at:new Date().toISOString()},{onConflict:'user_id'}).select('age,sex,allergies,medications,history,confirmed_at').single()),
  // Existing app.consent_event trigger atomically deletes the profile on withdrawal.
  remove:id=>result(db.from('consent_event').insert({user_id:id,item:'healthStorage',agreed:false,policy_version:healthStoragePolicyVersion})),
 };
}
export function createHealthProfileHandler({resolveAccount,sameOrigin,repository=createHealthProfileRepository}){
 return async request=>{
  const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  if(!['GET','PUT','DELETE'].includes(request.method))return reply({error:'method_not_allowed'},405);
  if(request.method!=='GET'&&!sameOrigin(request))return reply({error:'invalid_origin'},403);
  try{
   const account=await resolveAccount();if(!account.user)return reply({error:'authentication_required'},401);if(!account.ready)return reply({error:'signup_required'},403);
   const id=account.user.id;
   if(request.headers.has('x-account-scope')&&request.headers.get('x-account-scope')!==id)return reply({error:'account_changed'},409);
   const db=repository(account.client);
   if(request.method==='DELETE'){await db.remove(id);return reply({profile:emptyHealth(),storageConsent:false});}
   const consentRows=await db.consents(id),consented=['healthProcessing','healthStorage'].every(item=>consentRows.some(row=>row.item===item&&row.agreed));
   const serialize=row=>({profile:row?Object.fromEntries(storedHealthFields.map(k=>[k,row[k]==null?'':String(row[k])])):emptyHealth(),storageConsent:true,confirmedAt:row?.confirmed_at||null});
   if(request.method==='GET')return reply(consented?serialize(await db.read(id)):{profile:emptyHealth(),storageConsent:false,confirmedAt:null});
   if(!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'content_type'},415);
   let body,profile;try{if(Number(request.headers.get('content-length'))>8192)return reply({error:'body_too_large'},413);const text=await request.text();if(Buffer.byteLength(text)>8192)return reply({error:'body_too_large'},413);body=JSON.parse(text);if(Object.keys(body).some(k=>!['profile','consent'].includes(k)))throw Error();profile=validateStoredHealth(body.profile);}catch{return reply({error:'invalid_profile'},400);}
   if(!consented){if(body.consent?.version!==healthStoragePolicyVersion||body.consent?.granted!==true)return reply({error:'storage_consent_required'},409);await db.grant(id);}
   const saved=await db.save(id,profile);if(!saved)throw Error('save_not_confirmed');return reply(serialize(saved));
  }catch{return reply({error:'health_storage_unavailable'},503);}
 };
}
