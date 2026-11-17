import {phrase,expandLocales,localizedObject,localizedText} from '../i18n.mjs';
import {EmergencyLocationPicker} from './emergency-location-picker.jsx';
import {emergencyResources,defaultEmergencyGuides} from '../emergency-resources.mjs';
import {assistantContentKey} from '../assistant.mjs';
import {useState,useLayoutEffect,useRef} from 'react';
import {visibleEmergency,emergencyGuidance} from '../emergency.mjs';
import {Icon} from './shared.jsx';
function EmergencyVideo({video,locale}){
 const [opened,setOpened]=useState(false),[failed,setFailed]=useState(false),title=localizedText(video.title,locale),ko=locale==='ko';
 return <div className="emergency-video"><strong>{title}</strong>{opened&&!failed?<><iframe title={title} src={'https://www.youtube-nocookie.com/embed/'+video.youtubeId+'?autoplay=0'} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={()=>setFailed(true)} /><button className="text-button" onClick={()=>setFailed(true)}>{phrase(locale,"Video not playing?")}</button></>:failed?<p role="status">{phrase(locale,"Open the video using the YouTube link below.")}</p>:<button className="secondary-button" onClick={()=>setOpened(true)}><Icon name="arrow" />{phrase(locale,"Show video")}</button>}<a href={'https://www.youtube.com/watch?v='+video.youtubeId} target="_blank" rel="noopener noreferrer">{phrase(locale,"Open on YouTube")}<Icon name="external" /></a></div>;
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
  <p>{phrase(state.locale,"In an emergency in Korea, call 119.")}</p>
  <a className="primary-button emergency-call" href="tel:119"><Icon name="phone" />{phrase(state.locale,"Call 119")}</a>
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
   <details className="emergency-reporting"><summary>{phrase(state.locale,"What to tell 119")}</summary><ol>{emergencyResources.instructions.map((step,index)=><li key={index}>{label(step)}</li>)}</ol><a href={emergencyResources.source.url} target="_blank" rel="noopener noreferrer">{phrase(state.locale,"119 reporting guidance")}</a></details>
  </section>
 </section>;
}
export function EmergencyCard(props){
 const {state}=props,notice=visibleEmergency(state,assistantContentKey(state));
 return notice||state.emergency?.manual?<EmergencyDialog><EmergencyHelp key={notice?JSON.stringify(notice):'manual'} {...props} notice={notice} /></EmergencyDialog>:null;
}

function EmergencyDialog({children}){
 const ref=useRef(null);
 useLayoutEffect(()=>{const node=ref.current;if(node.showModal)node.showModal();else node.setAttribute('open','');return()=>{if(node.open&&node.close)node.close();};},[]);
 return <dialog id="emergency-dialog" ref={ref} className="emergency-dialog" aria-labelledby="emergency-heading" onCancel={event=>{event.preventDefault();document.getElementById('emergency-close')?.click();}}>{children}</dialog>;
}
