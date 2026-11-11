import {assistantContentKey,assistantInputKey} from '../assistant.mjs';
import {intakeLabel} from '../intake-data.mjs';
import {Textarea} from './shared.jsx';
export function AssistantResult({state,t}){
 const a=state.assistant;if(!a?.connected)return null;
 if(a.response?.profileUpdates?.length&&!a.response.summary&&!a.response.followUp&&!a.response.search&&a.status==='ready')return null;
 const label=value=>intakeLabel(value,state.locale),r=a.response;
 let content;
 if(a.status==='loading')content=<p role="status">{t('assistantLoading')}</p>;
 else if(a.status==='error')content=<><p role="status">{t('assistantError')}</p><button className="secondary-button" id="assistant-retry" type="button">{t('assistantRetry')}</button></>;
 else if(!r)return null;
 else if(r.contentKey!==assistantContentKey(state))content=<p>{t('assistantOutdated')}</p>;
 else{
  const plan=r.search,labels=[];
  if(plan){if(Object.hasOwn(plan,'region'))labels.push(plan.region||t('intakeCurrentLocation'));if(plan.type)labels.push(t(plan.type==='all'?'all':plan.type==='hospital'?'hospitals':'pharmacies'));if(plan.department)labels.push(t(plan.department==='all'?'allDepartments':plan.department));if(Object.hasOwn(plan,'openOnly'))labels.push(t(plan.openOnly?'openOnly':'assistantAnyHours'));if(plan.mode)labels.push(t({walk:'assistantWalk',traffic:'assistantTraffic',car:'assistantCar'}[plan.mode]));}
  const current=r.sourceKey===assistantInputKey(state);
  content=<>{r.summary&&<><strong>{t('assistantSummary')}</strong>{a.editing?<><label className="sr-only" htmlFor="assistant-summary">{t('assistantSummary')}</label><Textarea id="assistant-summary" value={a.summaryDraft} maxLength={2000} rows={4} /></>:<p className="assistant-summary-text">{a.confirmed?.text||label(r.summary)}</p>}<div className="assistant-actions">{a.confirmed&&!a.editing?<span role="status">{t('assistantConfirmed')}</span>:<button id="assistant-confirm" className="secondary-button" type="button">{t('assistantConfirm')}</button>}<button id="assistant-edit" className="text-button" type="button">{t(a.editing?'assistantCancel':'assistantEdit')}</button></div></>}
  {r.followUp&&<><strong id="assistant-question" tabIndex={-1}>{label(r.followUp.label)}</strong><div className="onset-options" role="group" aria-labelledby="assistant-question">{r.followUp.options.map(option=><button key={option.id} type="button" data-assistant-option={option.id}>{label(option.label)}</button>)}</div>{a.answers.some(answer=>answer.value!=null)&&<button id="assistant-skip" type="button" className="text-button">{state.locale==='ko'?'여기까지 답하고 찾기':'Find care with these answers'}</button>}</>}
  {plan&&<><strong>{t('assistantSearch')}</strong><div className="suggestion-chips">{labels.map((value,i)=><span key={i}>{value}</span>)}</div><p>{t(a.applied?'assistantApplied':current?'assistantSearchHelp':'assistantSearchOutdated')}</p><button id="assistant-apply" type="button" className="primary-button" disabled={!current||a.applied}>{t('assistantApply')}</button></>}</>;
 }
 return <section className="chat-intake-context assistant-result" aria-label={t('assistantSection')}>{a.answers.length>0&&<dl>{a.answers.map(answer=><div key={answer.questionId}><dt>{label(answer.label)}</dt><dd>{label(answer.optionLabel)}</dd>{a.questions?.some(question=>question.id===answer.questionId)&&<button type="button" className="text-button" data-assistant-answer-edit={answer.questionId} disabled={a.status==='loading'||r?.contentKey!==assistantContentKey(state)}>{state.locale==='ko'?'답변 수정':'Edit answer'}</button>}</div>)}</dl>}{content}</section>;
}
