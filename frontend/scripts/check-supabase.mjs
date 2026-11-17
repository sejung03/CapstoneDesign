import {createClient} from '@supabase/supabase-js';
import {supabaseConfig} from '../lib/supabase/config.js';
const {url,key}=supabaseConfig();
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
let blocked=false;
const response=await fetch(url+'/auth/v1/settings',{headers:{apikey:key},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw Error('Auth endpoint returned '+response.status);
const settings=await response.json();
console.log('Supabase Auth: reachable');
console.log('Kakao provider:',settings.external?.kakao?'enabled':'DISABLED');
if(!settings.external?.kakao)blocked=true;
for(const table of ['capstone_account_consents','capstone_search_setting','capstone_favorite']){
 const {data,error}=await client.from(table).select('*').limit(0);
 if(error?.code==='42501')console.log(table+': anonymous access denied (expected; authenticated RLS still needs testing)');
 else if(error){blocked=true;console.log(table+': '+error.code+' '+error.message);}
 else {blocked=true;console.log(table+': anonymous SELECT permitted; review grants/RLS');}
}
if(blocked){console.log('Setup incomplete. See docs/SUPABASE.md.');process.exitCode=1;}
