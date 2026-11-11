import {displayedFacilities} from '../live-data.mjs';
import {searchFacilities} from '../facilities.mjs';
import {FacilityDetail,StatusBadge} from './facility.jsx';
import {RoutePanel} from './routing.jsx';
export function FacilityWorkspace({state,t}){
 const results=displayedFacilities(state,searchFacilities),item=results.find(item=>item.id===state.search.selectedId);
 if(!item)return <p role="status">{t('liveEmpty')}</p>;
 if(state.workspace.panel==='detail')return <FacilityDetail state={state} item={item} results={results} t={t} standalone />;
 return <section className="directions-workspace"><h2 tabIndex={-1}>{item.name[state.locale]}</h2><StatusBadge item={item} t={t} /><RoutePanel state={state} item={item} t={t} showMap /><button className="secondary-button" data-workspace-facility={item.id}>{t('detail')}</button></section>;
}
