import {phrase,expandLocales} from '../i18n.mjs';
import {intakeLabel,intakeSelection} from '../intake-data.mjs';
import {Icon,Textarea,Input} from './shared.jsx';
export function Intake({state,t}){
 const step=state.intakeStep||0,d=state.draft,questions=state.intakeQuestionnaire.questions,otherStep=questions.length,reviewStep=otherStep+1;
 const stage=step<otherStep?0:step===otherStep?1:2,question=questions[step],chosen=question?intakeSelection(question,state.intakeAnswers):null;
 const canSkip=Object.values(state.intakeAnswers||{}).some(value=>value!=null)||!!d.symptom.trim();
 const label=value=>intakeLabel(value,state.locale);
 return <div className="intake-step-card">
  <ol className="intake-progress" aria-label={t('intakeProgress')}>{['intakeChoiceStage','intakeExtraNote','intakeStepReview'].map((key,i)=><li key={key} aria-current={stage===i?'step':undefined} className={i<stage?'complete':stage===i?'current':''}><span aria-hidden="true">{i<stage?<Icon name="check" />:i+1}</span>{t(key)}</li>)}</ol>
  <form id="intake-wizard" noValidate><div className="wizard-field" aria-live="polite">
   {question?<><h2 className="wizard-question" id="intake-question" tabIndex={-1}>{label(question.label)}</h2><p className="wizard-help">{t(question.required?'intakeChoiceHelp':'intakeOptionalHelp')}</p><div className="onset-options" role="group" aria-labelledby="intake-question" aria-describedby="intake-error">{question.options.map(option=><button key={question.id+':'+option.id} type="button" data-intake-option={option.id} aria-pressed={chosen?.id===option.id} className={chosen?.id===option.id?'selected':''}>{label(option.label)}</button>)}</div></>:step===otherStep?<>
    <label className="wizard-question" htmlFor="intake-symptom" tabIndex={-1}>{t('intakeOtherQuestion')}</label><p className="wizard-help" id="intake-other-help">{t('intakeOtherHelp')}</p>
    <Textarea id="intake-symptom" value={d.symptom} maxLength={1000} rows={5} aria-describedby="intake-other-help intake-count" placeholder={t('intakeNotePlaceholder')} /><div className="wizard-count" id="intake-count">{d.symptom.length} / 1,000</div>
    <div className="wizard-region"><label htmlFor="intake-region">{t('regionLabel')} <span>{t('optionalText')}</span></label><Input id="intake-region" value={d.region} maxLength={80} placeholder={t('regionPlaceholder')} /><p className="wizard-help">{t('intakeRegionHelp')}</p></div>
   </>:<>
    <h2 className="wizard-question" tabIndex={-1}>{t('intakeReviewQuestion')}</h2><p className="wizard-help">{t('intakeReviewHelp')}</p><dl className="intake-review">{questions.map((item,index)=>{const selected=intakeSelection(item,state.intakeAnswers);return <div key={item.id}><dt>{label(item.label)}</dt><dd>{selected?label(selected.label):t('empty')}</dd><button type="button" data-intake-edit={index} aria-label={label(item.label)+' '+t('intakeEditAnswer')}><Icon name="edit" /></button></div>;})}
     {d.symptom&&<div><dt>{t('intakeExtraNote')}</dt><dd>{d.symptom}</dd><button type="button" data-intake-edit={otherStep} aria-label={t('intakeEditNote')}><Icon name="edit" /></button></div>}
     <div><dt>{t('regionShort')}</dt><dd>{d.region||t('intakeCurrentLocation')}</dd></div></dl><p className="wizard-profile-note"><Icon name="document" />{t('intakeReportHelp')}</p>
   </>}
  </div><p key={'error:'+step+':'+(chosen?.id||'')} id="intake-error" className="field-error" role="alert" hidden /><div className="wizard-actions">{step>0&&<button id="intake-back" type="button" className="secondary-button"><Icon name="back" />{t('intakeBack')}</button>}<button type="submit" className="primary-button">{t(step===reviewStep?'intakeSend':'intakeNext')}<Icon name="arrow" /></button></div></form>
  {step===reviewStep&&<button id="intake-report" className="text-button wizard-report">{t('intakeViewReport')}<Icon name="document" /></button>}{canSkip&&<button id="skip" className="skip-button" data-view="explore">{phrase(state.locale,"Find care with these answers")}<Icon name="arrow" /></button>}
 </div>;
}
