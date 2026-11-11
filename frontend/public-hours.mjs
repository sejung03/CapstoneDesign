export function parsePublicHours(xml,Parser=globalThis.DOMParser){
 if(typeof xml!=='string'||xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error('hoursInvalidResponse');
 const doc=new Parser().parseFromString(xml,'application/xml');
 if(doc.querySelector('parsererror'))throw Error('hoursInvalidResponse');
 const code=doc.querySelector('resultCode')?.textContent?.trim();
 if(!['0','00','0000'].includes(code))throw Error('hoursUpstreamFailed');
 const fields=['hpid','dutyName','dutyAddr','dutyMapimg','dutyTel1','wgs84Lat','wgs84Lon',...Array.from({length:8},(_,i)=>['dutyTime'+(i+1)+'s','dutyTime'+(i+1)+'c']).flat()];
 return [...doc.querySelectorAll('item')].map(node=>Object.fromEntries(fields.map(field=>[field,node.querySelector(field)?.textContent?.trim()||''])));
}
const comparable=value=>String(value||'').normalize('NFKC').replace(/[\s().,\-·]/g,'').toLowerCase();
const digits=value=>String(value||'').replace(/\D/g,'');
export function matchPublicFacility(item,rows){
 const name=comparable(item.name.ko),phone=digits(item.phone);
 const matches=rows.filter(row=>{
  if(!row.hpid||comparable(row.dutyName)!==name)return false;
  const rowPhone=digits(row.dutyTel1);
  if(phone.length>=8&&phone===rowPhone)return true;
  const address=comparable(item.area.ko),other=comparable(row.dutyAddr).split('(')[0];
  if(address.length>10&&other.length>10&&(address===other||address.startsWith(other)||other.startsWith(address)))return true;
  const lat=Number(row.wgs84Lat),lng=Number(row.wgs84Lon);
  return !!row.wgs84Lat&&!!row.wgs84Lon&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.hypot((lat-item.lat)*111000,(lng-item.lng)*88000)<200;
 });
 return matches.length===1?matches[0]:null;
}
export function readSchedule(row){
 return Array.from({length:8},(_,i)=>({day:i+1,start:String(row['dutyTime'+(i+1)+'s']||''),end:String(row['dutyTime'+(i+1)+'c']||'')}));
}
function minutes(value,{end=false}={}){
 if(!/^\d{3,4}$/.test(value))return null;
 const text=value.padStart(4,'0'),hour=Number(text.slice(0,-2)),minute=Number(text.slice(-2));
 if(minute>59||hour>(end?47:23))return null;
 return hour*60+minute;
}
function interval(slot){
 if(!slot)return null;
 const start=minutes(slot.start),rawEnd=minutes(slot.end,{end:true});
 if(start===null||rawEnd===null||rawEnd===start)return null;
 return {start,end:rawEnd<start?rawEnd+1440:rawEnd};
}
export function evaluateSchedule(schedule,now=new Date(),{holiday=false}={}){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const weekday={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}[parts.weekday];
 const day=holiday?8:weekday,minute=Number(parts.hour)*60+Number(parts.minute);
 const current=interval(schedule.find(s=>s.day===day));
 const previous=holiday?null:interval(schedule.find(s=>s.day===(weekday===1?7:weekday-1)));
 if(previous&&previous.end>1440&&minute<previous.end-1440)return {status:'open',hours:formatSlot(schedule.find(s=>s.day===(weekday===1?7:weekday-1)))};
 if(!current)return {status:'unknown',hours:null};
 return {status:minute>=current.start&&minute<current.end?'open':'closed',hours:formatSlot(schedule.find(s=>s.day===day))};
}
export function formatSlot(slot){
 const range=interval(slot);if(!range)return null;
 const text=value=>String(Math.floor(value/60)%24).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
 return text(range.start)+'–'+(range.end>=1440?'(+1) ':'')+text(range.end);
}
export function withCurrentHours(item,now=new Date()){
 return item.schedule?{...item,...evaluateSchedule(item.schedule,now)}:item.source==='kakao'?{...item,status:'unknown',hours:null}:item;
}
export async function enrichPublicHours(items,{fetcher=globalThis.fetch,signal,onProgress=()=>{},parse=parsePublicHours}={}){
 const result=items.map(item=>({...withCurrentHours(item)}));let cursor=0;
 const worker=async()=>{
  while(cursor<result.length){
   if(signal?.aborted)return;
   const index=cursor++,item=result[index];
   if(item.schedule)continue;
   const province=item.area.ko.trim().split(/\s+/)[0];
   const query=new URLSearchParams({type:item.type,name:item.name.ko,province});
   try{
    const response=await fetcher('/api/public-hours?'+query,{signal,cache:'no-store'});
    if(!response.ok){const data=await response.json();throw Error(data.error||'hoursUpstreamFailed');}
    const rows=parse(await response.text()),match=matchPublicFacility(item,rows);
    if(match){
     const schedule=readSchedule(match);
     result[index]=withCurrentHours({...item,schedule,registeredAddress:String(match.dutyAddr||'').trim().slice(0,500),locationHint:String(match.dutyMapimg||'').trim().slice(0,500),phone:item.phone||(/^[0-9+\s()-]{5,30}$/.test(match.dutyTel1||'')?match.dutyTel1:''),hoursSource:'nmc',publicId:match.hpid,hoursError:schedule.some(slot=>formatSlot(slot))?'':'hoursScheduleMissing'});
    }else result[index]={...item,status:'unknown',hours:null,hoursError:'hoursNotMatched'};
   }catch(error){if(signal?.aborted)return;result[index]={...item,status:'unknown',hoursError:['hoursAuthFailed','hoursQuotaExceeded','hoursTimeout','hoursKeyMissing','hoursInvalidResponse'].includes(error.message)?error.message:'hoursUpstreamFailed'};}
   onProgress(result[index],index);
  }
 };
 await Promise.all(Array.from({length:Math.min(3,result.length)},worker));return result;
}
