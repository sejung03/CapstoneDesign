import {NextResponse} from 'next/server';
import {createClient} from '../../../../../lib/supabase/server.js';
import {appOrigin,verifiedAccount} from '../../../../../lib/supabase/auth.js';
export const runtime='nodejs';
export async function GET(request){
 const incoming=new URL(request.url),origin=appOrigin();
 const redirect=path=>NextResponse.redirect(new URL(path,origin),{headers:{'Cache-Control':'no-store'}});
 if(incoming.searchParams.has('error')||!incoming.searchParams.get('code'))return redirect('/?auth_error=invalid_oauth');
 try{const client=await createClient();const {error}=await client.auth.exchangeCodeForSession(incoming.searchParams.get('code'));if(error)return redirect('/?auth_error=invalid_oauth');const {ready}=await verifiedAccount(client);return redirect(ready?'/':'/signup');}
 catch{return redirect('/?auth_error=supabase_setup');}
}
