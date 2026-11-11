import {placeQueries,normalizePlace,mergePlaces} from './live-data.mjs';
let sdkPromise;
export function loadKakaoSdk(key,{document:doc=globalThis.document,window:win=globalThis.window,timeoutMs=15000}={}){
 if(win.kakao?.maps?.services?.Places&&win.kakao.maps.Map&&win.kakao.maps.MarkerClusterer)return Promise.resolve(win.kakao);
 if(sdkPromise)return sdkPromise;
 sdkPromise=new Promise((resolve,reject)=>{
  if(!key){reject(Error('keyMissing'));return;}
  const script=doc.createElement('script');
  script.src='https://dapi.kakao.com/v2/maps/sdk.js?appkey='+encodeURIComponent(key)+'&autoload=false&libraries=services,clusterer';
  script.async=true;
  let finished=false;
  const fail=()=>{if(finished)return;finished=true;clearTimeout(timer);script.remove();reject(Error('mapLoadFailed'));};
  const timer=setTimeout(fail,timeoutMs);
  script.onerror=fail;
  script.onload=()=>{
   if(!win.kakao?.maps?.load){fail();return;}
   win.kakao.maps.load(()=>{if(finished)return;if(!win.kakao.maps.services?.Places||!win.kakao.maps.MarkerClusterer){fail();return;}finished=true;clearTimeout(timer);resolve(win.kakao);});
  };
  doc.head.appendChild(script);
 }).catch(error=>{sdkPromise=null;throw error;});
 return sdkPromise;
}
export async function searchKakao(key,criteria,{page=1,categories,api,timeoutMs=12000}={}){
 const kakao=api||await loadKakaoSdk(key);
 const nearby=!String(criteria.region||'').trim()&&validCenter(criteria.center);
 const queries=placeQueries(nearby?{...criteria,region:'nearby'}:criteria,categories);
 const batches=await Promise.all(queries.map(query=>new Promise((resolve,reject)=>{
  const places=new kakao.maps.services.Places();
  const timer=setTimeout(()=>reject(Error('searchTimeout')),timeoutMs);
  try{const callback=(rows,status,pagination)=>{
   clearTimeout(timer);
   if(status===kakao.maps.services.Status.ZERO_RESULT){resolve({items:[],hasNext:false,code:query.code});return;}
   if(status!==kakao.maps.services.Status.OK){reject(Error('searchFailed'));return;}
   resolve({items:rows.map((raw,index)=>normalizePlace(raw,index)).filter(Boolean),hasNext:!!pagination?.hasNextPage&&page<3,code:query.code});
  };
  if(nearby){const options={location:new kakao.maps.LatLng(criteria.center.lat,criteria.center.lng),radius:5000,size:15,page,sort:kakao.maps.services.SortBy.DISTANCE};
   if(['all','pharmacy'].includes(criteria.department))places.categorySearch(query.code,callback,options);
   else places.keywordSearch(query.keyword.replace(/^nearby /,''),callback,{...options,category_group_code:query.code});
  }else places.keywordSearch(query.keyword,callback,{category_group_code:query.code,size:15,page});}catch{clearTimeout(timer);reject(Error('searchFailed'));}
 })));
 const rows=batches.flatMap(batch=>batch.items),target=criteria.targetFacilityId,items=target?rows.filter(item=>item.id===target):rows;
 return {items,hasMore:(!target||!items.length)&&batches.some(batch=>batch.hasNext),nextCategories:batches.filter(batch=>batch.hasNext).map(batch=>batch.code),page};
}

export async function suggestKakaoPlaces(key,keyword,{center,signal,api,timeoutMs=5000}={}){
 const query=String(keyword||'').trim().slice(0,80);
 if(query.length<2||signal?.aborted)return [];
 const kakao=api||await loadKakaoSdk(key);
 if(signal?.aborted)return [];
 const batches=await Promise.all(['HP8','PM9'].map(code=>new Promise((resolve,reject)=>{
  let finished=false;
  const done=(error,rows=[])=>{
   if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(error)reject(error);else resolve(rows);
  };
  const abort=()=>done(null,[]);
  const timer=setTimeout(()=>done(Error('searchTimeout')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  const options={category_group_code:code,size:6,page:1};
  if(validCenter(center)){options.location=new kakao.maps.LatLng(center.lat,center.lng);options.sort=kakao.maps.services.SortBy.DISTANCE;}
  try{new kakao.maps.services.Places().keywordSearch(query,(rows,status)=>{
   if(status===kakao.maps.services.Status.ZERO_RESULT){done(null,[]);return;}
   if(status!==kakao.maps.services.Status.OK){done(Error('searchFailed'));return;}
   done(null,rows.map((raw,index)=>normalizePlace(raw,index)).filter(Boolean));
  },options);}catch{done(Error('searchFailed'));}
 })));
 return signal?.aborted?[]:mergePlaces([],batches.flat());
}

export function validCenter(point){
 return !!point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&point.lat>=-90&&point.lat<=90&&point.lng>=-180&&point.lng<=180;
}
export function requestLocation(geolocation=globalThis.navigator?.geolocation,{onRefine=()=>{},signal,refinementMs=15000}={}){
 return new Promise((resolve,reject)=>{
  if(!geolocation){reject(Error('locationUnavailable'));return;}
  let best=null,watchId=null,stopped=false,timer=null;
  const stop=()=>{
   stopped=true;clearTimeout(timer);
   if(watchId!==null)geolocation.clearWatch(watchId);
   signal?.removeEventListener('abort',abort);
  };
  const fail=cause=>{
   if(stopped)return;
   stop();if(best)return;
   const error=Error('locationUnavailable');error.code=cause?.code;reject(error);
  };
  const abort=()=>{
   if(stopped)return;
   stop();if(!best){const error=Error('Location request aborted');error.name='AbortError';reject(error);}
  };
  const receive=position=>{
   if(stopped)return;
   const point={lat:position.coords.latitude,lng:position.coords.longitude};
   if(!validCenter(point)){fail({code:2});return;}
   if(Number.isFinite(position.coords.accuracy)&&position.coords.accuracy>0)point.accuracy=position.coords.accuracy;
   if(Number.isFinite(position.timestamp))point.timestamp=position.timestamp;
   if(best&&(point.accuracy??Infinity)>=(best.accuracy??Infinity))return;
   const first=!best;best=point;
   if(first)resolve(point);else onRefine(point);
   if(point.accuracy<=100)stop();
  };
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  const options={enableHighAccuracy:true,timeout:15000,maximumAge:0};
  if(typeof geolocation.watchPosition==='function'){
   timer=setTimeout(()=>{if(best)stop();else fail({code:3});},refinementMs);
   try{watchId=geolocation.watchPosition(receive,fail,options);if(stopped)geolocation.clearWatch(watchId);}catch{fail({code:2});}
  }else{
   geolocation.getCurrentPosition(position=>{receive(position);stop();},fail,options);
  }
 });
}
let mapView=null;
let mountVersion=0;
export function getKakaoMapCenter(){
 if(!mapView)return null;
 const point=mapView.map.getCenter();
 const center={lat:point.getLat(),lng:point.getLng()};
 return validCenter(center)?center:null;
}
export function releaseKakaoMap(){
 mountVersion++;
 if(mapView){mapView.observer?.disconnect();mapView.clusterer.clear();mapView.label?.setMap(null);mapView.location?.setMap(null);mapView.routeLines?.forEach(line=>line.setMap(null));mapView=null;}
}
function pinImage(kakao,type,selected){
 const color=selected?'#f97316':type==='pharmacy'?'#15846b':'#60768d';
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42"><path fill="'+color+'" stroke="white" stroke-width="2" d="M16 1a15 15 0 0 0-15 15c0 11 15 25 15 25s15-14 15-25A15 15 0 0 0 16 1Z"/><path stroke="white" stroke-width="3" d="M16 9v14M9 16h14"/></svg>';
 return new kakao.maps.MarkerImage('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),new kakao.maps.Size(32,42),{offset:new kakao.maps.Point(16,42)});
}
export async function mountKakaoMap(key,items,selectedId,onSelect,{onError=()=>{},center=null,userLocation=null,recenterToken=0,locale='ko',routePaths=[],routeKey=''}={}){
 const version=++mountVersion;
 try{
  const kakao=await loadKakaoSdk(key);
  if(version!==mountVersion)return;
  const node=document.getElementById('kakao-map');if(!node)return;
  if(!mapView){
   const first=validCenter(center)?center:items[0];
   const map=new kakao.maps.Map(node,{center:new kakao.maps.LatLng(first?.lat??37.5665,first?.lng??126.9780),level:5});
   map.addControl(new kakao.maps.ZoomControl(),kakao.maps.ControlPosition.RIGHT);
   const clusterer=new kakao.maps.MarkerClusterer({map,gridSize:70,averageCenter:true,minLevel:4,minClusterSize:2,texts:count=>String(count),styles:[{width:'48px',height:'48px',background:'#1e40af',color:'#fff',textAlign:'center',lineHeight:'48px',borderRadius:'50%',border:'3px solid white',fontWeight:'700',boxShadow:'0 2px 8px #0004'}]});
   const observer=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(node.clientWidth&&node.clientHeight){const point=map.getCenter();map.relayout();map.setCenter(point);}}):null;
   observer?.observe(node);
   mapView={node,map,clusterer,observer,markers:[],fitted:'',centerKey:'',label:null,location:null};
  }else if(node!==mapView.node){node.replaceWith(mapView.node);}
  const view=mapView,{map,clusterer}=view;
  view.routeLines?.forEach(line=>line.setMap(null));view.routeLines=[];
  clusterer.clear();view.label?.setMap(null);view.label=null;view.location?.setMap(null);view.location=null;
  // Cluster counts describe loaded results, never the total number of facilities in a region.
  const bounds=new kakao.maps.LatLngBounds();
  view.markers=items.map(item=>{
   const point=new kakao.maps.LatLng(item.lat,item.lng);bounds.extend(point);
   const marker=new kakao.maps.Marker({position:point,title:item.name[locale]||item.name.ko,image:pinImage(kakao,item.type,item.id===selectedId)});
   kakao.maps.event.addListener(marker,'click',()=>onSelect(item.id));
   return marker;
  });
  clusterer.addMarkers(view.markers);
  const centerKey=validCenter(center)?JSON.stringify([center,recenterToken]):'';
  if(centerKey&&centerKey!==view.centerKey){map.setCenter(new kakao.maps.LatLng(center.lat,center.lng));view.centerKey=centerKey;}
  const signature=items.map(item=>item.id).join(',');
  if(signature!==view.fitted&&items.length){if(!centerKey)map.setBounds(bounds,45,45,55,45);view.fitted=signature;}
  if(validCenter(userLocation)){
   const dot=document.createElement('span');dot.className='user-location-dot';dot.setAttribute('aria-label',locale==='ko'?'내 위치':'Your location');
   view.location=new kakao.maps.CustomOverlay({position:new kakao.maps.LatLng(userLocation.lat,userLocation.lng),content:dot,zIndex:4});view.location.setMap(map);
  }
  const selected=items.find(item=>item.id===selectedId);
  if(selected){
   const point=new kakao.maps.LatLng(selected.lat,selected.lng);
   // Keep the selected facility visible even when its marker belongs to a cluster.
   const label=document.createElement('button');label.type='button';label.className='selected-map-label';label.textContent=selected.name[locale]||selected.name.ko;
   label.addEventListener('click',()=>onSelect(selected.id));
   view.label=new kakao.maps.CustomOverlay({position:point,content:label,yAnchor:1.7,zIndex:6});view.label.setMap(map);
   if(!routePaths?.length){if(map.getLevel()>3)map.setLevel(3,{anchor:point});map.panTo(point);}
  }
  if(routePaths?.length&&typeof kakao.maps.Polyline==='function'){
   const routeBounds=new kakao.maps.LatLngBounds();
   for(const segment of routePaths){
    if(!Array.isArray(segment)||segment.length<2)continue;
    const path=segment.filter(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>new kakao.maps.LatLng(p[1],p[0]));
    if(path.length<2)continue;
    path.forEach(point=>routeBounds.extend(point));
    const line=new kakao.maps.Polyline({map,path,strokeWeight:5,strokeColor:'#2563eb',strokeOpacity:.85,zIndex:3});view.routeLines.push(line);
   }
   if(view.routeLines.length&&view.routeFitted!==routeKey){map.setBounds(routeBounds,45,45,55,45);view.routeFitted=routeKey;}
  }else view.routeFitted='';
  map.relayout();
 }catch(error){if(version===mountVersion)onError(error);}
}
