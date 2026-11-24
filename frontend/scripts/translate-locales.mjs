// Build-time translation of repository-owned UI strings only. No patient input.
import {readFileSync,writeFileSync} from 'node:fs';
import {generateOpenAiJson} from '../lib/openai-json.mjs';
const root=new URL('../',import.meta.url),source=JSON.parse(readFileSync(new URL('locales/source.json',root),'utf8'));
const catalogs=Object.fromEntries(['zh','vi','uz'].map(code=>[code,JSON.parse(readFileSync(new URL(`locales/${code}.json`,root),'utf8'))]));
const pending=Object.entries(source).filter(([key])=>Object.values(catalogs).some(dict=>!dict[key]));
if(!process.env.OPENAI_API_KEY)throw new Error('Set OPENAI_API_KEY in .env.local, then use node --env-file=.env.local scripts/translate-locales.mjs');
const placeholders=s=>[...s.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort().join(',');
// 11/23: Gemini → OpenAI gpt-6-luna (TRANSLATE_MODEL로 바꿀 수 있다). 출력 형식은 strict JSON 스키마로 강제한다.
const translationSchema={type:'object',additionalProperties:false,required:['translations'],properties:{translations:{type:'array',items:{type:'object',additionalProperties:false,required:['id','zh','vi','uz'],properties:{id:{type:'integer'},zh:{type:'string'},vi:{type:'string'},uz:{type:'string'}}}}}};
for(let offset=0;offset<pending.length;offset+=80){
 const batch=pending.slice(offset,offset+80);
 const prompt=`Translate the following repository-owned UI phrases for a Korean medical-facility FINDER, not a diagnosis service. No patient information is included. Return JSON {"translations":[{"id":0,"zh":"...","vi":"...","uz":"..."}]}. Translate every item into Simplified Chinese, Vietnamese and Uzbek LATIN script. Use clear concise respectful UI text. Preserve meaning, negation, conditions, consent optionality, emergency number 119, URLs, API identifiers, the literal confirmation token DELETE, PDF, and placeholders {0}, {1} exactly. Use Korean as context and English as the source key. Do not add medical advice or remove limitations. Do not change numbers. Items:\n`+JSON.stringify(batch.map(([en,ko],id)=>({id,en,ko})));
 const data=await generateOpenAiJson({apiKey:process.env.OPENAI_API_KEY,model:process.env.TRANSLATE_MODEL||'gpt-6-luna',input:prompt,schema:translationSchema,schemaName:'ui_translations',maxOutputTokens:16000});
 if(!Array.isArray(data.translations)||data.translations.length!==batch.length)throw new Error('Incomplete translation batch at '+offset);
 const seen=new Set();
 for(const item of data.translations){
  if(!Number.isInteger(item.id)||item.id<0||item.id>=batch.length||seen.has(item.id))throw new Error('Invalid translation ID');seen.add(item.id);
  const [key]=batch[item.id];
  for(const locale of ['zh','vi','uz']){
   const value=item[locale];if(typeof value!=='string'||!value.trim()||placeholders(value)!==placeholders(key))throw new Error('Invalid translation placeholders: '+key);
   if(key.includes('119')&&!value.includes('119'))throw new Error('Emergency number missing');
   catalogs[locale][key]=value;
  }
 }
 for(const code of ['zh','vi','uz'])writeFileSync(new URL(`locales/${code}.json`,root),JSON.stringify(catalogs[code],null,2)+'\n');
 console.log('Translated',Math.min(offset+batch.length,pending.length)+'/'+pending.length,'UI phrases');
}
