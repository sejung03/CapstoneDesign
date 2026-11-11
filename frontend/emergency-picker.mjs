import {loadKakaoSdk,validCenter} from './kakao-client.mjs';
// General places and addresses: no hospital/pharmacy category restriction.
export async function suggestEmergencyLocations(key,text,{api,signal,timeoutMs=5000}={}){
 const query=String(text||'').trim().slice(0,400);
 if(query.length<2||signal?.aborted||!key)return [];
 const sdk=api||await loadKakaoSdk(key);if(signal?.aborted)return [];
 const search=kind=>new Promise((resolve,reject)=>{
  let done=false;
  const finish=(error,rows=[])=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(rows);};
  const abort=()=>finish(null,[]),timer=setTimeout(()=>finish(Error('searchTimeout')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  const callback=(rows,status)=>{
   if(status===sdk.maps.services.Status.ZERO_RESULT){finish(null,[]);return;}
   if(status!==sdk.maps.services.Status.OK){finish(Error('searchFailed'));return;}
   finish(null,rows.filter(row=>String(row.x??'').trim()&&String(row.y??'').trim()).map(row=>({id:kind+'-'+String(row.id||row.address_name),name:String(row.place_name||row.road_address?.building_name||row.address_name||'').slice(0,200),address:String(row.road_address_name||row.road_address?.address_name||row.address_name||'').slice(0,400),lat:Number(row.y),lng:Number(row.x)})).filter(item=>item.name&&validCenter(item)));
  };
  try{if(kind==='address')new sdk.maps.services.Geocoder().addressSearch(query,callback,{size:5});else new sdk.maps.services.Places().keywordSearch(query,callback,{size:5,page:1});}catch(error){finish(error);}
 });
 const batches=await Promise.allSettled([search('place'),search('address')]);
 if(signal?.aborted)return [];
 if(batches.every(batch=>batch.status==='rejected'))throw Error('searchFailed');
 const seen=new Set();return batches.flatMap(batch=>batch.status==='fulfilled'?batch.value:[]).filter(item=>{const id=item.name+'|'+item.lat+'|'+item.lng;if(seen.has(id))return false;seen.add(id);return true;}).slice(0,6);
}
export async function mountEmergencyPicker(node,key,{point=null,center=null,onSelect=()=>{},loadSdk=loadKakaoSdk,isCancelled=()=>false}={}){
 const sdk=await loadSdk(key);if(isCancelled())return null;
 const initial=validCenter(point)?point:validCenter(center)?center:{lat:37.5665,lng:126.978};
 const map=new sdk.maps.Map(node,{center:new sdk.maps.LatLng(initial.lat,initial.lng),level:3});
 map.addControl(new sdk.maps.ZoomControl(),sdk.maps.ControlPosition.RIGHT);
 let marker=null,disposed=false;const bindings=[];
 const show=value=>{if(!validCenter(value)){marker?.setMap(null);marker=null;return;}
  const position=new sdk.maps.LatLng(value.lat,value.lng);
  if(!marker){marker=new sdk.maps.Marker({map,position,draggable:true});const drag=()=>{const p=marker?.getPosition();if(p)choose({lat:p.getLat(),lng:p.getLng()});};sdk.maps.event.addListener(marker,'dragend',drag);bindings.push([marker,'dragend',drag]);}else marker.setPosition(position);
 };
 const choose=value=>{if(disposed||isCancelled()||!validCenter(value))return;show(value);onSelect(value);};
 const click=event=>choose({lat:event.latLng.getLat(),lng:event.latLng.getLng()}),drag=()=>{const p=map.getCenter();choose({lat:p.getLat(),lng:p.getLng()});};
 for(const [name,handler] of [['click',click],['dragend',drag]]){sdk.maps.event.addListener(map,name,handler);bindings.push([map,name,handler]);}
 show(point);
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>map.relayout()):null;observer?.observe(node);map.relayout();
 return {center:()=>map.getCenter(),selectCenter:drag,update(value){if(disposed)return;show(value);if(validCenter(value))map.setCenter(new sdk.maps.LatLng(value.lat,value.lng));},dispose(){disposed=true;observer?.disconnect();bindings.forEach(([target,name,handler])=>sdk.maps.event.removeListener?.(target,name,handler));marker?.setMap(null);node.replaceChildren();}};
}
