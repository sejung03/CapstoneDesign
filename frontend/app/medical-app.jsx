"use client";
import {useEffect,useState} from 'react';
import {flushSync} from 'react-dom';
import {AppView} from '../components/app-view.jsx';

export default function MedicalApp(){
 const [frame,setFrame]=useState(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let cancelled=false,dispose,disposeDev,revision=0;
  import('../app.js').then(async controller=>{
   if(cancelled)return;
   dispose=controller.mountMedicalApp({renderView:context=>{
    // Controller actions restore focus/scroll and update the map after commit.
    // Keep that ordering while the presentation is now owned by React.
    flushSync(()=>setFrame({...context,revision:++revision}));
   }});
   if(process.env.NODE_ENV==='development'){
    const {installDevConsole}=await import('../dev-console.mjs');
    if(!cancelled)disposeDev=installDevConsole(window,controller,{enabled:true});
   }
  }).catch(()=>{if(!cancelled)setFailed(true);});
  return ()=>{cancelled=true;disposeDev?.();dispose?.();};
 },[]);
 return <><div id="app">{frame&&<AppView {...frame} />}</div>{failed&&<main id="main" role="alert"><p>화면을 불러오지 못했습니다. 새로고침해 주세요.</p><button onClick={()=>window.location.reload()}>새로고침</button></main>}<noscript>이 서비스를 이용하려면 JavaScript를 켜 주세요.</noscript></>;
}
