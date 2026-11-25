// Browser-side helpers for choice counts (how often a signed-in user viewed directions / copied a phone number
// for a facility, and applied a department to a search). The server decides whether anything is recorded.
import {departmentCatalog} from './departments.mjs';
import {favoriteRecord} from './favorites.mjs';

// 'pharmacy' is a facility type in the catalog, not a department.
export const CHOICE_DEPARTMENT_KEYS=Object.freeze(departmentCatalog.map(item=>item.key).filter(key=>key!=='pharmacy'));
const countOf=value=>Number.isInteger(value)&&value>0&&value<=100000;

export function createChoices(){return {phase:'idle',facilities:[],departments:[],departmentsAvailable:true,personalization:true,busy:false,error:''};}

/** Only the fields the screen shows: facility ID, type, name and count. */
export function normalizeChoices(raw){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.facilities)||!Array.isArray(raw.departments)||raw.facilities.length>50||raw.departments.length>CHOICE_DEPARTMENT_KEYS.length)throw new TypeError('Invalid choices');
 const facilities=raw.facilities.map(item=>{if(!countOf(item?.count))throw new TypeError('Invalid facility count');const {id,type,name}=favoriteRecord({...item,address:''});return {id,type,name,count:item.count};});
 const departments=raw.departments.map(item=>{if(!CHOICE_DEPARTMENT_KEYS.includes(item?.key)||!countOf(item.count))throw new TypeError('Invalid department count');return {key:item.key,count:item.count};});
 return {facilities,departments,departmentsAvailable:raw.departmentsAvailable!==false,personalization:raw.personalization!==false};
}

/** The payload for one counted facility action. No address, coordinates or phone number. */
export function choiceFacility(item){const {id,type,name}=favoriteRecord(item);return {id,type,name};}

export function isChoiceDepartment(key){return CHOICE_DEPARTMENT_KEYS.includes(key);}

/** Department search options: frequently applied ones first (count order), then the catalog order. */
export function orderedDepartments(catalog,choices){
 if(!choices||choices.personalization===false||!choices.departments?.length)return catalog;
 const rank=new Map(choices.departments.map((item,index)=>[item.key,index]));
 return [...catalog.filter(item=>rank.has(item.key)).sort((a,b)=>rank.get(a.key)-rank.get(b.key)),...catalog.filter(item=>!rank.has(item.key))];
}
