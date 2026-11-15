import {Input} from './shared.jsx';

/** Visible only in the local development build. Values are demo data, never health/profile data. */
export function BehaviorDemo({state}) {
 const demo=state.behaviorDemo;
 if(!demo || demo.phase==='idle')return null;
 const ko=state.locale==='ko',busy=demo.busy||demo.phase==='loading';
 const settings=demo.settings,enabled=settings?.personalization_enabled!==false;
 const sortLabels=ko?{distance:'거리 우선',open:'운영 여부 우선',access:'접근성 우선'}:{distance:'Distance',open:'Open status',access:'Accessibility'};
 return <section className="behavior-demo-panel" aria-labelledby="behavior-heading">
  <header><div><h2 id="behavior-heading">{ko?'행동 온톨로지 · 개인화 설정':'Behavior ontology · Preferences'}</h2>
  <p>{ko?'개발 전용 가짜 계정 / 서버 메모리 저장소 (실제 DB·로그인 아님)':'Development-only fictional account / memory storage (not DB or login)'}</p></div>
  <button type="button" id="behavior-switch" className="secondary-button" disabled={busy||demo.phase!=='ready'}>{ko?`가짜 계정 ${demo.account.toUpperCase()} → ${demo.account==='a'?'B':'A'}`:`Demo ${demo.account.toUpperCase()} → ${demo.account==='a'?'B':'A'}`}</button></header>
  {demo.phase==='loading'&&<p role="status">{ko?'가짜 설정을 불러오는 중입니다…':'Loading fictional settings…'}</p>}
  {demo.phase==='error'&&<p role="alert">{ko?'모의 API 연결에 실패했습니다. 개발 서버를 확인해 주세요.':'Demo API failed. Check the development server.'} <button id="behavior-retry" type="button" className="text-button">{ko?'다시 시도':'Retry'}</button></p>}
  {demo.phase==='ready'&&<>
   {demo.notice&&<p role="status" className="behavior-demo-notice">{demo.notice}</p>}
   {demo.error&&<p role="alert" className="field-error">{ko?'설정 작업에 실패했습니다. 다시 시도해 주세요.':'Could not update demo settings.'}</p>}
   <div className="behavior-demo-fields">
    <label htmlFor="behavior-sort">{ko?'저장할 기본 정렬 선호':'Default sorting preference'}
     <select key={demo.account+'-'+(settings?.updated_at||'empty')} id="behavior-sort" defaultValue={demo.draft.preference} disabled={busy}>
      {['distance','open','access'].map(key=><option key={key} value={key}>{sortLabels[key]}</option>)}
     </select>
    </label>
    <label htmlFor="behavior-region">{ko?'저장할 기본 검색 지역':'Saved default search area'}
     <Input id="behavior-region" maxLength={80} value={demo.draft.region} disabled={busy} placeholder={ko?'예: 춘천시 (테스트에는 가상 지역 사용)':'e.g. Fictional Test District'} />
    </label>
   </div>
   <p className="behavior-demo-help">{ko?'위의 「저장」 버튼을 누를 때만 정렬 선호와 지역이 저장됩니다. 병원 검색창에서 일회성으로 변경한 지역은 저장되지 않습니다.':'Only Save stores preferences. Changing the search field once does not save it.'}</p>
   <div className="behavior-demo-actions">
    <button type="button" id="behavior-save" className="primary-button" disabled={busy}>{ko?'기본 설정 저장':'Save preferences'}</button>
    <button type="button" id="behavior-add-sample" className="secondary-button" disabled={busy}>{ko?'가상 병원 즐겨찾기 추가':'Add fictional favorite'}</button>
    <button type="button" id="behavior-apply-region" className="secondary-button" disabled={busy||!settings?.region}>{ko?'저장 지역을 검색창에 입력':'Use saved area in search'}</button>
   </div>
   <div className="behavior-demo-status">
    <div><strong>{ko?'개인화 선호 적용':'Preference personalization'}</strong><span>{enabled?(ko?'ON · 선호 신호 제공':'ON · preference signal available'):(ko?'OFF · 선호 신호 없음':'OFF · no preference signal')}</span></div>
    <button type="button" id="behavior-toggle" className="secondary-button" disabled={busy}>{enabled?(ko?'개인화 끄기':'Turn off'):(ko?'개인화 켜기':'Turn on')}</button>
   </div>
   <div className="behavior-demo-evidence" aria-live="polite">
    <strong>{ko?'온톨로지 신호·근거 확인':'Ontology signal / evidence'}</strong>
    <ul className="behavior-demo-statements" aria-label={ko?'저장한 온톨로지 진술':'Saved ontology statements'}>
      {(demo.statements||[]).map((entry,index)=><li key={entry.predicate+'-'+index}>
        <span>{entry.auxiliary} / {entry.predicate}</span>
        <strong>{String(entry.object)}</strong>
        <small>{entry.evidence.source==='direct_setting'?(ko?'근거: 직접 저장':'Evidence: directly saved'):(ko?'근거 정보 없음':'No saved evidence')}{entry.evidence.at?' · '+entry.evidence.at:''}</small>
      </li>)}
    </ul>
    {demo.signal?<><p>{ko?'정렬':'Sort'}: {sortLabels[demo.signal.sort]} · {ko?'저장 지역':'Area'}: {demo.signal.region||'-'} · {ko?'즐겨찾기 ID':'Favorite IDs'}: {demo.signal.favoriteIds.length}{ko?'개':' item(s)'}</p>
     <p>{ko?'추천 적용 이유: 아직 없음 (팀원 2의 실제 정렬 후 applied 생성)':'Ranking reasons: none yet (applied after actual team ranking)'}</p></>:
     <p>{ko?'현재 추천에 적용할 선호 신호가 없습니다. 저장값은 개인화 OFF 상태에서도 유지됩니다.':'No active preference signal. Values are retained when personalization is off.'}</p>}
   </div>
   <div className="behavior-demo-delete"><button type="button" id="behavior-delete" className="text-button danger" disabled={busy}>{ko?'검색 설정·즐겨찾기 전체 삭제':'Delete settings and favorites'}</button>
    <p>{ko?'가짜 계정의 search_setting과 favorite만 삭제합니다. 건강정보·문진·PDF는 대상이 아닙니다.':'Deletes only fictional search settings and favorites, not health information.'}</p></div>
  </>}
 </section>;
}
