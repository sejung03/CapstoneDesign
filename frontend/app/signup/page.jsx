"use client";
import {useEffect,useState} from 'react';
import {AccountDialog} from '../../components/account-dialog.jsx';
import {phrase,locales,languageNames} from '../../i18n.mjs';
import {useLanguage} from '../../components/use-language.js';

export default function Signup(){
 const [locale,setLocale]=useLanguage(),text=key=>phrase(locale,key);
 const [pending,setPending]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/auth/pending',{signal:controller.signal,cache:'no-store'})
   .then(response=>response.ok?response.json():Promise.reject(Error('pending')))
   .then(value=>setPending(!!value.pending)).catch(()=>{if(!controller.signal.aborted)setPending(false);});
  return ()=>controller.abort();
 },[]);
 const submit=async({consentSelection})=>{
  if(busy)return;
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(consentSelection)});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'signup_failed');}
   location.replace('/');
  }catch(e){setError('signup_failed');setBusy(false);}
 };
 return <main style={{maxWidth:760,margin:'64px auto',padding:24}}>
  {pending!==true&&<label>{text('Language')} <select value={locale} onChange={e=>setLocale(e.target.value)}>{locales.map(code=><option key={code} value={code}>{languageNames[code]}</option>)}</select></label>}
  <h1>{text('Sign up')}</h1>
  {pending===null&&<p>{text('Verifying Kakao authentication…')}</p>}
  {pending===false&&<><p>{text('Kakao authentication has expired. Please sign in again.')}</p><a href="/api/auth/kakao">{text('Restart Kakao authentication')}</a></>}
  {pending===true&&<><p>{text('Review the terms and consent items to complete signup.')}</p>
   {error&&<p role="alert" style={{color:'#b91c1c'}}>{text('Could not complete signup. Please try again.')}</p>}
   <AccountDialog key={locale} locale={locale} onLocaleChange={setLocale} needsSignupConsent={true} onContinue={submit} onDismiss={()=>location.assign('/')} />
   {busy&&<p>{text('Saving your signup information…')}</p>}</>}
 </main>;
}
