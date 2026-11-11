import {normalizeAge} from './profile.mjs';
export const healthUpdateFields=['age','allergies','medications','history'];
export function createHealthUpdates(){return {phase:'idle',items:[],baseline:{},contentKey:'',revision:0};}
export function normalizeHealthUpdates(raw){
 const fail=()=>{throw new TypeError('Invalid health updates');};
 if(!Array.isArray(raw)||raw.length>4)return fail();
 const ids=new Set(),fields=new Set();
 return raw.map(item=>{
  if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(item.id)||ids.has(item.id)||!healthUpdateFields.includes(item.field)||fields.has(item.field)||!['set','clear'].includes(item.operation))return fail();
  if(typeof item.value!=='string'||item.value.length>500||(item.operation==='clear'?item.value!=='':!item.value.trim()))return fail();
  if(item.operation==='set'&&item.field==='age'&&normalizeAge(item.value)==='')return fail();
  const e=item.evidence;if(!e||!['message','intake','intakeNote','followup'].includes(e.kind)||typeof e.quote!=='string'||!e.quote.trim()||e.quote.length>500)return fail();
  let evidence;
  if(e.kind==='message'){
   if(!Number.isInteger(e.index)||e.index<0||e.index>10000)return fail();
   evidence={kind:e.kind,index:e.index,quote:e.quote};
  }else if(e.kind==='intakeNote'){evidence={kind:e.kind,quote:e.quote};}
  else{
   if(typeof e.questionId!=='string'||!e.questionId||e.questionId.length>80)return fail();
   evidence={kind:e.kind,questionId:e.questionId,quote:e.quote};
  }
  ids.add(item.id);fields.add(item.field);return {id:item.id,field:item.field,operation:item.operation,value:item.value.trim(),evidence};
 });
}
export function validateHealthUpdateEvidence(items,state){
 for(const item of items){
  const e=item.evidence;let sources=[];
  if(e.kind==='message')sources=[state.chat.messages.filter(message=>message.role==='user')[e.index]?.text];
  else if(e.kind==='intakeNote')sources=[state.chat.intakeContext?.symptom];
  else{
   const answers=e.kind==='intake'?state.chat.intakeContext?.answers:state.assistant?.answers;
   const answer=answers?.find(value=>value.questionId===e.questionId);
   if(answer?.value!==null&&answer?.value!==undefined){sources=answer.type==='text'?[answer.value]:Object.values(answer.optionLabel||{});}
  }
  if(!sources.some(value=>typeof value==='string'&&value.includes(e.quote)))throw new TypeError('Invalid health update evidence');
 }
 return items;
}
export function applyHealthUpdateSelection(batch,selection,profile,draft){
 if(batch.phase!=='pending'||!Array.isArray(selection.ids)||!selection.ids.length||selection.ids.length>4||new Set(selection.ids).size!==selection.ids.length)throw Error('invalid');
 const patch={};
 for(const id of selection.ids){
  const item=batch.items.find(value=>value.id===id);if(!item)throw Error('invalid');
  const before=batch.baseline[item.field]||'';
  if((profile[item.field]||'')!==before||(draft[item.field]||'')!==before)throw Error('conflict');
  const value=item.operation==='clear'?'':selection.values?.[id];
  if(typeof value!=='string'||value.length>500||(item.operation==='set'&&!value.trim())||(item.field==='age'&&item.operation==='set'&&normalizeAge(value)===''))throw Error('invalid');
  patch[item.field]=item.field==='age'&&value!==''?normalizeAge(value):value.trim();
 }
 return {profile:{...profile,...patch},draft:{...draft,...patch}};
}
