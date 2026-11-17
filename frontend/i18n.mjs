import source from './locales/source.json' with {type:'json'};
import zh from './locales/zh.json' with {type:'json'};
import vi from './locales/vi.json' with {type:'json'};
import uz from './locales/uz.json' with {type:'json'};
export const locales=Object.freeze(['ko','en','zh','vi','uz']);
export const languageNames=Object.freeze({ko:'한국어',en:'English',zh:'简体中文',vi:'Tiếng Việt',uz:'O‘zbekcha'});
export const languageTags=Object.freeze({ko:'ko-KR',en:'en-US',zh:'zh-CN',vi:'vi-VN',uz:'uz-Latn-UZ'});
export const normalizeLocale=value=>locales.includes(value)?value:'ko';
const dictionaries={ko:source,zh,vi,uz};
export function phrase(locale,key,values=[]){
 const language=normalizeLocale(locale);
 const text=language==='en'?key:dictionaries[language]?.[key]??source[key]??key;
 return text.replace(/\{(\d+)\}/g,(match,index)=>values[index]===undefined?match:String(values[index]));
}
function translateTree(value,locale){
 if(typeof value==='string')return phrase(locale,value);
 if(Array.isArray(value))return value.map(item=>translateTree(item,locale));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,translateTree(item,locale)]));
 return value;
}
export function expandLocales(value){
 return {...value,...Object.fromEntries(['zh','vi','uz'].map(locale=>[locale,translateTree(value.en,locale)]))};
}
export function completeLocales(value){Object.assign(value,expandLocales(value));return value;}
export function localizedText(value,locale){
 if(typeof value==='string')return value;
 if(!value)return '';
 return value[normalizeLocale(locale)]||value.en&&phrase(locale,value.en)||value.ko||'';
}
export function localizedObject(value,locale){return translateTree(value,locale);}
export function localizedLabels(value,max=2000){
 const result={};
 if(!value||typeof value.ko!=='string'||!value.ko.trim()||value.ko.length>max)throw new TypeError('Invalid localized label');
 for(const locale of locales){if(value[locale]!==undefined){if(typeof value[locale]!=='string'||value[locale].length>max)throw new TypeError('Invalid localized label');result[locale]=value[locale];}}
 return result;
}
