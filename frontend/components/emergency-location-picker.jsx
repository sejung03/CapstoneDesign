import {useEffect,useRef,useState} from 'react';
import {mountEmergencyPicker,suggestEmergencyLocations} from '../emergency-picker.mjs';
import {lookupEmergencyAddress} from '../emergency.mjs';
export function EmergencyLocationPicker({state,onChange,mapOpen=false}){
 const e=state.emergency,ko=state.locale==='ko',key=state.live.key;
 const [query,setQuery]=useState(e.locationDraft||''),[candidates,setCandidates]=useState([]),[phase,setPhase]=useState('idle'),[error,setError]=useState(false),[mapPhase,setMapPhase]=useState('loading'),[active,setActive]=useState(-1);
 const node=useRef(null),map=useRef(null),onChangeRef=useRef(onChange),selected=useRef(''),lookup=useRef(null),sequence=useRef(0);
 onChangeRef.current=onChange;
 const point=e.selectedPoint||(!e.manualLocation?e.location.point:null);
 const pick=async value=>{
  lookup.current?.abort();const controller=new AbortController();lookup.current=controller;const token=++sequence.current;
  selected.current='';setQuery('');onChangeRef.current?.({draft:''});setCandidates([]);setPhase('idle');
  onChangeRef.current?.({point:value,address:'',source:'map'});
  const address=await lookupEmergencyAddress(key,value,{signal:controller.signal,selected:true});
  if(!controller.signal.aborted&&sequence.current===token)onChangeRef.current?.({point:value,address,source:'map'});
 };
 const pickRef=useRef(pick);pickRef.current=pick;
 useEffect(()=>{
  let cancelled=false,view;setMapPhase(key?'loading':'unavailable');
  if(mapOpen&&key)mountEmergencyPicker(node.current,key,{point,center:state.live.position,onSelect:value=>void pickRef.current(value),isCancelled:()=>cancelled}).then(value=>{if(cancelled){value?.dispose();return;}view=value;map.current=value;setMapPhase('ready');}).catch(()=>{if(!cancelled)setMapPhase('error');});
  return ()=>{cancelled=true;view?.dispose();map.current=null;lookup.current?.abort();sequence.current++;};
 },[key,mapOpen]);
 useEffect(()=>{map.current?.update(point);},[point?.lat,point?.lng,mapPhase]);
 useEffect(()=>{
  const controller=new AbortController();let cancelled=false;
  setActive(-1);
  if(query.trim().length<2||query===selected.current||!key){setCandidates([]);setPhase('idle');return ()=>controller.abort();}
  setCandidates([]);setPhase('loading');
  const timer=setTimeout(()=>suggestEmergencyLocations(key,query,{signal:controller.signal}).then(items=>{if(!cancelled){setCandidates(items);setPhase(items.length?'ready':'empty');}}).catch(()=>{if(!cancelled)setPhase('error');}),300);
  return ()=>{cancelled=true;clearTimeout(timer);controller.abort();};
 },[query,key]);
 const choose=item=>{
  lookup.current?.abort();sequence.current++;
  const text=[item.address,item.name!==item.address?item.name:''].filter(Boolean).join(' ');
  selected.current=text;setQuery(text);setCandidates([]);setPhase('idle');setError(false);
  onChangeRef.current?.({draft:text});onChangeRef.current?.({point:{lat:item.lat,lng:item.lng},address:text,source:'place'});
 };

 return <div className="emergency-location-picker"><form id="emergency-location-form" noValidate onSubmit={event=>{event.preventDefault();if(active>=0&&candidates[active]){choose(candidates[active]);return;}const value=query.trim().slice(0,400);setError(!value);if(value){lookup.current?.abort();sequence.current++;selected.current=value;setCandidates([]);setPhase('idle');onChangeRef.current?.({point:null,address:value,source:'text'});}}}>
 <label htmlFor="emergency-location-input">{ko?'주소나 건물명':'Address or building name'}</label><div className="emergency-location-entry"><input id="emergency-location-input" value={query} onInput={event=>{const value=event.target.value;setQuery(value);setError(false);onChangeRef.current?.({draft:value});}} onKeyDown={event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&candidates.length){event.preventDefault();setActive(value=>(value+(event.key==='ArrowDown'?1:-1)+candidates.length)%candidates.length);}if(event.key==='Escape'){setCandidates([]);setPhase('idle');}}} maxLength={400} autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={candidates.length>0} aria-controls="emergency-location-suggestions" aria-activedescendant={active>=0?'emergency-place-'+active:undefined} aria-invalid={error} placeholder={ko?'주소, 건물명 또는 주변 장소':'Address, building or landmark'} /><button type="submit" className="secondary-button">{ko?'직접 입력한 위치 사용':'Use typed location'}</button></div>
 {error&&<p className="field-error" role="alert">{ko?'주소나 건물명을 적어 주세요.':'Enter an address or building name.'}</p>}
 <ul id="emergency-location-suggestions" className="emergency-location-suggestions" role="listbox" aria-label={ko?'주소와 장소 검색 후보':'Address and place suggestions'} hidden={!candidates.length}>{candidates.map((item,index)=><li key={item.id+index} role="option" id={'emergency-place-'+index} aria-selected={active===index}><button type="button" tabIndex={-1} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)}><strong>{item.name}</strong><span>{item.address}</span></button></li>)}</ul>
 {['loading','empty','error'].includes(phase)&&<p className="emergency-note" role="status">{ko?{loading:'검색 후보를 찾고 있어요.',empty:'검색 후보가 없어요. 직접 입력하거나 지도에서 위치를 정해 주세요.',error:'검색 후보를 불러오지 못했어요. 직접 입력하거나 지도에서 위치를 정해 주세요.'}[phase]:{loading:'Finding locations…',empty:'No suggestions. Type your location or select it on the map.',error:'Suggestions are unavailable. Type your location or select it on the map.'}[phase]}</p>}
 </form>{mapOpen&&<><div className="emergency-map-picker"><div ref={node} id="emergency-location-map" className="emergency-map-canvas" role="group" aria-label={ko?'신고할 위치 선택 지도':'Map for choosing your location'} />{mapPhase!=='ready'&&<p className="emergency-map-status" role="status">{ko?(mapPhase==='loading'?'지도를 불러오고 있어요.':'지도를 불러올 수 없어요. 주소나 건물명을 직접 입력해 주세요.'):(mapPhase==='loading'?'Loading map…':'Map unavailable. Enter an address or building name.')}</p>}</div>
 <p className="emergency-note">{ko?'지도를 움직이거나 원하는 곳을 누르세요. 핀을 끌어서 위치를 조정할 수도 있어요.':'Move or tap the map, or drag the pin to adjust your location.'}</p><button id="emergency-map-center" type="button" className="secondary-button" disabled={mapPhase!=='ready'} onClick={()=>map.current?.selectCenter()}>{ko?'지도 중심을 내 위치로 선택':'Use map center as my location'}</button></>}

 </div>;
}
