
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderWeeklyHours} from '../facilities-view.mjs';
import {normalizePlace,facilityAddress} from '../live-data.mjs';
import {enrichPublicHours} from '../public-hours.mjs';
import {copy} from '../copy.mjs';
import {mountApp} from './dom-harness.mjs';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const schedule=Array.from({length:8},(_,i)=>({day:i+1,start:'0900',end:'1800'}));
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Today highlight follows the Korean date at the UTC date boundary in both languages',()=>{
 const now=new Date('2026-10-25T15:30:00Z');
 for(const locale of ['ko','en']){
  const html=renderWeeklyHours(schedule,locale,key=>copy[locale][key],escape,{now});
  assert.equal((html.match(/aria-current="date"/g)||[]).length,1);
  assert.match(html,locale==='ko'?/aria-current="date">월 09:00/:/aria-current="date">Mon 09:00/);
  assert.doesNotMatch(html,/aria-current="date">공휴일|aria-current="date">Holiday/);
 }
});
test('An absent Sunday time stays unknown while its row is highlighted; no closure is inferred',()=>{
 const blank=schedule.map(slot=>slot.day===7?{day:7,start:'',end:''}:slot);
 const html=renderWeeklyHours(blank,'ko',key=>copy.ko[key],escape,{now:new Date('2026-10-25T01:00:00Z')});
 assert.match(html,/aria-current="date">일/);assert.doesNotMatch(html,/휴무|진료 종료/);
 assert.equal(renderWeeklyHours(null,'ko',key=>key,escape),'');
});
test('Normalization retains road and lot addresses and selects a full registered address when available',()=>{
 const item=normalizePlace({id:'100',x:'127.74',y:'37.87',category_group_code:'HP8',place_name:'Clinic',road_address_name:'Road 10',address_name:'Lot 20'});
 assert.equal(item.area.ko,'Road 10');assert.equal(item.roadAddress,'Road 10');assert.equal(item.jibunAddress,'Lot 20');
 assert.equal(facilityAddress(item),'Road 10');
 assert.equal(facilityAddress({...item,registeredAddress:'Road 10, floor 3, room 301'}),'Road 10, floor 3, room 301');
});
test('An unambiguous public-data match keeps full address and directions without changing map identity',async()=>{
 const item={id:'kakao-100',type:'hospital',name:{ko:'Clinic',en:'Clinic'},area:{ko:'Road 10',en:'Road 10'},lat:37.87,lng:127.74,phone:'',status:'unknown'};
 const row={hpid:'A100',dutyName:'Clinic',dutyAddr:'Road 10, floor 3, room 301',dutyMapimg:'Across from the station',wgs84Lat:'37.87',wgs84Lon:'127.74',dutyTel1:'033-123-4567',dutyTime1s:'0900',dutyTime1c:'1800'};
 const [result]=await enrichPublicHours([item],{fetcher:async()=>({ok:true,text:async()=>''}),parse:()=>[row]});
 assert.equal(result.id,item.id);assert.equal(result.lat,item.lat);assert.equal(result.lng,item.lng);
 assert.equal(result.registeredAddress,row.dutyAddr);assert.equal(result.locationHint,row.dutyMapimg);
 assert.equal(result.phone,row.dutyTel1);assert.equal(item.registeredAddress,undefined);
 const [unmatched]=await enrichPublicHours([item],{fetcher:async()=>({ok:true,text:async()=>''}),parse:()=>[{...row,dutyName:'Other clinic'}]});
 assert.equal(unmatched.registeredAddress,undefined);
});
const place={id:'kakao-100',source:'kakao',providerId:'100',type:'hospital',department:'other',status:'unknown',name:{ko:'Test clinic',en:'Test clinic'},area:{ko:'Road 10',en:'Road 10'},roadAddress:'Road 10',jibunAddress:'Lot 20',registeredAddress:'Road 10, floor 3, room 301',locationHint:'Across from the station',phone:'033-123-4567',lat:37.87,lng:127.74,placeUrl:'https://place.map.kakao.com/100',access:{ko:'',en:''},schedule};
function openDetail(overrides={}){
 const ui=mountApp({source:null});
 ui.run("state.view='explore';state.live.items="+JSON.stringify([{...place,...overrides}])+";state.search.selectedId='kakao-100';render()");
 return ui;
}
test('Detail renders full location, alternate addresses and copy controls; each copies the original value',async()=>{
 const ui=openDetail();
 assert.match(ui.app.innerHTML,/floor 3, room 301/);assert.equal(ui.document.getElementById('facility-jibun').hidden,true);
 assert.equal(ui.document.getElementById('toggle-jibun').attributes['aria-expanded'],'false');
 ui.document.getElementById('toggle-jibun').click();
 assert.equal(ui.document.getElementById('facility-jibun').hidden,false);
 assert.equal(ui.document.getElementById('toggle-jibun').attributes['aria-expanded'],'true');
 ui.document.getElementById('toggle-jibun').click();
 assert.equal(ui.document.getElementById('facility-jibun').hidden,true);
 assert.match(ui.app.innerHTML,/Across from the station/);
 ui.run("globalThis.navigator={clipboard:{writeText:async text=>{window.copied=text}}}");
 const address=ui.document.querySelectorAll('[data-copy-facility]').find(n=>n.dataset.copyFacility==='address');
 const phone=ui.document.querySelectorAll('[data-copy-facility]').find(n=>n.dataset.copyFacility==='phone');
 assert.equal(address.attributes['aria-label'],'주소 복사');
 assert.doesNotMatch(ui.app.innerHTML,/<span>복사<\/span>/);
 assert.doesNotMatch(ui.app.innerHTML,/도로명 Road 10/);
 address.click();await tick();assert.equal(ui.run('window.copied'),place.registeredAddress);
 assert.match(ui.document.getElementById('toast').textContent,/주소를 복사/);
 phone.click();await tick();assert.equal(ui.run('window.copied'),place.phone);
 assert.equal(ui.run('state.search.selectedId'),place.id);assert.equal(ui.run('state.routing.openId'),null);
});
test('Copy uses the exact visible record after changing facilities and does not mix previous selection data',async()=>{
 const ui=openDetail();
 ui.run("globalThis.navigator={clipboard:{writeText:async text=>{window.copied=text}}}");
 const other={...place,id:'kakao-200',roadAddress:'Another address',registeredAddress:'Another address',phone:'033-222-3333'};
 ui.run("state.live.items.push("+JSON.stringify(other)+");state.search.selectedId='kakao-200';render()");
 ui.document.querySelectorAll('[data-copy-facility]').find(n=>n.dataset.copyFacility==='address').click();await tick();
 assert.equal(ui.run('window.copied'),'Another address');
});
test('Copy failure and missing clipboard show an error; unavailable address and phone have no copy controls',async()=>{
 const ui=openDetail();
 ui.run("globalThis.navigator={clipboard:{writeText:async()=>{throw Error('blocked')}}}");
 ui.document.querySelectorAll('[data-copy-facility]')[0].click();await tick();
 assert.match(ui.document.getElementById('toast').textContent,/복사하지 못/);
 ui.run("globalThis.navigator={}");
 ui.document.querySelectorAll('[data-copy-facility]')[0].click();await tick();
 assert.match(ui.document.getElementById('toast').textContent,/직접 선택/);
 const missing=openDetail({registeredAddress:'',roadAddress:'',jibunAddress:'',area:{ko:'',en:''},phone:''});
 assert.equal(missing.document.querySelectorAll('[data-copy-facility]').length,0);
});
test('Provider address and location markup is escaped for display and copied as literal text',async()=>{
 const address='<img src=x onerror=alert(1)>',ui=openDetail({roadAddress:address,registeredAddress:address,locationHint:'<script>bad</script>'});
 assert.match(ui.app.innerHTML,/&lt;img src=x/);assert.doesNotMatch(ui.app.innerHTML,/<img src=x/);
 assert.match(ui.app.innerHTML,/&lt;script&gt;bad/);assert.doesNotMatch(ui.app.innerHTML,/<script>bad/);
 ui.run("globalThis.navigator={clipboard:{writeText:async text=>{window.copied=text}}}");
 ui.document.querySelectorAll('[data-copy-facility]').find(n=>n.dataset.copyFacility==='address').click();await tick();
 assert.equal(ui.run('window.copied'),address);
});

test('The road address stays primary when a public record uses a different address; lot addresses start collapsed on each selection',()=>{
 assert.equal(facilityAddress({...place,registeredAddress:'Lot 20'}),'Road 10');
 assert.equal(facilityAddress({...place,registeredAddress:'Road 100, room 4'}),'Road 10','Different building numbers must not be treated as floor suffixes');
 const ui=openDetail();
 ui.document.getElementById('toggle-jibun').click();
 assert.equal(ui.document.getElementById('facility-jibun').hidden,false);
 const other={...place,id:'kakao-200',jibunAddress:'Lot 200'};
 ui.run("state.live.items.push("+JSON.stringify(other)+");state.search.selectedId='kakao-200';render()");
 assert.equal(ui.document.getElementById('facility-jibun').hidden,true);
 assert.equal(ui.document.getElementById('toggle-jibun').attributes['aria-expanded'],'false');
});

test('Unavailable and empty schedules do not claim registered hours, for either clinics or pharmacies',()=>{
 for(const type of ['hospital','pharmacy'])for(const missing of ['absent','empty','unmatched']){
  const ui=openDetail({type,schedule:missing==='empty'?schedule.map(slot=>({...slot,start:'',end:''})):undefined,hoursError:missing==='unmatched'?'hoursNotMatched':missing==='empty'?'hoursScheduleMissing':''});
  ui.run("state.live.hoursConfigured=true;state.live.hoursPhase='ready';render()");
  assert.equal(ui.document.querySelector('.weekly-hours'),null);
  assert.equal(ui.document.querySelector('.hours-state'),null);
  assert.doesNotMatch(ui.app.innerHTML,/등록된 진료시간이에요|등록된 영업시간이에요|표시된 운영시간은/);
  assert.match(ui.app.innerHTML,type==='pharmacy'?/영업 여부는 카카오맵/:/진료 여부는 카카오맵/);
  assert.doesNotMatch(ui.app.innerHTML,/병원에 확인/);
 }
});
test('Registered-hours details use the appropriate clinic or pharmacy terms in both languages',()=>{
 for(const locale of ['ko','en'])for(const type of ['hospital','pharmacy']){
  const ui=openDetail({type});ui.run("state.locale='"+locale+"';state.live.hoursConfigured=true;state.live.hoursPhase='ready';render()");
  assert.ok(ui.document.querySelector('.weekly-hours'));
  assert.match(ui.app.innerHTML,new RegExp(type==='pharmacy'?(locale==='ko'?'등록된 영업시간이에요':'registered pharmacy hours'):(locale==='ko'?'등록된 진료시간이에요':'registered consultation hours')));
  if(type==='pharmacy')assert.doesNotMatch(ui.app.innerHTML,/공휴일 진료와 접수 마감/);
 }
});
test('Selecting missing hours hides the generic registered-hours notice even when another result has a schedule',()=>{
 const ui=openDetail();
 const missing={...place,id:'kakao-200',schedule:undefined,hoursError:'hoursNotMatched'};
 ui.run("state.live.items.push("+JSON.stringify(missing)+");state.search.selectedId='kakao-200';state.live.hoursConfigured=true;state.live.hoursPhase='ready';render()");
 assert.equal(ui.document.querySelector('.hours-state'),null);
 ui.run("state.live.hoursError='hoursAuthFailed';render()");
 assert.ok(ui.document.querySelector('.hours-state'));assert.ok(ui.document.getElementById('hours-retry'));
 assert.doesNotMatch(ui.app.innerHTML,/표시된 운영시간은 등록된 정보 기준/);
});
