import test from 'node:test';
import assert from 'node:assert/strict';
import {installDevConsole} from '../dev-console.mjs';
import {mountApp} from './dom-harness.mjs';
test('development console does not install unless explicitly enabled and removes only its own helper',()=>{
 const host={};installDevConsole(host,{})();assert.equal(host.medicalDev,undefined);
 const remove=installDevConsole(host,{}, {enabled:true});assert.equal(typeof host.medicalDev.login,'function');assert.throws(()=>installDevConsole(host,{},{enabled:true}));remove();assert.equal(host.medicalDev,undefined);
});
test('development login uses the normal account/logout controller and keeps mock favorites in memory only',async()=>{
 const ui=mountApp({source:null});ui.run('render=()=>{};state.workspace=createWorkspace();');
 const host={},dispose=installDevConsole(host,{setAccountAdapter:async adapter=>{ui.setGlobal('devAdapter',adapter);await ui.run('setAccountAdapter(devAdapter)');}},{enabled:true});
 try{
  await host.medicalDev.login();assert.equal(ui.run('state.account.accountId'),'dev-demo');
  ui.run("state.profile.allergies='test';state.profileDraft={...state.profile};state.live.items=[{id:'kakao-1',type:'hospital',name:{ko:'테스트의원'},area:{ko:'춘천'}}]");
  await ui.run("toggleFavorite('kakao-1')");assert.equal(ui.run('state.favorites.items.length'),1);
  await ui.run('logoutAccount()');assert.equal(ui.run('state.account.phase'),'guest');assert.equal(ui.run('state.profile.allergies'),'');assert.equal(ui.run('state.favorites.items.length'),0);
  await host.medicalDev.login();await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.run('state.favorites.items.length'),1);assert.equal(ui.storage.size,0);
  await assert.rejects(()=>host.medicalDev.login('bad name'));dispose();assert.equal(host.medicalDev,undefined);
 }finally{dispose();}
});
