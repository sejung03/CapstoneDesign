import {phrase,expandLocales} from '../i18n.mjs';
import {useState,useEffect,useLayoutEffect,useRef} from 'react';
import {HealthUpdateReview} from './health-update-review.jsx';
import {PreviousReport} from './report-import.jsx';
import {HealthConsent} from './health-consent.jsx';
import {hasHealthConsent} from '../health-consent.mjs';
import {visibleEmergency} from '../emergency.mjs';
import {assistantContentKey} from '../assistant.mjs';
import {EmergencyCard} from './emergency-card.jsx';
import {ConversationIntake,ConversationResults} from './conversation-workspace.jsx';
import {robotIcon} from '../chat-view.mjs';
import {intakeLabel} from '../intake-data.mjs';
import {conversationStarters,suggestionLabels} from '../care-context.mjs';
import {Icon,Artwork,Textarea} from './shared.jsx';
import {voiceEnabled} from '../voice-client.mjs';
import {VoiceInput} from './voice-controls.jsx';
import {AssistantResult} from './assistant-result.jsx';
function resizeComposer(node){if(!node)return;node.style.height='40px';node.style.height=Math.min(120,Math.max(40,node.scrollHeight))+'px';}
export function Chat({state,t,entry=false,primary=false,onEmergencyLocation,onPreviousReport,onHealthUpdates}){
 const emergencyOpen=!!state.emergency.manual||!!visibleEmergency(state,assistantContentKey(state)),intakeOpen=state.workspace?.intake&&hasHealthConsent(state);
 const [attachments,setAttachments]=useState(false),tools=useRef(null);
 useEffect(()=>{const close=event=>{if(!tools.current?.contains(event.target))setAttachments(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 const permitted=hasHealthConsent(state),chat=state.chat,context=chat.intakeContext,answers=context?.answers||[],label=value=>intakeLabel(value,state.locale),plan=state.suggestion;
 useLayoutEffect(()=>resizeComposer(document.getElementById('composer-input')),[chat.input,state.locale,permitted]);
 const welcome=primary&&!chat.messages.length&&!context&&!intakeOpen&&!state.reportImport.open&&!state.reportImport.confirmed&&!(state.healthConsent.open&&state.healthConsent.pending!=='chat');
 return <section className={'chat-panel'+(welcome?' is-welcome':'')+(entry?' entry-chat':'')+(primary?' primary-chat':'')} id="assistant-panel" role="region" aria-label={t('chatTitle')}><div className="chat-heading"><span className="chat-avatar"><Artwork markup={robotIcon()} /></span><div><h2>{t(primary?'conversationChatTitle':'chatTitle')}</h2><p>{t('chatSubtitle')}</p></div>{primary&&<button id="emergency-open" aria-expanded={emergencyOpen} aria-controls="emergency-card" className="text-button emergency-shortcut"><Icon name="phone" />{phrase(state.locale,"Emergency help")}</button>}{!entry&&!primary&&<button id="chat-close" className="icon-button chat-collapse" aria-label={t('chatFold')} aria-controls="assistant-panel" aria-expanded="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 8 6 6 6-6" /></svg></button>}</div>
  {primary&&<EmergencyCard state={state} t={t} onEmergencyLocation={onEmergencyLocation} />}
  {welcome&&<div className="chat-welcome"><h2>{phrase(state.locale,"How can we help you today?")}</h2></div>}
  <div className="chat-messages" id="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">{!primary&&<div className="chat-message bot-message"><span className="chat-role">{t('chatRoleBot')}</span><p>{t('chatFirst')}</p></div>}
   {primary&&!['chat','profile'].includes(state.healthConsent.pending)&&<HealthConsent state={state} />}
   {primary&&<PreviousReport state={state} onChange={onPreviousReport} />}
   {context&&<div className="chat-intake-context" id="chat-intake-context" data-intake-status={context.completion?.status} tabIndex={-1}><div className="intake-context-heading"><strong>{t('intakeSubmitted')}</strong>{primary&&!state.assistant?.connected&&!intakeOpen&&<button id="start-intake" type="button" aria-expanded="false" aria-controls="intake-wizard" className="text-button">{phrase(state.locale,"Edit answers")}</button>}</div>{context.completion?.status&&context.completion.status!=='complete'&&<p>{phrase(state.locale,"Only the answers you provided were included.")}</p>}<dl>{answers.length?answers.map(answer=><div key={answer.questionId||answer.id}><dt>{label(answer.label)}</dt><dd>{answer.type==='text'?answer.value||t('empty'):answer.optionLabel?label(answer.optionLabel):t('empty')}</dd></div>):<><div><dt>{t('symptomShort')}</dt><dd>{context.symptom}</dd></div><div><dt>{t('onsetShort')}</dt><dd>{t(context.onset||'intakeUnknown')}</dd></div></>}{answers.length>0&&context.symptom&&<div><dt>{t('intakeExtraNote')}</dt><dd>{context.symptom}</dd></div>}{context.region&&<div><dt>{t('regionShort')}</dt><dd>{context.region}</dd></div>}</dl></div>}
   {chat.messages.map((message,i)=><div key={message.id||i} className="chat-message user-message"><span className="chat-role">{t('chatRoleUser')}</span><p>{message.text}</p></div>)}
   {primary&&permitted&&<ConversationIntake state={state} t={t} />}
   <AssistantResult state={state} t={t} />
   {primary&&<HealthUpdateReview state={state} onReview={onHealthUpdates} />}
   {!intakeOpen&&chat.messages.length>0&&!state.assistant?.connected&&<div className="chat-message bot-message"><p>{t(plan?.hasConditions?'chatRecorded':'chatNeedsConditions')}</p></div>}
   {!intakeOpen&&!state.assistant?.connected&&plan?.hasConditions&&<div className="chat-suggestion"><div className="suggestion-heading"><strong>{t('suggestionTitle')}</strong><span>{t('connectionDemo')}</span></div><div className="suggestion-chips">{suggestionLabels(plan,t).map((value,i)=><span key={i}>{value}</span>)}</div>{state.source==='live'&&<p className="live-limit-note">{t('liveFilterLimit')}</p>}<p>{t('suggestionCopy')}</p><button id="apply-suggestion" className="primary-button" type="button">{t('suggestionApply')}</button></div>}
   {primary&&!intakeOpen&&<><ConversationResults state={state} t={t} /></>}
  </div>{primary&&state.healthConsent.pending==='chat'&&<HealthConsent state={state} />}<form id="composer-form" className="chat-form"><label className="sr-only" htmlFor="composer-input">{t('chatLabel')}</label><Textarea readOnly={!permitted} aria-haspopup={!permitted?'dialog':undefined} id="composer-input" value={chat.input} maxLength={1000} rows={1} onInput={event=>resizeComposer(event.currentTarget)} placeholder={phrase(state.locale,"Describe your symptoms or the place you need")} />
  <div className="composer-actions">{primary&&voiceEnabled&&permitted&&<VoiceInput question={state.assistant?.response?.followUp} />}<div className="composer-attachments" ref={tools} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setAttachments(false);document.getElementById('composer-attach')?.focus();}}}><button id="composer-attach" type="button" className="icon-button" aria-label={phrase(state.locale,"Attach health notes")} aria-expanded={attachments} aria-controls="composer-attachment-menu" onClick={()=>setAttachments(value=>!value)}><Icon name="plus" /></button>{attachments&&<div id="composer-attachment-menu" className="composer-attachment-menu"><button id="start-report-import" type="button" onClick={()=>{setAttachments(false);onPreviousReport?.({open:true,mode:'pdf'});}}><Icon name="document" />{phrase(state.locale,"Attach report PDF")}</button><button id="start-report-paste" type="button" onClick={()=>{setAttachments(false);onPreviousReport?.({open:true,mode:'text'});}}><Icon name="clipboard" />{phrase(state.locale,"Paste report text")}</button></div>}</div>
  <button type="submit" className="send-button" aria-label={t('chatSend')}><Icon name="up" /></button></div></form>{state.locale!=='ko'&&<p className="composer-language-note" role="note">{phrase(state.locale,"Please write your symptoms in Korean if you can. Danger signs written in other languages may not be detected. In an emergency, call 119.")}</p>}{welcome&&<div className="conversation-starters" aria-label={phrase(state.locale,"Conversation starters")}>{conversationStarters.map(item=><button key={item.id} type="button" data-conversation-starter={item.id}><Icon name={item.icon} /><span>{item.text[state.locale]||item.text.ko}</span><Icon name="arrow" /></button>)}</div>}<div className="chat-context-actions">{primary&&<button id="health-consent-open" aria-expanded={state.healthConsent.open} aria-controls="health-consent-card" className="text-button">{phrase(state.locale,"Health information notice")}</button>}{!entry&&!primary&&<button className="text-button" data-view="report">{t('chatDraft')}<Icon name="chevron" /></button>}</div>
 </section>;
}
