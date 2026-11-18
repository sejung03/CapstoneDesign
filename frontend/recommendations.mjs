import {facilityDepartments} from './discovery.mjs';
import {assistantContent,assistantInputKey,assistantSearchContext} from './assistant.mjs';
import {displayedFacilities,liveQueryKey} from './live-data.mjs';
import {searchFacilities} from './facilities.mjs';
export function createRecommendations(){return {phase:'idle',key:'',items:[]};}
// Snapshot contains only real, currently open search results. No coordinates or contact details.
// displayOrder: position in the current list (distance order), so a ranker can keep it among equally matched places.
export function recommendationSnapshot(state){
 if(state.search.origin==='favorite'||state.source!=='live'||state.live.phase!=='ready'||state.live.hoursPhase==='loading'||state.live.queryKey!==liveQueryKey(state.search.criteria))return null;
 const ids=new Set(state.live.items.map(item=>item.id));
 const items=displayedFacilities(state,searchFacilities).filter(item=>ids.has(item.id)&&item.status==='open').map((item,displayOrder)=>({facilityId:item.id,name:item.name.ko,type:item.type,department:item.department,departments:item.type==='pharmacy'?['pharmacy']:facilityDepartments(item),status:'open',displayOrder})).sort((a,b)=>a.facilityId.localeCompare(b.facilityId));
 if(!items.length)return null;
 const resultSetId='results-'+state.live.token;
 const search=assistantSearchContext(state);
 return {key:JSON.stringify([assistantInputKey(state),resultSetId,items]),payload:{reason:'recommendations',locale:state.locale,...assistantContent(state),search,candidates:{resultSetId,items}}};
}
export function normalizeRecommendations(raw,snapshot){
 if(!raw||typeof raw!=='object'||raw.resultSetId!==snapshot.payload.candidates.resultSetId||!Array.isArray(raw.items)||raw.items.length>100)throw new TypeError('Invalid recommendations');
 const allowed=new Set(snapshot.payload.candidates.items.map(item=>item.facilityId)),seen=new Set(),items=[];
 for(const entry of raw.items){
  if(!entry||typeof entry.facilityId!=='string'||!entry.reason||typeof entry.reason.ko!=='string'||!entry.reason.ko.trim()||entry.reason.ko.length>240||entry.reason.en!==undefined&&(typeof entry.reason.en!=='string'||entry.reason.en.length>240))throw new TypeError('Invalid recommendation item');
  if(!allowed.has(entry.facilityId)||seen.has(entry.facilityId))continue;
  seen.add(entry.facilityId);items.push({facilityId:entry.facilityId,reason:{ko:entry.reason.ko.trim(),...(entry.reason.en?.trim()?{en:entry.reason.en.trim()}:{})}});
 }
 return items;
}
export function recommendationOrder(state,items){
 const result=state.recommendations;
 if(result?.phase!=='ready'||result.key!==recommendationSnapshot(state)?.key)return items;
 const order=new Map(result.items.map((item,index)=>[item.facilityId,{...item,index}]));
 return items.map(item=>order.has(item.id)?{...item,recommendationReason:order.get(item.id).reason}:item).sort((a,b)=>(order.get(a.id)?.index??Infinity)-(order.get(b.id)?.index??Infinity));
}
