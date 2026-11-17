export function supabaseConfig(env = process.env) {
 const raw=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!raw||!key)throw Error('supabase_not_configured');
 const url=new URL(raw);
 if(url.pathname!=='/'||url.search||url.hash)throw Error('Use the project URL without /rest/v1/');
 return {url:url.origin,key};
}
