// Dependencies are server-only. Never take the account ID from the browser.
export function createDeleteAccountHandler({sameOrigin,resolveUser,deleteUser,clearSession,isConfigured}){
 const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 return async request=>{
  if(!sameOrigin(request))return json({error:'invalid_origin'},403);
  try{
   const user=await resolveUser();
   if(!user)return json({error:'authentication_required'},401);
   if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json({error:'invalid_payload'},400);
   const text=await request.text();
   if(Buffer.byteLength(text)>512)return json({error:'invalid_payload'},400);
   let body;try{body=JSON.parse(text);}catch{return json({error:'invalid_payload'},400);}
   if(!body||Array.isArray(body)||Object.keys(body).length!==1||!['탈퇴','DELETE'].includes(body.confirmation))return json({error:'confirmation_required'},400);
   if(!isConfigured())return json({error:'account_deletion_not_configured'},503);
   // A failed Auth deletion leaves the account intact. Do not pre-delete app rows.
   const {error}=await deleteUser(user.id);
   if(error)return json({error:'account_deletion_failed'},409);
   // Auth user and its FK-cascaded records are already deleted at this point.
   try{await clearSession();}catch{}
   return json({ok:true});
  }catch{return json({error:'account_deletion_unavailable'},503);}
 };
}
