
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProfile,persistProfile,emptyProfile,PROFILE_KEY,SETTINGS_KEY} from '../profile.mjs';
import {mountApp} from './dom-harness.mjs';
const storageFor=map=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
const profile={nickname:'Private name',age:'adult',region:'Chuncheon',preference:'open',allergies:'Private allergy',medications:'Private medicine',history:'Private history'};
const route=(ui,view)=>ui.run("navigate('"+view+"')");

test('Consent is off by default; opting in persists only search settings',()=>{
 const map=new Map(),storage=storageFor(map);
 assert.equal(loadProfile(storage).remember,false);
 assert.equal(persistProfile(storage,profile,true),true);
 assert.deepEqual(JSON.parse(map.get(SETTINGS_KEY)),{region:'Chuncheon',preference:'open'});
 assert.equal(map.has(PROFILE_KEY),false);
 const restored=loadProfile(storage);
 assert.equal(restored.remember,true);
 for(const key of ['nickname','age','allergies','medications','history'])assert.equal(restored.profile[key],'');
 assert.equal(restored.profile.region,'Chuncheon');
});
test('Legacy health storage is deleted; only search settings carry into the current visit without renewed consent',()=>{
 const map=new Map([[PROFILE_KEY,JSON.stringify(profile)]]),storage=storageFor(map);
 const restored=loadProfile(storage);
 assert.equal(map.has(PROFILE_KEY),false);assert.equal(map.has(SETTINGS_KEY),false);
 assert.equal(restored.remember,false);assert.equal(restored.profile.region,'Chuncheon');
 assert.equal(restored.profile.preference,'open');
 for(const key of ['nickname','age','allergies','medications','history'])assert.equal(restored.profile[key],'');
 assert.deepEqual(loadProfile(storage).profile,emptyProfile(),'Without consent migrated settings are not retained after reload');
});
test('Existing search settings take precedence over old storage and unexpected sensitive fields are scrubbed',()=>{
 const map=new Map([[PROFILE_KEY,JSON.stringify(profile)],[SETTINGS_KEY,JSON.stringify({...profile,region:'Seoul',symptom:'Private symptom',institutionId:'private'})]]);
 const restored=loadProfile(storageFor(map));
 assert.equal(restored.profile.region,'Seoul');assert.equal(map.has(PROFILE_KEY),false);
 assert.deepEqual(JSON.parse(map.get(SETTINGS_KEY)),{region:'Seoul',preference:'open'});
 assert.equal(restored.profile.history,'');
});
test('Malformed storage is removed without restoring health fields or claiming consent',()=>{
 for(const bad of ['{broken','null','[]','"text"']){
  const map=new Map([[PROFILE_KEY,bad],[SETTINGS_KEY,bad]]);
  const restored=loadProfile(storageFor(map));
  assert.deepEqual(restored.profile,emptyProfile());assert.equal(restored.remember,false);
  assert.equal(map.size,0);
 }
});
test('Opting out deletes both current and legacy storage',()=>{
 const map=new Map([[PROFILE_KEY,JSON.stringify(profile)],[SETTINGS_KEY,'{}']]);
 assert.equal(persistProfile(storageFor(map),profile,false),true);assert.equal(map.size,0);
});
test('Blocked legacy deletion is reported without restoring sensitive data',()=>{
 const map=new Map([[PROFILE_KEY,JSON.stringify(profile)]]);
 const restored=loadProfile({...storageFor(map),removeItem(){throw Error('blocked');}});
 assert.equal(restored.storageError,true);assert.equal(restored.remember,false);
 assert.deepEqual(restored.profile,emptyProfile());assert.equal(map.has(SETTINGS_KEY),false);
});
test('The settings save failure never falls back to storing the full health profile',()=>{
 const map=new Map([[PROFILE_KEY,JSON.stringify(profile)]]);
 assert.equal(persistProfile({...storageFor(map),setItem(){throw Error('quota');}},profile,true),false);
 assert.equal(map.has(PROFILE_KEY),false);assert.equal(map.has(SETTINGS_KEY),false);
});
test('UI migration retains the existing form, does not restore health fields, and requires consent for settings',()=>{
 const storage=new Map([[PROFILE_KEY,JSON.stringify(profile)]]),ui=mountApp({storage});
 route(ui,'profile');
 assert.equal(ui.document.getElementById('profile-region').value,'Chuncheon');
 assert.equal(ui.document.getElementById('profile-history').value,'');
 assert.equal(ui.document.getElementById('profile-nickname').value,'');
 assert.equal(ui.document.getElementById('profile-age').value,'');
 assert.equal(ui.document.getElementById('profile-remember').checked,false);
 assert.equal(storage.has(PROFILE_KEY),false);assert.equal(storage.has(SETTINGS_KEY),false);
 ui.document.getElementById('profile-history').value='Current-visit health';
 ui.document.getElementById('profile-remember').checked=true;
 ui.document.getElementById('profile-form').emit('submit');
 assert.deepEqual(JSON.parse(storage.get(SETTINGS_KEY)),{region:'Chuncheon',preference:'open'});
 route(ui,'report');assert.match(ui.app.innerHTML,/Current-visit health/);
 const reloaded=mountApp({storage});route(reloaded,'profile');
 assert.equal(reloaded.document.getElementById('profile-region').value,'Chuncheon');
 assert.equal(reloaded.document.getElementById('profile-history').value,'');
});
test('Theme/language changes preserve unsaved health input in memory without writing it to browser storage',()=>{
 const storage=new Map(),ui=mountApp({storage});route(ui,'profile');
 ui.document.getElementById('profile-allergies').value='Current allergy';
 ui.document.getElementById('theme').click();ui.document.getElementById('language').click();
 assert.equal(ui.document.getElementById('profile-allergies').value,'Current allergy');
 assert.equal(storage.has(SETTINGS_KEY),false);assert.equal(storage.has(PROFILE_KEY),false);
 assert.ok(![...storage.values()].some(value=>String(value).includes('Current allergy')));
});
