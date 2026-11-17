import {phrase,expandLocales} from '../i18n.mjs';
import {useRef,useState,useEffect} from 'react';
import {PROFILE_KEY,SETTINGS_KEY} from '../profile.mjs';
export function DeleteAccount({locale,disabled=false}){
 const ko=locale==='ko',word=ko?'탈퇴':'DELETE';
 const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const ref=useRef(null);
 useEffect(()=>{
  if(!open)return;
  const node=ref.current;
  if(node.showModal)node.showModal();else node.setAttribute('open','');
  node.querySelector('input')?.focus();
  return()=>{if(node.open&&node.close)node.close();document.getElementById('account-delete-open')?.focus();};
 },[open]);
 const close=()=>{if(!busy){setOpen(false);setConfirmation('');setError('');}};
 const submit=async event=>{
  event.preventDefault();if(busy||confirmation!==word)return;
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/auth/account',{method:'DELETE',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation})});
   const result=await response.json().catch(()=>({}));
   if(!response.ok){setError(result.error||'account_deletion_failed');setBusy(false);return;}
   try{localStorage.removeItem(PROFILE_KEY);localStorage.removeItem(SETTINGS_KEY);}catch{}
   location.replace('/');
  }catch{setError('account_deletion_unavailable');setBusy(false);}
 };
 return <section className="account-delete-section" style={{marginTop:32}}>
  <button id="account-delete-open" type="button" className="text-button danger" disabled={disabled} onClick={()=>setOpen(true)}>{phrase(locale,"Delete account")}</button>
  {open&&<dialog ref={ref} className="account-dialog account-delete-dialog" aria-labelledby="account-delete-heading" onCancel={event=>{event.preventDefault();close();}}>
   <h2 id="account-delete-heading">{phrase(locale,"Delete account")}</h2>
   <p>{phrase(locale,"Permanently delete your service account, consent records, favorites and search settings. This cannot be undone.")}</p>
   <p>{phrase(locale,"Your Kakao account will remain. The current consultation and health information on this page will be cleared.")}</p>
   <form className="account-delete-form" onSubmit={submit}>
    <div className="account-delete-field">
     <label htmlFor="account-delete-confirmation">{phrase(locale,"Type DELETE to confirm.")}</label>
     <input id="account-delete-confirmation" autoComplete="off" value={confirmation} disabled={busy} onChange={e=>setConfirmation(e.target.value)} />
    </div>
    {error&&<p role="alert">{error==='account_deletion_not_configured'?(phrase(locale,"Account deletion is not configured. Contact the administrator.")):(phrase(locale,"Could not complete account deletion. Check your account and try again."))}</p>}
    <div className="account-delete-actions"><button type="button" className="secondary-button" disabled={busy} onClick={close}>{phrase(locale,"Cancel")}</button>
     <button type="submit" className="account-delete-confirm" disabled={busy||confirmation!==word}>{busy?(phrase(locale,"Deleting…")):(phrase(locale,"Permanently delete account"))}</button></div>
   </form>
  </dialog>}
 </section>;
}
