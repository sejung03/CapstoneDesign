"use client";
import {useEffect,useState} from 'react';
import {flushSync} from 'react-dom';
import {AppView} from '../components/app-view.jsx';
import {phrase} from '../i18n.mjs';
import {useLanguage} from '../components/use-language.js';

export default function MedicalApp(){
 const [locale]=useLanguage();
 const [frame,setFrame]=useState(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let cancelled=false,dispose,disposeDev,disposeCare,revision=0;
  import('../app.js').then(async controller=>{
   if(cancelled)return;
   dispose=controller.mountMedicalApp({renderView:context=>{
    // Controller actions restore focus/scroll and update the map after commit.
    // Keep that ordering while the presentation is now owned by React.
    flushSync(()=>setFrame({...context,revision:++revision}));
   }});
   const {createAccountClient}=await import('../account-client.mjs');
   if(!cancelled)void controller.setAccountAdapter(createAccountClient());
   // 문진 엔진 연결(/api/care). BACKEND.md "연결 위치": mountMedicalApp 뒤에 호출한다.
   const [{connectCare},{createCareAssistant,createCareRanking,careHealthNotice}]=await Promise.all([import('../care-client.mjs'),import('../care-adapter.mjs')]);
   if(!cancelled){const off=await connectCare({requestAssistant:createCareAssistant(),rankFacilities:createCareRanking(),healthNotice:careHealthNotice});if(cancelled)off();else disposeCare=off;}
   if(process.env.NODE_ENV==='development'){
    const {installDevConsole}=await import('../dev-console.mjs');
    if(!cancelled)disposeDev=installDevConsole(window,controller,{enabled:true});
   }
  }).catch(()=>{if(!cancelled)setFailed(true);});
  return ()=>{cancelled=true;disposeCare?.();disposeDev?.();dispose?.();};
 },[]);
 return <><div id="app">{frame&&<AppView {...frame} />}</div>{failed&&<main id="main" role="alert"><p>{phrase(frame?.state.locale||locale,'Could not load the page. Please refresh.')}</p><button onClick={()=>window.location.reload()}>{phrase(frame?.state.locale||locale,'Refresh')}</button></main>}<noscript>이 서비스를 이용하려면 JavaScript를 켜 주세요. / Enable JavaScript to use this service.</noscript></>;
}
