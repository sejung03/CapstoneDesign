import {phrase,expandLocales,localizedObject} from '../i18n.mjs';
import {FAVORITES_LIMIT} from '../favorites.mjs';
import {Icon} from './shared.jsx';
export function FavoriteButton({state,item}){
 const selected=!!state.favorites?.items.some(value=>value.id===item.id),label=localizedObject((selected?'Remove favorite':'Add favorite'),state.locale);
 return <button type="button" className={'favorite-button'+(selected?' is-favorite':'')} data-favorite={item.id} disabled={!!state.favorites?.pendingId||state.favorites?.phase==='loading'} aria-pressed={selected} aria-label={(item.name[state.locale]||item.name.ko)+' '+label} title={label}><Icon name="star" /></button>;
}
export function Favorites({state}){
 const data=state.favorites;if(!data)return null;const ko=state.locale==='ko';
 return <section className="info-favorites" aria-labelledby="favorites-heading"><h2 id="favorites-heading">{phrase(state.locale,"Favorite hospitals and pharmacies")} <span className="favorite-count">{data.items.length}/{FAVORITES_LIMIT}</span></h2>{data.phase==='loading'&&<p role="status">{phrase(state.locale,"Loading…")}</p>}{data.error&&<p role="alert">{phrase(state.locale,"Could not load or update favorites. Please try again.")}<button id="favorites-retry" className="text-button">{phrase(state.locale,"Retry")}</button></p>}{!data.items.length&&data.phase!=='loading'?<p>{phrase(state.locale,"Select the star on a hospital or pharmacy to find it again here.")}</p>:<ul>{data.items.map(item=><li key={item.id}><div><strong>{item.name[state.locale]||item.name.ko}</strong><small>{localizedObject((item.type==='pharmacy'?'Pharmacy':'Hospital'),state.locale)}</small>{item.address&&<p>{item.address}</p>}</div><button type="button" data-favorite-find={item.id} className="text-button">{phrase(state.locale,"Find")}</button><FavoriteButton state={state} item={item} /></li>)}</ul>}</section>;
}
