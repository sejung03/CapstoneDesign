import {phrase,localizedObject} from '../i18n.mjs';
// My info: how often the signed-in user viewed directions / copied a phone number per facility,
// and applied each department to a search. Shown only to the account owner; the delete button removes both.
export function ChoiceHistory({state,t}){
 const data=state.choices;if(!data||data.phase==='idle')return null;
 const empty=!data.facilities.length&&!data.departments.length;
 return <section className="info-favorites info-choices" aria-labelledby="choices-heading">
  <h2 id="choices-heading">{phrase(state.locale,"Frequently used places and departments")}</h2>
  <p>{phrase(state.locale,"We count directions views and phone-number copies for each place, and use them to show a place first among equally suitable results.")}</p>
  <p>{phrase(state.locale,"Departments you applied to a search are counted only with health information storage consent.")}</p>
  {data.phase==='loading'&&<p role="status">{phrase(state.locale,"Loading…")}</p>}
  {data.error&&<p role="alert">{phrase(state.locale,"Could not load or delete records. Please try again.")}<button id="choices-retry" type="button" className="text-button">{phrase(state.locale,"Retry")}</button></p>}
  {data.phase==='ready'&&empty&&<p>{phrase(state.locale,"No records yet.")}</p>}
  {data.facilities.length>0&&<><h3>{phrase(state.locale,"Hospitals and pharmacies")}</h3><ul>{data.facilities.map(item=><li key={item.id}><div><strong>{item.name[state.locale]||item.name.ko}</strong><small>{localizedObject((item.type==='pharmacy'?'Pharmacy':'Hospital'),state.locale)}</small></div><span className="choice-count">{phrase(state.locale,"{0} times",[item.count])}</span></li>)}</ul></>}
  {data.departments.length>0&&<><h3>{phrase(state.locale,"Departments applied to searches")}</h3><ul>{data.departments.map(item=><li key={item.key}><div><strong>{t(item.key)}</strong></div><span className="choice-count">{phrase(state.locale,"{0} times",[item.count])}</span></li>)}</ul></>}
  {!empty&&<button id="choices-clear" type="button" className="text-button danger" disabled={data.busy}>{phrase(state.locale,"Delete records")}</button>}
 </section>;
}
