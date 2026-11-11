const routeEndpoints={walk:'https://dapi.kakao.com/v2/routing/walk',traffic:'https://dapi.kakao.com/v2/routing/publictraffic',car:'https://apis-navi.kakaomobility.com/v1/directions'};
const routeNumber=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const routePoint=point=>Array.isArray(point)&&point.length===2&&Number.isFinite(point[0])&&Math.abs(point[0])<=180&&Number.isFinite(point[1])&&Math.abs(point[1])<=90;
export function routingConfigured(env){return !!String(env.KAKAO_REST_API_KEY||'').trim();}
export function normalizeRoute(body,mode){
 let props,steps=[],paths=[];
 if(mode==='car'){
  const route=body.routes?.find(r=>r.result_code===0);
  if(!route)throw Error('routeNotFound');
  props={totalDistance:route.summary?.distance,totalTime:route.summary?.duration};
  for(const section of route.sections||[]){
   steps.push(...(section.guides||[]).map(g=>({guidance:g.guidance,distance:g.distance,time:g.duration})));
   for(const road of section.roads||[]){
    const points=[];for(let i=0;i<(road.vertexes?.length||0);i+=2)points.push([road.vertexes[i],road.vertexes[i+1]]);
    paths.push(points);
   }
  }
 }else{
  if(body.status!=='OK')throw Error('routeNotFound');
  const route=mode==='traffic'?body.routes?.find(r=>routeNumber(r.properties?.totalDistance)&&routeNumber(r.properties?.totalTime)):body.route;
  if(!route)throw Error('routeInvalidResponse');
  props=route.properties;
  const entries=mode==='traffic'?(route.steps||[]):(route.legs||[]).flatMap(leg=>leg.steps||[]);
  steps=entries.map(step=>({guidance:step.properties?.guidance,distance:step.properties?.distance,time:step.properties?.time}));
  paths=entries.map(step=>step.path?.points||[]);
 }
 if(!routeNumber(props?.totalDistance)||!routeNumber(props?.totalTime))throw Error('routeInvalidResponse');
 // Return only documented display fields. No upstream URLs or credentials.
 let remaining=30000;
 paths=paths.map(path=>{if(!Array.isArray(path)||path.some(p=>!routePoint(p)))return [];const result=path.slice(0,remaining);remaining-=result.length;return result;}).filter(path=>path.length>1);
 return {mode,distanceMeters:props.totalDistance,durationSeconds:props.totalTime,steps:steps.slice(0,500).map(s=>({guidance:String(s.guidance||'').slice(0,300),distanceMeters:routeNumber(s.distance)?s.distance:null,durationSeconds:routeNumber(s.time)?s.time:null})),paths};
}
export function createRoutingProxy(env,{fetcher=globalThis.fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();
 const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 return async(url,res)=>{
  const mode=url.searchParams.get('mode'),values=['startLat','startLng','endLat','endLng'].map(key=>url.searchParams.get(key));
  const coords=values.map(Number);
  if(!Object.hasOwn(routeEndpoints,mode)||values.some(v=>v===null||!v.trim())||coords.some((v,i)=>!Number.isFinite(v)||Math.abs(v)>(i%2?180:90))){send(res,400,{error:'invalidRouteQuery'});return;}
  const apiKey=String(env.KAKAO_REST_API_KEY||'').trim();
  if(!apiKey){send(res,503,{error:'routeKeyMissing'});return;}
  const id=JSON.stringify([mode,...coords]);
  try{
   const cached=cache.get(id);
   if(cached&&cached.expires>now()){send(res,200,cached.data);return;}
   if(!pending.has(id)){
    if(pending.size>=8){send(res,429,{error:'routeBusy'});return;}
    const request=(async()=>{
     const target=new URL(routeEndpoints[mode]),[sy,sx,ey,ex]=coords;
     if(mode==='car'){target.searchParams.set('origin',sx+','+sy);target.searchParams.set('destination',ex+','+ey);target.searchParams.set('summary','false');}
     else{for(const [key,value] of Object.entries({start_x:sx,start_y:sy,end_x:ex,end_y:ey,input_coord:'WGS84',output_coord:'WGS84'}))target.searchParams.set(key,String(value));}
     const response=await fetcher(target,{headers:{Authorization:'KakaoAK '+apiKey},signal:AbortSignal.timeout(12000),redirect:'error'});
     if(!response.ok)throw Error([401,403].includes(response.status)?'routeAuthFailed':response.status===429?'routeQuotaExceeded':'routeUpstreamFailed');
     const text=await response.text();if(text.length>4000000)throw Error('routeInvalidResponse');
     let body;try{body=JSON.parse(text);}catch{throw Error('routeInvalidResponse');}
     const data=normalizeRoute(body,mode);
     if(cache.size>=128)cache.delete(cache.keys().next().value);
     cache.set(id,{data,expires:now()+120000});return data;
    })();pending.set(id,request);
   }
   let data;try{data=await pending.get(id);}finally{pending.delete(id);}
   send(res,200,data);
  }catch(error){
   const known=['routeNotFound','routeInvalidResponse','routeAuthFailed','routeQuotaExceeded','routeUpstreamFailed'];
   send(res,502,{error:known.includes(error.message)?error.message:['TimeoutError','AbortError'].includes(error.name)?'routeTimeout':'routeUpstreamFailed'});
  }
 };
}
