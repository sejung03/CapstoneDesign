import {favoriteFirst} from '../favorites.mjs';
import {FavoriteButton} from './favorites.jsx';
import {recommendationOrder,recommendationSnapshot} from '../recommendations.mjs';
import {FacilityWorkspace} from './facility-workspace.jsx';
import {conversationFacilities} from '../workspace-model.mjs';
import {displayedFacilities} from '../live-data.mjs';
import {searchFacilities} from '../facilities.mjs';
import {FacilityPhoto,FacilityMeta,StatusBadge} from './facility.jsx';
import {Intake} from './intake.jsx';
import {Icon} from './shared.jsx';
export function ConversationIntake({state,t}){
 const open=!!state.workspace?.intake,ko=state.locale==='ko';
 if(!open&&(state.assistant?.connected||state.chat.intakeContext||!(state.chat.messages.length||state.reportImport.confirmed)))return null;
 const count=state.intakeQuestionnaire.questions.length,step=state.intakeStep||0;
 const progress=step<count?(ko?'질문 '+(step+1)+' / '+count:'Question '+(step+1)+' / '+count):step===count?(ko?'기타 사항':'Additional information'):(ko?'답변 확인':'Review answers');
 return <section className="conversation-intake" aria-label={t('conversationQuestions')}><div className="conversation-intake-heading"><div><strong>{ko?'문진':'Questionnaire'}</strong><span>{progress}</span></div><button id="start-intake" type="button" aria-expanded={open} aria-controls="intake-wizard" className="text-button">{ko?(open?'문진 접기':'문진 이어하기'):(open?'Hide questionnaire':'Continue questionnaire')}</button></div>{open&&<Intake state={state} t={t} />}</section>;
}
export function ConversationResults({state,t}){
 const live=state.live,ranking=state.recommendations,currentRanking=ranking?.key===recommendationSnapshot(state)?.key;
 if(!state.search.initialized||state.search.origin==='favorite')return null;
 const items=favoriteFirst(recommendationOrder(state,conversationFacilities(displayedFacilities(state,searchFacilities))),state.favorites?.items),expanded=['detail','route'].includes(state.workspace?.panel),anchor=state.workspace?.anchorId||state.search.selectedId,visible=expanded&&state.workspace?.resultIds?state.workspace.resultIds.map(id=>items.find(item=>item.id===id)).filter(Boolean):items.slice(0,3),loading=['loading','loadingMore'].includes(live.phase);
 return <section className="conversation-results" aria-labelledby="conversation-results-title"><div className="conversation-section-heading"><h3 id="conversation-results-title">{t('conversationResults')}</h3><button className="text-button" data-view="explore">{t('conversationAllResults')}<Icon name="chevron" /></button></div>
 {currentRanking&&ranking.phase==='loading'&&<p className="conversation-ranking-status" role="status">{state.locale==='ko'?'추천 순서를 정리하고 있어요.':'Preparing recommendations.'}</p>}
 {currentRanking&&ranking.phase==='error'&&<p className="conversation-ranking-status" role="status">{state.locale==='ko'?'추천 순서를 가져오지 못했어요. 검색 결과는 계속 볼 수 있어요.':'Recommendations are unavailable. Search results are still available.'}<button id="recommendations-retry" className="text-button">{t('liveRetry')}</button></p>}
 {loading?<p role="status">{t('liveLoading')}</p>:live.error?<div role="status"><p>{t(['searchTimeout','searchFailed'].includes(live.error)?live.error:'searchFailed')}</p><button id="live-retry" className="secondary-button">{t('liveRetry')}</button></div>:items.length?<><p className="conversation-result-count">{items.length} {t('countUnit')}</p>{visible.map(item=><article key={item.id} className="conversation-facility" data-conversation-facility={item.id}><div className="conversation-facility-top"><div><h4>{item.name[state.locale]} <FavoriteButton state={state} item={item} /></h4>{state.favorites?.items.some(value=>value.id===item.id)&&<span className="conversation-favorite-label">{state.locale==='ko'?'즐겨찾는 곳':'Favorite'}</span>}{item.recommendationReason&&<div className="conversation-recommendation"><strong>{state.locale==='ko'?'추천':'Recommended'}</strong><p>{item.recommendationReason[state.locale]||item.recommendationReason.ko}</p></div>}<StatusBadge item={item} t={t} /><FacilityMeta state={state} item={item} t={t} /></div><FacilityPhoto item={item} t={t} locale={state.locale} /></div><div className="conversation-card-actions"><button className="secondary-button" data-workspace-facility={item.id} aria-expanded={expanded&&anchor===item.id&&state.workspace.panel==='detail'}>{t('detail')}</button><button className="secondary-button" data-workspace-facility={item.id} data-workspace-route="" aria-expanded={expanded&&anchor===item.id&&state.workspace.panel==='route'}>{t('routeAction')}</button></div>{expanded&&anchor===item.id&&<div id="conversation-facility-panel" className="conversation-facility-expanded"><button id="inline-facility-close" className="text-button">{t('close')}</button><FacilityWorkspace state={state} t={t} /></div>}</article>)}<button id="conversation-map" className="conversation-map-button" data-view="explore"><Icon name="map" />{t('conversationMap')}</button></>:<p role="status">{live.phase==='queryRequired'?t('liveSearchHint'):live.hoursPhase==='loading'?t('hoursLoading'):state.locale==='ko'?'현재 등록된 운영시간으로 진료·영업 중인 곳을 확인하지 못했어요. 전체 결과에서 운영시간을 확인해 주세요.':'No currently open facilities could be confirmed from registered hours. Check all results for opening hours.'}</p>}
 </section>;
}
