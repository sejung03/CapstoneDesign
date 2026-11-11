import {Favorites} from './favorites.jsx';
import {useState,useLayoutEffect,useRef} from 'react';
import {AccountDialog} from './account-dialog.jsx';
import {hasProfileChanges} from '../profile.mjs';
import {HealthConsent} from './health-consent.jsx';
import {hasHealthConsent} from '../health-consent.mjs';
import {Textarea,Input,Icon} from './shared.jsx';
export function Profile({state,t}){
 const [accountOpen,setAccountOpen]=useState(false),[dirty,setDirty]=useState(false);
 useLayoutEffect(()=>setDirty(hasProfileChanges(state.profile,state.profileDraft)),[state.profile,state.profileDraft]);
 const permitted=hasHealthConsent(state),p=state.profileDraft,ko=state.locale==='ko',account=state.account||{phase:'guest'},signedIn=!!account.accountId,busy=['loading','loggingOut'].includes(account.phase);
 return <section className="profile-view info-view" aria-labelledby="profile-heading">
  <div className="profile-title info-page-heading"><h1 id="profile-heading" tabIndex={-1}>{t('myInfo')}</h1><p>{ko?'상담에 사용할 정보를 확인하고 수정하세요.':'Review and edit information for your consultation.'}</p></div>
  <div className="info-account"><span className="info-account-icon"><Icon name="user" /></span><div><strong>{signedIn?(ko?'로그인되어 있어요.':'You are logged in.'):(ko?'로그인하고 건강정보를 간편하게 관리하세요.':'Log in to manage your health information.')}</strong>{!signedIn&&<p>{ko?'건강정보와 즐겨찾는 병원·약국을 저장하고 다음에도 이용하세요.':'Save health information and favorite hospitals and pharmacies for next time.'}</p>}{account.error&&<p role="alert">{ko?(account.error==='logout'?'로그아웃하지 못했어요. 다시 시도해 주세요.':'로그인 상태를 확인하지 못했어요.'):(account.error==='logout'?'Could not log out. Try again.':'Could not check your session.')}{account.error==='session'&&<button id="account-retry" className="text-button">{ko?'다시 시도':'Retry'}</button>}</p>}</div>{signedIn?<button id="account-logout" type="button" className="secondary-button" disabled={busy}>{ko?(account.phase==='loggingOut'?'로그아웃 중':'로그아웃'):(account.phase==='loggingOut'?'Logging out…':'Log out')}</button>:<button id="account-open" type="button" className="primary-button" disabled={busy} aria-haspopup="dialog" aria-expanded={accountOpen} aria-controls="account-dialog" onClick={()=>setAccountOpen(true)}>{ko?'로그인·회원가입':'Log in / Sign up'}</button>}</div>
  {accountOpen&&!signedIn&&<AccountDialog locale={state.locale} onDismiss={()=>setAccountOpen(false)} />}
  <Favorites state={state} />
  {state.profileStorageNotice&&<p className="field-error" role="alert">{t('profileStorageNotice')}</p>}
  <form id="profile-form" className="profile-form" onInput={event=>{const values={...state.profile};for(const key of ['age','allergies','medications','history'])values[key]=event.currentTarget.elements.namedItem('profile-'+key)?.value??'';state.profileDraft={...state.profileDraft,...values};setDirty(hasProfileChanges(state.profile,values));}}><section className="profile-health info-health" aria-labelledby="info-health-heading"><h2 id="info-health-heading">{ko?'건강정보':'Health information'}</h2>{!permitted&&<div className="profile-health-access"><p>{ko?'건강정보 입력을 시작하려면 수집·이용 동의를 확인해 주세요.':'Review health information consent before entering your details.'}</p><button id="profile-health-start" type="button" className="secondary-button">{ko?'건강정보 입력하기':'Enter health information'}</button></div>}<div className="profile-field info-age"><label htmlFor="profile-age">{t('profileAge')}</label><div className="age-input"><Input id="profile-age" type="number" inputMode="numeric" min="0" max="120" step="1" value={p.age} disabled={!permitted} /><span>{ko?'세':'years'}</span></div></div>
   {[['allergies','profileAllergies'],['medications','profileMedications'],['history','profileHistory']].map(([key,label])=><div key={key} className="profile-field"><label htmlFor={'profile-'+key}>{t(label)} <span>{t('optionalText')}</span></label><Textarea id={'profile-'+key} value={p[key]} disabled={!permitted} maxLength={500} rows={2} /></div>)}
   <p className="profile-help">{ko?'만 나이를 모르면 비워 두세요. 나머지 항목은 해당하지 않으면 ‘없음’, 잘 모르면 ‘모름’으로 적어 주세요.':'Leave age blank if unknown. For other fields, use “None” if not applicable and “Unknown” if unsure.'}</p>
  </section>
  <div className="profile-save">{state.profileError&&<p role="alert" className="field-error">{ko?'만 나이는 0부터 120까지 정수로 입력해 주세요.':'Enter a whole age from 0 to 120.'}</p>}{dirty&&<p className="profile-dirty" role="status">{ko?'저장하지 않은 변경사항이 있어요.':'You have unsaved changes.'}</p>}<p className="info-session-note">{ko?'비회원의 건강정보는 현재 페이지에서만 유지됩니다. 저장한 내용이 상담과 PDF에 반영됩니다.':'Guest information lasts on this page only. Saved information is used in your consultation and PDF.'}</p><div><button className="primary-button" type="submit" disabled={!permitted}>{ko?'건강정보 저장':'Save health information'}</button><button id="profile-delete" className="text-button danger" type="button">{ko?'건강정보 지우기':'Clear health information'}</button></div></div></form>
  <div className="profile-export-actions"><button id="profile-pdf" type="button" className="secondary-button"><Icon name="print" />{ko?'건강정보 PDF 저장':'Save health information as PDF'}</button></div>
  <article className="health-print-sheet" aria-label={ko?'건강정보 PDF':'Health information PDF'}><h1>{ko?'건강정보':'Health information'}</h1><dl>{[['age','profileAge'],['allergies','profileAllergies'],['medications','profileMedications'],['history','profileHistory']].map(([key,label])=><div key={key}><dt>{t(label)}</dt><dd>{state.profile[key]!==''&&state.profile[key]!=null?(key==='age'?(ko?'만 '+state.profile[key]+'세':state.profile[key]+' years'):state.profile[key]):(ko?'입력하지 않음':'Not provided')}</dd></div>)}</dl></article>
  {state.healthConsent.pending==='profile' &&<HealthConsent state={state} />}
  {state.profileExit&&<ProfileExit locale={state.locale} />}
 </section>;
}

function ProfileExit({locale}){
 const ref=useRef(null),ko=locale==='ko';
 useLayoutEffect(()=>{const node=ref.current;if(node.showModal)node.showModal();else node.setAttribute('open','');return()=>{if(node.open&&node.close)node.close();};},[]);
 return <dialog ref={ref} className="profile-exit-dialog" aria-labelledby="profile-exit-heading" onCancel={event=>{event.preventDefault();document.getElementById('profile-leave-cancel')?.click();}}><h2 id="profile-exit-heading">{ko?'변경한 건강정보를 저장할까요?':'Save your health information changes?'}</h2><p>{ko?'저장하지 않은 내용은 상담이나 건강정보 PDF에 반영되지 않습니다.':'Unsaved changes are not used in consultations or notes.'}</p><div><button id="profile-leave-save" className="primary-button">{ko?'저장하고 이동':'Save and leave'}</button><button id="profile-leave-discard" className="secondary-button">{ko?'변경사항 버리기':'Discard changes'}</button><button id="profile-leave-cancel" className="text-button">{ko?'계속 작성':'Keep editing'}</button></div></dialog>;
}
