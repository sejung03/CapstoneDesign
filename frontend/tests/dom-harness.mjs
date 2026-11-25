import fs from 'node:fs';
import vm from 'node:vm';
import * as i18n from '../i18n.mjs';
import * as healthStorage from '../health-storage.mjs';
export function mountApp({storage=new Map(),source='demo'}={}){
 const nodes=[];const ids=new Map();let renders=0;const listeners=[];
 const datasetOf=attributes=>Object.fromEntries(Object.entries(attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));
 const attrs=source=>{const values={};for(const match of source.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g))values[match[1]]=match[2];for(const match of source.matchAll(/\b(data-[\w-]+)(?=\s|$)/g))if(!(match[1] in values))values[match[1]]='';return values;};
 class Element{
  constructor(tag='div',attributes={}){this.tagName=tag.toUpperCase();this.attributes=attributes;this.dataset=datasetOf(attributes);this.children=[];this.events=new Map();this.value=attributes.value||'';this.checked=false;this.scrollTop=0;this.scrollHeight=100;this.style={};this.hidden=false;this.textContent='';this.listeners=0;if(tag==='select')this.value=attributes.id==='sort'?'distance':'all';}
  addEventListener(type,handler){const all=this.events.get(type)||[];all.push(handler);this.events.set(type,all);this.listeners++;if(this===body&&this.listeners>15)throw new Error('Body event handlers accumulated');}
  emit(type,event={}){const e={target:this,preventDefault(){},...event};for(const handler of [...(this.events.get(type)||[])])handler(e);if(this!==body)body.emit(type,e);}
  click(){this.emit('click');}
  requestSubmit(){this.emit('submit');}
  focus(){document.activeElement=this;}
  scrollIntoView(){}
  setAttribute(name,value){this.attributes[name]=value;}
  removeAttribute(name){delete this.attributes[name];}
  append(...children){for(const child of children){this.children.push(child);if(!nodes.includes(child))nodes.push(child);if(child.attributes.id)ids.set(child.attributes.id,child);}}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  replaceChildren(...children){
   const remove=child=>{for(const nested of child.children)remove(nested);const index=nodes.indexOf(child);if(index>=0)nodes.splice(index,1);if(child.attributes.id)ids.delete(child.attributes.id);};
   this.children.forEach(remove);this.children=[];this.textContent='';this.append(...children);
  }
  querySelectorAll(selector){return select(selector,false);}
  get innerHTML(){return this.html||'';}
  set innerHTML(html){
   this.html=html;renders++;nodes.length=0;
   for(const key of [...ids.keys()])if(key!=='app')ids.delete(key);
   for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/gi)){
    const node=new Element(match[1],attrs(match[2]));node.checked=/\bchecked(?:\s|$)/.test(match[2]);node.hidden=/\bhidden(?:\s|$)/.test(match[2]);nodes.push(node);
    if(node.attributes.id)ids.set(node.attributes.id,node);
   }
   for(const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)){
    const node=ids.get(attrs(match[1]).id);
    const options=[...match[2].matchAll(/<option\b([^>]*)>/gi)];
    const option=options.find(item=>/\bselected(?:\s|$)/.test(item[1]))||options[0];
    if(node&&option)node.value=attrs(option[1]).value;
   }
   for(const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)){
    const node=ids.get(attrs(match[1]).id);
    if(node)node.value=match[2].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'\"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
   }
  }
 }
 const body=new Element('body');const app=new Element('div',{id:'app'});ids.set('app',app);
 const skip=new Element('a',{class:'skip-link'});
 function select(selector,includeBody=true){
  if(selector==='.skip-link')return [skip];
  let pool=includeBody?[body,...nodes]:nodes;
  if(selector.startsWith('#app '))return select(selector.slice(5),false);
  if(selector.includes('button'))pool=pool.filter(n=>n.tagName==='BUTTON');
  const data=selector.match(/\[data-([\w-]+)(?:="([^"]+)")?\]/);
  if(data){const key=data[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return pool.filter(n=>n.dataset[key]!==undefined&&(data[2]===undefined||n.dataset[key]===data[2]));}
  if(selector.startsWith('.'))return pool.filter(n=>(n.attributes.class||'').split(' ').includes(selector.slice(1)));
  if(selector==='h1')return pool.filter(n=>n.tagName==='H1');
  return [];
 }
 const document={createElement:tag=>new Element(tag),body,documentElement:{dataset:{},lang:''},getElementById:id=>ids.get(id)||null,querySelectorAll:selector=>select(selector),querySelector:selector=>select(selector)[0]||null,addEventListener:(...args)=>listeners.push(args),title:'',activeElement:null};
 const sandbox={document,console,AbortController,setTimeout:()=>1,clearTimeout(){},localStorage:{getItem(key){return storage.get(key)??null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},window:{scrollY:0,scrollTo(){},matchMedia(){return {matches:false};},confirm(){return true;}}};
 document.removeEventListener=(type,handler)=>{const index=listeners.findIndex(entry=>entry[0]===type&&entry[1]===handler);if(index>=0)listeners.splice(index,1);};
 Object.assign(sandbox,i18n,healthStorage);
 const context=vm.createContext(sandbox);
 const base=new URL('../',import.meta.url);
 let bundle=['account-session.mjs','favorites.mjs','health-updates.mjs','report-import.mjs','health-consent.mjs','workspace-model.mjs','departments.mjs','choices.mjs','facility-art.mjs','ui-icons.mjs','copy.mjs','routing.mjs','holiday-data.mjs','holidays.mjs','public-hours.mjs','live-data.mjs','kakao-client.mjs','profile.mjs','care-context.mjs','flow.mjs','facilities.mjs','facilities-view.mjs','chat-model.mjs','intake-data.mjs','voice-answer.mjs','discovery.mjs','emergency.mjs','emergency-picker.mjs','emergency-resources.mjs','assistant.mjs','pdf-offer.mjs','recommendations.mjs','intake-view.mjs','chat-view.mjs','report.mjs','app.js'].map(name=>fs.readFileSync(new URL(name,base),'utf8').replace(/^import .*;[\r]?$/gm,'').replace(/\bexport /g,'')).join('\n');
 // Catalog fixtures are test-only; production starts in live mode.
 if(source!==null)bundle+='\nstate.source='+JSON.stringify(source)+';';
 bundle+='\nconst disposeApp=mountMedicalApp();';
 vm.runInContext(bundle,context,{timeout:1500});
 return {document,body,app,storage,get renders(){return renders;},run:code=>vm.runInContext(code,context,{timeout:1500}),setGlobal:(name,value)=>{context[name]=value;}};
}
