import test from 'node:test';
import assert from 'node:assert/strict';
import {favoriteRecord,normalizeFavorites,favoriteFirst} from '../favorites.mjs';
import {displayedFacilities} from '../live-data.mjs';
import {conversationFacilities} from '../workspace-model.mjs';
import {mountApp} from './dom-harness.mjs';
const item={id:'kakao-1',type:'hospital',name:{ko:'테스트의원',en:'Test'},address:'테스트로 1'};
test('favorites store only institutional identity, not health inputs, operating claims or duplicates',()=>{
 const value=favoriteRecord({...item,patientName:'secret',status:'open',schedule:[1],messages:['private']});assert.deepEqual(value,item);assert.throws(()=>normalizeFavorites([item,item]));assert.throws(()=>favoriteRecord({...item,id:'<script>'}));
});
test('favorite filter keeps only current search candidates and priority never promotes a closed facility',()=>{
 const rows=[{...item,id:'other',status:'open',distance:1},{...item,status:'closed',distance:.1}];
 const state={source:'demo',search:{criteria:{},favoritesOnly:true},favorites:{items:[item]}};assert.deepEqual(displayedFacilities(state,()=>rows).map(x=>x.id),['kakao-1']);assert.deepEqual(favoriteFirst(conversationFacilities(rows),[item]).map(x=>x.id),['other']);
});
test('guest favorites toggle without browser storage; backend failures do not pretend a save',async()=>{
 const ui=mountApp({source:null});ui.run('render=()=>{};state.live.items=['+JSON.stringify(item)+'];');await ui.run("toggleFavorite('kakao-1')");assert.equal(ui.run('state.favorites.items.length'),1);await ui.run("toggleFavorite('kakao-1')");assert.equal(ui.run('state.favorites.items.length'),0);assert.equal(ui.storage.size,0);
 await ui.run("setFavoritesAdapter({list:async()=>[],set:async()=>{throw Error('failed')}},{scope:'account-a'})");await ui.run("toggleFavorite('kakao-1')");assert.equal(ui.run('state.favorites.items.length'),0);assert.equal(ui.run('state.favorites.error'),'update');
 await ui.run("setFavoritesAdapter({list:async()=>[],set:()=>new Promise(resolve=>globalThis.commit=resolve)},{scope:'account-b'})");const pending=ui.run("toggleFavorite('kakao-1')");assert.equal(ui.run('state.favorites.items.length'),0);assert.equal(ui.run('state.favorites.pendingId'),'kakao-1');ui.run('commit()');await pending;assert.equal(ui.run('state.favorites.items.length'),1);assert.equal(ui.storage.size,0);
});
test('late account favorite loads are ignored after switching scope or signing out',async()=>{
 const ui=mountApp({source:null});ui.run('render=()=>{};globalThis.release=null;setFavoritesAdapter({list:()=>new Promise(resolve=>release=resolve),set:async()=>{}},{scope:"account-a"});');
 await ui.run('setFavoritesAdapter(null,{scope:"guest"})');ui.run('release(['+JSON.stringify(item)+'])');await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.run('state.favorites.scope'),'guest');assert.equal(ui.run('state.favorites.items.length'),0);assert.equal(ui.storage.size,0);
});
test('20 favorites are allowed, the 21st is rejected without a write, and removing at the limit remains possible',async()=>{
 const items=Array.from({length:20},(_,index)=>({...item,id:'place-'+index}));assert.equal(normalizeFavorites(items).length,20);assert.throws(()=>normalizeFavorites([...items,{...item,id:'extra'}]));
 const ui=mountApp({source:null});ui.run('render=()=>{};state.favorites.items='+JSON.stringify(items)+';state.live.items=['+JSON.stringify({...item,id:'extra'})+'];');
 await ui.run("toggleFavorite('extra')");assert.equal(ui.run('state.favorites.items.length'),20);await ui.run("toggleFavorite('place-0')");assert.equal(ui.run('state.favorites.items.length'),19);await ui.run("toggleFavorite('extra')");assert.equal(ui.run('state.favorites.items.length'),20);assert.equal(ui.storage.size,0);
});
test('switching account scope drops guest favorites and clears health information rather than migrating it',async()=>{
 const ui=mountApp({source:null});ui.run('render=()=>{};viewRenderer=()=>{};state.workspace=createWorkspace();state.profile.allergies="guest health";state.profileDraft={...state.profile};state.favorites.items=['+JSON.stringify(item)+'];');
 await ui.run("setFavoritesAdapter({list:async()=>[],set:async()=>{}},{scope:'account-a'})");assert.equal(ui.run('state.favorites.items.length'),0);assert.equal(ui.run('state.profile.allergies'),'');assert.equal(ui.run('state.profileDraft.allergies'),'');assert.equal(ui.run('state.chat.messages.length'),0);assert.equal(ui.storage.size,0);
 await ui.run("setFavoritesAdapter(null,{scope:'guest'})");assert.equal(ui.run('state.favorites.items.length'),0);
});
