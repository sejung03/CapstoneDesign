import {NextResponse} from 'next/server';
import {kakaoReauthCookie} from '../../../../lib/supabase/kakao-reauth.mjs';
import {createClient} from '../../../../lib/supabase/server.js';
import {appOrigin,sameOrigin} from '../../../../lib/supabase/auth.js';
export const runtime='nodejs';
export async function POST(request){
 if(!sameOrigin(request))return Response.json({error:'invalid_origin'},{status:403});
 try{const client=await createClient();const {error}=await client.auth.signOut({scope:'local'});if(error)throw error;const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}});response.cookies.set(kakaoReauthCookie,'1',{httpOnly:true,sameSite:'lax',secure:new URL(appOrigin()).protocol==='https:',path:'/api/auth/kakao',maxAge:1800});return response;}catch{return Response.json({error:'logout_failed'},{status:503});}
}
