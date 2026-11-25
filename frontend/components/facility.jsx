import {FavoriteButton} from './favorites.jsx';
import {phrase} from '../i18n.mjs';
import {useState} from 'react';
import {renderFacilityIllustration} from '../facility-art.mjs';
import {formatSlot} from '../public-hours.mjs';
import {isPublicHoliday} from '../holidays.mjs';
import {facilityAddress,facilityDistanceKm} from '../live-data.mjs';
import {routeEntry,routeDistance} from '../routing.mjs';
import {recommendationReasons} from '../care-context.mjs';
import {nearerOpenHospitals,alternativeItems,comparisonDepartments} from '../discovery.mjs';
import {RoutePanel} from './routing.jsx';
import {Icon,Artwork,escapeText} from './shared.jsx';
export function FacilityPhoto({item,t,detail=false,locale}){
 const src=typeof item.photo?.src==='string'&&(/^(?:\.\/)?[\w/-]+\.(?:png|jpe?g|webp)$/i.test(item.photo.src)||/^https:\/\/[a-z0-9.-]+(?:\/[^\s<>\x22\x27\\]*)?$/i.test(item.photo.src))?item.photo.src:'';
 const [failed,setFailed]=useState(false);
 const key='facility-photo-'+item.id+(detail?'-detail':'-card');
 return <div className={'facility-photo facility-art-'+(item.type==='pharmacy'?'pharmacy':'hospital')+(detail?' detail-photo':'')}><span id={key+'-fallback'} className="photo-fallback" hidden={!!src&&!failed}><Artwork markup={renderFacilityIllustration(item.type,t,escapeText,{detail})} /></span>{src&&<><img onError={()=>setFailed(true)} hidden={failed} data-facility-photo={key} src={src} alt={t(item.photo.kind==='registered'?'registeredPhoto':'examplePhoto')+' '+(item.name[locale]||item.name.ko)} loading="lazy" width="320" height="200" /><span id={key+'-badge'} className="photo-credit" hidden={failed}>{t(item.photo.kind==='registered'?'registeredPhoto':'examplePhoto')}</span></>}</div>;
}
export function FacilityName({item,locale}){
 const korean=item.name.ko, translated=item.name[locale]||item.name.en;
 return locale!=='ko'&&translated&&translated!==korean?<>{translated} <span lang="ko">({korean})</span></>:<span lang="ko">{korean}</span>;
}
export function StatusBadge({item,t,locale,checkingHours}){return item.status==='unknown'?<span className="facility-status status-unknown">{checkingHours?t('hoursLoading'):phrase(locale,'Hours unavailable')}</span>:<span className={'facility-status status-'+item.status}><i aria-hidden="true" />{t(item.type==='pharmacy'?(item.status==='open'?'pharmacyOpen':'pharmacyClosed'):item.status)}</span>;}
function distanceLabel(state,item,t){
 if(item.source!=='kakao')return t('sampleDistance')+' '+item.distance.toFixed(1)+' km';
 const km=facilityDistanceKm(state,item);if(km===null)return t('liveDistanceUnknown');
 const entry=routeEntry(state,item);return entry?.phase==='ready'?t('travel'+state.routing.mode)+' '+routeDistance(entry.data.distanceMeters):t('straightDistance')+' '+routeDistance(km*1000);
}
export function FacilityMeta({state,item,t}){return <div className="facility-meta"><span className="facility-category">{state.locale==='ko'&&item.source==='kakao'&&item.categoryLabel?item.categoryLabel:t(item.department||'other')}</span><span className="facility-travel">{distanceLabel(state,item,t)}</span></div>;}
export function Reasons({state,item,t}){return state.search.criteria.sort==='recommended'?<div className="match-reasons">{recommendationReasons(item,state.search.criteria).map(key=><span key={key}>{t(key)}</span>)}</div>:null;}
export function FacilityCard({state,item,index,focusedId,t}){
 const isLive=state.source==='live',selected=focusedId===item.id;
 return <article className={'facility-card'+(selected?' is-selected':'')} data-card={item.id} tabIndex={0} role="group" aria-label={(item.name[state.locale]||item.name.ko)+' '+t('cardFocus')}><div className="facility-card-top"><span className="result-number">{state.search.criteria.sort==='recommended'?t(isLive?'liveRank':'rankLabel')+' ':''}{index+1}</span><StatusBadge item={item} t={t} locale={state.locale} checkingHours={item.source==='kakao'&&state.live.hoursPhase==='loading'} /><FavoriteButton state={state} item={item} /></div><div className="facility-card-content"><div className="facility-card-copy"><h3><FacilityName item={item} locale={state.locale} /></h3><FacilityMeta state={state} item={item} t={t} /><p className="facility-area">{(item.area[state.locale]||item.area.ko)}</p></div><FacilityPhoto item={item} t={t} locale={state.locale} /></div><Reasons state={state} item={item} t={t} />{item.source==='kakao'&&<button className="facility-route-button" data-facility={item.id} data-route-jump=""><Icon name="location" />{t('routeAction')}</button>}<button className="facility-detail-button" data-facility={item.id} aria-pressed={selected}>{t(selected?'selected':'detail')}<Icon name="chevron" /></button></article>;
}
export const hasHours=item=>!!item?.schedule?.some(slot=>formatSlot(slot));
export function WeeklyHours({schedule,locale,t,now=new Date()}){
 // 공휴일에는 요일 대신 '공휴일' 줄이 오늘이다(운영 여부 판단과 같은 기준, public-hours.mjs)
 const weekday=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',weekday:'short'}).format(now),today=isPublicHoliday(now)===true?8:{Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7}[weekday];
 const labels=locale==='ko'?['','월','화','수','목','금','토','일','공휴일']:['','Mon','Tue','Wed','Thu','Fri','Sat','Sun','Holiday'].map(value=>value?phrase(locale,value):'');
 return <div className="weekly-hours">{schedule.map((slot,i)=><span key={slot.day+':'+i} className={slot.day===today?'is-today':undefined} aria-current={slot.day===today?'date':undefined}>{labels[slot.day]} {formatSlot(slot)||t('unknown')}</span>)}</div>;
}
export function NearerHospitals({state,active,items,t}){
 if(state.source!=='live'||active.type!=='hospital')return null;
 const matches=nearerOpenHospitals(state,active,[...items,...alternativeItems(state)]);let key='';
 if(!matches.length){if(!comparisonDepartments(state,active).length)key='nearerDepartmentMissing';else if(!state.live.position)key='nearerLocationMissing';else if(!state.live.routingConfigured)key='nearerRouteMissing';else if(state.live.hoursConfigured===false)key='nearerHoursMissing';else if(state.discovery?.phase==='loading')key='nearerLoading';else if(state.discovery?.phase==='error')key='nearerFailed';else if(state.discovery?.phase==='ready'){const entry=routeEntry(state,active),pending=[active,...alternativeItems(state)].some(item=>!routeEntry(state,item));key=entry?.phase==='error'?'nearerRouteMissing':pending?'nearerLoading':'nearerEmpty';}if(!key)return null;}
 return <section className="nearer-hospitals" aria-labelledby="nearer-heading"><h3 id="nearer-heading">{t('nearerTitle')}</h3>{matches.length?<><p>{t('nearerHours')}</p>{matches.map(match=><button key={match.item.id} type="button" className="nearer-hospital" data-facility={match.item.id}><strong>{match.item.name[state.locale]||match.item.name.ko}</strong><span>{match.departments.map(key=>t(key)).join(', ')} / {routeDistance(match.distanceMeters)}</span><small>{routeDistance(match.savedMeters)} {t('nearerDifference')}</small></button>)}</>:<><p role="status">{t(key)}</p>{state.discovery?.phase==='error'&&<button type="button" className="text-button" id="nearer-retry">{t('liveRetry')}</button>}</>}</section>;
}
export function FacilityDetail({state,item,results,t,standalone=false}){
 const live=state.source==='live',prefix=item.type==='pharmacy'?'pharmacy':'hospital',address=facilityAddress(item,'ko'),translatedAddress=state.locale==='ko'?'':item.localizedAddress?.[state.locale]||(item.source!=='kakao'?facilityAddress(item,state.locale):''),jibun=item.jibunAddress&&item.jibunAddress!==address,open=state.routing?.openId===item.id;
 const missing=item.hoursError==='hoursNotMatched'?prefix+'HoursNotMatched':item.hoursError==='hoursScheduleMissing'?prefix+'HoursScheduleMissing':prefix+'HoursUnknown';
 const copy=field=><button type="button" className="facility-copy" data-copy-facility={field} data-copy-id={item.id} aria-label={field==='address'?phrase(state.locale,'Copy Korean address'):t('copyPhone')} title={field==='address'?phrase(state.locale,'Copy Korean address'):t('copyPhone')}><Icon name="copy" /></button>;
 return <section className="facility-detail" aria-labelledby="detail-heading"><div className="detail-toolbar"><span>{t('detailTitle')}</span>{!standalone&&<button id="close-detail" className="text-button" aria-label={t('close')}><Icon name="back" />{t('backResults')}</button>}</div><div className="detail-main"><div className="facility-detail-heading"><div className="facility-heading-copy"><span className="detail-sample">{t(live?'liveProvider':'sampleTag')}</span><h2 id="detail-heading" tabIndex={-1}><FacilityName item={item} locale={state.locale} /> <FavoriteButton state={state} item={item} /></h2><FacilityMeta state={state} item={item} t={t} /><StatusBadge item={item} t={t} locale={state.locale} checkingHours={item.source==='kakao'&&state.live.hoursPhase==='loading'} /></div><FacilityPhoto item={item} t={t} detail locale={state.locale} /></div><Reasons state={state} item={item} t={t} /><dl>
 <div><dt>{t('address')}</dt><dd><div className="detail-value-row"><span className="facility-address-text" lang={address?'ko':undefined}>{address||t('liveAddressMissing')}</span>{address&&copy('address')}</div>{translatedAddress&&translatedAddress!==address&&<small>{translatedAddress}</small>}{jibun&&<JibunAddress item={item} t={t} />}{item.locationHint&&<small className="facility-location-hint">{item.locationHint}</small>}<small>{live?'':t('sampleAddress')}</small></dd></div>
 <div><dt>{t('hours')}</dt><dd>{hasHours(item)?<><WeeklyHours schedule={item.schedule} locale={state.locale} t={t} /><small>{t(live?prefix+'HoursHint':'hoursHint')}</small></>:<><span>{live?t(missing):item.hours||t('hoursUnknown')}</span>{item.hoursError&&!['hoursNotMatched','hoursScheduleMissing'].includes(item.hoursError)&&<small>{t(item.hoursError)}</small>}{live&&<small>{t(prefix+'HoursContact')}</small>}</>}</dd></div>
 <div className="facility-phone-row"><dt>{t('phone')}</dt><dd><div className="detail-value-row"><span className="facility-phone-text">{live?item.phone||t('livePhoneMissing'):t('phoneMissing')}</span>{live&&item.phone&&copy('phone')}</div></dd></div><div><dt>{t('access')}</dt><dd>{item.access[state.locale]}</dd></div></dl>
 {item.source==='kakao'&&open&&<RoutePanel state={state} item={item} t={t} />}
 {item.source==='kakao'?<div className="detail-actions"><button id="route-toggle" className="primary-button" type="button" aria-expanded={open} aria-controls="facility-route-panel"><Icon name="location" />{t(open?'routeClose':'routeAction')}</button>{item.phone&&<a className="secondary-button" href={'tel:'+item.phone.replace(/[^\d+]/g,'')}><Icon name="phone" />{t('phoneAction')}</a>}<a className="text-button" href={item.placeUrl} target="_blank" rel="noopener noreferrer">{t('liveDetailLink')}<Icon name="external" /></a><p>{t('liveDetailsNote')}</p></div>:<div className="detail-actions"><button className="secondary-button" data-demo-action="">{t('phoneAction')}</button><button className="primary-button" data-demo-action="">{t('routeAction')}<Icon name="arrow" /></button><p>{t('detailsNote')}</p></div>}
 <NearerHospitals state={state} active={item} items={results} t={t} /></div></section>;
}

function JibunAddress({item,t}){
 const [open,setOpen]=useState(false);
 return <><button id="toggle-jibun" className="text-button facility-jibun-toggle" type="button" aria-expanded={open} aria-controls="facility-jibun" onClick={()=>setOpen(value=>!value)}><span id="jibun-toggle-label">{t(open?'hideJibun':'showJibun')}</span><Icon name="chevron" /></button><div id="facility-jibun" className="facility-jibun" hidden={!open}>{item.jibunAddress}</div></>;
}
