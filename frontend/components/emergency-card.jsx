import {EmergencyLocationPicker} from './emergency-location-picker.jsx';
import {emergencyResources,defaultEmergencyGuides} from '../emergency-resources.mjs';
import {assistantContentKey} from '../assistant.mjs';
import {useState,useLayoutEffect,useRef} from 'react';
import {visibleEmergency,emergencyGuidance} from '../emergency.mjs';
import {Icon} from './shared.jsx';
function EmergencyVideo({video,locale}){
 const [opened,setOpened]=useState(false),[failed,setFailed]=useState(false),title=video.title[locale]||video.title.ko,ko=locale==='ko';
 return <div className="emergency-video"><strong>{title}</strong>{opened&&!failed?<><iframe title={title} src={'https://www.youtube-nocookie.com/embed/'+video.youtubeId+'?autoplay=0'} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onError={()=>setFailed(true)} /><button className="text-button" onClick={()=>setFailed(true)}>{ko?'영상이 재생되지 않나요?':'Video not playing?'}</button></>:failed?<p role="status">{ko?'아래 유튜브 링크에서 영상을 열어 주세요.':'Open the video using the YouTube link below.'}</p>:<button className="secondary-button" onClick={()=>setOpened(true)}><Icon name="arrow" />{ko?'영상 보기':'Show video'}</button>}<a href={'https://www.youtube.com/watch?v='+video.youtubeId} target="_blank" rel="noopener noreferrer">{ko?'유튜브에서 보기':'Open on YouTube'}<Icon name="external" /></a></div>;
}
function EmergencyHelp({state,t,notice,onEmergencyLocation}){
 const [editing,setEditing]=useState(false),[mapOpen,setMapOpen]=useState(false),[selectedId,setSelectedId]=useState('');
 const e=state.emergency,ko=state.locale==='ko',label=value=>value?.[state.locale]||value?.ko,location=e.location;
 const guides=state.emergencyGuides??defaultEmergencyGuides,guidance=emergencyGuidance(notice?{topicId:notice.topicId}:null,guides,selectedId);
 const coarse=location.point&&(!Number.isFinite(location.point.accuracy)||location.point.accuracy<=0||location.point.accuracy>1000);
 const point=e.selectedPoint||(!coarse?location.point:null),address=e.manualLocation||(!coarse?location.address:'');
 const editLocation=map=>{setEditing(true);setMapOpen(map);};
 return <section id="emergency-card" className="emergency-card" aria-labelledby="emergency-heading">
  <div className="emergency-heading"><h3 id="emergency-heading">{label(notice?.title)||(ko?'응급 도움':'Emergency help')}</h3><button id="emergency-close" className="text-button">{t('close')}</button></div>
  {notice?.message&&<p>{label(notice.message)}</p>}
  <p>{ko?'응급 상황이라면 119로 연락해 주세요.':'In an emergency in Korea, call 119.'}</p>
  <a className="primary-button emergency-call" href="tel:119"><Icon name="phone" />{ko?'119 전화하기':'Call 119'}</a>
  <p className="emergency-note">{ko?'전화가 연결되지 않으면 휴대전화에서 119를 눌러 주세요. 119 상담원의 안내를 따라 주세요.':'If calling is unavailable on this device, dial 119 on your phone. Follow the dispatcher’s instructions.'}</p>
  <details className="emergency-location" id="emergency-location-section" aria-labelledby="emergency-location-heading">
   <summary id="emergency-location-heading">{ko?'신고할 위치 확인·수정':'Check or edit reporting location'}</summary>
   {(address||point)?<div id="emergency-manual-result" className="emergency-manual-result" role="status"><p className="emergency-address">{address||(point.lat.toFixed(6)+', '+point.lng.toFixed(6))}</p><small>{ko?(e.locationSource==='text'?'직접 입력한 위치':e.selectedPoint?'직접 선택한 위치':'기기에서 확인한 위치'):'Selected location'}</small><button id="emergency-location-clear" type="button" className="text-button" onClick={()=>{onEmergencyLocation?.({clear:true});setEditing(false);setMapOpen(false);}}>{ko?'선택한 위치 지우기':'Clear location'}</button></div>:<p role="status">{ko?(coarse?'위치 오차가 커요. 주소를 직접 입력하거나 지도에서 수정해 주세요.':location.phase==='error'?'위치를 확인하지 못했어요. 주소나 건물명을 직접 입력해 주세요.':'신고할 주소나 주변 건물명을 확인해 주세요.'):(coarse?'Location accuracy is low. Enter or adjust your location.':'Check your address or a nearby building name.')}</p>}
   <div className="emergency-location-actions"><button id="emergency-locate" className="secondary-button" disabled={location.phase==='loading'}>{ko?(location.phase==='loading'?'위치 확인 중':'현재 위치 확인'):(location.phase==='loading'?'Locating…':'Check current location')}</button><button id="emergency-location-edit" type="button" className="secondary-button" aria-expanded={editing} onClick={()=>editing&&!mapOpen?setEditing(false):editLocation(false)}>{ko?'직접 입력':'Enter location'}</button><button id="emergency-map-toggle" type="button" className="text-button" aria-expanded={mapOpen} onClick={()=>{if(mapOpen)setMapOpen(false);else editLocation(true);}}>{ko?(mapOpen?'지도 닫기':'지도에서 수정'):(mapOpen?'Close map':'Adjust on map')}</button></div>
   {editing&&<div id="emergency-location-editor"><EmergencyLocationPicker state={state} onChange={onEmergencyLocation} mapOpen={mapOpen} /><button type="button" className="text-button" onClick={()=>{setEditing(false);setMapOpen(false);}}>{ko?'위치 입력 닫기':'Close location editor'}</button></div>}
   <p className="emergency-note">{ko?'이 화면의 위치가 119에 자동 전송되지는 않아요.':'This screen does not automatically send your location to 119.'}</p>
  </details>
  <section className="emergency-instructions" id="emergency-first-aid" aria-labelledby="emergency-aid-heading">
   <h4 id="emergency-aid-heading">{ko?'응급처치 안내·영상':'First aid guidance and videos'}</h4>
   {<div className="emergency-topics" role="group" aria-label={ko?'응급처치 항목':'First aid topics'}>{guides.map(guide=><button key={guide.id} type="button" data-emergency-topic={guide.id} className="secondary-button" aria-pressed={guidance?.id===guide.id} onClick={()=>setSelectedId(guide.id)}>{label(guide.title)}</button>)}</div>}
   {guidance?<div className="emergency-guide-content"><h4>{label(guidance.title)||(ko?'상황별 안내':'Situation guidance')}</h4>{guidance.instructions?.length>0&&<ol>{guidance.instructions.map((step,index)=><li key={index}>{label(step)}</li>)}</ol>}{guidance.source&&<a className="emergency-note" href={guidance.source.url} target="_blank" rel="noopener noreferrer">{guidance.source.label}<Icon name="external" /></a>}{guidance.videos?.length>0?<div className="emergency-videos">{guidance.videos.map(video=><EmergencyVideo key={video.youtubeId} video={video} locale={state.locale} />)}</div>:null}</div>:<p className="emergency-note">{ko?(notice?.topicId?'이 상황에 연결된 안내를 불러오지 못했어요. 119 상담원의 안내를 따라 주세요.':'필요한 항목을 선택하면 안내와 영상을 볼 수 있어요. 119 연락을 미루지 마세요.'):'Choose a topic for guidance and videos. Do not delay calling 119.'}</p>}
   <details className="emergency-reporting"><summary>{ko?'119에 알려줄 내용':'What to tell 119'}</summary><ol>{emergencyResources.instructions.map((step,index)=><li key={index}>{label(step)}</li>)}</ol><a href={emergencyResources.source.url} target="_blank" rel="noopener noreferrer">{ko?'소방청 신고 안내':'119 reporting guidance'}</a></details>
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
