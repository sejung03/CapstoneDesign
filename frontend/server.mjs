// Regression-test server only. Production and development use Next.js.
import {createRoutingProxy,routingConfigured} from './routing-server.mjs';
import {createPublicDataProxy,publicDataConfigured} from './public-data-server.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
try{process.loadEnvFile(path.join(root,'.env.local'));}catch(error){if(error.code!=='ENOENT')throw error;}
export {publicConfig} from './lib/public-config.mjs';
import {publicConfig} from './lib/public-config.mjs';
const allowed=new Set(['index.html','account-session.mjs','favorites.mjs','health-updates.mjs','signup-consent.mjs','report-import.mjs','health-consent.mjs','workspace-model.mjs','recommendations.mjs','emergency.mjs','emergency-picker.mjs','emergency-resources.mjs','legacy-entry.mjs','departments.mjs','copy.mjs','ui-icons.mjs','facility-art.mjs','ui.css','fonts/SUIT-Variable.woff2','fonts/SUITE-Variable.woff2','fonts/SUIT-LICENSE.txt','fonts/SUITE-LICENSE.txt','styles.css','app.js','flow.mjs','facilities.mjs','facilities-view.mjs','chat-model.mjs','chat-view.mjs','intake-view.mjs','intake-data.mjs','assistant.mjs','discovery.mjs','favicon.svg','routing.mjs','report.mjs','profile.mjs','care-context.mjs','clinic-demo.png','live-data.mjs','kakao-client.mjs','public-hours.mjs']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};

export function startServer({port=Number(process.env.PORT||3080),log=console.log,env=process.env,fetcher=globalThis.fetch}={}){
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT는 0~65535 범위의 정수여야 합니다.');
 const proxyHours=createPublicDataProxy(env,{fetcher});
 const proxyRoute=createRoutingProxy(env,{fetcher});
 const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method||'GET')){res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method not allowed');return;}
  let pathname;try{pathname=new URL(req.url,'http://localhost').pathname;}catch{res.writeHead(400);res.end('Bad request');return;}
  if(pathname==='/api/config'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(publicConfig(env)));return;}
  if(pathname==='/api/public-hours'){await proxyHours(new URL(req.url,'http://localhost'),res);return;}
  if(pathname==='/api/route'){await proxyRoute(new URL(req.url,'http://localhost'),res);return;}
  const file=pathname==='/'?'index.html':pathname.slice(1);
  if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}
  try{const data=await readFile(path.join(root,file));res.writeHead(200,{'Content-Type':types[path.extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Security-Policy':"upgrade-insecure-requests; default-src 'self'; script-src 'self' https://dapi.kakao.com https://*.daumcdn.net https://*.kakaocdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://dapi.kakao.com; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});res.end(data);}catch{res.writeHead(500);res.end('Server error');}
 });
 return new Promise((resolve,reject)=>{
  let candidate=port;
  let retries=0;
  const onError=(error)=>{
   if(error.code==='EADDRINUSE'&&candidate>0&&candidate<65535&&retries<20){
    log('Port '+candidate+' is in use. Trying '+(candidate+1)+'...');
    candidate++;retries++;
    server.listen(candidate,'127.0.0.1');
   }else{
    server.removeListener('error',onError);
    reject(error);
   }
  };
  server.on('error',onError);
  server.once('listening',()=>{
   server.removeListener('error',onError);
   log('Local: http://127.0.0.1:'+server.address().port);
   resolve(server);
  });
  server.listen(candidate,'127.0.0.1');
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 startServer().catch(error=>{
  console.error('서버를 시작할 수 없습니다: '+error.message);
  console.error('다른 포트 지정: npm run dev -- 환경변수 PORT 설정 또는 실행 중인 미리보기 종료');
  process.exitCode=1;
 });
}
