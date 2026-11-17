import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createSupabaseBehaviorRepository} from '../lib/behavior/supabase-repository.js';
import {FavoriteLimitError} from '../lib/behavior/validation.js';
import {supabaseConfig} from '../lib/supabase/config.js';
const uid='11111111-1111-4111-8111-111111111111';
function setup(reply){
 const calls=[];
 const client=createClient('https://example.supabase.co','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
  calls.push({url:new URL(url),...init});return reply(calls.at(-1));
 }}});
 return {repository:createSupabaseBehaviorRepository(client),calls};
}
test('config rejects REST endpoint paths instead of silently producing double paths',()=>{
 assert.throws(()=>supabaseConfig({NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co/rest/v1/',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public'}));
 assert.equal(supabaseConfig({NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public'}).url,'https://example.supabase.co');
});
test('Supabase favorites scope queries to verified owner and preserve stored evidence',async()=>{
 const {repository,calls}=setup(()=>Response.json([{facility_id:'hospital:1',type:'hospital',name:{ko:'가상 병원',en:'Test'},address:'가상 지역',created_at:'2026-11-15T00:00:00Z'}]));
 const rows=await repository.listFavorites(uid);
 assert.equal(calls[0].url.searchParams.get('user_id'),'eq.'+uid);
 assert.equal(rows[0].id,'hospital:1');assert.equal(rows[0].created_at,'2026-11-15T00:00:00Z');
 assert.equal(rows[0].facility_id,undefined);
});
test('settings patch uses atomic authenticated RPC without request user ID',async()=>{
 const {repository,calls}=setup(()=>Response.json({preference:'open'}));
 await repository.patchSettings(uid,{preference:'open'});
 assert.equal(calls[0].url.pathname,'/rest/v1/rpc/capstone_patch_settings');
 assert.deepEqual(JSON.parse(calls[0].body),{patch:{preference:'open'}});
});
test('favorite writes preserve original timestamp on duplicates and translate DB limit error',async()=>{
 const {repository,calls}=setup(()=>Response.json({code:'P0001',message:'favorite_limit_20'},{status:400}));
 await assert.rejects(repository.setFavorite(uid,{favorite:true,facility:{id:'hospital:1',type:'hospital',name:{ko:'테스트',en:'Test'},address:''}}),FavoriteLimitError);
 assert.match(new Headers(calls[0].headers).get('prefer'),/resolution=ignore-duplicates/);
 assert.equal(JSON.parse(calls[0].body).created_at,undefined);
});
test('missing provenance is not presented as an explicit user preference',async()=>{
 const {repository}=setup(()=>Response.json(null));
 assert.deepEqual(await repository.readExplicitSettings(uid),{preference:false,personalization:false});
});
