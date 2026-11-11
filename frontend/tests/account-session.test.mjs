import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccountSession} from '../account-session.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('account state comes from a validated server response, without storing tokens',()=>{
 assert.equal(normalizeAccountSession({authenticated:false,accessToken:'secret'}).phase,'guest');assert.deepEqual(normalizeAccountSession({authenticated:true,accountId:'a',accessToken:'secret'}),{phase:'authenticated',accountId:'a',error:''});
 for(const value of [{},null,{authenticated:'true'},{authenticated:true},{authenticated:true,accountId:'x'.repeat(121)}])assert.throws(()=>normalizeAccountSession(value));
});
test('logout waits for server acknowledgement and failure keeps the verified account and local data',async()=>{
 const ui=mountApp({source:null});ui.run('render=()=>{};state.workspace=createWorkspace();');
 await ui.run("setAccountAdapter({getSession:async()=>({authenticated:true,accountId:'a'}),logout:async()=>{throw Error('offline')}})");
 ui.run("state.profile.allergies='saved health';state.profileDraft={...state.profile};state.chat.messages=[{role:'user',text:'private'}];state.favorites.items=[{id:'keep'}]");
 await ui.run('logoutAccount()');assert.equal(ui.run('state.account.phase'),'authenticated');assert.equal(ui.run('state.account.error'),'logout');assert.equal(ui.run('state.profile.allergies'),'saved health');assert.equal(ui.run('state.favorites.items.length'),1);
 await ui.run("setAccountAdapter({getSession:async()=>({authenticated:true,accountId:'a'}),logout:()=>new Promise(resolve=>globalThis.finishLogout=resolve)})");
 const pending=ui.run('logoutAccount()');await tick();assert.equal(ui.run('state.account.phase'),'loggingOut');assert.equal(ui.run('state.profile.allergies'),'saved health');
 ui.run('finishLogout()');await pending;assert.equal(ui.run('state.account.phase'),'guest');assert.equal(ui.run('state.account.accountId'),null);assert.equal(ui.run('state.profile.allergies'),'');assert.equal(ui.run('state.profileDraft.allergies'),'');assert.equal(ui.run('state.chat.messages.length'),0);assert.equal(ui.run('state.favorites.items.length'),0);assert.equal(ui.storage.size,0);
});
test('a new page restores identity only from getSession, and an old session response cannot overwrite a new one',async()=>{
 const ui=mountApp({source:null});ui.run('render=()=>{};state.workspace=createWorkspace();');
 const old=ui.run("setAccountAdapter({getSession:()=>new Promise(resolve=>globalThis.oldSession=resolve),logout:async()=>{}})");await tick();
 await ui.run("setAccountAdapter({getSession:async()=>({authenticated:true,accountId:'new-account'}),logout:async()=>{}})");ui.run("oldSession({authenticated:true,accountId:'old-account'})");await old;assert.equal(ui.run('state.account.accountId'),'new-account');
 const next=mountApp({storage:ui.storage,source:null});next.run('render=()=>{};state.workspace=createWorkspace();');assert.equal(next.run('state.account.phase'),'guest');await next.run("setAccountAdapter({getSession:async()=>({authenticated:true,accountId:'new-account'}),logout:async()=>{}})");assert.equal(next.run('state.account.accountId'),'new-account');assert.equal(next.storage.size,0);
});
