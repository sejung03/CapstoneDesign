import {phrase,expandLocales,languageNames} from '../i18n.mjs';
import {copy} from '../copy.mjs';
import {useState,useRef,useLayoutEffect} from 'react';
import {Icon} from './shared.jsx';
import {Chat} from './chat.jsx';
import {Explore} from './explore.jsx';
import {Profile} from './profile.jsx';
import {Report} from './report.jsx';
export function Header({state,t}){

 return <><header className="header care-header"><button className="brand brand-button" data-view="entry"><span className="brand-symbol"><Icon name="plus" /></span>{t('brand')}</button><div className="header-actions"><label className="sr-only" htmlFor="language-select">{phrase(state.locale,"Language")}</label><select id="language-select" className="language-select" value={state.locale} onChange={()=>{}}>{Object.keys(copy).map(code=><option key={code} value={code}>{languageNames[code]}</option>)}</select><nav className="header-nav" aria-label={t('navLabel')}><button className="icon-button header-profile" data-view="profile" aria-label={t('myInfo')} title={t('myInfo')}><Icon name="user" /></button></nav><button id="theme" className="icon-button" aria-label={t(state.theme==='light'?'themeDark':'themeLight')} aria-pressed={state.theme==='dark'}><Icon name={state.theme==='light'?'moon':'sun'} /></button></div></header></>;
}
export function AppView({state,t,revision,onEmergencyLocation,onPreviousReport,onHealthUpdates}){
 const shell=useRef(null),drag=useRef(null),[width,setWidth]=useState(0),[ratios,setRatios]=useState({explore:40,profile:50}),[resizing,setResizing]=useState(false);
 const welcome=!state.chat.messages.length&&!state.chat.intakeContext&&!state.workspace?.intake&&!state.reportImport.open&&!state.reportImport.confirmed;
 const workspace=state.workspace||{},panel=workspace.panel,View={explore:Explore,report:Report,profile:Profile}[panel];
 const kind=panel==='explore'?'explore':'profile',initial=kind==='explore'?40:50,minTool=kind==='explore'?600:380;
 useLayoutEffect(()=>{
  const node=shell.current,measure=()=>setWidth(node.getBoundingClientRect().width);measure();
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(measure):null;observer?.observe(node);window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 useLayoutEffect(()=>{drag.current=null;setResizing(false);},[panel,workspace.expanded]);
 const bounds=()=>{const available=Math.max(1,(shell.current?.getBoundingClientRect().width||width||1200)-10);return {min:360/available*100,max:(available-minTool)/available*100,available};};
 const clamp=(value)=>{const b=bounds();return Math.max(b.min,Math.min(Math.max(b.min,b.max),value));};
 const ratio=clamp(ratios[kind]),b=bounds();
 const resize=value=>setRatios(values=>({...values,[kind]:clamp(value)}));
 const end=(event,cancel=false)=>{if(!drag.current)return;if(cancel)resize(drag.current.ratio);drag.current=null;setResizing(false);if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
 return <><Header state={state} t={t} /><div ref={shell} style={{'--conversation-size':ratio+'%','--tool-min':minTool+'px'}} className={'care-shell'+(View?' has-workspace':'')+(View&&workspace.expanded?' is-expanded':'')+(resizing?' is-resizing':'')+(View&&kind==='profile'?' info-only':'')}>
 <main id="main" className="conversation-main" tabIndex={-1}><div className={'conversation-heading'+(welcome?' welcome-heading':'')}><div><h1 tabIndex={-1}>{t('conversationTitle')}</h1><p>{t('conversationIntro')}</p></div><button id="new-conversation" className="text-button"><Icon name="plus" />{t('conversationNew')}</button></div><Chat state={state} t={t} primary onEmergencyLocation={onEmergencyLocation} onPreviousReport={onPreviousReport} onHealthUpdates={onHealthUpdates} /></main>
 {View&&kind==='explore'&&!workspace.expanded&&<div id="workspace-splitter" className="workspace-splitter" role="separator" tabIndex={0} aria-label={phrase(state.locale,"Resize conversation pane")} aria-orientation="vertical" aria-controls="main" aria-valuemin={Math.round(b.min)} aria-valuemax={Math.round(Math.max(b.min,b.max))} aria-valuenow={Math.round(ratio)} aria-valuetext={phrase(state.locale,"Conversation {0}%", [Math.round(ratio)])} title={phrase(state.locale,"Drag to resize; double-click to reset")}
  onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();drag.current={ratio};setResizing(true);event.currentTarget.setPointerCapture?.(event.pointerId);event.currentTarget.focus();}}
  onPointerMove={event=>{if(!drag.current)return;const rect=shell.current.getBoundingClientRect();resize((event.clientX-rect.left)/bounds().available*100);}}
  onPointerUp={event=>end(event)} onPointerCancel={event=>end(event,true)} onLostPointerCapture={event=>end(event,true)}
  onDoubleClick={()=>resize(initial)} onKeyDown={event=>{
   if(['ArrowLeft','ArrowRight','Home','End','Escape','Enter'].includes(event.key)){event.preventDefault();event.stopPropagation();}
   if(event.key==='ArrowLeft')resize(ratio-2);if(event.key==='ArrowRight')resize(ratio+2);
   if(event.key==='Home')resize(b.min);if(event.key==='End')resize(b.max);
   if(event.key==='Escape')end(event,true);
   if(event.key==='Enter'){document.getElementById('workspace-expand')?.click();document.getElementById('workspace-expand')?.focus();}
  }}><svg viewBox="0 0 16 32" aria-hidden="true"><path d="M6 8v16M10 8v16" /></svg></div>}
 {View&&<aside id="workspace-panel" className={'care-tool-panel tool-'+panel} aria-label={t({explore:'navExplore',report:'contextReport',profile:'myInfo',detail:'detail',route:'routeAction'}[panel])}><div className="workspace-toolbar"><button id="workspace-close" className="text-button"><Icon name="back" />{panel==='report'?(phrase(state.locale,"Back to My information")):t('conversationBack')}</button>{kind==='explore'&&<button id="workspace-expand" className="icon-button" aria-label={t(workspace.expanded?'conversationRestore':'conversationExpand')} aria-pressed={!!workspace.expanded}><Icon name={workspace.expanded?'back':'external'} /></button>}</div><div className="workspace-content"><View state={state} t={t} unified={panel==='report'} /></div></aside>}
 </div><div key={'toast:'+revision} id="toast" className="toast" role="status" aria-live="polite" hidden /></>;
}
