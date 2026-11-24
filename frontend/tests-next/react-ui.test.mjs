import test from 'node:test';
import assert from 'node:assert/strict';
import jsdom from 'jsdom';
const {JSDOM,VirtualConsole,requestInterceptor}=jsdom;
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const waitFor=async check=>{for(let i=0;i<150;i++){if(check())return;await delay(40);}assert.ok(check(),'UI did not reach expected state');};
const raw=code=>({id:code==='HP8'?'1':'2',place_name:code==='HP8'?'테스트내과':'테스트약국',category_group_code:code,category_name:code==='HP8'?'병원 > 내과':'약국',x:'127.75',y:'37.87',road_address_name:'강원특별자치도 춘천시 테스트로 1',address_name:'강원특별자치도 춘천시 효자동 1',phone:'033-123-4567'});
function mockSdk(window){
 const qa=window.__qa={maps:0,searches:[],copies:[],prints:0,routes:[],lines:0,mapInstances:[],mapEvents:[]};
 class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
 class Map{constructor(node,options){qa.maps++;this.node=node;this.center=options.center;this.level=options.level;qa.mapInstances.push(this);}addControl(){}setCenter(p){this.center=p;}getCenter(){return this.center;}setBounds(){}getLevel(){return this.level;}setLevel(l){this.level=l;}panTo(p){this.center=p;}relayout(){}}
 class Marker{constructor(options){Object.assign(this,options);}setPosition(p){this.position=p;}getPosition(){return this.position;}setMap(){}}
 class Overlay{setMap(){}}
 window.kakao={maps:{Map,LatLng,Marker,Polyline:class{constructor(){qa.lines++;}setMap(){}},CustomOverlay:Overlay,MarkerImage:class{},Size:class{},Point:class{},ZoomControl:class{},LatLngBounds:class{extend(){}},MarkerClusterer:class{clear(){}addMarkers(){}},ControlPosition:{RIGHT:1},event:{addListener(target,type,fn){qa.mapEvents.push({target,type,fn});},removeListener(target,type,fn){const i=qa.mapEvents.findIndex(e=>e.target===target&&e.type===type&&e.fn===fn);if(i>=0)qa.mapEvents.splice(i,1);}},services:{Status:{OK:'OK',ZERO_RESULT:'ZERO'},SortBy:{DISTANCE:'distance'},Geocoder:class{addressSearch(query,callback){queueMicrotask(()=>callback([{address_name:'춘천시 한림대학길 1',x:'127.73',y:'37.88'}],'OK'));}coord2Address(lng,lat,callback){queueMicrotask(()=>callback([{road_address:{address_name:'테스트로 1',building_name:'테스트아파트'}}],'OK'));}},Places:class{
  keywordSearch(query,callback,options){qa.searches.push(query);queueMicrotask(()=>callback(options.category_group_code?(qa.duplicateNames?[{...raw(options.category_group_code),id:'999',y:'38.57'},raw(options.category_group_code)]:[raw(options.category_group_code)]):[{id:'100',place_name:'한림대학교',road_address_name:'춘천시 한림대학길 1',x:'127.73',y:'37.88'}],'OK',{}));}
  categorySearch(code,callback){qa.searches.push(code);queueMicrotask(()=>callback([raw(code)],'OK',{}));}
 }}}};
 Object.defineProperty(window.navigator,'geolocation',{value:{getCurrentPosition(success){queueMicrotask(()=>success({coords:{latitude:37.87,longitude:127.74,accuracy:20}}));}}});
 Object.defineProperty(window.navigator,'clipboard',{value:{async writeText(text){qa.copies.push(text);}}});
 window.print=()=>{qa.prints++;};
}

test('React components preserve intake, search, maps, chat, report and privacy', {timeout:45000},async t=>{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'},stdio:'ignore'});
 let dom;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(60);}
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('error',e=>errors.push(String(e)));
  dom=await JSDOM.fromURL(base,{resources:{interceptors:[requestInterceptor(request=>request.url.startsWith('https://www.youtube-nocookie.com/')?new Response('<!doctype html><title>Mock player</title>',{headers:{'Content-Type':'text/html'}}):undefined)]},runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,beforeParse(window){
   mockSdk(window);
   window.fetch=(url,options)=>{
    const u=new URL(url,base);
    if(u.pathname==='/api/config')return Promise.resolve(Response.json({map:{configured:true,javascriptKey:'mock'},publicData:{configured:true},routing:{configured:true}}));
    if(u.pathname==='/api/route'){window.__qa.routes.push(u.search);return Promise.resolve(Response.json({distanceMeters:800,durationSeconds:600,steps:[],paths:[[[127.74,37.87],[127.75,37.87]]]}));}
    if(u.pathname==='/api/public-hours'){
     if(window.__qa.missingHours)return Promise.resolve(new Response('<response><header><resultCode>00</resultCode></header><body><items></items></body></response>'));
     const days=Array.from({length:8},(_,i)=>`<dutyTime${i+1}s>0000</dutyTime${i+1}s><dutyTime${i+1}c>2400</dutyTime${i+1}c>`).join('');
     const name=u.searchParams.get('name');
     return Promise.resolve(new Response(`<response><header><resultCode>00</resultCode></header><body><items><item><hpid>mock-${name}</hpid><dutyName>${name}</dutyName><dutyTel1>033-123-4567</dutyTel1><dutyAddr>강원특별자치도 춘천시 테스트로 1</dutyAddr><wgs84Lat>37.87</wgs84Lat><wgs84Lon>127.75</wgs84Lon>${days}</item></items></body></response>`));
    }
    return fetch(u,options);
   };
   window.confirm=()=>true;
   window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});window.scrollTo=()=>{};window.HTMLElement.prototype.scrollIntoView=()=>{};
   Object.assign(window,{TextEncoder,TextDecoder,ReadableStream,Request,Response,Headers});
  }});
  const w=dom.window,d=w.document,el=id=>d.getElementById(id),click=id=>{assert.ok(el(id),id);el(id).click();},submit=id=>el(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const language=code=>{el('language-select').value=code;el('language-select').dispatchEvent(new w.Event('change',{bubbles:true}));};
  const input=(id,value)=>{el(id).focus();el(id).value=value;el(id).dispatchEvent(new w.Event('input',{bubbles:true}));};
  await waitFor(()=>el('composer-attach'));
  assert.equal(w.medicalDev,undefined);assert.equal(el('intake-wizard'),null);assert.equal(el('workspace-panel'),null);assert.deepEqual([...d.querySelector('.header-actions').children].filter(node=>node.tagName!=='LABEL').map(node=>node.id||node.className),['language-select','header-nav','theme']);
  await t.test('welcome keeps one composer and an independent emergency action; attachment menu supports close and consent',async()=>{
   assert.ok(d.querySelector('.primary-chat.is-welcome'));assert.equal(w.getComputedStyle(el('chat-messages')).display,'none');
   assert.equal(el('open-explore'),null);assert.equal(el('start-intake'),null);assert.equal(el('start-health-chat'),null);assert.equal(el('start-report-import'),null);assert.equal(d.querySelectorAll('[data-conversation-starter]').length,4);assert.match(d.querySelector('[data-conversation-starter=pharmacy]').textContent,/약국/);assert.ok(el('emergency-open'));
   click('composer-attach');await delay(0);assert.ok(el('start-report-import'));assert.ok(el('start-report-paste'));assert.equal(el('health-consent-card'),null);
   el('start-report-paste').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await delay(0);assert.equal(el('composer-attachment-menu'),null);assert.equal(d.activeElement,el('composer-attach'));
   click('composer-attach');await delay(0);d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));await delay(0);assert.equal(el('composer-attachment-menu'),null);
   click('composer-attach');await delay(0);click('start-report-import');await delay(0);assert.ok(el('health-consent-card'));assert.equal(el('chat-consent-dialog'),null);assert.equal(el('previous-report-file'),null);assert.equal(el('composer-attachment-menu'),null);
   click('health-consent-close');assert.equal(el('health-consent-card'),null);assert.equal(el('intake-wizard'),null);
  });
  await t.test('login starts OAuth while signup consent is handled after verified authentication',async()=>{
   assert.equal(d.querySelector('.header-actions #account-open'),null);d.querySelector('.header-nav [data-view=profile]').click();assert.ok(el('account-open'));click('account-open');await waitFor(()=>el('account-dialog')?.open);
   assert.equal(d.querySelectorAll('.kakao-login-button').length,1);assert.equal(el('signup-continue').disabled,false);
   assert.equal(el('signup-terms'),null);assert.equal(el('signup-account'),null);
   assert.equal(el('account-heading').textContent,'로그인·회원가입');
   assert.equal(el('signup-selection-result'),null);assert.doesNotMatch(el('account-dialog').textContent,/가입.*완료|저장.*완료/);
   assert.equal(el('composer-input').readOnly,true);assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('signup-policy')));
   click('account-close');await waitFor(()=>!el('account-dialog'));assert.equal(d.activeElement,el('account-open'));
   click('account-open');await waitFor(()=>el('account-dialog')?.open);assert.equal(el('signup-continue').disabled,false);
   el('account-dialog').dispatchEvent(new w.Event('cancel',{bubbles:false,cancelable:true}));await waitFor(()=>!el('account-dialog'));click('workspace-close');
  });
  await t.test('guests enter health consent from My information; unsaved changes can be cancelled, discarded or explicitly saved',async()=>{
   d.querySelector('.header-profile').click();assert.equal(el('profile-age').disabled,true);click('profile-health-start');assert.ok(el('chat-consent-dialog')?.open);assert.equal(d.querySelectorAll('#health-consent-card').length,1);click('health-consent-close');assert.equal(el('profile-age').disabled,true);
   click('profile-health-start');click('health-consent-check');submit('health-consent-form');assert.equal(el('profile-age').disabled,false);
   input('profile-age','30');input('profile-allergies','저장하지 않은 값');await delay(0);assert.equal(el('profile-allergies').value,'저장하지 않은 값');assert.ok(d.querySelector('.profile-dirty'));
   click('workspace-close');assert.ok(el('profile-leave-save'));click('profile-leave-cancel');assert.equal(el('profile-allergies').value,'저장하지 않은 값');click('workspace-close');click('profile-leave-discard');assert.equal(el('workspace-panel'),null);
   d.querySelector('.header-profile').click();assert.equal(el('profile-allergies').value,'');assert.equal(el('profile-age').value,'');
   input('profile-age','1.5');submit('profile-form');assert.ok(d.querySelector('#profile-form [role=alert]'));input('profile-age','0');input('profile-allergies','저장한 값');submit('profile-form');assert.equal(d.querySelector('.profile-dirty'),null);click('workspace-close');assert.equal(el('profile-leave-save'),null);
   d.querySelector('.header-profile').click();assert.equal(el('profile-age').value,'0');input('profile-allergies','명시적으로 저장한 수정');click('workspace-close');click('profile-leave-save');assert.equal(el('workspace-panel'),null);d.querySelector('.header-profile').click();assert.equal(el('profile-allergies').value,'명시적으로 저장한 수정');
   assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('명시적으로 저장한 수정')));click('profile-delete');click('workspace-close');click('health-consent-open');click('health-consent-revoke');
  });
  await t.test('localized emergency help keeps Korean dialing and shows a Korean handoff',async()=>{
   for(const locale of ['en','zh','vi','uz']){
    language(locale);click('emergency-open');
    await waitFor(()=>el('emergency-card'));
    const call=el('emergency-card').querySelector('a[href="tel:119"]');
    assert.match(call.textContent,/119/);
    assert.equal(el('emergency-card').querySelector('a[href="tel:911"]'),null);
    assert.match(call.nextElementSibling.textContent,/Interpreter, please/);
    assert.match(d.querySelector('.emergency-reporting details [lang=ko]').textContent,/구급차/);
    click('emergency-close');
   }
   language('ko');
  });
  await t.test('Escape closes emergency help without leaving My information',async()=>{
   d.querySelector('.header-profile').click();
   const panel=el('workspace-panel');
   assert.ok(panel);
   assert.equal(d.querySelector('.skip-link').getAttribute('href'),'#workspace-panel');
   click('emergency-open');
   const dialog=el('emergency-dialog');
   assert.ok(dialog?.open);
   const escape=new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});
   el('emergency-close').dispatchEvent(escape);
   assert.equal(escape.defaultPrevented,false);
   // JSDOM does not dispatch the native dialog cancel event for Escape.
   dialog.dispatchEvent(new w.Event('cancel',{cancelable:true}));
   assert.equal(el('emergency-dialog'),null);
   assert.equal(el('workspace-panel'),panel);
   assert.equal(d.activeElement,el('emergency-open'));
   click('workspace-close');
   assert.equal(d.querySelector('.skip-link').getAttribute('href'),'#main');
  });
  await t.test('emergency shortcut offers 119 without auto calling, preserves input, and looks up location only on request',async()=>{
   assert.equal(el('composer-input').readOnly,true);click('emergency-open');assert.equal(el('emergency-open').getAttribute('aria-expanded'),'true');click('emergency-open');assert.equal(el('emergency-card'),null);assert.equal(el('emergency-open').getAttribute('aria-expanded'),'false');click('emergency-open');
   const emergencyButton=el('emergency-open');
   assert.equal(emergencyButton.parentElement.previousElementSibling,d.querySelector('.care-header'));
   assert.equal(el('composer-form').contains(emergencyButton),false);
   assert.equal(emergencyButton.getAttribute('aria-controls'),'emergency-dialog');
   assert.equal(d.querySelectorAll('#emergency-open').length,1);
   assert.equal(el('emergency-open').type,'button');
   assert.ok(el('emergency-dialog')?.open);assert.equal(el('chat-messages').contains(el('emergency-card')),false);assert.equal(d.querySelectorAll('[data-emergency-topic]').length,6);
   const call=el('emergency-card').querySelector('a[href="tel:119"]');
   assert.match(call.textContent,/119/);assert.equal(call.nextElementSibling.className,'emergency-reporting');assert.equal(call.nextElementSibling.querySelectorAll('li').length,3);
   assert.equal(el('emergency-card').querySelector('iframe'),null);
   for(const [topic,id] of Object.entries({aed:'b4XAPbxcEZk',choking:'dsiTtEImNmg',seizure:'aLNucite-Hw'})){
    d.querySelector('[data-emergency-topic='+topic+']').click();
    await waitFor(()=>d.querySelector('.emergency-video iframe')?.src.includes(id));
    const player=d.querySelector('.emergency-video iframe');
    assert.equal(new URL(player.src).pathname,'/embed/'+id);
    assert.equal(new URL(player.src).searchParams.get('autoplay'),'0');
    assert.equal(d.querySelectorAll('.emergency-video iframe').length,1);
    assert.equal(d.querySelector('.emergency-video button'),null);
   }
   for(const [topic,[article,id]] of Object.entries({bleeding:['5679','nsEqL5a0Evg'],burns:['6584','mCk_ffvJqAQ']})){
    d.querySelector('[data-emergency-topic='+topic+']').click();
    await waitFor(()=>d.querySelector('.emergency-guide-content a')?.href.endsWith('cntnts_sn='+article));
    assert.ok(d.querySelector('.emergency-guide-content ol li'));
    assert.equal(new URL(d.querySelector('.emergency-video iframe').src).pathname,'/embed/'+id);
   }
   assert.equal(el('emergency-location-map'),null);assert.equal(el('emergency-location-input'),null);assert.equal(w.__qa.maps,0);assert.equal(el('composer-input').value,'');
   assert.ok(d.querySelector('[data-emergency-topic="cpr"]'));
   d.querySelector('[data-emergency-topic=choking]').click();await delay(0);assert.match(d.querySelector('.emergency-guide-content').textContent,/성인 기도폐쇄/);assert.ok(d.querySelector('.emergency-guide-content iframe'));
   d.querySelector('[data-emergency-topic="cpr"]').click();await waitFor(()=>d.querySelector('.emergency-video'));
   assert.equal(el('emergency-location-map'),null);assert.equal(w.__qa.routes.length,0);
   await delay(80);click('emergency-locate');await waitFor(()=>d.querySelector('.emergency-address'));
   assert.match(d.querySelector('.emergency-address').textContent,/테스트아파트/);assert.equal(w.__qa.routes.length,0);
   click('emergency-location-edit');await waitFor(()=>el('emergency-location-form'));
   submit('emergency-location-form');await waitFor(()=>el('emergency-location-input').getAttribute('aria-invalid')==='true');
   input('emergency-location-input','한림대학교 정문 <img src=x>');await delay(0);submit('emergency-location-form');await waitFor(()=>el('emergency-manual-result')?.textContent.includes('한림대학교 정문'));
   assert.match(el('emergency-manual-result').textContent,/한림대학교 정문/);assert.equal(el('emergency-manual-result').querySelector('img'),null);
   assert.equal(el('emergency-manual-result').querySelector('a'),null);assert.equal(w.__qa.routes.length,0);
   click('emergency-locate');await waitFor(()=>!el('emergency-locate').disabled);assert.match(el('emergency-manual-result').textContent,/한림대학교 정문/);
   assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('한림대학교 정문')));
   input('emergency-location-input','한림');await waitFor(()=>el('emergency-place-0'));
   el('emergency-place-0').querySelector('button').click();assert.match(el('emergency-manual-result').textContent,/한림대학교/);
   click('emergency-map-toggle');await waitFor(()=>el('emergency-location-map'));
   await waitFor(()=>w.__qa.mapEvents.some(e=>e.type==='click'&&e.target.node?.id==='emergency-location-map'));
   const picker=w.__qa.mapInstances.find(m=>m.node.id==='emergency-location-map');
   w.__qa.mapEvents.find(e=>e.target===picker&&e.type==='click').fn({latLng:new w.kakao.maps.LatLng(37.9,127.76)});
   await waitFor(()=>el('emergency-manual-result').textContent.includes('테스트아파트'));
   assert.ok(d.querySelector('.emergency-reporting ol li'));assert.ok(d.querySelector('.emergency-video'));
   assert.match(d.querySelector('.emergency-video iframe').src,/youtube-nocookie.com\/embed\/CGG9g1pvJ4g/);assert.equal(w.__qa.routes.length,0);
   assert.equal(d.querySelector('.emergency-video a').href,'https://www.youtube.com/watch?v=CGG9g1pvJ4g');
   click('emergency-map-toggle');await waitFor(()=>!el('emergency-location-map'));assert.equal(w.__qa.mapEvents.filter(e=>e.target===picker).length,0);assert.equal(el('emergency-location-input').value.includes('한림'),false);
   click('emergency-close');assert.equal(el('emergency-card'),null);
   click('emergency-open');assert.match(el('emergency-manual-result').textContent,/테스트아파트/);click('emergency-location-clear');assert.equal(el('emergency-manual-result'),null);click('emergency-close');assert.equal(el('composer-input').value,'');input('composer-input','');
  });
  await t.test('composer opens shared consent by click or keyboard focus; first message starts intake',async()=>{
   assert.equal(el('start-health-chat'),null);assert.equal(el('start-intake'),null);
   d.querySelector('[data-conversation-starter=cough]').click();assert.ok(el('chat-consent-dialog')?.open);assert.equal(d.querySelector('.user-message'),null);assert.ok(el('health-consent-card'));assert.equal(el('intake-wizard'),null);
   assert.equal(w.getComputedStyle(el('health-consent-check')).width,'18px');assert.equal(w.getComputedStyle(el('health-consent-check')).height,'18px');
   el('chat-consent-dialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));await delay(0);assert.equal(el('health-consent-card'),null);assert.equal(d.activeElement,el('composer-attach'));
   el('composer-input').focus();await delay(0);assert.ok(el('chat-consent-dialog')?.open);assert.equal(el('health-consent-check').checked,false);
   submit('health-consent-form');assert.equal(el('composer-input').readOnly,true);
   assert.equal(el('health-consent-decline'),null);click('health-consent-close');assert.equal(el('search-form'),null);await delay(0);assert.equal(el('health-consent-card'),null);click('composer-input');assert.ok(el('health-consent-card'));el('health-consent-check').click();submit('health-consent-form');
   assert.equal(el('health-consent-card'),null);assert.equal(el('composer-input').readOnly,false);assert.equal(el('intake-wizard'),null);assert.equal(d.activeElement,el('composer-input'));
   input('composer-input','불편한 점을 먼저 적었어요');submit('composer-form');assert.ok(el('intake-wizard'));assert.equal(el('composer-input').value,'');assert.equal(el('workspace-panel'),null);assert.equal(w.__qa.routes.length,0);
   assert.match(d.querySelector('.user-message').textContent,/불편한 점을 먼저/);assert.equal(el('health-consent-card'),null);
   click('health-consent-open');assert.ok(el('chat-consent-dialog')?.open);assert.equal(el('chat-messages').contains(el('health-consent-card')),false);click('health-consent-close');assert.equal(el('health-consent-card'),null);
   assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('local-health-1')));
  });
  await t.test('pasted report is reviewed before use and remains historical context',async()=>{
   click('composer-attach');await delay(0);assert.ok(el('start-report-import'));click('start-report-paste');await delay(0);assert.ok(el('previous-report-text'));assert.equal(el('previous-report-context'),null);
   input('previous-report-text','진료 전에 보여줄 내용\n과거 증상 <img src=x>');await delay(0);
   assert.equal(el('composer-attachment-menu'),null);assert.equal(el('previous-report-editor').hidden,false);assert.match(el('previous-report-text').value,/과거 증상/);
   assert.equal(el('previous-report-form').querySelector('button[type="submit"]').disabled,true);
   click('previous-report-reviewed');await delay(0);submit('previous-report-form');await waitFor(()=>el('previous-report-context'));
   assert.equal(el('previous-report-context').querySelector('img'),null);assert.match(el('previous-report-context').textContent,/과거 기록/);
   assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('과거 증상')));
   el('previous-report-context').querySelector('button.text-button').click();assert.equal(el('previous-report-context'),null);
  });
  await t.test('variable choice wizard validates, keeps answers and delivers final note',async()=>{
   submit('intake-wizard');assert.equal(el('intake-error').hidden,false);
   assert.ok(el('start-intake').closest('.conversation-intake'));assert.equal(el('composer-form').querySelector('#start-intake'),null);d.querySelector('[data-intake-option="option-1"]').click();click('start-intake');assert.equal(el('intake-wizard'),null);assert.match(el('start-intake').textContent,/이어하기/);assert.match(d.querySelector('.conversation-intake-heading').textContent,/질문 1/);click('start-intake');assert.equal(d.querySelector('[data-intake-option="option-1"]').getAttribute('aria-pressed'),'true');submit('intake-wizard');
   assert.match(el('intake-question').textContent,/문진 2/);
   d.querySelector('[data-intake-option="option-2"]').click();submit('intake-wizard');
   input('intake-symptom','<script>not executable</script>');input('intake-region','춘천');submit('intake-wizard');
   assert.match(d.querySelector('.intake-review').textContent,/not executable/);assert.equal(d.querySelector('.intake-review script'),null);
   submit('intake-wizard');await delay(40);await waitFor(()=>d.querySelectorAll('.conversation-facility').length===2&&el('conversation-map'));
   assert.equal(el('workspace-panel'),null);click('conversation-map');await waitFor(()=>d.querySelectorAll('[data-card]').length===2);
   assert.match(el('chat-intake-context').textContent,/선지 1/);assert.match(el('chat-intake-context').textContent,/선지 2/);assert.ok(el('start-intake').closest('#chat-intake-context'));assert.match(el('start-intake').textContent,/답변 수정/);
  });
  await t.test('chat details stay inline without route calls; explicit directions draw a route for one destination',async()=>{
   click('workspace-close');assert.equal(w.__qa.routes.length,0);assert.match(d.querySelector('.conversation-facility .facility-travel').textContent,/직선 약/);assert.doesNotMatch(d.querySelector('.conversation-facility .facility-travel').textContent,/조회 중/);
   d.querySelector('[data-workspace-facility="kakao-1"]:not([data-workspace-route])').click();
   assert.ok(el('detail-heading'));assert.equal(el('detail-heading').closest('[data-conversation-facility]').dataset.conversationFacility,'kakao-1');assert.equal(el('workspace-panel'),null);assert.equal(el('search-form'),null);assert.equal(el('kakao-map'),null);
   await delay(80);assert.equal(w.__qa.routes.length,0);
   click('route-toggle');await waitFor(()=>w.__qa.routes.length===1&&w.__qa.lines>0);
   assert.ok(el('facility-route-panel'));assert.equal(el('facility-route-panel').closest('[data-conversation-facility]').dataset.conversationFacility,'kakao-1');assert.ok(el('kakao-map'));assert.equal(el('workspace-panel'),null);
   assert.equal(el('detail-heading'),null);assert.equal(el('search-form'),null);
   d.querySelector('[data-travel-mode="car"]').click();await waitFor(()=>w.__qa.routes.length===2);
   assert.equal(d.querySelector('[data-travel-mode="car"]').getAttribute('aria-pressed'),'true');
   click('inline-facility-close');
   d.querySelector('[data-workspace-facility="kakao-2"]:not([data-workspace-route])').click();
   assert.equal(el('detail-heading').closest('[data-conversation-facility]').dataset.conversationFacility,'kakao-2');assert.equal(d.querySelectorAll('.conversation-facility-expanded').length,1);
   click('inline-facility-close');const count=w.__qa.routes.length;
   d.querySelector('[data-workspace-route]').click();await delay(80);assert.equal(w.__qa.routes.length,count);
   click('inline-facility-close');click('conversation-map');await waitFor(()=>el('kakao-map'));
   if(el('close-detail'))click('close-detail');await waitFor(()=>d.querySelectorAll('[data-card]').length===2);
  });
  await t.test('retained React DOM binds once and map instance survives updates',async()=>{
   const node=el('kakao-map'),maps=w.__qa.maps;
   for(let i=0;i<8;i++)click('theme');assert.equal(d.documentElement.dataset.theme,'light');
   assert.equal(el('kakao-map'),node);assert.equal(w.__qa.maps,maps);
   input('composer-input','메시지 하나');submit('composer-form');assert.equal(el('chat-messages').querySelectorAll('.user-message').length,2);
   assert.equal(el('composer-input').value,'');
   input('composer-input','보내지 않은 입력');language('en');assert.equal(d.documentElement.lang,'en');assert.equal(el('composer-input').value,'보내지 않은 입력');language('ko');
   assert.equal(w.__qa.maps,maps);
  });
  await t.test('list-only results remain visible, keep filters and reuse the live map',async()=>{
   const node=el('kakao-map'),maps=w.__qa.maps,queries=w.__qa.searches.length,routes=w.__qa.routes.length;
   const ids=()=>[...d.querySelectorAll('[data-card]')].map(card=>card.dataset.card).sort();const before=ids();assert.equal(before.length,2);
   click('display-list');assert.equal(el('display-list').getAttribute('aria-pressed'),'true');assert.deepEqual(ids(),before);
   assert.equal(w.getComputedStyle(d.querySelector('.finder-body')).display,'block');assert.equal(w.getComputedStyle(d.querySelector('.facility-results')).display,'grid');assert.match(w.getComputedStyle(d.querySelector('.facility-results')).gridTemplateColumns,/repeat\(auto-fill/);
   assert.equal(w.getComputedStyle(d.querySelector('.finder-list-panel')).overflow,'visible');assert.equal(node.closest('.facility-map').hidden,true);
   el('sort').value='name';el('sort').dispatchEvent(new w.Event('change',{bubbles:true}));assert.deepEqual(ids(),before);
   assert.equal(w.__qa.searches.length,queries);assert.equal(w.__qa.routes.length,routes);
   click('display-map');assert.equal(node.closest('.facility-map').hidden,false);assert.equal(el('kakao-map'),node);assert.equal(w.__qa.maps,maps);assert.deepEqual(ids(),before);
   el('sort').value='distance';el('sort').dispatchEvent(new w.Event('change',{bubbles:true}));
  });
  await t.test('details, route toggle and copy actions work without recreating map',async()=>{
   const maps=w.__qa.maps;d.querySelector('.facility-detail-button[data-facility="kakao-1"]').click();
   assert.match(el('detail-heading').textContent,/테스트내과/);assert.equal(el('facility-route-panel'),null);
   click('toggle-jibun');await delay(0);assert.equal(el('facility-jibun').hidden,false);
   d.querySelector('[data-copy-facility="phone"]').click();await delay(0);assert.equal(w.__qa.copies.at(-1),'033-123-4567');
   click('route-toggle');assert.ok(el('facility-route-panel'));click('route-toggle');assert.equal(el('facility-route-panel'),null);
   click('close-detail');assert.equal(d.querySelectorAll('[data-card]').length,2);assert.equal(w.__qa.maps,maps);
  });
  await t.test('splitter remembers each panel ratio and resizes without search, route or map reconstruction',async()=>{
   const shell=d.querySelector('.care-shell');shell.getBoundingClientRect=()=>({width:1600,left:0});w.dispatchEvent(new w.Event('resize'));await delay(0);
   const key=value=>el('workspace-splitter').dispatchEvent(new w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
   const pointer=(type,x)=>el('workspace-splitter').dispatchEvent(new w.MouseEvent(type,{button:0,clientX:x,bubbles:true,cancelable:true}));
   const maps=w.__qa.maps,searches=w.__qa.searches.length,routes=w.__qa.routes.length;
   assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),'70');key('ArrowRight');await delay(0);assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),'72');
   pointer('pointerdown',670);pointer('pointermove',800);pointer('pointerup',800);await delay(0);const changed=el('workspace-splitter').getAttribute('aria-valuenow');assert.ok(Number(changed)>=49&&Number(changed)<=51);
   pointer('pointerdown',800);pointer('pointermove',900);pointer('pointercancel',900);await delay(0);assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),changed);
   key('Home');await delay(0);assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),el('workspace-splitter').getAttribute('aria-valuemin'));key('End');await delay(0);assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),el('workspace-splitter').getAttribute('aria-valuemax'));
   el('workspace-splitter').dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true}));await delay(0);assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),'70');
   key('ArrowLeft');await delay(0);assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),'68');assert.equal(w.__qa.maps,maps);assert.equal(w.__qa.searches.length,searches);assert.equal(w.__qa.routes.length,routes);
   assert.equal(el('workspace-expand'),null);
   assert.equal(d.querySelector('.emergency-entry-bar'),null);
   assert.equal(el('emergency-open').parentElement,el('workspace-close').parentElement);
   assert.equal(d.querySelectorAll('#emergency-open').length,1);
   click('emergency-open');assert.ok(el('emergency-dialog')?.open);
   click('emergency-close');assert.equal(d.activeElement,el('emergency-open'));assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),'68');
   d.querySelector('.header-nav [data-view=profile]').click();await delay(0);assert.equal(el('workspace-splitter'),null);assert.ok(d.querySelector('.care-shell.info-only'));assert.equal(w.getComputedStyle(el('main')).display,'none');
   click('workspace-close');assert.equal(el('workspace-splitter'),null);click('conversation-map');await delay(0);assert.equal(el('workspace-splitter').getAttribute('aria-valuenow'),'68');
   d.querySelector('.header-nav [data-view=profile]').click();await delay(0);assert.equal(el('workspace-splitter'),null);click('workspace-close');click('conversation-map');await waitFor(()=>el('kakao-map'));
  });
  await t.test('search suggestions submit immediately and preserve one live map',async()=>{
   const maps=w.__qa.maps;
   input('search-region','테스트');await waitFor(()=>el('search-suggestion-0'));
   click('search-suggestion-0');await waitFor(()=>d.querySelectorAll('[data-card]').length>0);
   assert.ok(w.__qa.searches.some(query=>query.includes('테스트')));assert.equal(w.__qa.maps,maps);await delay(350);assert.equal(el('search-suggestions').hidden,true);
  });
  await t.test('profile exports saved health information with the questionnaire summary without opening the report',async()=>{
   d.querySelector('button[data-view="profile"]').click();assert.ok(el('profile-form'));assert.equal(el('profile-report-open'),null);assert.equal(el('info-current-report'),null);assert.equal(el('info-settings'),null);assert.equal(el('profile-nickname'),null);
   assert.ok(el('account-open').classList.contains('primary-button'));assert.match(w.getComputedStyle(d.querySelector('.info-health')).gridTemplateColumns,/repeat\(2/);
   input('profile-age','27');input('profile-sex','female');input('profile-allergies','저장한 건강정보');assert.equal(el('profile-count-allergies').textContent,'8 / 500');submit('profile-form');
   input('profile-allergies','아직 저장하지 않은 내용');click('profile-pdf');assert.ok(el('profile-leave-cancel'));assert.equal(w.__qa.prints,0);assert.doesNotMatch(d.querySelector('.health-print-sheet').textContent,/아직 저장하지/);click('profile-leave-cancel');assert.equal(el('profile-allergies').value,'아직 저장하지 않은 내용');
   click('profile-pdf');click('profile-leave-save');assert.equal(w.__qa.prints,1);assert.ok(el('profile-form'));assert.equal(el('report-heading'),null);assert.match(d.querySelector('.health-print-sheet').textContent,/아직 저장하지 않은 내용/);assert.match(d.querySelector('.health-print-sheet').textContent,/만 27세/);assert.equal(d.querySelector('.care-print-health').querySelectorAll('dt').length,5);assert.ok(d.querySelector('.care-print-summary'));assert.match(d.querySelector('.health-print-sheet').textContent,/여성/);
   input('profile-allergies','버릴 내용');click('profile-pdf');click('profile-leave-discard');assert.equal(w.__qa.prints,2);assert.equal(el('profile-allergies').value,'아직 저장하지 않은 내용');assert.doesNotMatch(d.querySelector('.health-print-sheet').textContent,/버릴 내용|not executable|선지/);
   assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('저장하지 않은 내용')));
   click('profile-delete');assert.equal(el('profile-allergies').value,'');assert.doesNotMatch(d.querySelector('.health-print-sheet').textContent,/저장하지 않은 내용/);
  });
  await t.test('closing workspaces preserves drafts; new conversation clears session notes',async()=>{
   input('composer-input','이어서 작성할 내용');click('workspace-close');assert.equal(el('workspace-panel'),null);assert.equal(el('composer-input').value,'이어서 작성할 내용');
   assert.equal(d.querySelector('.conversation-report'),null);click('new-conversation');assert.equal(d.querySelector('.conversation-report'),null);assert.equal(el('composer-input').value,'');assert.equal(el('intake-wizard'),null);
   click('composer-input');assert.equal(el('health-consent-card'),null);input('composer-input','다음 상담');submit('composer-form');d.querySelector('[data-intake-option="option-1"]').click();submit('intake-wizard');click('skip');
   await waitFor(()=>el('chat-intake-context'));assert.equal(el('chat-intake-context').dataset.intakeStatus,'partial');assert.match(el('chat-intake-context').textContent,/선지 1/);assert.equal(el('intake-wizard'),null);assert.equal(el('workspace-panel'),null);
  });
  await t.test('withdrawing consent clears health inputs and leaves emergency access available',async()=>{
   click('health-consent-open');click('health-consent-revoke');assert.equal(el('chat-intake-context'),null);assert.equal(el('composer-input').readOnly,true);
   click('emergency-open');assert.ok(el('emergency-card').querySelector('a[href="tel:119"]'));click('emergency-close');
  });
  await t.test('favorite stars sync across cards and information; filters do not add route requests',async()=>{
   click('new-conversation');d.querySelector('[data-conversation-starter=pharmacy]').click();click('health-consent-check');submit('health-consent-form');await waitFor(()=>el('conversation-map'));click('conversation-map');await waitFor(()=>el('facility-type'));d.querySelector('[data-reset]').click();input('search-region','춘천');submit('search-form');await waitFor(()=>d.querySelectorAll('[data-card]').length===2);
   const routes=w.__qa.routes.length;const star=d.querySelector('[data-card="kakao-1"] [data-favorite]');assert.equal(star.getAttribute('aria-pressed'),'false');star.click();await delay(0);assert.equal(d.querySelector('[data-card="kakao-1"] [data-favorite]').getAttribute('aria-pressed'),'true');
   click('favorites-only');await delay(0);assert.equal(d.querySelectorAll('[data-card]').length,1);assert.equal(d.querySelector('[data-card]').dataset.card,'kakao-1');
   d.querySelector('.header-nav [data-view=profile]').click();assert.ok(d.querySelector('.info-only'));assert.match(d.querySelector('.info-favorites').textContent,/테스트내과/);assert.equal(w.getComputedStyle(el('main')).display,'none');
   d.querySelector('.info-favorites [data-favorite]').click();await delay(0);assert.equal(d.querySelector('.info-favorites [data-favorite]'),null);assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('kakao-1')));
   click('workspace-close');d.querySelector('.conversation-results [data-view=explore]').click();await delay(0);assert.equal(d.querySelectorAll('[data-card]').length,0);click('favorites-only');await waitFor(()=>d.querySelectorAll('[data-card]').length===2);assert.equal(w.__qa.routes.length,routes);click('workspace-close');
  });
  await t.test('pharmacy starter resumes exactly once after consent and searches only open pharmacies',async()=>{
   const routeCount=w.__qa.routes.length;click('health-consent-open');click('health-consent-revoke');click('new-conversation');assert.equal(d.querySelector('.user-message'),null);
   d.querySelector('[data-conversation-starter=pharmacy]').click();assert.ok(el('health-consent-card'));assert.equal(el('intake-wizard'),null);assert.equal(d.querySelector('.user-message'),null);
   click('health-consent-check');submit('health-consent-form');await waitFor(()=>d.querySelector('.user-message'));
   assert.equal(d.querySelectorAll('.user-message').length,1);assert.match(d.querySelector('.user-message').textContent,/지금 문 연 약국을 찾고 싶어요/);
   assert.equal(el('intake-wizard'),null);await waitFor(()=>d.querySelectorAll('.conversation-facility').length===1);assert.match(d.querySelector('.conversation-facility h4').textContent,/약국/);assert.equal(w.__qa.routes.length,routeCount);
   assert.ok(!Object.values({...w.localStorage}).some(value=>value.includes('지금 문 연 약국')));
  });
  await t.test('favorite lookup opens the exact institution without chat results, stale open claims or route requests',async()=>{
   const routes=w.__qa.routes.length;d.querySelector('.conversation-facility [data-favorite="kakao-2"]').click();await delay(0);d.querySelector('.header-profile').click();assert.ok(d.querySelector('.info-favorites [data-favorite-find="kakao-2"]'));
   w.__qa.duplicateNames=true;w.__qa.missingHours=true;d.querySelector('.info-favorites [data-favorite-find="kakao-2"]').click();await waitFor(()=>el('detail-heading')&&d.querySelector('.facility-detail').textContent.includes('영업시간을 찾지 못했어요'));
   assert.equal(d.querySelector('.conversation-results'),null);assert.equal(el('open-only').checked,false);assert.match(el('detail-heading').textContent,/테스트약국/);assert.equal(d.querySelector('.facility-detail .status-open'),null);assert.doesNotMatch(d.querySelector('.facility-travel').textContent,/77\.6/);assert.equal(d.querySelectorAll('.facility-detail').length,1);assert.equal(w.__qa.routes.length,routes);assert.ok(w.__qa.searches.some(query=>query.includes('테스트약국')&&query.includes('춘천시')));
   click('close-detail');await delay(0);assert.equal(d.querySelectorAll('[data-card]').length,1);assert.equal(d.querySelector('[data-card]').dataset.card,'kakao-2');assert.equal(d.querySelector('.status-open'),null);
   w.__qa.duplicateNames=false;w.__qa.missingHours=false;input('search-region','춘천');submit('search-form');await waitFor(()=>d.querySelectorAll('[data-card]').length===1);assert.ok(d.querySelector('.conversation-results'));assert.equal(w.__qa.routes.length,routes);
  });
  assert.deepEqual(errors,[]);
 }finally{
  dom?.window.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
 }
});
