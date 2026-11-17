import {localizedLabels} from './i18n.mjs';
import {loadKakaoSdk} from './kakao-client.mjs';
export function createEmergency(){return {manual:false,notice:null,locationDraft:'',manualLocation:'',selectedPoint:null,locationSource:'',locationError:false,location:{phase:'idle',point:null,address:''}};}
export function normalizeEmergency(raw){
 const fail=()=>{throw new TypeError('Invalid emergency notice');};
 if(!raw||typeof raw!=='object'||typeof raw.active!=='boolean')return fail();
 if(!raw.active)return {active:false};
 const text=(value,max)=>{
  if(!value||typeof value.ko!=='string'||!value.ko.trim()||value.ko.length>max||value.en!==undefined&&(typeof value.en!=='string'||value.en.length>max))return fail();
  return localizedLabels(value,max);
 };
 if(raw.instructions!==undefined&&(!Array.isArray(raw.instructions)||raw.instructions.length>10))return fail();
 const instructions=(raw.instructions||[]).map(value=>text(value,1000));
 if(raw.videos!==undefined&&(!Array.isArray(raw.videos)||raw.videos.length>3))return fail();
 const videos=(raw.videos||[]).map(video=>{
  if(!video||typeof video.youtubeId!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(video.youtubeId))return fail();
  return {youtubeId:video.youtubeId,title:text(video.title,120)};
 });
 if(raw.topicId!==undefined&&(typeof raw.topicId!=='string'||!/^[-a-z0-9_]{1,60}$/.test(raw.topicId)))return fail();
 return {active:true,...(raw.topicId?{topicId:raw.topicId}:{}),instructions,title:raw.title==null?null:text(raw.title,120),message:raw.message==null?null:text(raw.message,1000),videos:[...new Map(videos.map(video=>[video.youtubeId,video])).values()]};
}
export function visibleEmergency(state,currentKey){
 const notice=state.emergency?.notice;
 return notice?.contentKey===currentKey?notice:null;
}
export function emergencyMapLink(point){
 if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||Math.abs(point.lat)>90||Math.abs(point.lng)>180)return '';
 return 'https://map.kakao.com/link/map/'+point.lat+','+point.lng;
}
export function requestEmergencyPosition({geolocation=globalThis.navigator?.geolocation,signal}={}){
 return new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,value)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>finish(new Error('locationCancelled'));
  if(signal?.aborted){abort();return;}
  if(!geolocation){finish(new Error('locationUnavailable'));return;}
  signal?.addEventListener('abort',abort,{once:true});
  try{geolocation.getCurrentPosition(result=>{
   const point={lat:result.coords.latitude,lng:result.coords.longitude,accuracy:result.coords.accuracy};
   if(!emergencyMapLink(point)){finish(new Error('locationUnavailable'));return;}
   finish(null,point);
  },()=>finish(new Error('locationUnavailable')),{enableHighAccuracy:true,maximumAge:0,timeout:10000});}catch{finish(new Error('locationUnavailable'));}
 });
}
export async function lookupEmergencyAddress(key,point,{signal,loadSdk=loadKakaoSdk,timeoutMs=6000,selected=false}={}){
 if(signal?.aborted||!key||!emergencyMapLink(point)||(!selected&&(!Number.isFinite(point.accuracy)||point.accuracy<=0||point.accuracy>1000)))return '';
 let sdk;try{sdk=await loadSdk(key);}catch{return '';}if(signal?.aborted)return '';
 return new Promise(resolve=>{
  let done=false;
  const finish=address=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(address);};
  const abort=()=>finish(''),timer=setTimeout(()=>finish(''),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  try{new sdk.maps.services.Geocoder().coord2Address(point.lng,point.lat,(rows,status)=>{
   if(status!==sdk.maps.services.Status.OK){finish('');return;}
   const row=rows?.[0],road=row?.road_address;
   const address=road?.address_name||row?.address?.address_name;
   const building=typeof road?.building_name==='string'?road.building_name.trim():'';
   finish(typeof address==='string'?String(address+(building&&!address.includes(building)?' ('+building+')':'')).slice(0,400):'');
  });}catch{finish('');}
 });
}

export function emergencySearchLink(text){
 const query=String(text||'').trim().slice(0,400);
 return query?'https://map.kakao.com/link/search/'+encodeURIComponent(query):'';
}

// Content selection only; medical relevance is supplied by reviewed backend rules.
export function normalizeEmergencyGuides(raw){
 if(!Array.isArray(raw)||raw.length>12)throw new TypeError('Invalid emergency guides');
 const seen=new Set();
 return raw.map(guide=>{
  if(!guide||typeof guide.id!=='string'||!/^[-a-z0-9_]{1,60}$/.test(guide.id)||seen.has(guide.id))throw new TypeError('Invalid emergency guides');
  seen.add(guide.id);
  const data=normalizeEmergency({...guide,active:true});
  if(!data.title||(!data.instructions.length&&!data.videos.length))throw new TypeError('Invalid emergency guides');
  let source;
  if(guide.source){
   const {label,url}=guide.source;
   if(typeof label!=='string'||!label.trim()||label.length>160||typeof url!=='string'||url.length>1000||!/^https:\/\//i.test(url))throw new TypeError('Invalid emergency guide source');
   const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw new TypeError('Invalid emergency guide source');
   source={label:label.trim(),url:parsed.href};
  }
  return {id:guide.id,title:data.title,instructions:data.instructions,videos:data.videos,...(source?{source}:{})};
 });
}
export function emergencyGuidance(notice,guides,selectedId){
 if(notice?.instructions?.length||notice?.videos?.length)return notice;
 const id=selectedId||notice?.topicId;
 return guides.find(guide=>guide.id===id)||null;
}
