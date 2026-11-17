import {phrase,expandLocales} from './i18n.mjs';
import {normalizeAge} from './profile.mjs';
import {assistantReportNotes} from './assistant.mjs';
import {intakeAnswerNotes} from './intake-data.mjs';
import {uiIcon} from './ui-icons.mjs';
export const reportFieldKeys=['age','symptom','onset','allergies','medications','history','notes','questions'];
const reportWords=expandLocales({
ko:{title:'진료 전에 보여줄 내용',intro:'진료 때 보여줄 내용을 살펴보고, 필요한 부분을 고쳐보세요.',badge:'직접 적은 내용',missing:'미입력',edit:'내용 편집',save:'수정 내용 저장',cancel:'취소',reset:'원본 다시 반영',print:'인쇄 / PDF',copy:'내용 복사',editor:'분석서 편집',help:'여기서 고친 내용은 분석서에만 반영해요. 다 적었다면 저장해 주세요.',changed:'새로 적은 정보가 있어요. 지금 수정본은 그대로 두었어요. 새 내용을 쓰려면 원본 다시 반영을 눌러주세요.',note:'직접 적은 증상과 참고 정보예요. 진료 때 의료진과 함께 확인해 주세요.',session:'새로고침하면 수정 내용이 사라져요. 필요한 내용은 복사하거나 PDF로 저장해 주세요.',updated:'작성일',resetConfirm:'분석서 수정 내용을 지우고, 지금까지 적은 정보로 다시 채울까요?',saved:'수정한 내용을 저장했어요.',copied:'분석서를 복사했어요.',copyFailed:'복사하지 못했습니다. 내용 편집에서 선택해 복사하거나 인쇄 / PDF를 이용하세요.',labels:['만 나이','주요 증상','증상 시작 시점','알레르기','복용 중인 약','과거 병력과 참고할 내용','추가로 전할 내용','진료 때 물어볼 질문']},
en:{title:'Pre-visit health notes',intro:'Review your symptoms and prepare information to show your clinician.',badge:'Based on your input',missing:'Not entered',edit:'Edit content',save:'Save changes',cancel:'Cancel',reset:'Reload source',print:'Print / PDF',copy:'Copy text',editor:'Edit report',help:'Changes apply only to this report. Save before copying or printing.',changed:'Source input has changed. Your edited report is preserved. Choose Reload source to use the latest input.',note:'This document organizes user-entered information. Review it with your clinician.',session:'Edits last for this session. Save a PDF if you need a copy.',updated:'Prepared',resetConfirm:'Discard report edits and reload current symptoms, conversation and profile?',saved:'Report changes saved.',copied:'Report copied.',copyFailed:'Could not copy. Select text in the editor or use Print / PDF.',labels:['Age in completed years','Main symptoms','Symptom onset','Allergies','Current medications','Medical history / notes','Additional information','Questions for your clinician']}
});
export function reportSource(state,t){
return {age:normalizeAge(state.profile.age)!==''?(phrase(state.locale,"{0} years", [normalizeAge(state.profile.age)])):'',symptom:state.intakeQuestionnaire?'':state.draft.symptom,onset:state.draft.onset?t(state.draft.onset):'',allergies:state.profile.allergies,medications:state.profile.medications,history:state.profile.history,notes:[assistantReportNotes(state),intakeAnswerNotes(state.intakeQuestionnaire,state.intakeAnswers,state.locale),state.intakeQuestionnaire&&state.draft.symptom?t('intakeExtraNote')+': '+state.draft.symptom:'',...state.chat.messages.filter(m=>m.role==='user').map(m=>m.text)].filter(Boolean).join('\n'),questions:''};
}
export function reportSourceSignature(state){
const p=state.profile;return JSON.stringify([p.age,p.allergies,p.medications,p.history,state.draft.symptom,state.draft.onset,state.intakeQuestionnaire||null,state.intakeAnswers||{},assistantReportNotes(state),state.chat.messages.filter(m=>m.role==='user').map(m=>m.text)]);
}
export function cleanReport(values){return Object.fromEntries(reportFieldKeys.map(key=>[key,String(values[key]??'').trim().slice(0,key==='notes'?4000:2000)]));}
export function reportText(values,locale='ko'){
const w=reportWords[locale];return w.title+'\n\n'+reportFieldKeys.map((key,i)=>w.labels[i]+'\n'+(values[key]||w.missing)).join('\n\n')+'\n\n'+w.note;
}
export function renderReport(state,t,escape){
const w=reportWords[state.locale],r=state.report,values=r.saved||reportSource(state,t);
const changed=r.saved&&r.signature!==reportSourceSignature(state);
const button=(id,label,cls='secondary-button')=>'<button id="'+id+'" class="'+cls+'"'+(r.editing&&['report-print','report-copy'].includes(id)?' disabled':'')+'>'+uiIcon({'report-edit':'edit','report-print':'print','report-copy':'copy','report-reset':'back'}[id]||'check')+'<span>'+label+'</span></button>';
const editor=r.editing?'<form id="report-editor" class="report-editor"><h2>'+w.editor+'</h2><p>'+w.help+'</p>'+reportFieldKeys.map((key,i)=>'<label for="report-'+key+'">'+w.labels[i]+'</label><textarea id="report-'+key+'" rows="'+(['symptom','notes'].includes(key)?4:2)+'" maxlength="'+(key==='notes'?4000:2000)+'">'+escape(r.draft[key]||'')+'</textarea>').join('')+'<div class="report-editor-actions"><button class="primary-button" type="submit">'+w.save+'</button><button id="report-cancel" type="button" class="secondary-button">'+w.cancel+'</button></div></form>':'';
return '<section class="report-view report-workspace" aria-labelledby="report-heading"><div class="report-heading"><div><p class="eyebrow">'+t('reportEyebrow')+'</p><h1 id="report-heading" tabindex="-1">'+t('reportTitle')+'</h1><p>'+w.intro+'</p></div><div class="report-toolbar">'+(r.editing?'':button('report-edit',w.edit))+button('report-print',w.print)+button('report-copy',w.copy)+'</div></div>'+(changed?'<p class="report-source-notice" role="status">'+w.changed+'</p>':'')+'<div class="report-layout'+(r.editing?' is-editing':'')+'">'+editor+'<article class="report-sheet" aria-label="'+w.title+'"><header class="report-document-heading"><span class="optional-badge">'+w.badge+'</span><h2>'+w.title+'</h2><p><span>'+w.updated+'</span><time datetime="'+new Date(r.updatedAt).toISOString()+'">'+escape(new Date(r.updatedAt).toLocaleString(state.locale))+'</time></p></header><dl class="report-fields">'+reportFieldKeys.map((key,i)=>'<div class="report-field report-field-'+key+'"><dt>'+w.labels[i]+'</dt><dd'+(!values[key]?' class="report-missing"':'')+'>'+escape(values[key]||w.missing)+'</dd></div>').join('')+'</dl><footer class="report-document-footer">'+w.note+'</footer></article></div><div class="report-bottom"><p>'+w.session+'</p>'+button('report-reset',w.reset,'text-button')+'</div></section>';
}
export function reportMessage(locale,key){return reportWords[locale][key];}

// React My information has one canonical copy of shared health fields.
// Saved consultation edits remain separate; export always uses current applied health information.
export function unifiedReportValues(state,t){
 const source=reportSource(state,t),values={...(state.report.saved||source)};
 for(const key of ['age','allergies','medications','history'])values[key]=source[key];
 return values;
}
