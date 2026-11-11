import {publicConfig} from './public-config.mjs';
import {createPublicDataProxy} from '../public-data-server.mjs';
import {createRoutingProxy} from '../routing-server.mjs';

// Reuse the validated upstream clients and in-memory request/cache limits.
// The adapter converts their Node response interface to a standard Web Response.
export function createApiHandlers(env=process.env,options={}){
 const hours=createPublicDataProxy(env,options),route=createRoutingProxy(env,options);
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 return async function handle(name,request){
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  let response;
  if(name==='config')response=Response.json(publicConfig(env),{headers});
  else if(name==='public-hours'||name==='route'){
   let status=200,replyHeaders={},body='';
   const sink={writeHead(code,values){status=code;replyHeaders=values;},end(value=''){body=value;}};
   try{await (name==='route'?route:hours)(new URL(request.url),sink);}
   catch{return Response.json({error:'serverError'},{status:500,headers});}
   response=new Response(body,{status,headers:replyHeaders});
  }else return new Response(null,{status:404,headers});
  return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
 };
}
let handlers;
export function handleApi(name,request){handlers??=createApiHandlers();return handlers(name,request);}
