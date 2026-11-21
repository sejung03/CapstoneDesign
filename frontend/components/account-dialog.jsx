import {phrase,expandLocales,localizedObject,localizedText,locales,languageNames} from '../i18n.mjs';
import {useEffect,useRef,useState} from 'react';
import {signupConsentPolicy,emptySignupChoices,changeSignupChoice,buildSignupConsentSelection} from '../signup-consent.mjs';
export function AccountDialog({locale,onLocaleChange,onDismiss,needsSignupConsent=true,onContinue}){
 const dialog=useRef(null),[choices,setChoices]=useState(emptySignupChoices);
 const ko=locale==='ko',label=value=>localizedText(value,locale);
 useEffect(()=>{
  const node=dialog.current;
  try{node.showModal();}catch{node.setAttribute('open','');}
  node.querySelector('button')?.focus();
  return ()=>{if(node.open&&typeof node.close==='function')node.close();document.getElementById('account-open')?.focus();};
 },[]);
 const visibleSections=signupConsentPolicy.sections.filter(item=>!item.reserved);
 const allChecked=visibleSections.every(item=>choices[item.id]===true);
 const requiredReady=signupConsentPolicy.sections.every(item=>!item.required||choices[item.id]);
 return <dialog ref={dialog} id="account-dialog" className="account-dialog" aria-labelledby="account-heading" onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}} onCancel={event=>{event.preventDefault();onDismiss();}}><div className="account-dialog-heading"><h2 id="account-heading">{phrase(locale,"Log in / Sign up")}</h2><button type="button" id="account-close" className="text-button" onClick={onDismiss}>{phrase(locale,"Close")}</button></div>
 {needsSignupConsent&&typeof onLocaleChange==='function'&&<label htmlFor="signup-language">{phrase(locale,'Language')} <select id="signup-language" value={locale} onChange={event=>onLocaleChange(event.target.value)}>{locales.map(code=><option key={code} value={code}>{languageNames[code]}</option>)}</select></label>}
 <p className="signup-intro">{needsSignupConsent?(phrase(locale,"Kakao authentication is verified. Review the terms and consent items below.")):(phrase(locale,"Continue with Kakao. New users review terms and consent after authentication."))}</p>
 <form id="signup-consent-form" onSubmit={event=>{event.preventDefault();if((!needsSignupConsent||requiredReady)&&typeof onContinue==='function')onContinue({intent:needsSignupConsent?'signup':'login',consentSelection:needsSignupConsent?buildSignupConsentSelection(choices):null});}}>
 {needsSignupConsent&&<label className="health-consent-choice signup-select-all"><input id="signup-all" type="checkbox" checked={allChecked} onChange={event=>{const checked=event.currentTarget.checked;setChoices(Object.fromEntries(signupConsentPolicy.sections.map(item=>[item.id,checked&&!item.reserved])));}} /><span><strong>{phrase(locale,'Agree to all (including optional items)')}</strong></span></label>}
 {needsSignupConsent&&visibleSections.map(item=><section className="signup-consent-item" key={item.id}><label className="health-consent-choice"><input id={'signup-'+item.id} type="checkbox" checked={choices[item.id]} disabled={!!item.dependsOn&&!choices[item.dependsOn]} onChange={event=>{setChoices(value=>changeSignupChoice(value,item.id,event.target.checked));}} /><span><small>{label(item.scope)}</small><strong>{label(item.title)}</strong></span></label><details><summary>{localizedObject((item.id==='terms'?'Read terms':'View information and purposes'),locale)}</summary>{item.details?item.details.map((value,index)=><p key={index}>{label(value)}</p>):<dl>{[['purpose',phrase(locale,"Purpose")],['items',phrase(locale,"Information")],['retention',phrase(locale,"Retention and deletion")],['refusal',phrase(locale,"If you decline")]].map(([key,title])=><div key={key}><dt>{title}</dt><dd>{label(item[key])}</dd></div>)}</dl>}</details></section>)}
 {needsSignupConsent&&<div className="signup-processing-note"><strong>{phrase(locale,"External AI services")}</strong><p>{phrase(locale,"When OpenAI is enabled for consultation, review the separate health information notice before using the feature. Kakao is used to authenticate your account.")}</p></div>}
 {needsSignupConsent&&<p className="emergency-note">{phrase(locale,"Optional consent is not required for signup. Health information consent is required for the questionnaire and symptom chat; hospital search and emergency help remain available without it.")}</p>}

 <button id="signup-continue" className={needsSignupConsent?"primary-button signup-complete-button":"kakao-login-button"} type="submit" disabled={(needsSignupConsent&&!requiredReady)||typeof onContinue!=='function'}>{!needsSignupConsent&&<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.5 2 10.8c0 2.8 1.9 5.2 4.8 6.6L5.5 22l5-3.5H12c5.5 0 10-3.5 10-7.7S17.5 3 12 3Z" /></svg>}{phrase(locale,needsSignupConsent?"Complete signup":"Continue with Kakao")}</button>
 </form>
 </dialog>;
}
