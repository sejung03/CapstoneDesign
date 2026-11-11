import {useLayoutEffect,useRef} from 'react';
import {uiIcon} from '../ui-icons.mjs';
// Only repository-owned SVG artwork goes through this boundary. User/API text
// is always rendered as React text, never passed to dangerouslySetInnerHTML.
export const escapeText=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function Artwork({markup}){
 const [,attributes,body]=markup.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/)||[];
 if(body===undefined)return null;
 const props={};
 for(const [,name,value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g))props[name==='class'?'className':name]=value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
 return <svg {...props} dangerouslySetInnerHTML={{__html:body}} />;
}
export function Icon({name}){return <Artwork markup={uiIcon(name)} />;}
// The controller captures drafts before every render. Synchronize values after
// commit without remounting focused fields or interrupting Korean composition.
export function Textarea({id,value='',...props}){
 const ref=useRef(null);useLayoutEffect(()=>{if(ref.current.value!==value)ref.current.value=value;});
 return <textarea ref={ref} id={id} defaultValue={value} {...props} />;
}
export function Input({id,value='',...props}){
 const ref=useRef(null);useLayoutEffect(()=>{if(ref.current.value!==value)ref.current.value=value;});
 return <input ref={ref} id={id} defaultValue={value} {...props} />;
}
export function Check({id,checked,...props}){
 const ref=useRef(null);useLayoutEffect(()=>{ref.current.checked=!!checked;});
 return <input ref={ref} id={id} type="checkbox" defaultChecked={checked} {...props} />;
}
export function Select({id,value,options,t,...props}){
 const ref=useRef(null);useLayoutEffect(()=>{if(ref.current.value!==value)ref.current.value=value;});
 return <select ref={ref} id={id} defaultValue={value} {...props}>{options.map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select>;
}
