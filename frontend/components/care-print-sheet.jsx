import {phrase} from '../i18n.mjs';
import {reportMessage,reportFieldKeys,unifiedReportValues} from '../report.mjs';
import {healthSexChoices} from '../health-storage.mjs';

// The one PDF this app exports: saved health information (My information) plus the questionnaire summary
// (chat intake answers, the reviewed engine summary and the user's own messages, as in My report).
// Hidden on screen; print styles in workspace.css show only this sheet from the profile and report panels.
// Health fields always come from the saved profile, never from unsaved drafts.
const HEALTH_ROWS=[['age','profileAge'],['sex',null],['allergies','profileAllergies'],['medications','profileMedications'],['history','profileHistory']];
const SUMMARY_KEYS=['symptom','onset','notes','questions'];

function healthValue(state,key){
 const value=state.profile[key];
 if(value===''||value==null)return phrase(state.locale,"Not provided");
 if(key==='age')return phrase(state.locale,"{0} years",[value]);
 if(key==='sex')return phrase(state.locale,healthSexChoices[value]);
 return value;
}

export function CarePrintSheet({state,t}){
 // Partial states (before any chat, or isolated renders) still produce the health section.
 const source={...state,draft:state.draft||{symptom:'',onset:''},report:state.report||{},chat:state.chat||{messages:[]}};
 const w=key=>reportMessage(state.locale,key),labels=w('labels'),values=unifiedReportValues(source,t),title=phrase(state.locale,"Health information and questionnaire summary");
 return <article className="health-print-sheet care-print-sheet" aria-label={title}>
  <h1>{title}</h1>
  <p className="care-print-date">{w('updated')} <time>{new Date().toLocaleDateString(state.locale)}</time></p>
  <section className="care-print-health"><h2>{phrase(state.locale,"Health information")}</h2><dl>{HEALTH_ROWS.map(([key,label])=><div key={key}><dt>{label?t(label):phrase(state.locale,'Sex')}</dt><dd>{healthValue(state,key)}</dd></div>)}</dl></section>
  <section className="care-print-summary"><h2>{phrase(state.locale,"Questionnaire summary")}</h2><dl>{SUMMARY_KEYS.map(key=><div key={key}><dt>{labels[reportFieldKeys.indexOf(key)]}</dt><dd>{values[key]||w('missing')}</dd></div>)}</dl></section>
  <footer>{w('note')}</footer>
 </article>;
}
