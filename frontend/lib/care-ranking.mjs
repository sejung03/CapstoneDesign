// 병원 추천 순위(reason=recommendations). 문진 엔진이 안내한 진료과(사용자가 적용한 검색 조건)를 기준으로
// 그 진료과가 대표 진료과인 곳 → 그 진료과 진료가 확인된 곳 순으로 올린다. 같은 무리 안에서는 지금 화면 순서(거리 등)를 지킨다.
// 의학적 판단을 새로 하지 않는다: 진료과는 엔진이 정한 것을 쓰고, 기관 정보는 프론트가 조회한 실제 데이터만 쓴다.
// 11/25 개인화: 로그인 사용자가 길찾기·전화번호 복사를 FREQUENT_CHOICE_MIN번 이상 한 기관은 "같은 무리 안에서만" 앞으로 온다
// (무리 순서 → 횟수 많은 순 → 화면 순서). 진료과 근거가 없으면(약국 검색 등) 후보 전체가 한 무리다.
// 횟수는 서버가 로그인 세션으로 읽어 넘긴다(frequentCounts). 요청 본문의 값은 쓰지 않는다.
import {departmentCatalog} from '../departments.mjs';

const MAX_ITEMS=100;
const ID_RE=/^[\w:.-]{1,200}$/;

export class RankingInputError extends Error{}

function departmentName(key){return departmentCatalog.find(d=>d.key===key)?.keyword??null;}
const frequentReason=n=>`이전에 길찾기나 전화번호 복사를 ${n}번 한 곳이에요.`;

/**
 * @param {object} payload
 * @param {{frequentCounts?: Map<string, number>|null}} [options] facility ID → count (already filtered to frequent ones)
 * @returns {{resultSetId:string, items:Array<{facilityId:string, reason:{ko:string}}>}}
 */
export function rankFacilities(payload,{frequentCounts=null}={}){
 const set=payload?.candidates;
 if(!set||typeof set!=='object'||typeof set.resultSetId!=='string'||!set.resultSetId||set.resultSetId.length>200||!Array.isArray(set.items)||set.items.length>MAX_ITEMS)throw new RankingInputError('candidates');
 const counts=frequentCounts instanceof Map?frequentCounts:new Map();
 const frequent=id=>{const n=counts.get(id);return Number.isInteger(n)&&n>0?n:0;};
 const open=[];
 set.items.forEach((item,index)=>{
  if(!item||typeof item.facilityId!=='string'||!ID_RE.test(item.facilityId)||item.status!=='open')return;
  open.push({item,order:Number.isInteger(item.displayOrder)&&item.displayOrder>=0?item.displayOrder:index});
 });
 const empty={resultSetId:set.resultSetId,items:[]};
 // 진료과 근거가 없으면 한 무리: 자주 쓴 곳만 앞으로(횟수 많은 순 → 화면 순서), 나머지는 순서 그대로
 const byFrequencyOnly=()=>({resultSetId:set.resultSetId,items:open.filter(({item})=>frequent(item.facilityId))
  .sort((a,b)=>frequent(b.item.facilityId)-frequent(a.item.facilityId)||a.order-b.order)
  .map(({item})=>({facilityId:item.facilityId,reason:{ko:frequentReason(frequent(item.facilityId))}}))});
 const target=payload?.search?.department;
 const name=typeof target==='string'?departmentName(target):null;
 if(!name||target==='pharmacy'||payload?.search?.type==='pharmacy')return counts.size?byFrequencyOnly():empty;
 // 11/25 1·2순위 진료과를 함께 검색했으면 1순위 무리(0·1) 뒤에 2순위 무리(2·3)를 둔다
 const also=payload?.search?.departments;
 const targets=Array.isArray(also)&&also.length===2&&also[0]===target&&also[1]!==target&&also[1]!=='pharmacy'&&departmentName(also[1])?[target,also[1]]:[target];
 const scored=[];
 for(const {item,order} of open){
  const departments=Array.isArray(item.departments)?item.departments:[];
  const main=targets.findIndex(key=>item.department===key),confirmed=targets.findIndex(key=>departments.includes(key));
  const rank=main>=0&&(confirmed<0||main<=confirmed)?main:confirmed;
  if(rank<0)continue;
  const label=departmentName(targets[rank]),guide=rank===0?'문진에서 안내한':'문진에서 함께 안내한';
  if(rank===main)scored.push({group:rank*2,order,facilityId:item.facilityId,reason:`${guide} ${label}가 대표 진료과인 곳이에요.`});
  else scored.push({group:rank*2+1,order,facilityId:item.facilityId,reason:`${label} 진료가 확인된 곳이에요.`});
 }
 // 진료과에 맞는 곳이 없으면 무리가 하나뿐이다 → 횟수로만
 if(!scored.length)return counts.size?byFrequencyOnly():empty;
 // 모두 같은 무리이고 자주 쓴 곳도 없으면 순서를 바꿀 근거가 없다 → 추천 없음(기존 순서 유지)
 const groups=new Set(scored.map(s=>s.group));
 if(scored.length===set.items.length&&groups.size===1&&!scored.some(s=>frequent(s.facilityId)))return empty;
 scored.sort((a,b)=>a.group-b.group||frequent(b.facilityId)-frequent(a.facilityId)||a.order-b.order);
 return {resultSetId:set.resultSetId,items:scored.map(({facilityId,reason})=>{const n=frequent(facilityId);return {facilityId,reason:{ko:n?`${reason} ${frequentReason(n)}`:reason}};})};
}
