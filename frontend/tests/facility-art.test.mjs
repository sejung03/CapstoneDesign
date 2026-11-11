import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFacilityPhoto} from '../facilities-view.mjs';
import {mountApp} from './dom-harness.mjs';
const translate=key=>({hospitals:'병원',pharmacy:'약국',facilityArtNote:'기관 종류를 나타낸 안내 그림이에요.'}[key]||key);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('Missing photos use distinct compact SVGs with accessible names and no visible labels',()=>{
 const base={id:'kakao-1',source:'kakao',photo:null,name:{ko:'건강센터'},placeUrl:'https://place.map.kakao.com/1'};
 const hospital=renderFacilityPhoto({...base,type:'hospital'},translate,escape);
 const pharmacy=renderFacilityPhoto({...base,type:'pharmacy'},translate,escape);
 assert.match(hospital,/facility-art-hospital/);assert.match(hospital,/aria-label="병원"/);
 assert.match(pharmacy,/facility-art-pharmacy/);assert.match(pharmacy,/aria-label="약국"/);
 assert.notEqual(hospital.match(/<svg[\s\S]*?<\/svg>/)[0],pharmacy.match(/<svg[\s\S]*?<\/svg>/)[0]);
 for(const html of [hospital,pharmacy]){assert.doesNotMatch(html,/<img/);assert.match(html,/role="img"/);assert.doesNotMatch(html,/<strong>|facility-art-copy/);}
 const detail=renderFacilityPhoto({...base,type:'pharmacy'},translate,escape,{detail:true});
 assert.doesNotMatch(detail,/기관 종류를 나타낸 안내 그림/);assert.doesNotMatch(detail,/photo-provider-link|https:\/\/place.map.kakao.com\/1/);
});
test('A failed pharmacy image reveals the pharmacy illustration and hides the photo attribution',()=>{
 const ui=mountApp();ui.document.getElementById('skip').click();
 ui.run("state.source='live';state.live.locationAttempted=true;state.live.queryKey=liveQueryKey(state.search.criteria);state.live.items=[{id:'kakao-1',type:'pharmacy',source:'kakao',status:'unknown',name:{ko:'테스트약국',en:'Test pharmacy'},area:{ko:'서울',en:'Seoul'},access:{ko:'',en:''},photo:{src:'https://example.com/photo.jpg',kind:'registered'},lat:37,lng:127}];render()");
 const image=ui.document.querySelectorAll('[data-facility-photo]')[0],id=image.dataset.facilityPhoto;
 assert.equal(ui.document.getElementById(id+'-fallback').hidden,true);
 image.emit('error');
 assert.equal(image.hidden,true);assert.equal(ui.document.getElementById(id+'-fallback').hidden,false);
 assert.equal(ui.document.getElementById(id+'-badge').hidden,true);
 assert.match(ui.app.innerHTML,/facility-art-pharmacy/);
});
