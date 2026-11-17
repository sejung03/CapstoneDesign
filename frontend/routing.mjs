import {phrase,expandLocales} from './i18n.mjs';
import {uiIcon} from './ui-icons.mjs';
export const travelModes=['walk','traffic','car'];
export function validRouteLocation(point){return !!point&&Number.isFinite(point.lat)&&Number.isFinite(point.lng)&&Math.abs(point.lat)<=90&&Math.abs(point.lng)<=180;}
export function routeQuery(mode,origin,destination){
 if(!travelModes.includes(mode)||!validRouteLocation(origin)||!validRouteLocation(destination))return '';
 return 'mode='+mode+'&startLat='+origin.lat+'&startLng='+origin.lng+'&endLat='+destination.lat+'&endLng='+destination.lng;
}
export function kakaoRouteLink(mode,origin,destination,locale='ko'){
 if(!travelModes.includes(mode)||!validRouteLocation(destination))return '';
 const end=encodeURIComponent(destination.name?.[locale]||destination.name?.ko||'Destination')+','+destination.lat+','+destination.lng;
 if(!validRouteLocation(origin))return 'https://map.kakao.com/link/to/'+end;
 return 'https://map.kakao.com/link/by/'+mode+'/'+encodeURIComponent(phrase(locale,"My location"))+','+origin.lat+','+origin.lng+'/'+end;
}
export function routeContext(state){
 const destination=state.source==='live'&&state.view==='explore'&&state.routing.openId===state.search.selectedId?(state.live.items.find(item=>item.id===state.search.selectedId)||state.discovery?.items?.find(item=>item.id===state.search.selectedId)):null;
 return {destination,origin:state.live.position,key:destination?routeQuery(state.routing.mode,state.live.position,destination):''};
}
export function routeDistance(meters){return meters<1000?Math.round(meters)+' m':(meters/1000).toFixed(1)+' km';}
export function routeDuration(seconds,locale='ko'){
 const mins=Math.max(1,Math.ceil(seconds/60)),hours=Math.floor(mins/60),rest=mins%60;
 return hours?phrase(locale,'{0} h',[hours])+(rest?' '+phrase(locale,'{0} min',[rest]):''):phrase(locale,'{0} min',[mins]);
}
export function routeEntry(state,item){
 const key=routeQuery(state.routing?.mode||'walk',state.live.position,item);
 const entry=state.routing?.cache?.[key];
 return entry&&entry.expires>Date.now()?entry:null;
}
export function renderRoutePanel(state,item,t,escape){
 const r=state.routing||{mode:"walk"},origin=state.live.position,entry=routeEntry(state,item);
 const data=entry?.phase==='ready'?entry.data:null;
 const error=!validRouteLocation(origin)?'routeLocationMissing':!state.live.routingConfigured?'routeKeyMissing':entry?.phase==='error'?entry.error:'routeLoading';
 const link=kakaoRouteLink(r.mode,origin,item,state.locale);
 const svg={walk:'<circle cx="13" cy="4" r="2"/><path d="m10 8 4-1 3 5 3 1M10 8l-3 5-4 1m9-5-2 7-4 5m4-5 5 2 2 4"/>',traffic:'<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 11h14M8 19l-2 3m10-3 2 3M9 15h.01M15 15h.01"/>',car:'<path d="m4 10 2-6h12l2 6M3 10h18v9H3zM6 19v3m12-3v3M6 14h2m8 0h2"/>'};
 return '<section id="facility-route-panel" class="route-panel" aria-labelledby="route-heading"><h3 id="route-heading" tabindex="-1">'+t('routeHeading')+'</h3><div class="travel-modes" role="group" aria-label="'+t('travelMode')+'">'+travelModes.map(mode=>'<button type="button" data-travel-mode="'+mode+'" class="'+(r.mode===mode?'active':'')+'" aria-pressed="'+(r.mode===mode)+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+svg[mode]+'</svg>'+t('travel'+mode)+'</button>').join('')+'</div><div class="route-result" role="status" aria-live="polite">'+(data?'<div class="route-estimates"><div><span>'+t('travelDistance')+'</span><strong>'+escape(routeDistance(data.distanceMeters))+'</strong></div><div><span>'+t('travelDuration')+'</span><strong>'+escape(routeDuration(data.durationSeconds,state.locale))+'</strong></div></div><p>'+t('routeActual')+'</p>':'<p>'+t(error)+'</p>')+'</div>'+(origin?.accuracy>1000?'<p class="route-note">'+t('routeCoarse')+'</p>':'')+(data?.steps?.length?'<details class="route-steps"><summary>'+t('routeSteps')+'</summary><ol>'+data.steps.map(step=>'<li>'+escape(step.guidance)+(Number.isFinite(step.distanceMeters)?'<small>'+escape(routeDistance(step.distanceMeters))+'</small>':'')+'</li>').join('')+'</ol></details>':'')+(entry?.phase==='error'&&state.live.routingConfigured?'<button id="route-retry" class="text-button">'+t('routeRetry')+'</button>':'')+(link?'<a class="primary-button route-external" href="'+escape(link)+'" target="_blank" rel="noopener noreferrer">'+t('routeOpen')+uiIcon('external')+'</a>':'')+'<p class="route-note">'+t(validRouteLocation(origin)?'routeDeparture':'routeManualDeparture')+'</p></section>';
}
