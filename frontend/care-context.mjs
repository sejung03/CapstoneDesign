import {departmentCatalog} from './departments.mjs';
// Frontend simulation only: explicit search preferences, no inference from symptoms.
export function buildSuggestion(message,profile={},previous={}){
 const text=String(message).toLowerCase();
 const plan={region:previous.region||profile.region||'',type:previous.type||'all',department:previous.department||'all',openOnly:!!previous.openOnly,priority:previous.priority||profile.preference||'distance'};
 const areas=[['춘천','춘천'],['chuncheon','춘천'],['효자동','효자동'],['hyoja','효자동'],['석사동','석사동'],['seoksa','석사동'],['후평동','후평동'],['hupyeong','후평동'],['서울','서울'],['seoul','서울'],['부산','부산'],['busan','부산'],['인천','인천'],['대구','대구'],['대전','대전'],['광주','광주']];
 let areaIndex=-1;
 for(const [term,region] of areas){const index=text.lastIndexOf(term);if(index>=0&&index>=areaIndex){areaIndex=index;plan.region=region;}}
 const matches=[];
 for(const item of departmentCatalog)for(const term of item.aliases){
  const index=text.lastIndexOf(term.toLowerCase());
  if(index>=0&&(!/^[a-z]/i.test(term)||!/[a-z]/i.test(text[index-1]||'')&&!/[a-z]/i.test(text[index+term.length]||''))&&!/^\s*(말고|제외|아닌|빼)/.test(text.slice(index+term.length)))matches.push({index,end:index+term.length,department:item.key});
 }
 // Prefer specific specialties over generic substrings such as 외과 inside 신경외과.
 const candidates=matches.filter(match=>!matches.some(other=>other.index<=match.index&&other.end>=match.end&&other.end-other.index>match.end-match.index));
 candidates.sort((a,b)=>b.index-a.index);
 const chosen=candidates[0],deptIndex=chosen?.index??-1;
 if(chosen){plan.department=chosen.department;plan.type=chosen.department==='pharmacy'?'pharmacy':'hospital';}
 if(/전체\s*진료과|모든\s*진료과|all departments/.test(text)){plan.department='all';plan.type='all';}
 if(deptIndex<0&&/병원|의원|hospital|clinic/.test(text)&&!/병원\s*말고/.test(text)){plan.type='hospital';if(plan.department==='pharmacy')plan.department='all';}
 if(/전체\s*(기관|병원|유형)|all facilities/.test(text)){plan.type='all';plan.department='all';}
 if(/문\s*연|운영\s*중|진료\s*중|영업\s*중|open only|open now/.test(text)){plan.openOnly=true;}
 if(/운영\s*(여부|시간).*상관|영업\s*(여부|시간).*상관|운영\s*조건\s*해제|any hours/.test(text)){plan.openOnly=false;}
 if(/가까운|거리\s*우선|가까이|nearest|nearby/.test(text))plan.priority='distance';
 if(/운영\s*우선|영업\s*우선|open first/.test(text))plan.priority='open';
 if(/휠체어|접근성|단차|wheelchair|accessible/.test(text))plan.priority='access';
 return {...plan,hasConditions:!!(plan.region||plan.type!=='all'||plan.department!=='all'||plan.openOnly||plan.priority!=='distance')};
}
export function suggestionLabels(plan,t){
 if(!plan)return [];
 return [plan.region,plan.type==='pharmacy'?t('pharmacies'):plan.department!=='all'?t(plan.department):plan.type==='hospital'?t('hospitals'):'',plan.openOnly?t('openOnly'):'',t(plan.priority==='open'?'preferOpen':plan.priority==='access'?'preferAccess':'preferDistance')].filter(Boolean);
}
export function renderSuggestion(state,t,escape){
 const plan=state.suggestion;
 if(!plan?.hasConditions)return '';
 return '<div class="chat-suggestion"><div class="suggestion-heading"><strong>'+t('suggestionTitle')+'</strong><span>'+t('connectionDemo')+'</span></div><div class="suggestion-chips">'+suggestionLabels(plan,t).map(label=>'<span>'+escape(label)+'</span>').join('')+'</div>'+(state.source==='live'?'<p class="live-limit-note">'+t('liveFilterLimit')+'</p>':'')+'<p>'+t('suggestionCopy')+'</p><button id="apply-suggestion" class="primary-button" type="button">'+t('suggestionApply')+'</button></div>';
}
export function recommendationReasons(item,criteria){
 const reasons=[];
 if(criteria.department!=='all'&&item.department===criteria.department)reasons.push('reasonDept');
 if(criteria.priority==='access'&&item.accessible===true)reasons.push('reasonAccess');
 if((criteria.openOnly||criteria.priority==='open')&&item.status==='open')reasons.push('reasonOpen');
 if(criteria.priority==='distance'&&Number.isFinite(item.distance))reasons.push('reasonDistance');
 return reasons.slice(0,2);
}

// Visible phrases are sent verbatim. These are entry shortcuts, not clinical rules.
export const conversationStarters=[
 {id:'cough',icon:'user',text:{ko:'기침이 나요',en:'I have a cough'}},
 {id:'fever',icon:'user',text:{ko:'열이 나는 것 같아요',en:'I think I have a fever'}},
 {id:'stomach',icon:'user',text:{ko:'배가 아파요',en:'My stomach hurts'}},
 {id:'pharmacy',icon:'building',text:{ko:'지금 문 연 약국을 찾고 싶어요',en:'I want to find a pharmacy open now'},search:{type:'pharmacy',department:'pharmacy',openOnly:true}}
];
