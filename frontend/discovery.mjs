import {liveQueryKey} from './live-data.mjs';
import {departmentCatalog} from './departments.mjs';
import {evaluateSchedule} from './public-hours.mjs';
import {routeEntry,routeDistance} from './routing.mjs';
const compactSearchText=value=>String(value||'').toLocaleLowerCase().replace(/\s+/g,'');
export function facilityDepartments(item){
 return [...new Set([...(Array.isArray(item?.departments)?item.departments:[]),item?.department]
  .filter(key=>key!=='pharmacy'&&departmentCatalog.some(department=>department.key===key)))];
}
export function comparisonDepartments(state,active){
 const departments=facilityDepartments(active),selected=state.search.criteria.department;
 return selected&&selected!=='all'?(departments.includes(selected)?[selected]:[]):departments.length===1?departments:[];
}
export function alternativeKey(state,active){
 const departments=comparisonDepartments(state,active);
 if(state.source!=='live'||active?.type!=='hospital'||!departments.length||!state.live.position)return '';
 return JSON.stringify([state.live.queryKey,state.live.position.lat,state.live.position.lng,departments]);
}
export function alternativeItems(state){
 return state.discovery?.key&&state.discovery.key===alternativeKey(state,state.live.items.find(item=>item.id===state.search.selectedId)||state.discovery.items.find(item=>item.id===state.search.selectedId))?state.discovery.items:[];
}
export function nearerOpenHospitals(state,active,items,{now=new Date(),limit=3}={}){
 if(state.source!=='live'||active?.type!=='hospital'||!Number.isFinite(state.live?.searchedAt)||state.live.queryKey!==liveQueryKey(state.search.criteria))return [];
 const searchedAt=new Date(state.live.searchedAt);
 if(!Number.isFinite(searchedAt.getTime())||searchedAt>now)return [];
 const relevant=comparisonDepartments(state,active);
 if(!relevant.length)return [];
 const distance=item=>{
  const entry=routeEntry(state,item),meters=entry?.data?.distanceMeters;
  return entry?.phase==='ready'&&Number.isFinite(meters)&&meters>=0?meters:null;
 };
 const baseline=distance(active);
 if(baseline===null)return [];
 const found=new Map();
 for(const item of items){
  if(!item||item.type!=='hospital'||item.id===active.id||found.has(item.id))continue;
  const matches=facilityDepartments(item).filter(key=>relevant.includes(key));
  if(!matches.length||item.hoursError||!Array.isArray(item.schedule)||[item.status,item.hoursStatus,item.operatingStatus].some(value=>['unknown','stale'].includes(String(value||'').toLowerCase())))continue;
  if(evaluateSchedule(item.schedule,searchedAt).status!=='open'||evaluateSchedule(item.schedule,now).status!=='open')continue;
  const meters=distance(item);
  if(meters===null||meters>=baseline)continue;
  found.set(item.id,{item,departments:matches,distanceMeters:meters,savedMeters:baseline-meters});
 }
 return [...found.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.item.id.localeCompare(b.item.id)).slice(0,limit);
}
export function renderNearerHospitals(state,active,items,t,escape){
 if(state.source!=='live'||active?.type!=='hospital')return '';
 const matches=nearerOpenHospitals(state,active,[...items,...alternativeItems(state)]);
 if(!matches.length){
  let key='';
  if(!comparisonDepartments(state,active).length)key='nearerDepartmentMissing';
  else if(!state.live.position)key='nearerLocationMissing';
  else if(!state.live.routingConfigured)key='nearerRouteMissing';
  else if(state.live.hoursConfigured===false)key='nearerHoursMissing';
  else if(state.discovery?.phase==='loading')key='nearerLoading';
  else if(state.discovery?.phase==='error')key='nearerFailed';
  else if(state.discovery?.phase==='ready'){
   const entry=routeEntry(state,active);
   const pending=[active,...alternativeItems(state)].some(item=>!routeEntry(state,item));
   key=entry?.phase==='error'?'nearerRouteMissing':pending?'nearerLoading':'nearerEmpty';
  }
  if(!key)return '';
  return '<section class="nearer-hospitals" aria-labelledby="nearer-heading"><h3 id="nearer-heading">'+t('nearerTitle')+'</h3><p role="status">'+t(key)+'</p>'+(state.discovery?.phase==='error'?'<button type="button" class="text-button" id="nearer-retry">'+t('liveRetry')+'</button>':'')+'</section>';
 }
 return '<section class="nearer-hospitals" aria-labelledby="nearer-heading"><h3 id="nearer-heading">'+t('nearerTitle')+'</h3><p>'+t('nearerHours')+'</p>'+
 matches.map(match=>'<button type="button" class="nearer-hospital" data-facility="'+escape(match.item.id)+'"><strong>'+escape(match.item.name[state.locale]||match.item.name.ko)+'</strong><span>'+match.departments.map(key=>escape(t(key))).join(', ')+' / '+escape(routeDistance(match.distanceMeters))+'</span><small>'+escape(routeDistance(match.savedMeters))+' '+t('nearerDifference')+'</small></button>').join('')+'</section>';
}
export function searchSuggestions(value,state,t,{limit=6}={}){
 const text=String(value||'').trim().slice(0,80),needle=compactSearchText(text);
 if(!needle)return [];
 const words=text.split(/\s+/),tail=compactSearchText(words.at(-1)),prefix=words.slice(0,-1).join(' ');
 const choices=[];
 for(const item of departmentCatalog){
  let region=prefix,match=item.aliases.some(alias=>compactSearchText(alias).startsWith(tail));
  if(!match){
   const suffix=item.aliases.find(alias=>needle.endsWith(compactSearchText(alias)));
   if(suffix){const length=compactSearchText(suffix).length;region=text.slice(0,text.length-length).trim();match=true;}
  }
  if(!match)continue;
  const scope=region||String(state.search.criteria.region||'').trim();
  choices.push({kind:'department',label:[scope,t(item.key)].filter(Boolean).join(' '),value:scope,department:item.key,type:item.key==='pharmacy'?'pharmacy':'hospital'});
 }
 const records=state.source==='live'?state.live.items:[];
 const seen=new Set(),facilities=[];
 for(const item of records){
  if(!item?.id||seen.has(item.id))continue;
  const name=item.name?.[state.locale]||item.name?.ko||'',area=item.area?.[state.locale]||item.area?.ko||'';
  const specialties=facilityDepartments(item).map(key=>departmentCatalog.find(department=>department.key===key)?.aliases.join(' ')||'').join(' ');
  if(!name||!words.every(word=>compactSearchText(name+' '+area+' '+specialties).includes(compactSearchText(word))))continue;
  const query=[...String(item.area?.ko||'').trim().split(/\s+/).filter(Boolean).slice(0,2),name].join(' ').slice(0,80);
  seen.add(item.id);facilities.push({kind:'facility',label:name,value:query,description:area,type:['hospital','pharmacy'].includes(item.type)?item.type:'all',department:'all'});
 }
 return [...choices.slice(0,facilities.length?Math.min(3,limit):limit),...facilities].slice(0,limit);
}
let disposeSearchSuggestions=null;
const suggestionCache=new Map();
export function releaseSearchSuggestions(){disposeSearchSuggestions?.();disposeSearchSuggestions=null;}
export function bindSearchSuggestions(state,t,doc=document,{lookup=null}={}){
 const resume=doc.getElementById('search-region')?.getAttribute?.('aria-expanded')==='true';
 disposeSearchSuggestions?.();
 const input=doc.getElementById('search-region'),panel=doc.getElementById('search-suggestions');
 if(!input||!panel)return;
 let options=[],buttons=[],active=-1,composing=false,timer=null,controller=null,revision=0,disposed=false;
 const eventCleanups=[];
 const on=(node,type,handler)=>{node.addEventListener(type,handler);eventCleanups.push(()=>node.removeEventListener?.(type,handler));};
 const cancel=()=>{revision++;clearTimeout(timer);controller?.abort();};
 disposeSearchSuggestions=()=>{disposed=true;cancel();for(const cleanup of eventCleanups)cleanup();panel.replaceChildren();panel.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
 const alive=()=>!disposed&&doc.getElementById('search-region')===input;
 const close=()=>{
  cancel();
  panel.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');
  panel.setAttribute('aria-busy','false');active=-1;
 };
 const choose=index=>{
  const option=options[index];if(!option||!alive())return;
  input.value=option.value;state.draft.region=option.value;
  state.search.suggestionScope=option.kind==='department';
  state.type=option.type;state.search.department=option.department;
  doc.getElementById('facility-type').value=option.type;doc.getElementById('department').value=option.department;
  close();
  state.search.suggestionSubmitting=true;
  try{doc.getElementById('search-form').requestSubmit();}
  finally{state.search.suggestionSubmitting=false;}
 };
 const highlight=index=>{
  active=index;
  buttons.forEach((button,i)=>button.setAttribute('aria-selected',String(i===index)));
  if(index>=0)input.setAttribute('aria-activedescendant','search-suggestion-'+index);
  else input.removeAttribute('aria-activedescendant');
 };
 const show=(records=[])=>{
  panel.setAttribute('aria-busy','false');
  const pool={...state,live:{...state.live,items:[...state.live.items,...records]}};
  options=searchSuggestions(input.value,pool,t);buttons=[];panel.replaceChildren();
  options.forEach((option,index)=>{
   const button=doc.createElement('button');
   button.type='button';button.tabIndex=-1;button.className='search-suggestion';
   button.setAttribute('id','search-suggestion-'+index);button.setAttribute('role','option');button.setAttribute('aria-selected','false');
   const title=doc.createElement('span');title.textContent=option.label;
   const subtitle=doc.createElement('small');subtitle.textContent=option.description||t('suggestionDepartment');
   button.append(title,subtitle);
   button.addEventListener('pointerdown',event=>event.preventDefault());
   button.addEventListener('click',()=>choose(index));
   panel.append(button);buttons.push(button);
  });
  panel.hidden=!options.length;input.setAttribute('aria-expanded',String(!!options.length));highlight(-1);
 };
 const update=()=>{
  if(!alive())return;
  cancel();state.draft.region=input.value.slice(0,80);
  const query=input.value.trim(),point=state.live.position||state.search.criteria.center;
  const key=JSON.stringify([query,point?.lat,point?.lng]),cached=suggestionCache.get(key);
  const usable=cached&&cached.expires>Date.now();
  show(usable?cached.items:[]);
  if(!lookup||query.length<2||usable)return;
  panel.setAttribute('aria-busy','true');
  if(!options.length){panel.textContent=t('suggestionsLoading');panel.hidden=false;input.setAttribute('aria-expanded','true');}
  const token=revision;
  timer=setTimeout(async()=>{
   if(!alive()||token!==revision)return;
   const abort=new AbortController();controller=abort;
   try{
    const items=await lookup(query,{center:point,signal:abort.signal});
    if(!alive()||token!==revision||abort.signal.aborted||input.value.trim()!==query)return;
    if(suggestionCache.size>=20)suggestionCache.delete(suggestionCache.keys().next().value);
    suggestionCache.set(key,{items,expires:Date.now()+30000});show(items);
    if(!options.length){panel.textContent=t('suggestionsEmpty');panel.hidden=false;input.setAttribute('aria-expanded','true');}
   }catch{
    if(alive()&&token===revision&&!abort.signal.aborted){show();if(!options.length){panel.textContent=t('suggestionsFailed');panel.hidden=false;input.setAttribute('aria-expanded','true');}}
   }
  },300);
 };
 on(input,'focus',()=>{if(!state.search.suggestionSubmitting)update();});
 on(input,'input',event=>{
  state.search.suggestionScope=false;
  update();
 });
 on(input,'compositionstart',()=>{composing=true;});
 on(input,'compositionend',()=>{composing=false;state.search.suggestionScope=false;update();});
 on(input,'keydown',event=>{
  if(composing||event.isComposing||event.keyCode===229)return;
  if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation?.();close();return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){
   if(panel.hidden)update();
   if(!options.length)return;
   event.preventDefault();
   highlight(event.key==='ArrowDown'?(active+1)%options.length:(active<=0?options.length:active)-1);
  }else if(event.key==='Enter'&&!panel.hidden&&active>=0){event.preventDefault();event.stopPropagation?.();choose(active);}
 });
 on(doc.getElementById('search-form'),'focusout',event=>{
  if(event.relatedTarget!==input&&!panel.contains(event.relatedTarget))close();
 });
 // React preserves focused inputs across request-driven renders. Resume the
 // active lookup after rebinding rather than leaving its cancelled popup idle.
 if(resume&&doc.activeElement===input&&input.value.trim()&&!state.search.suggestionSubmitting)update();
}
