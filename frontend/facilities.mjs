import {phrase,expandLocales} from './i18n.mjs';
// All entries are fictional UI fixtures. No real clinic information or coordinates.
export const facilities = [
 {id:'sample-a',accessible:true,photo:{src:'clinic-demo.png',kind:'example'},name:expandLocales({ko:'예시 내과 A',en:'Sample Internal Medicine A'}),type:'hospital',department:'internal',area:expandLocales({ko:'춘천시 효자동',en:'Hyoja-dong, Chuncheon'}),region:'강원특별자치도 춘천시 효자동',distance:0.5,status:'open',hours:'09:00–18:00',x:31,y:39,access:expandLocales({ko:'건물 1층 · 휠체어 접근 예시',en:'Ground floor · sample accessible entrance'})},
 {id:'sample-b',name:expandLocales({ko:'예시 가정의학과 B',en:'Sample Family Clinic B'}),type:'hospital',department:'family',area:expandLocales({ko:'춘천시 효자동',en:'Hyoja-dong, Chuncheon'}),region:'강원특별자치도 춘천시 효자동',distance:0.8,status:'unknown',hours:null,x:48,y:60,access:expandLocales({ko:'엘리베이터 이용 예시',en:'Sample elevator access'})},
 {id:'sample-c',name:expandLocales({ko:'예시 약국 C',en:'Sample Pharmacy C'}),type:'pharmacy',department:'pharmacy',area:expandLocales({ko:'춘천시 석사동',en:'Seoksa-dong, Chuncheon'}),region:'강원특별자치도 춘천시 석사동',distance:1.1,status:'open',hours:'09:00–21:00',x:64,y:34,access:expandLocales({ko:'출입구 단차 정보 확인 필요',en:'Entrance accessibility unknown'})},
 {id:'sample-d',name:expandLocales({ko:'예시 치과 D',en:'Sample Dental Clinic D'}),type:'hospital',department:'dental',area:expandLocales({ko:'춘천시 석사동',en:'Seoksa-dong, Chuncheon'}),region:'강원특별자치도 춘천시 석사동',distance:1.5,status:'closed',hours:'09:00–17:00',x:74,y:65,access:expandLocales({ko:'건물 2층 · 엘리베이터 예시',en:'Second floor · sample elevator'})},
 {id:'sample-e',name:expandLocales({ko:'예시 약국 E',en:'Sample Pharmacy E'}),type:'pharmacy',department:'pharmacy',area:expandLocales({ko:'춘천시 후평동',en:'Hupyeong-dong, Chuncheon'}),region:'강원특별자치도 춘천시 후평동',distance:2.1,status:'unknown',hours:null,x:41,y:20,access:expandLocales({ko:'접근성 정보 확인 필요',en:'Accessibility information unknown'})},
 {id:'sample-f',name:expandLocales({ko:'예시 내과 F',en:'Sample Internal Medicine F'}),type:'hospital',department:'internal',area:expandLocales({ko:'춘천시 후평동',en:'Hupyeong-dong, Chuncheon'}),region:'강원특별자치도 춘천시 후평동',distance:2.8,status:'closed',hours:'09:00–18:00',x:83,y:25,access:expandLocales({ko:'건물 1층 예시',en:'Sample ground-floor location'})}
];
export const emptyCriteria = () => ({region:'',type:'all',department:'all',openOnly:false,sort:'distance'});
const normalize = value => String(value).toLocaleLowerCase().replace(/\s+/g,'');
export function searchFacilities(criteria,items=facilities){
 const terms=String(criteria.region??'').trim().split(/\s+/).filter(Boolean).map(normalize);
 const results=items.filter(item=>{
  const haystack=normalize(item.region+' '+item.name.ko+' '+item.name.en+' '+item.area.en);
  return terms.every(term=>haystack.includes(term))
   && (criteria.type==='all'||item.type===criteria.type)
   && (criteria.department==='all'||item.department===criteria.department)
   && (!criteria.openOnly||item.status==='open');
 });
 return results.sort((a,b)=>{
  if(criteria.sort==='name')return a.name.ko.localeCompare(b.name.ko,'ko');
  if(criteria.sort==='recommended'){
   if(criteria.priority==='provider')return (a.providerOrder??0)-(b.providerOrder??0)||a.id.localeCompare(b.id);
   if(criteria.priority==='access'){const difference=Number(b.accessible===true)-Number(a.accessible===true);if(difference)return difference;}
   if(criteria.priority==='open'){const order={open:0,unknown:1,closed:2};const difference=order[a.status]-order[b.status];if(difference)return difference;}
  }
  const aDistance=Number.isFinite(a.distance)?a.distance:Infinity,bDistance=Number.isFinite(b.distance)?b.distance:Infinity;
  if(aDistance!==bDistance)return aDistance-bDistance;
  return (a.providerOrder??0)-(b.providerOrder??0)||a.id.localeCompare(b.id);
 });
}
export function selectedFacility(results,id){
 return results.find(item=>item.id===id)??null;
}
