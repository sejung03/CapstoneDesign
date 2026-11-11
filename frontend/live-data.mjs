import {departmentByKey,departmentFromCategory} from './departments.mjs';
import {withCurrentHours} from './public-hours.mjs';
export function createLiveState(){return {configured:false,key:'',phase:'idle',items:[],error:'',hasMore:false,nextCategories:[],page:0,queryKey:'',token:0};}
export function liveQueryKey(criteria){return JSON.stringify([String(criteria.region||'').trim(),criteria.type,criteria.department,criteria.center?.lat,criteria.center?.lng,criteria.targetFacilityId||null,criteria.targetQuery||null]);}
export function liveCriteria(criteria){return {...criteria,openOnly:!!criteria.openOnly,priority:'provider',sort:['name','distance'].includes(criteria.sort)?criteria.sort:'recommended'};}
export function placeQueries(criteria,categories){
 if(criteria.targetFacilityId&&criteria.targetQuery)return [{code:criteria.type==='pharmacy'?'PM9':'HP8',keyword:String(criteria.targetQuery).trim().slice(0,500)}];
 const region=String(criteria.region||'').trim().slice(0,80);
 if(!region)throw Error('regionRequired');
 const selected=departmentByKey[criteria.department];
 if(selected&&((selected.key==='pharmacy'&&criteria.type==='hospital')||(selected.key!=='pharmacy'&&criteria.type==='pharmacy')))return [];
 const departmentType=selected?[selected.key==='pharmacy'?'PM9':'HP8']:null;
 const kinds=categories||departmentType||(['hospital','pharmacy'].includes(criteria.type)?[criteria.type==='pharmacy'?'PM9':'HP8']:['HP8','PM9']);
 return kinds.map(code=>({code,keyword:region+' '+(code==='PM9'?'약국':selected?.keyword||'병원')}));
}
export function facilityAddress(item,locale='ko'){
 const road=String(item.roadAddress||'').trim(),registered=String(item.registeredAddress||'').trim();
 // Keep floor/room suffixes when the registered address extends the same road address.
 if(road&&registered.startsWith(road)&&/^[\s,(]/.test(registered.slice(road.length)))return registered;
 return road||registered||item.area?.[locale]||'';
}
export function normalizePlace(raw,order=0){
 if(!raw||!['HP8','PM9'].includes(raw.category_group_code))return null;
 const lat=Number(raw.y),lng=Number(raw.x);
 if(!raw.id||!raw.place_name||!String(raw.x||'').trim()||!String(raw.y||'').trim()||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return null;
 const type=raw.category_group_code==='PM9'?'pharmacy':'hospital';
 const category=String(raw.category_name||'').split('>').at(-1).trim();
 const department=type==='pharmacy'?'pharmacy':departmentFromCategory(category);
 const name=String(raw.place_name).slice(0,200),address=String(raw.road_address_name||raw.address_name||'').slice(0,300);
 const providerId=String(raw.id);
 if(!/^\d+$/.test(providerId))return null;
 const phone=/^[0-9+\s()-]{5,30}$/.test(raw.phone||'')?String(raw.phone):'';
 return {id:'kakao-'+providerId,providerId,source:'kakao',providerOrder:order,name:{ko:name,en:name},area:{ko:address,en:address},region:address,type,department,categoryLabel:category,status:'unknown',hours:null,distance:null,accessible:null,photo:null,lat,lng,phone,roadAddress:String(raw.road_address_name||'').slice(0,300),jibunAddress:String(raw.address_name||'').slice(0,300),placeUrl:'https://place.map.kakao.com/'+providerId,directionsUrl:'https://map.kakao.com/link/to/'+encodeURIComponent(name)+','+lat+','+lng,access:{ko:'접근성 정보 확인 필요',en:'Accessibility information unavailable'}};
}
export function mergePlaces(existing,incoming){
 const map=new Map(existing.map(item=>[item.id,item]));
 for(const item of incoming)if(item&&!map.has(item.id))map.set(item.id,{...item,providerOrder:map.size});
 return [...map.values()];
}
export function distanceInKm(origin,destination){
 const valid=point=>point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&Math.abs(point.lat)<=90&&Math.abs(point.lng)<=180;
 if(!valid(origin)||!valid(destination))return null;
 const rad=value=>value*Math.PI/180;
 const dLat=rad(destination.lat-origin.lat),dLng=rad(destination.lng-origin.lng);
 const a=Math.sin(dLat/2)**2+Math.cos(rad(origin.lat))*Math.cos(rad(destination.lat))*Math.sin(dLng/2)**2;
 return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
}
// User position is the only distance origin; map center and provider snapshots are not departures.
export function facilityDistanceKm(state,item){return distanceInKm(state.live?.position,item);}
export function displayedFacilities(state,search){
 const filterFavorites=items=>{const targeted=state.search.criteria.targetFacilityId?items.filter(item=>item.id===state.search.criteria.targetFacilityId):items;return state.search.favoritesOnly?targeted.filter(item=>state.favorites?.items.some(value=>value.id===item.id)):targeted;};
 if(state.source!=='live')return filterFavorites(search(state.search.criteria));
 const items=[...state.live.items],selected=state.discovery?.items?.find(item=>item.id===state.search.selectedId);
 if(selected&&!items.some(item=>item.id===selected.id))items.push(selected);
 return filterFavorites(search({...state.search.criteria,region:'',department:'all',priority:'provider'},items.map(item=>({...withCurrentHours(item),distance:facilityDistanceKm(state,item)}))));
}
export function resetLiveRequest(live,criteria){
 const token=live.token+1;
 return {...live,token,searchedAt:Date.now(),phase:'loading',hoursPhase:'idle',hoursError:'',items:[],error:'',hasMore:false,nextCategories:[],page:0,queryKey:liveQueryKey(criteria)};
}
export function acceptLiveResponse(live,token,result,{append=false}={}){
 if(live.token!==token)return live;
 return {...live,phase:'ready',error:'',items:mergePlaces(append?live.items:[],result.items),hasMore:result.hasMore,nextCategories:result.nextCategories,page:result.page};
}
