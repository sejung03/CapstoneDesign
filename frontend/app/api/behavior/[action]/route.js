import {verifiedAccount,appOrigin} from '../../../../lib/supabase/auth.js';
import {createBehaviorApi} from '../../../../lib/behavior/api.js';
import {createSupabaseBehaviorRepository} from '../../../../lib/behavior/supabase-repository.js';
export const runtime='nodejs';
async function handle(request,{params}){
 try{const {action}=await params;const {client,user,ready}=await verifiedAccount();return createBehaviorApi({repository:createSupabaseBehaviorRepository(client),expectedOrigin:appOrigin(),resolveSession:async()=>ready&&user?{user:{id:user.id}}:null})(request,action);}
 catch{return Response.json({error:'supabase_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export {handle as GET,handle as POST,handle as PATCH,handle as PUT,handle as DELETE};
