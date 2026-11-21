import {useLayoutEffect,useRef,useState} from 'react';
import {phrase} from '../i18n.mjs';
import {LegalDocumentBody,legalTitleKey} from './legal-document.jsx';

function DocumentDialog({document,locale,dismiss}){
 const ref=useRef(null);
 useLayoutEffect(()=>{
  const node=ref.current;
  if(typeof node.showModal==='function')node.showModal();else node.setAttribute('open','');
  return()=>{if(node.open&&typeof node.close==='function')node.close();};
 },[]);
 return <dialog ref={ref} id="legal-document-dialog" className="chat-consent-dialog legal-dialog" aria-labelledby="legal-document-title" onCancel={event=>{event.preventDefault();dismiss();}}>
  <header className="legal-dialog-header"><h2 id="legal-document-title">{phrase(locale,legalTitleKey[document])}</h2><button type="button" className="text-button" onClick={dismiss}>{phrase(locale,'Close')}</button></header>
  <div className="legal-dialog-body"><LegalDocumentBody document={document} locale={locale} separateTab /></div>
 </dialog>;
}

export function LegalDocumentLinks({locale}){
 const [document,setDocument]=useState(null),trigger=useRef(null);
 const dismiss=()=>setDocument(null);
 useLayoutEffect(()=>{
  if(!document&&trigger.current){trigger.current.focus({preventScroll:true});trigger.current=null;}
 },[document]);
 return <>{Object.entries(legalTitleKey).map(([key,title])=><a key={key} className="text-button" href={'/legal/'+key+'?lang='+locale} aria-haspopup="dialog" onClick={event=>{
  if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();trigger.current=event.currentTarget;setDocument(key);
 }}>{phrase(locale,title)}</a>)}
 {document&&<DocumentDialog document={document} locale={locale} dismiss={dismiss} />}
 </>;
}

export function ConversationLegalLinks({state,entry=false}){
 return <footer className={'chat-context-actions conversation-legal-links'+(entry?' voice-entry-legal-links':'')}>
  <button id="health-consent-open" type="button" aria-haspopup="dialog" aria-expanded={state.healthConsent.open&&!state.healthConsent.pending} aria-controls="chat-consent-dialog" className="text-button">{phrase(state.locale,"Health information notice")}</button>
  <LegalDocumentLinks locale={state.locale} />
 </footer>;
}
