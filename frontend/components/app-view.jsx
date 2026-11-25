import {phrase,expandLocales,languageNames} from '../i18n.mjs';
import {copy} from '../copy.mjs';
import {useState,useRef,useLayoutEffect,useEffect} from 'react';
import {Icon} from './shared.jsx';
import {Chat} from './chat.jsx';
import {Explore} from './explore.jsx';
import {Profile} from './profile.jsx';
import {Report} from './report.jsx';
import {flushSync} from 'react-dom';
import {voiceEnabled} from '../voice-client.mjs';
import {FirstVoicePrompt} from './voice-controls.jsx';
import {HealthConsent} from './health-consent.jsx';
import {ConversationLegalLinks} from './legal-dialog.jsx';
import {EmergencyCard} from './emergency-card.jsx';
import {CarePrintSheet} from './care-print-sheet.jsx';
import {visibleEmergency} from '../emergency.mjs';
import {assistantContentKey} from '../assistant.mjs';
import {hasHealthConsent} from '../health-consent.mjs';

function HeaderVoiceVolume({volume,muted,setVolume,setMuted}){
 const [open,setOpen]=useState(false),menu=useRef(null),toggle=useRef(null),slider=useRef(null);
 useEffect(()=>{
  if(!open)return;
  slider.current?.focus();
  const outside=event=>{if(!menu.current?.contains(event.target))setOpen(false);};
  document.addEventListener('pointerdown',outside);
  return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 return <div ref={menu} className="header-voice-volume" onKeyDown={event=>{
  if(event.key==='Escape'&&open){event.stopPropagation();setOpen(false);toggle.current?.focus();}
 }}>
  <button ref={toggle} type="button" className="icon-button" aria-label={muted||!volume?'읽어주기 설정 (음소거)':'읽어주기 음량'} aria-expanded={open} aria-controls="voice-volume-popover" onClick={()=>setOpen(value=>!value)}>
   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4 5 9H2v6h3l6 5z" />
    {muted||!volume?<path d="m16 9 5 6m0-6-5 6" />:<path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12" />}
   </svg>
  </button>
  <div id="voice-volume-popover" className="voice-volume-popover" hidden={!open}>
   <label htmlFor="header-voice-level">읽기 음량 {Math.round(volume*100)}%</label>
   <input ref={slider} id="header-voice-level" type="range" min="0" max="100" step="5" value={Math.round(volume*100)} onChange={event=>{setVolume(Number(event.target.value)/100);setMuted(false);}} />
   <button type="button" className="text-button" aria-pressed={muted} onClick={()=>setMuted(value=>!value)}>{muted?'음소거 해제':'음소거'}</button>
  </div>
 </div>;
}

export function Header({state,t,voiceControls}){

 return <><header className="header care-header"><button className="brand brand-button" data-view="entry"><img className="brand-logo" src="/brand-icon.png" alt="" width="30" height="30" />{t('brand')}</button><div className="header-actions"><label className="sr-only" htmlFor="language-select">{phrase(state.locale,"Language")}</label><select id="language-select" className="language-select" value={state.locale} onChange={()=>{}}>{Object.keys(copy).map(code=><option key={code} value={code}>{languageNames[code]}</option>)}</select><nav className="header-nav" aria-label={t('navLabel')}><button className="icon-button header-profile" data-view="profile" aria-label={t('myInfo')} title={t('myInfo')}><Icon name="user" /></button></nav>{voiceControls&&<HeaderVoiceVolume {...voiceControls} />}<button id="theme" className="icon-button" aria-label={t(state.theme==='light'?'themeDark':'themeLight')} aria-pressed={state.theme==='dark'}><Icon name={state.theme==='light'?'moon':'sun'} /></button></div></header></>;
}
export function AppView({state,t,revision,conversationVersion=0,onEmergencyLocation,onPreviousReport,onHealthUpdates}){
 const shell=useRef(null),drag=useRef(null),[width,setWidth]=useState(0),[ratios,setRatios]=useState({explore:70,profile:50}),[resizing,setResizing]=useState(false);
 const [voiceFollowups,setVoiceFollowups]=useState(false);
 const [entered,setEntered]=useState(false),[volume,setVolume]=useState(0.7),[muted,setMuted]=useState(false);
 const healthReady=hasHealthConsent(state),voiceStarted=useRef(false),entryAnswer=useRef(null),activeConversation=useRef(conversationVersion);
 useLayoutEffect(()=>{
  if(activeConversation.current===conversationVersion)return;
  activeConversation.current=conversationVersion;
  voiceStarted.current=false;
  setEntered(false);
  setVoiceFollowups(false);
 },[conversationVersion]);
 const voiceControls=voiceEnabled&&state.locale==='ko'?{volume,muted,setVolume,setMuted}:null;
 const voiceVolume=voiceControls&&!muted?volume:0;
 const emergencyOpen=!!state.emergency.manual||!!visibleEmergency(state,assistantContentKey(state));
 const welcome=!state.chat.messages.length&&!state.chat.intakeContext&&!state.workspace?.intake&&!state.reportImport.open&&!state.reportImport.confirmed;
 const workspace=state.workspace||{},panel=workspace.panel,View={explore:Explore,report:Report,profile:Profile}[panel];
 const introOpen=!!voiceControls&&!entered&&welcome&&!panel;
 const skipTarget=introOpen?'#voice-entry':View?'#workspace-panel':'#main';
 useLayoutEffect(()=>{
  document.querySelector('.skip-link')?.setAttribute('href',skipTarget);
 },[skipTarget]);
 const introHealthOpen=introOpen&&state.healthConsent.open&&(!state.healthConsent.pending||state.healthConsent.pending==='voice-entry');
 useEffect(()=>{
  if(introOpen&&!introHealthOpen&&voiceStarted.current)entryAnswer.current?.focus({preventScroll:true});
 },[introOpen,introHealthOpen]);
 const openEmergency=()=>{
  const button=document.getElementById('emergency-open');
  if(button?.getAttribute('aria-expanded')==='false')button.click();
 };
 const canStartVoice=()=>{
  voiceStarted.current=true;
  // 녹음의 외부(OpenAI) 전송은 건강정보 수집·이용 동의에 포함되어 있다(health-consent.mjs). 따로 묻지 않는다
  if(!healthReady){entryAnswer.current?.dispatchEvent(new Event('medical:request-voice-consent'));return false;}
  return true;
 };
 const enterText=()=>{
  flushSync(()=>{setVoiceFollowups(false);setEntered(true);});
  document.getElementById('main')?.focus({preventScroll:true});
 };
 const fillVoice=(text,send)=>{
  if(!healthReady||!text.trim())return;
  flushSync(()=>{setVoiceFollowups(true);setEntered(true);});
  const input=document.getElementById('composer-input');
  if(input&&!input.readOnly&&input.form){
   input.value=text;
   input.dispatchEvent(new Event('input',{bubbles:true}));
   if(send)input.form.requestSubmit();else input.focus({preventScroll:true});
  }
 };
 const kind=panel==='explore'?'explore':'profile',initial=kind==='explore'?70:50,minTool=kind==='explore'?360:380;
 useLayoutEffect(()=>{
  const node=shell.current,measure=()=>setWidth(node.getBoundingClientRect().width);measure();
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(measure):null;observer?.observe(node);window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 useLayoutEffect(()=>{drag.current=null;setResizing(false);},[panel]);
 const bounds=()=>{const available=Math.max(1,(shell.current?.getBoundingClientRect().width||width||1200)-10);return {min:360/available*100,max:(available-minTool)/available*100,available};};
 const clamp=(value)=>{const b=bounds();return Math.max(b.min,Math.min(Math.max(b.min,b.max),value));};
 const ratio=clamp(ratios[kind]),b=bounds();
 const resize=value=>setRatios(values=>({...values,[kind]:clamp(value)}));
 const end=(event,cancel=false)=>{if(!drag.current)return;if(cancel)resize(drag.current.ratio);drag.current=null;setResizing(false);if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 const emergencyButton=<button id="emergency-open" type="button" className="text-button emergency-entry-button" aria-haspopup="dialog" aria-expanded={emergencyOpen} aria-controls={emergencyOpen?'emergency-dialog':undefined}><Icon name="phone" />{phrase(state.locale,"Emergency help")}</button>;
 return <><Header state={state} t={t} voiceControls={voiceControls} />
 {/* 새 대화(왼쪽)와 응급 도움(오른쪽)을 한 줄에. 지도 패널이 열리면 응급 도움은 패널 도구줄로 옮겨 간다 */}
 {!introOpen&&<div className="emergency-entry-bar"><button id="new-conversation" type="button" className="text-button new-conversation-button"><Icon name="plus" />{t('conversationNew')}</button>{panel!=='explore'&&emergencyButton}</div>}
 {introOpen&&panel!=='explore'&&<div className="emergency-entry-bar">{emergencyButton}</div>}
 {introOpen&&<FirstVoicePrompt locale={state.locale} brand={t('brand')} answerRef={entryAnswer}
  ready={voiceStarted.current&&healthReady}
  canStartVoice={canStartVoice} onVoiceSubmit={text=>fillVoice(text,true)} onVoiceEdit={text=>fillVoice(text,false)} onSkip={enterText} onEmergency={openEmergency}
  conversation={state.chat.messages} permitted={healthReady}
  voiceBlocked={introHealthOpen||emergencyOpen||state.account?.phase==='loading'} />}
 {introOpen&&<ConversationLegalLinks state={state} entry />}
 {introHealthOpen&&<HealthConsent state={state} />}
 <div ref={shell} hidden={introOpen} inert={introOpen} style={{'--conversation-size':ratio+'%','--tool-min':minTool+'px'}} className={'care-shell'+(View?' has-workspace':'')+(resizing?' is-resizing':'')+(View&&kind==='profile'?' info-only':'')}>
 <main id="main" className="conversation-main" tabIndex={-1}><h1 id="conversation-title" className="sr-only" tabIndex={-1}>{t('conversationTitle')}</h1><Chat state={state} t={t} primary voiceVolume={voiceVolume} voiceFollowups={voiceFollowups} stopVoiceFollowups={()=>setVoiceFollowups(false)} introOpen={introOpen} emergencyOpen={emergencyOpen} onPreviousReport={onPreviousReport} onHealthUpdates={onHealthUpdates} /></main>
 {panel==='explore'&&<div id="workspace-splitter" className="workspace-splitter" role="separator" tabIndex={0} aria-label={phrase(state.locale,"Resize conversation pane")} aria-orientation="vertical" aria-controls="main" aria-valuemin={Math.round(b.min)} aria-valuemax={Math.round(Math.max(b.min,b.max))} aria-valuenow={Math.round(ratio)} aria-valuetext={phrase(state.locale,"Conversation {0}%", [Math.round(ratio)])} title={phrase(state.locale,"Drag to resize; double-click to reset")}
  onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={ratio};setResizing(true);event.currentTarget.setPointerCapture?.(event.pointerId);event.currentTarget.focus();}}
  onPointerMove={event=>{if(!drag.current)return;const rect=shell.current.getBoundingClientRect();resize((event.clientX-rect.left)/bounds().available*100);}}
  onPointerUp={event=>end(event)} onPointerCancel={event=>end(event,true)} onLostPointerCapture={event=>end(event,true)}
  onDoubleClick={()=>resize(initial)} onKeyDown={event=>{
   if(['ArrowLeft','ArrowRight','Home','End','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();}
   if(event.key==='ArrowLeft')resize(ratio-2);if(event.key==='ArrowRight')resize(ratio+2);
   if(event.key==='Home')resize(b.min);if(event.key==='End')resize(b.max);
   if(event.key==='Escape')end(event,true);
  }}><svg viewBox="0 0 16 32" aria-hidden="true"><path d="M6 8v16M10 8v16" /></svg></div>}
 {View&&<aside id="workspace-panel" tabIndex={-1} className={'care-tool-panel tool-'+panel} aria-label={t({explore:'navExplore',report:'contextReport',profile:'myInfo',detail:'detail',route:'routeAction'}[panel])}><div className="workspace-toolbar"><button id="workspace-close" className="text-button"><Icon name="back" />{panel==='report'?(phrase(state.locale,"Back to My information")):t('conversationBack')}</button>{panel==='explore'&&emergencyButton}</div><div className="workspace-content"><View state={state} t={t} unified={panel==='report'} /></div></aside>}
 </div>
 {/* 대화의 PDF 카드가 인쇄하는 정리본. 화면에는 보이지 않고, body.print-care-sheet일 때만 인쇄된다 */}
 {state.profile&&<div className="chat-print-root" aria-hidden="true"><CarePrintSheet state={state} t={t} /></div>}
 <EmergencyCard state={state} t={t} onEmergencyLocation={onEmergencyLocation} />
 <div key={'toast:'+revision} id="toast" className="toast" role="status" aria-live="polite" hidden /></>;
}
