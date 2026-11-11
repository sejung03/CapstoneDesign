const endpoints={
 hospital:'https://apis.data.go.kr/B552657/HsptlAsembySearchService/getHsptlMdcncListInfoInqire',
 pharmacy:'https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyListInfoInqire'
};
export function publicDataKey(env,type){
 let key=String(env[type==='pharmacy'?'PUBLIC_DATA_PHARMACY_KEY':'PUBLIC_DATA_HOSPITAL_KEY']||env.PUBLIC_DATA_SERVICE_KEY||'').trim();
 if(/%[0-9a-f]{2}/i.test(key)){try{key=decodeURIComponent(key);}catch{}}
 return key;
}
export function publicDataConfigured(env){return !!publicDataKey(env,'hospital')&&!!publicDataKey(env,'pharmacy');}
export function createPublicDataProxy(env,{fetcher=globalThis.fetch,now=Date.now}={}){
 const cache=new Map(),pending=new Map();
 const send=(res,status,data,type='application/json; charset=utf-8')=>{
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(type.startsWith('application/json')?JSON.stringify(data):data);
 };
 return async function publicDataRequest(url,res){
  const type=url.searchParams.get('type'),name=(url.searchParams.get('name')||'').trim(),province=(url.searchParams.get('province')||'').trim();
  if(!endpoints[type]||!name||name.length>100||province.length>30||/[\u0000-\u001f]/.test(name+province)){send(res,400,{error:'invalidHoursQuery'});return;}
  const key=publicDataKey(env,type);
  if(!key){send(res,503,{error:'hoursKeyMissing'});return;}
  const id=JSON.stringify([type,name,province]);
  try{
   const cached=cache.get(id);
   let xml;
   if(cached&&cached.expires>now())xml=cached.xml;
   else{
    if(!pending.has(id)){
     const request=(async()=>{
      const target=new URL(endpoints[type]);
      target.searchParams.set('serviceKey',key);target.searchParams.set('QN',name);
      if(province)target.searchParams.set('Q0',province);
      target.searchParams.set('pageNo','1');target.searchParams.set('numOfRows','100');
      const response=await fetcher(target,{signal:AbortSignal.timeout(12000),redirect:'error'});
      if(!response.ok)throw Error(response.status===401||response.status===403?'hoursAuthFailed':'hoursUpstreamFailed');
      const text=await response.text();
      if(text.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('hoursInvalidResponse');
      const code=text.match(/<resultCode>\s*([^<]+)\s*<\/resultCode>/i)?.[1]?.trim();
      if(code&&!['0','00','0000'].includes(code))throw Error(['20','30','31','32'].includes(code)?'hoursAuthFailed':code==='22'?'hoursQuotaExceeded':'hoursUpstreamFailed');
      if(!code||!/<response[\s>]/i.test(text)||!/<items(?:\s|>|\/)/i.test(text))throw Error('hoursInvalidResponse');
      // Cache source schedules, never the time-dependent open/closed decision.
      if(cache.size>=128)cache.delete(cache.keys().next().value);
      cache.set(id,{xml:text,expires:now()+3600000});return text;
     })();
     pending.set(id,request);
    }
    try{xml=await pending.get(id);}finally{pending.delete(id);}
   }
   send(res,200,xml,'application/xml; charset=utf-8');
  }catch(error){
   const known=['hoursAuthFailed','hoursQuotaExceeded','hoursInvalidResponse','hoursUpstreamFailed'];
   const message=known.includes(error.message)?error.message:(error.name==='TimeoutError'||error.name==='AbortError')?'hoursTimeout':'hoursUpstreamFailed';
   send(res,502,{error:message});
  }
 };
}
