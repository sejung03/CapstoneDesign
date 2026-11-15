import {createClient} from '../../../../lib/supabase/server.js';
import {sameOrigin} from '../../../../lib/supabase/auth.js';
export const runtime='nodejs';
export async function POST(request){
 if(!sameOrigin(request))return Response.json({error:'invalid_origin'},{status:403});
 try{const client=await createClient();const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'logout_failed'},{status:503});}
}
