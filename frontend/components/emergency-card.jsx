import {emergencyCallHref,emergencySmsHref} from '../emergency-contact.mjs';
import {phrase,expandLocales,localizedObject,localizedText} from '../i18n.mjs';
import {EmergencyLocationPicker} from './emergency-location-picker.jsx';
import {emergencyResources,defaultEmergencyGuides} from '../emergency-resources.mjs';
import {assistantContentKey} from '../assistant.mjs';
import {useState,useEffect,useLayoutEffect,useRef} from 'react';
import {visibleEmergency,emergencyGuidance,emergencyDialogOpenedEvent} from '../emergency.mjs';
import {Icon} from './shared.jsx';
const emergencyVideoVolume=50;
let youtubeApi;

function loadYouTubeApi(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(youtubeApi)return youtubeApi;
 youtubeApi=new Promise(resolve=>{
  const script=document.createElement('script');
  script.src='https://www.youtube.com/iframe_api';
  const previousReady=window.onYouTubeIframeAPIReady;
  function ready(){
   window.onYouTubeIframeAPIReady=previousReady;
   resolve(window.YT);
   previousReady?.();
  }
  window.onYouTubeIframeAPIReady=ready;
  script.addEventListener('error',()=>{
   if(window.onYouTubeIframeAPIReady===ready)window.onYouTubeIframeAPIReady=previousReady;
   script.remove();
   youtubeApi=undefined;
   resolve(null);
  },{once:true});
  document.head.append(script);
 });
 return youtubeApi;
}

function EmergencyVideo({video,locale}){
 const title=localizedText(video.title,locale);
 const iframeRef=useRef(null);
 useEffect(()=>{
  const iframe=iframeRef.current;
  let active=true,player;
  loadYouTubeApi().then(api=>{
   if(!active||!api?.Player)return;
   player=new api.Player(iframe,{events:{onReady:({target})=>{
    if(active)target.setVolume(emergencyVideoVolume);
   }}});
  });
  return()=>{active=false;player?.destroy();};
 },[]);
 const origin=typeof window==='undefined'?'':'&origin='+encodeURIComponent(window.location.origin);
 return <div className="emergency-video">
  <strong>{title}</strong>
  {video.source&&<small>{video.source}</small>}
  <iframe ref={iframeRef} title={title} src={'https://www.youtube-nocookie.com/embed/'+video.youtubeId+'?autoplay=0&playsinline=1&enablejsapi=1'+origin} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
  <a href={'https://www.youtube.com/watch?v='+video.youtubeId} target="_blank" rel="noopener noreferrer">{phrase(locale,"Open on YouTube")}<Icon name="external" /></a>
 </div>;
}
function EmergencyHelp({state,t,notice,onEmergencyLocation}){
 const [editing,setEditing]=useState(false),[mapOpen,setMapOpen]=useState(false),[selectedId,setSelectedId]=useState('');
 const e=state.emergency,ko=state.locale==='ko',label=value=>localizedText(value,state.locale),location=e.location;
 const guides=state.emergencyGuides??defaultEmergencyGuides,guidance=emergencyGuidance(notice?{topicId:notice.topicId}:null,guides,selectedId);
 const coarse=location.point&&(!Number.isFinite(location.point.accuracy)||location.point.accuracy<=0||location.point.accuracy>1000);
 const point=e.selectedPoint||(!coarse?location.point:null),address=e.manualLocation||(!coarse?location.address:'');
 const editLocation=map=>{setEditing(true);setMapOpen(map);};
 return <section id="emergency-card" className="emergency-card" aria-labelledby="emergency-heading">
  <div className="emergency-heading"><h3 id="emergency-heading">{label(notice?.title)||(phrase(state.locale,"Emergency help"))}</h3><button id="emergency-close" className="text-button">{t('close')}</button></div>
  {notice?.message&&<p>{label(notice.message)}</p>}
  {!ko&&notice?.message?.ko&&label(notice.message)!==notice.message.ko&&<p className="emergency-original"><span className="emergency-note">{phrase(state.locale,"Korean original (you can show this to 119 or people nearby):")}</span> <span lang="ko">{notice.message.ko}</span></p>}
  <p>{phrase(state.locale,"In an emergency in Korea, call 119.")}</p>
  <a className="primary-button emergency-call" href={emergencyCallHref}><Icon name="phone" />{phrase(state.locale,"Call 119 for an ambulance")}</a>
  {!ko&&<p className="emergency-note">{phrase(state.locale,'If you need an interpreter, say “Interpreter, please” when the call connects.')}</p>}
  <section className="emergency-reporting" aria-labelledby="emergency-reporting-heading">
   <h4 id="emergency-reporting-heading">{phrase(state.locale,"What to tell 119")}</h4>
   <ol>{emergencyResources.instructions.map((step,index)=><li key={index}>{index===0&&(address||point)?<><strong>{address||(point.lat.toFixed(6)+', '+point.lng.toFixed(6))}</strong><br /></>:null}{label(step)}</li>)}</ol>
   {!ko&&<details className="emergency-original"><summary>{phrase(state.locale,'Show this in Korean')}</summary>
    <p lang="ko">구급차를 보내 주세요. 통역이 필요해요.</p>
    {address||point?<p><span lang="ko">현재 위치: </span><bdi>{address||(point.lat.toFixed(6)+', '+point.lng.toFixed(6))}</bdi></p>:<p>{phrase(state.locale,'Current location is not confirmed.')}</p>}
   </details>}
   <a href={emergencyResources.source.url} target="_blank" rel="noopener noreferrer">{phrase(state.locale,"119 reporting guidance")}</a>
  </section>
  <a className="secondary-button" href={emergencySmsHref}>{phrase(state.locale,"Open a text message to 119")}</a>
  <p className="emergency-note">{phrase(state.locale,"If speaking is difficult, text your location and situation to 119.")}</p>
  <p className="emergency-note">{phrase(state.locale,"If calling is unavailable on this device, dial 119 on your phone. Follow the dispatcher’s instructions.")}</p>
  <details className="emergency-location" id="emergency-location-section" aria-labelledby="emergency-location-heading">
   <summary id="emergency-location-heading">{phrase(state.locale,"Check or edit reporting location")}</summary>
   {(address||point)?<div id="emergency-manual-result" className="emergency-manual-result" role="status"><p className="emergency-address">{address||(point.lat.toFixed(6)+', '+point.lng.toFixed(6))}</p><small>{ko?(e.locationSource==='text'?'직접 입력한 위치':e.selectedPoint?'직접 선택한 위치':'기기에서 확인한 위치'):phrase(state.locale,'Selected location')}</small><button id="emergency-location-clear" type="button" className="text-button" onClick={()=>{onEmergencyLocation?.({clear:true});setEditing(false);setMapOpen(false);}}>{phrase(state.locale,"Clear location")}</button></div>:<p role="status">{localizedObject((coarse?'Location accuracy is low. Enter or adjust your location.':'Check your address or a nearby building name.'),state.locale)}</p>}
   <div className="emergency-location-actions"><button id="emergency-locate" className="secondary-button" disabled={location.phase==='loading'}>{localizedObject((location.phase==='loading'?'Locating…':'Check current location'),state.locale)}</button><button id="emergency-location-edit" type="button" className="secondary-button" aria-expanded={editing} onClick={()=>editing&&!mapOpen?setEditing(false):editLocation(false)}>{phrase(state.locale,"Enter location")}</button><button id="emergency-map-toggle" type="button" className="text-button" aria-expanded={mapOpen} onClick={()=>{if(mapOpen)setMapOpen(false);else editLocation(true);}}>{localizedObject((mapOpen?'Close map':'Adjust on map'),state.locale)}</button></div>
   {editing&&<div id="emergency-location-editor"><EmergencyLocationPicker state={state} onChange={onEmergencyLocation} mapOpen={mapOpen} /><button type="button" className="text-button" onClick={()=>{setEditing(false);setMapOpen(false);}}>{phrase(state.locale,"Close location editor")}</button></div>}
   <p className="emergency-note">{phrase(state.locale,"This screen does not automatically send your location to 119.")}</p>
  </details>
  <section className="emergency-instructions" id="emergency-first-aid" aria-labelledby="emergency-aid-heading">
   <h4 id="emergency-aid-heading">{phrase(state.locale,"First aid guidance and videos")}</h4>
   {<div className="emergency-topics" role="group" aria-label={phrase(state.locale,"First aid topics")}>{guides.map(guide=><button key={guide.id} type="button" data-emergency-topic={guide.id} className="secondary-button" aria-pressed={guidance?.id===guide.id} onClick={()=>setSelectedId(guide.id)}>{label(guide.title)}</button>)}</div>}
   {guidance?<div className="emergency-guide-content"><h4>{label(guidance.title)||(phrase(state.locale,"Situation guidance"))}</h4>{guidance.instructions?.length>0&&<ol>{guidance.instructions.map((step,index)=><li key={index}>{label(step)}</li>)}</ol>}{guidance.source&&<a className="emergency-note" href={guidance.source.url} target="_blank" rel="noopener noreferrer">{guidance.source.label}<Icon name="external" /></a>}{guidance.videos?.length>0?<div className="emergency-videos">{guidance.videos.map(video=><EmergencyVideo key={video.youtubeId} video={video} locale={state.locale} />)}</div>:null}</div>:<p className="emergency-note">{ko?(notice?.topicId?'이 상황에 연결된 안내를 불러오지 못했어요. 119 상담원의 안내를 따라 주세요.':'필요한 항목을 선택하면 안내와 영상을 볼 수 있어요. 119 연락을 미루지 마세요.'):phrase(state.locale,'Choose a topic for guidance and videos. Do not delay calling 119.')}</p>}

  </section>
 </section>;
}
export function EmergencyCard(props){
 const {state}=props,notice=visibleEmergency(state,assistantContentKey(state));
 return notice||state.emergency?.manual?<EmergencyDialog><EmergencyHelp key={notice?JSON.stringify(notice):'manual'} {...props} notice={notice} /></EmergencyDialog>:null;
}

function EmergencyDialog({children}){
 const ref=useRef(null);
 useLayoutEffect(()=>{
  const node=ref.current;
  if(node.showModal)node.showModal();else node.setAttribute('open','');
  document.dispatchEvent(new Event(emergencyDialogOpenedEvent));
  return()=>{if(node.open&&node.close)node.close();};
 },[]);
 return <dialog id="emergency-dialog" ref={ref} className="emergency-dialog" aria-labelledby="emergency-heading" onCancel={event=>{event.preventDefault();document.getElementById('emergency-close')?.click();}}>{children}</dialog>;
}
