import {useEffect,useRef,useState} from 'react';
import {signupConsentPolicy,emptySignupChoices,changeSignupChoice,buildSignupConsentSelection} from '../signup-consent.mjs';
export function AccountDialog({locale,onDismiss,needsSignupConsent=true,onContinue}){
 const dialog=useRef(null),[choices,setChoices]=useState(emptySignupChoices);
 const ko=locale==='ko',label=value=>value?.[locale]||value?.ko;
 useEffect(()=>{
  const node=dialog.current;
  try{node.showModal();}catch{node.setAttribute('open','');}
  node.querySelector('button')?.focus();
  return ()=>{if(node.open&&typeof node.close==='function')node.close();document.getElementById('account-open')?.focus();};
 },[]);
 const requiredReady=signupConsentPolicy.sections.every(item=>!item.required||choices[item.id]);
 return <dialog ref={dialog} id="account-dialog" className="account-dialog" aria-labelledby="account-heading" onKeyDown={event=>{if(event.key==='Escape')event.stopPropagation();}} onCancel={event=>{event.preventDefault();onDismiss();}}><div className="account-dialog-heading"><h2 id="account-heading">{ko?'로그인·회원가입':'Log in / Sign up'}</h2><button type="button" id="account-close" className="text-button" onClick={onDismiss}>{ko?'닫기':'Close'}</button></div>
 <p className="signup-intro">{ko?'카카오 계정으로 로그인하거나 가입할 수 있습니다. 처음 가입하는 경우 아래 약관과 개인정보 동의 내용을 확인해 주세요.':'Use your Kakao account to log in or sign up. If you are joining for the first time, review the terms and consent items below.'}</p>
 <form id="signup-consent-form" onSubmit={event=>{event.preventDefault();if((!needsSignupConsent||requiredReady)&&typeof onContinue==='function')onContinue({intent:needsSignupConsent?'signup':'login',consentSelection:needsSignupConsent?buildSignupConsentSelection(choices):null});}}>
 {needsSignupConsent&&signupConsentPolicy.sections.map(item=><section className="signup-consent-item" key={item.id}><label className="health-consent-choice"><input id={'signup-'+item.id} type="checkbox" checked={choices[item.id]} disabled={!!item.dependsOn&&!choices[item.dependsOn]} onChange={event=>{setChoices(value=>changeSignupChoice(value,item.id,event.target.checked));}} /><span><small>{label(item.scope)}</small><strong>{label(item.title)}</strong></span></label><details><summary>{ko?(item.id==='terms'?'이용약관 보기':'수집 항목과 이용 목적 보기'):(item.id==='terms'?'Read terms':'View information and purposes')}</summary>{item.details?item.details.map((value,index)=><p key={index}>{label(value)}</p>):<dl>{[['purpose',ko?'목적':'Purpose'],['items',ko?'항목':'Information'],['retention',ko?'보관·삭제':'Retention and deletion'],['refusal',ko?'동의 거부 시':'If you decline']].map(([key,title])=><div key={key}><dt>{title}</dt><dd>{label(item[key])}</dd></div>)}</dl>}</details></section>)}
 <div className="signup-processing-note"><strong>{ko?'외부 AI 서비스 이용':'External AI services'}</strong><p>{ko?'현재 건강정보를 외부 AI 업체에 제공하지 않습니다. 외부 AI 서비스를 이용하게 되는 경우 처리업체, 전송 항목, 이용 목적과 보유 기간을 안내하고 필요한 동의를 별도로 받습니다.':'Health information is not currently provided to an external AI provider. If external AI services are introduced, the provider, transferred information, purposes and retention will be disclosed and any required consent obtained separately.'}</p></div>
 <p className="emergency-note">{ko?'선택 항목에 동의하지 않아도 회원가입이 가능합니다. 건강정보 수집·이용에 동의하지 않으면 문진과 증상 상담은 이용할 수 없으며, 병원 찾기와 응급 도움은 이용할 수 있습니다.':'Optional consent is not required for signup. Health information consent is required for the questionnaire and symptom chat; hospital search and emergency help remain available without it.'}</p>

 <button id="signup-continue" className="kakao-login-button" type="submit" disabled={(needsSignupConsent&&!requiredReady)||typeof onContinue!=='function'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.5 2 10.8c0 2.8 1.9 5.2 4.8 6.6L5.5 22l5-3.5H12c5.5 0 10-3.5 10-7.7S17.5 3 12 3Z" /></svg>{ko?'카카오로 계속하기':'Continue with Kakao'}</button>
 </form>
 </dialog>;
}
