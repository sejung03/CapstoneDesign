import {NextResponse} from 'next/server';
import {contentSecurityPolicy} from './lib/security.mjs';
import {createServerClient} from '@supabase/ssr';
export async function proxy(request){
 const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
 const policy=contentSecurityPolicy(nonce,{development:process.env.NODE_ENV==='development'});
 const headers=new Headers(request.headers);
 headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',policy);
 let response=NextResponse.next({request:{headers}});
 if(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY){
  // Refresh before rendering so refreshed cookies reach this request and the browser.
  const client=createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{
   cookies:{getAll:()=>request.cookies.getAll(),setAll:values=>{
    for(const {name,value} of values)request.cookies.set(name,value);
    headers.set('cookie',request.cookies.toString());
    response=NextResponse.next({request:{headers}});
    for(const {name,value,options} of values)response.cookies.set(name,value,options);
   }},
  });
  await client.auth.getUser();
 }
 response.headers.set('Content-Security-Policy',policy);
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Cache-Control','no-store');
 return response;
}
export const config={matcher:['/((?!api|_next/static|_next/image|favicon.svg|fonts/|clinic-demo.png).*)']};
