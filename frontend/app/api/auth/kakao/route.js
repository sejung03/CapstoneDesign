import {cookies} from 'next/headers';
import {kakaoReauthCookie,kakaoQueryParams} from '../../../../lib/supabase/kakao-reauth.mjs';
import {NextResponse} from 'next/server';
import {createClient} from '../../../../lib/supabase/server.js';
import {appOrigin} from '../../../../lib/supabase/auth.js';
export const runtime='nodejs';
export async function GET(request){
 try{
  const client=await createClient();
  const {data,error}=await client.auth.signInWithOAuth({provider:'kakao',options:{
   redirectTo:appOrigin()+'/api/auth/kakao/callback',
   // Supabase defaults request email and profile data. Explicitly replace the
   // provider scope with an empty list; account identity is sufficient to sign in.
   queryParams:kakaoQueryParams((await cookies()).get(kakaoReauthCookie)?.value,request.headers.get('user-agent')),
   skipBrowserRedirect:true,
  }});
  if(error||!data.url)throw error||Error('missing_url');
  return NextResponse.redirect(data.url,{status:302,headers:{'Cache-Control':'no-store'}});
 }
 catch{return Response.json({error:'supabase_kakao_not_configured'},{status:503});}
}
