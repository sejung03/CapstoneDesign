import {FAVORITES_LIMIT} from '../favorites.mjs';
import {Icon} from './shared.jsx';
export function FavoriteButton({state,item}){
 const selected=!!state.favorites?.items.some(value=>value.id===item.id),label=state.locale==='ko'?(selected?'즐겨찾기 해제':'즐겨찾기 추가'):(selected?'Remove favorite':'Add favorite');
 return <button type="button" className={'favorite-button'+(selected?' is-favorite':'')} data-favorite={item.id} disabled={!!state.favorites?.pendingId||state.favorites?.phase==='loading'} aria-pressed={selected} aria-label={item.name[state.locale]+' '+label} title={label}><Icon name="star" /></button>;
}
export function Favorites({state}){
 const data=state.favorites;if(!data)return null;const ko=state.locale==='ko';
 return <section className="info-favorites" aria-labelledby="favorites-heading"><h2 id="favorites-heading">{ko?'즐겨찾는 병원과 약국':'Favorite hospitals and pharmacies'} <span className="favorite-count">{data.items.length}/{FAVORITES_LIMIT}</span></h2>{data.phase==='loading'&&<p role="status">{ko?'불러오는 중…':'Loading…'}</p>}{data.error&&<p role="alert">{ko?'즐겨찾기를 불러오거나 변경하지 못했어요. 다시 시도해 주세요.':'Could not load or update favorites. Please try again.'}<button id="favorites-retry" className="text-button">{ko?'다시 시도':'Retry'}</button></p>}{!data.items.length&&data.phase!=='loading'?<p>{ko?'다시 찾고 싶은 병원이나 약국의 별표를 눌러 보세요.':'Select the star on a hospital or pharmacy to find it again here.'}</p>:<ul>{data.items.map(item=><li key={item.id}><div><strong>{item.name[state.locale]||item.name.ko}</strong><small>{ko?(item.type==='pharmacy'?'약국':'병원'):(item.type==='pharmacy'?'Pharmacy':'Hospital')}</small>{item.address&&<p>{item.address}</p>}</div><button type="button" data-favorite-find={item.id} className="text-button">{ko?'찾기':'Find'}</button><FavoriteButton state={state} item={item} /></li>)}</ul>}</section>;
}
