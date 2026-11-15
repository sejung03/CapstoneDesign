import {verifiedAccount} from '../../../../lib/supabase/auth.js';
export const runtime='nodejs';
export async function GET(){try{const {user,ready}=await verifiedAccount();return Response.json(ready?{authenticated:true,accountId:user.id}:{authenticated:false,pendingSignup:!!user},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'supabase_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}}
