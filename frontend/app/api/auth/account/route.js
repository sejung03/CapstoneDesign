import {createClient as createAdminClient} from '@supabase/supabase-js';
import {createClient} from '../../../../lib/supabase/server.js';
import {supabaseConfig} from '../../../../lib/supabase/config.js';
import {sameOrigin} from '../../../../lib/supabase/auth.js';
import {createDeleteAccountHandler} from '../../../../lib/delete-account.mjs';
export const runtime='nodejs';
export async function DELETE(request){
 let client;
 const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
 return createDeleteAccountHandler({sameOrigin,isConfigured:()=>!!secret,
  resolveUser:async()=>{
   client=await createClient();
   const {data:{user},error}=await client.auth.getUser();
   if(error&&error.name!=='AuthSessionMissingError'&&![401,403].includes(error.status))throw error;
   return error?null:user;
  },
  deleteUser:id=>{
   const {url}=supabaseConfig();
   const admin=createAdminClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
   return admin.auth.admin.deleteUser(id,false);
  },
  clearSession:()=>client.auth.signOut({scope:'local'}),
 })(request);
}
