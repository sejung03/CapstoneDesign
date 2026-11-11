import {NextResponse} from 'next/server';
import {contentSecurityPolicy} from './lib/security.mjs';
export function proxy(request){
 const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
 const policy=contentSecurityPolicy(nonce,{development:process.env.NODE_ENV==='development'});
 const headers=new Headers(request.headers);
 headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',policy);
 const response=NextResponse.next({request:{headers}});
 response.headers.set('Content-Security-Policy',policy);
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Cache-Control','no-store');
 return response;
}
export const config={matcher:['/((?!api|_next/static|_next/image|favicon.svg|fonts/|clinic-demo.png).*)']};
