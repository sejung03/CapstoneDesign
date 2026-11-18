// 병원 추천 순위(reason=recommendations). 문진 엔진이 안내한 진료과(사용자가 적용한 검색 조건)를 기준으로
// 그 진료과가 대표 진료과인 곳 → 그 진료과 진료가 확인된 곳 순으로 올린다. 같은 무리 안에서는 지금 화면 순서(거리 등)를 지킨다.
// 의학적 판단을 새로 하지 않는다: 진료과는 엔진이 정한 것을 쓰고, 기관 정보는 프론트가 조회한 실제 데이터만 쓴다.
import {departmentCatalog} from '../departments.mjs';

const MAX_ITEMS=100;
const ID_RE=/^[\w:.-]{1,200}$/;

export class RankingInputError extends Error{}

function departmentName(key){return departmentCatalog.find(d=>d.key===key)?.keyword??null;}

/** @returns {{resultSetId:string, items:Array<{facilityId:string, reason:{ko:string}}>}} */
export function rankFacilities(payload){
 const set=payload?.candidates;
 if(!set||typeof set!=='object'||typeof set.resultSetId!=='string'||!set.resultSetId||set.resultSetId.length>200||!Array.isArray(set.items)||set.items.length>MAX_ITEMS)throw new RankingInputError('candidates');
 const target=payload?.search?.department;
 const name=typeof target==='string'?departmentName(target):null;
 if(!name||target==='pharmacy'||payload?.search?.type==='pharmacy')return {resultSetId:set.resultSetId,items:[]};
 const scored=[];
 set.items.forEach((item,index)=>{
  if(!item||typeof item.facilityId!=='string'||!ID_RE.test(item.facilityId)||item.status!=='open')return;
  const order=Number.isInteger(item.displayOrder)&&item.displayOrder>=0?item.displayOrder:index;
  const departments=Array.isArray(item.departments)?item.departments:[];
  if(item.department===target)scored.push({group:0,order,facilityId:item.facilityId,reason:{ko:`문진에서 안내한 ${name}가 대표 진료과인 곳이에요.`}});
  else if(departments.includes(target))scored.push({group:1,order,facilityId:item.facilityId,reason:{ko:`${name} 진료가 확인된 곳이에요.`}});
 });
 // 둘 다 해당하는 곳이 없거나 모두 같은 무리면 순서를 바꿀 근거가 없다 → 추천 없음(기존 순서 유지)
 const groups=new Set(scored.map(s=>s.group));
 if(!scored.length||(scored.length===set.items.length&&groups.size===1))return {resultSetId:set.resultSetId,items:[]};
 scored.sort((a,b)=>a.group-b.group||a.order-b.order);
 return {resultSetId:set.resultSetId,items:scored.map(({facilityId,reason})=>({facilityId,reason}))};
}
