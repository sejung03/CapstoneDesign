import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestEmergencyLocations,mountEmergencyPicker} from '../emergency-picker.mjs';
import {lookupEmergencyAddress,normalizeEmergency} from '../emergency.mjs';
import {mountApp} from './dom-harness.mjs';
function sdk(){
 const listeners=[],maps=[],markers=[];
 class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
 class Map{constructor(node,options){this.point=options.center;maps.push(this);}addControl(){}relayout(){}getCenter(){return this.point;}setCenter(p){this.point=p;}}
 class Marker{constructor(options){this.point=options.position;markers.push(this);}getPosition(){return this.point;}setPosition(p){this.point=p;}setMap(){}}
 const api={maps:{Map,Marker,LatLng,ZoomControl:class{},ControlPosition:{RIGHT:1},event:{addListener(target,type,fn){listeners.push({target,type,fn});},removeListener(target,type,fn){listeners.splice(listeners.findIndex(item=>item.target===target&&item.type===type&&item.fn===fn),1);}},services:{Status:{OK:'OK',ZERO_RESULT:'ZERO'},Places:class{keywordSearch(text,callback,options){assert.equal(options.category_group_code,undefined);callback([{id:'1',place_name:'한림대학교',road_address_name:'한림대학길 1',x:'127.73',y:'37.88'}],'OK');}},Geocoder:class{addressSearch(text,callback){callback([{address_name:'한림대학길 1',x:'127.73',y:'37.88'}],'OK');}coord2Address(lng,lat,callback){callback([{road_address:{address_name:'선택한 주소'}}],'OK');}}}}};
 return {api,listeners,maps,markers,LatLng};
}
test('emergency suggestions search general places and addresses and suppress aborted requests',async()=>{
 const {api}=sdk(),items=await suggestEmergencyLocations('key','한림',{api});
 assert.equal(items.length,2);assert.equal(items[0].name,'한림대학교');assert.equal(items[0].lat,37.88);
 const controller=new AbortController();controller.abort();assert.deepEqual(await suggestEmergencyLocations('key','한림',{api,signal:controller.signal}),[]);
});
test('map selection starts unselected and supports map click, drag center and pin dragging with cleanup',async()=>{
 const {api,listeners,maps,markers,LatLng}=sdk(),selected=[];let cleaned=false;
 const view=await mountEmergencyPicker({replaceChildren(){cleaned=true;}},'key',{loadSdk:async()=>api,onSelect:point=>selected.push(point)});
 assert.equal(selected.length,0);assert.equal(markers.length,0);
 listeners.find(item=>item.target===maps[0]&&item.type==='click').fn({latLng:new LatLng(37.88,127.73)});
 assert.deepEqual(selected.at(-1),{lat:37.88,lng:127.73});
 maps[0].setCenter(new LatLng(37.89,127.74));view.selectCenter();assert.equal(selected.at(-1).lat,37.89);
 markers[0].setPosition(new LatLng(37.9,127.75));listeners.find(item=>item.target===markers[0]&&item.type==='dragend').fn();assert.equal(selected.at(-1).lat,37.9);
 const oldClick=listeners.find(item=>item.target===maps[0]&&item.type==='click').fn,count=selected.length;
 view.dispose();oldClick({latLng:new LatLng(38,128)});assert.equal(selected.length,count);assert.equal(listeners.length,0);assert.equal(cleaned,true);
});
test('explicit map selection can resolve an address without claiming GPS accuracy; backend steps are validated',async()=>{
 const {api}=sdk();assert.equal(await lookupEmergencyAddress('key',{lat:37.9,lng:127.75},{loadSdk:async()=>api,selected:true}),'선택한 주소');
 assert.deepEqual(normalizeEmergency({active:true,instructions:[{ko:'검수된 안내'}]}).instructions,[{ko:'검수된 안내'}]);
 assert.throws(()=>normalizeEmergency({active:true,instructions:[{ko:''}]}),TypeError);
});
test('selected emergency point is session-only and does not change hospital search or route origin',()=>{
 const ui=mountApp({source:null});ui.run("globalThis.before=JSON.stringify(state.search);selectEmergencyLocation({point:{lat:37.88,lng:127.73},address:'한림대학교',source:'place'})");
 assert.equal(ui.run('state.emergency.selectedPoint.lat'),37.88);assert.equal(ui.run('JSON.stringify(state.search)===before'),true);assert.equal(ui.run('state.live.position'),undefined);assert.equal(ui.storage.size,0);
 ui.run("selectEmergencyLocation({point:null,address:'주변 장소',source:'text'})");assert.equal(ui.run('state.emergency.selectedPoint'),null);
});
