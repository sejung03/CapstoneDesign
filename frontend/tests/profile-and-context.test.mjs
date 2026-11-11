import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from './dom-harness.mjs';
import {emptyProfile,cleanProfile,loadProfile,persistProfile,SETTINGS_KEY} from '../profile.mjs';
import {buildSuggestion,recommendationReasons} from '../care-context.mjs';
import {emptyCriteria,searchFacilities,facilities} from '../facilities.mjs';
import {renderFacilityPhoto} from '../facilities-view.mjs';
const route=(ui,view)=>ui.document.querySelectorAll('button[data-view]').find(node=>node.dataset.view===view).click();
const send=(ui,text)=>{ui.document.getElementById('composer-input').value=text;ui.document.getElementById('composer-form').emit('submit');};
test('Same workspace navigation stays in the header on search, report, and profile',()=>{
 const ui=mountApp();ui.document.getElementById('skip').click();
 for(const view of ['report','explore','profile','report']){
  route(ui,view);
  const buttons=ui.document.querySelectorAll('.header-route');
  assert.deepEqual(buttons.map(node=>node.dataset.view),['explore','report','profile']);
  assert.equal(buttons.find(node=>node.dataset.view===view).attributes['aria-current'],'page');
  assert.ok(!ui.app.innerHTML.includes('workspace-shortcuts'));
 }
});
test('Profile opt-in restores search settings on a new visit and keeps health notes in the current visit only',()=>{
 const storage=new Map(),ui=mountApp({storage});route(ui,'profile');
 const d=ui.document;
 d.getElementById('profile-nickname').value='홍길동';
 d.getElementById('profile-age').value='30';
 d.getElementById('profile-region').value='춘천';
 d.getElementById('profile-preference').value='open';
 d.getElementById('profile-allergies').value='알레르기 기록';
 d.getElementById('profile-remember').checked=true;
 d.getElementById('profile-form').emit('submit');
 assert.ok(storage.has(SETTINGS_KEY));
 const next=mountApp({storage});next.document.getElementById('skip').click();
 assert.equal(next.document.getElementById('search-region').value,'춘천');
 assert.equal(next.document.getElementById('sort').value,'recommended');
 assert.deepEqual(next.document.querySelectorAll('.facility-card').slice(0,2).map(node=>node.dataset.card),['sample-a','sample-c']);
 route(ui,'report');assert.ok(!ui.app.innerHTML.includes('홍길동'));assert.ok(ui.app.innerHTML.includes('알레르기 기록'));
 route(next,'report');assert.ok(!next.app.innerHTML.includes('홍길동'));assert.ok(!next.app.innerHTML.includes('알레르기 기록'));
 route(next,'profile');assert.equal(next.document.getElementById('profile-remember').checked,true);
 next.document.getElementById('profile-delete').click();assert.ok(!storage.has(SETTINGS_KEY));
 assert.equal(next.document.getElementById('profile-nickname').value,'');
});
test('Unchecked profile persistence removes stored values and preserves this visit only',()=>{
 const storage=new Map(),ui=mountApp({storage});route(ui,'profile');
 ui.document.getElementById('profile-region').value='춘천';
 ui.document.getElementById('profile-remember').checked=true;
 ui.document.getElementById('profile-form').emit('submit');
 ui.document.getElementById('profile-remember').checked=false;
 ui.document.getElementById('profile-form').emit('submit');
 assert.equal(storage.has(SETTINGS_KEY),false);
 route(ui,'explore');assert.equal(ui.document.getElementById('search-region').value,'춘천');
 assert.equal(mountApp({storage}).run('state.profile.region'),'');
});
test('Conversation suggests explicit preferences without silently changing results; apply changes map and list together',()=>{
 const ui=mountApp();send(ui,'춘천 내과, 문 연 곳을 가까운 순으로 찾아주세요');
 assert.ok(ui.document.getElementById('apply-suggestion'));
 assert.equal(ui.run('state.search.criteria.department'),'all');
 ui.document.getElementById('apply-suggestion').click();
 assert.equal(ui.document.body.dataset.view,'explore');
 assert.equal(ui.document.getElementById('search-region').value,'춘천');
 assert.equal(ui.document.getElementById('department').value,'internal');
 assert.equal(ui.document.getElementById('open-only').checked,true);
 assert.deepEqual(ui.document.querySelectorAll('.facility-card').map(node=>node.dataset.card),['sample-a']);
 assert.deepEqual(ui.document.querySelectorAll('.map-pin').map(node=>node.dataset.facility),['sample-a']);
 assert.ok(ui.app.innerHTML.includes('찾는 진료과'));
 assert.ok(ui.app.innerHTML.includes('대화 조건 반영'));
 send(ui,'치과 말고 약국으로 찾아주세요');
 ui.document.getElementById('apply-suggestion').click();
 assert.deepEqual(ui.document.querySelectorAll('.facility-card').map(node=>node.dataset.card),['sample-c']);
 assert.equal(ui.document.getElementById('facility-type').value,'pharmacy');
});
test('Entry continuation applies the reviewed conditions instead of starting an unrelated search',()=>{
 const ui=mountApp();send(ui,'춘천 약국');
 ui.document.getElementById('apply-suggestion').click();
 assert.equal(ui.document.getElementById('facility-type').value,'pharmacy');
 assert.equal(ui.document.querySelectorAll('.facility-card').length,2);
});
test('Ordinary symptom text is kept as a note and never mapped to a specialty by the demo',()=>{
 const plan=buildSuggestion('머리가 아프고 어지러워요');
 assert.equal(plan.hasConditions,false);
 assert.equal(plan.department,'all');
 const ui=mountApp();send(ui,'머리가 아프고 어지러워요');
 assert.equal(ui.document.getElementById('apply-suggestion'),null);
 ui.document.getElementById('skip').click();route(ui,'report');assert.ok(ui.app.innerHTML.includes('머리가 아프고 어지러워요'));
});
test('Saved preferences supply the search area while explicit conversation overrides visit ordering',()=>{
 const profile={...emptyProfile(),region:'춘천',preference:'open'};
 const plan=buildSuggestion('약국 가까운 순으로',profile);
 assert.equal(plan.region,'춘천');assert.equal(plan.priority,'distance');assert.equal(plan.department,'pharmacy');
 const sorted=searchFacilities({...emptyCriteria(),sort:'recommended',priority:'open'});
 assert.deepEqual(sorted.slice(0,2).map(item=>item.id),['sample-a','sample-c']);
 const accessible=searchFacilities({...emptyCriteria(),sort:'recommended',priority:'access'});
 assert.equal(accessible[0].accessible,true);
 assert.deepEqual(recommendationReasons(facilities[0],{...emptyCriteria(),department:'internal',priority:'access'}),['reasonDept','reasonAccess']);
});
test('Photo cards distinguish sample and provider images, and load failure reveals the placeholder',()=>{
 const escape=s=>String(s).replaceAll('"','&quot;');
 assert.ok(renderFacilityPhoto(facilities[0],key=>key,escape).includes('examplePhoto'));
 assert.ok(renderFacilityPhoto({...facilities[0],photo:{src:'clinic-demo.png',kind:'registered'}},key=>key,escape).includes('registeredPhoto'));
 assert.ok(!renderFacilityPhoto({...facilities[0],photo:{src:'javascript:alert(1)'}},key=>key,escape).includes('<img'));
 assert.ok(renderFacilityPhoto({...facilities[0],photo:{src:'https://example.com/provider.jpg',kind:'registered'}},key=>key,escape).includes('https://example.com/provider.jpg'));
 const ui=mountApp();ui.document.getElementById('skip').click();
 const img=ui.document.querySelectorAll('[data-facility-photo]')[0],key=img.dataset.facilityPhoto;
 assert.equal(ui.document.getElementById(key+'-fallback').hidden,true);
 img.emit('error');
 assert.equal(img.hidden,true);
 assert.equal(ui.document.getElementById(key+'-fallback').hidden,false);
 assert.equal(ui.document.getElementById(key+'-badge').hidden,true);
});
test('Invalid or blocked profile storage falls back safely and normalized fields stay bounded',()=>{
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.deepEqual(loadProfile(blocked).profile,emptyProfile());
 assert.equal(persistProfile(blocked,emptyProfile(),true),false);
 assert.equal(persistProfile(blocked,emptyProfile(),false),false);
 assert.deepEqual(loadProfile({getItem:()=>'{broken'}).profile,emptyProfile());
 assert.equal(cleanProfile({history:'x'.repeat(600),age:'invalid',preference:'invalid'}).history.length,500);
 assert.equal(cleanProfile(null).preference,'distance');
});

test('Health notes remain escaped in the current report and never restore after a reload',()=>{
 const storage=new Map(),ui=mountApp({storage});route(ui,'profile');
 ui.document.getElementById('profile-history').value='<img src=x onerror="boom">';
 ui.document.getElementById('theme').click();
 assert.equal(storage.has(SETTINGS_KEY),false);
 assert.equal(ui.document.getElementById('profile-history').value,'<img src=x onerror="boom">');
 ui.document.getElementById('profile-form').emit('submit');
 assert.equal(storage.has(SETTINGS_KEY),false,'Consent starts off');
 route(ui,'report');
 assert.ok(ui.app.innerHTML.includes('&lt;img src=x'));assert.ok(!ui.app.innerHTML.includes('<img src=x'));
 const next=mountApp({storage});next.document.getElementById('skip').click();route(next,'report');
 assert.ok(!next.app.innerHTML.includes('&lt;img src=x'));assert.ok(!next.app.innerHTML.includes('<img src=x'));
});
