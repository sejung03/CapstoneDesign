import {mockIntakeQuestionnaire,intakeLabel,intakeSelection} from './intake-data.mjs';
export function renderIntakeSteps(state,t,icon,escape){
 const step=state.intakeStep||0,d=state.draft||{symptom:'',onset:'',region:''};
 const questions=(state.intakeQuestionnaire||mockIntakeQuestionnaire).questions;
 const answers=state.intakeAnswers||{};
 const otherStep=questions.length,reviewStep=otherStep+1;
 const stage=step<otherStep?0:step===otherStep?1:2;
 const progress='<ol class="intake-progress" aria-label="'+t('intakeProgress')+'">'+
 ['intakeChoiceStage','intakeExtraNote','intakeStepReview'].map((key,i)=>
 '<li'+(stage===i?' aria-current="step"':'')+' class="'+(i<stage?'complete':stage===i?'current':'')+'"><span aria-hidden="true">'+(i<stage?icon('check'):i+1)+'</span>'+t(key)+'</li>').join('')+'</ol>';
 const note='<label class="wizard-question" for="intake-symptom" tabindex="-1">'+t('intakeOtherQuestion')+'</label>'+
 '<p class="wizard-help" id="intake-other-help">'+t('intakeOtherHelp')+'</p>'+
 '<textarea id="intake-symptom" maxlength="1000" rows="5" aria-describedby="intake-other-help intake-count" placeholder="'+t('intakeNotePlaceholder')+'">'+escape(d.symptom)+'</textarea>'+
 '<div class="wizard-count" id="intake-count">'+d.symptom.length+' / 1,000</div>';
 const region='<div class="wizard-region"><label for="intake-region">'+t('regionLabel')+' <span>'+t('optionalText')+'</span></label><input id="intake-region" maxlength="80" value="'+escape(d.region)+'" placeholder="'+t('regionPlaceholder')+'"><p class="wizard-help">'+t('intakeRegionHelp')+'</p></div>';
 const question=questions[step];
 const chosen=question?intakeSelection(question,answers):null;
 const field=question?
 '<h2 class="wizard-question" id="intake-question" tabindex="-1">'+escape(intakeLabel(question.label,state.locale))+'</h2>'+
 '<p class="wizard-help">'+t(question.required?'intakeChoiceHelp':'intakeOptionalHelp')+'</p>'+
 '<div class="onset-options" role="group" aria-labelledby="intake-question" aria-describedby="intake-error">'+
 question.options.map(option=>'<button type="button" data-intake-option="'+escape(option.id)+'" aria-pressed="'+(chosen?.id===option.id)+'" class="'+(chosen?.id===option.id?'selected':'')+'">'+escape(intakeLabel(option.label,state.locale))+'</button>').join('')+'</div>':step===otherStep?note+region:
 '<h2 class="wizard-question" tabindex="-1">'+t('intakeReviewQuestion')+'</h2><p class="wizard-help">'+t('intakeReviewHelp')+'</p><dl class="intake-review">'+
 questions.map((item,index)=>{const selected=intakeSelection(item,answers);return '<div><dt>'+escape(intakeLabel(item.label,state.locale))+'</dt><dd>'+escape(selected?intakeLabel(selected.label,state.locale):t('empty'))+'</dd><button type="button" data-intake-edit="'+index+'" aria-label="'+escape(intakeLabel(item.label,state.locale)+' '+t('intakeEditAnswer'))+'">'+icon('edit')+'</button></div>';}).join('')+
 (d.symptom?'<div><dt>'+t('intakeExtraNote')+'</dt><dd>'+escape(d.symptom)+'</dd><button type="button" data-intake-edit="'+otherStep+'" aria-label="'+t('intakeEditNote')+'">'+icon('edit')+'</button></div>':'')+
 '<div><dt>'+t('regionShort')+'</dt><dd>'+escape(d.region||t('intakeCurrentLocation'))+'</dd></div></dl><p class="wizard-profile-note">'+icon('document')+t('intakeReportHelp')+'</p>';
 return '<div class="intake-step-card">'+progress+'<form id="intake-wizard" novalidate><div class="wizard-field" aria-live="polite">'+field+'</div><p id="intake-error" class="field-error" role="alert" hidden></p><div class="wizard-actions">'+(step>0?'<button id="intake-back" type="button" class="secondary-button">'+icon('back')+t('intakeBack')+'</button>':'')+'<button type="submit" class="primary-button">'+t(step===reviewStep?'intakeSend':'intakeNext')+icon('arrow')+'</button></div></form>'+(step===reviewStep?'<button id="intake-report" class="text-button wizard-report">'+t('intakeViewReport')+icon('document')+'</button>':'')+'<button id="skip" class="skip-button" data-view="explore">'+t('skip')+icon('arrow')+'</button></div>';
}
export function intakeSupportArt(){
 return '<svg class="intake-support-art" viewBox="0 0 260 145" aria-hidden="true" focusable="false"><ellipse cx="132" cy="132" rx="85" ry="7" fill="var(--soft)"/><rect x="71" y="20" width="116" height="109" rx="15" fill="var(--paper)" stroke="var(--line-strong)" stroke-width="2"/><rect x="105" y="11" width="48" height="20" rx="8" fill="var(--soft)" stroke="var(--line-strong)" stroke-width="2"/><path d="m91 57 5 5 10-11m-15 35 5 5 10-11" stroke="var(--blue)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M117 57h46m-46 29h46m-72 24h72" stroke="var(--line-strong)" stroke-width="4" stroke-linecap="round"/><circle cx="196" cy="98" r="24" fill="var(--soft)"/><path d="M196 88v20m-10-10h20" stroke="var(--blue)" stroke-width="4" stroke-linecap="round"/></svg>';
}
