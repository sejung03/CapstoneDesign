import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {emptyProfile} from '../profile.mjs';
import {createAccountSession,normalizeAccountSession} from '../account-session.mjs';
import {createHealthConsent} from '../health-consent.mjs';
import {createFavorites} from '../favorites.mjs';
import {copy} from '../copy.mjs';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const previous=Module._extensions['.jsx'];let Profile;
try{
 Module._extensions['.jsx']=(module,filename)=>{const compiled=swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});module._compile(compiled.code,filename);};
 ({Profile}=require(fileURLToPath(new URL('../components/profile.jsx',import.meta.url))));
}finally{if(previous)Module._extensions['.jsx']=previous;else delete Module._extensions['.jsx'];}
test('My information has no PDF button (moved to the chat card) and shows logout only for a verified account',()=>{
 const state={locale:'ko',profile:emptyProfile(),profileDraft:emptyProfile(),healthConsent:createHealthConsent(true),favorites:createFavorites(),report:{editing:false},account:createAccountSession()};
 const inspect=()=>new JSDOM(renderToStaticMarkup(React.createElement(Profile,{state,t:key=>copy.ko[key]})));
 let dom=inspect();assert.ok(dom.window.document.getElementById('account-open'));assert.equal(dom.window.document.getElementById('account-logout'),null);assert.equal(dom.window.document.getElementById('profile-pdf'),null);assert.equal(dom.window.document.getElementById('profile-report-open'),null);assert.equal(dom.window.document.querySelector('.conversation-report'),null);dom.window.close();
 state.account=normalizeAccountSession({authenticated:true,accountId:'server-account'});dom=inspect();assert.equal(dom.window.document.getElementById('account-open'),null);assert.ok(dom.window.document.getElementById('account-logout'));assert.match(dom.window.document.querySelector('.info-account').textContent,/로그인되어/);assert.ok(dom.window.document.getElementById('account-delete-open'));assert.equal(dom.window.document.getElementById('saved-behavior-heading'),null);assert.doesNotMatch(dom.window.document.body.textContent,/행동 온톨로지|개인화 설정|direct_setting/);dom.window.close();
 state.account={...state.account,phase:'loggingOut'};dom=inspect();assert.equal(dom.window.document.getElementById('account-logout').disabled,true);dom.window.close();
});

// 11/23: one PDF = saved health information + questionnaire summary (notes from My report), never unsaved drafts
test('PDF combines committed health fields (including age zero) with the questionnaire summary',()=>{
 const state={locale:'ko',profile:{...emptyProfile(),age:'0',allergies:'저장한 알레르기',medications:'복용약',history:'기저질환'},profileDraft:{...emptyProfile(),allergies:'저장하지 않은 내용'},healthConsent:createHealthConsent(true),favorites:createFavorites(),account:createAccountSession(),chat:{messages:[{text:'대화 원문'}]},draft:{symptom:'',onset:''},report:{saved:{notes:'분석서 메모'}}};
 const dom=new JSDOM(renderToStaticMarkup(React.createElement(Profile,{state,t:key=>copy.ko[key]})));
 const sheet=dom.window.document.querySelector('.health-print-sheet');assert.equal(sheet.querySelector('h1').textContent,'건강정보와 문진 정리');const health=sheet.querySelector('.care-print-health'),summary=sheet.querySelector('.care-print-summary');assert.equal(health.querySelectorAll('dt').length,5);assert.match(health.textContent,/만 0세/);assert.match(health.textContent,/저장한 알레르기/);assert.match(health.textContent,/복용약/);assert.match(health.textContent,/기저질환/);assert.doesNotMatch(sheet.textContent,/저장하지 않은 내용/);assert.equal(summary.querySelector('h2').textContent,'문진 정리');assert.match(summary.textContent,/분석서 메모/);dom.window.close();
});
