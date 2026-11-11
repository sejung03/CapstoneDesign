export const healthProfileFields=['age','allergies','medications','history'];
export function normalizeAge(value){const text=String(value??'').trim();return /^\d{1,3}$/.test(text)&&Number(text)<=120?String(Number(text)):'';}
export function hasProfileChanges(profile,draft){return healthProfileFields.some(key=>String(profile[key]??'')!==String(draft[key]??''));}
export const PROFILE_KEY='medical-profile-v1'; // Legacy key: remove, never restore health fields.
export const SETTINGS_KEY='medical-search-settings-v1';
export function emptyProfile(){return {nickname:'',age:'',region:'',preference:'distance',allergies:'',medications:'',history:''};}
export function cleanProfile(value={}){
 if(!value||typeof value!=='object')value={};
 const text=(key,max)=>String(value[key]??'').trim().slice(0,max);
 return {nickname:text('nickname',40),age:normalizeAge(value.age),region:text('region',80),preference:['distance','open','access'].includes(value.preference)?value.preference:'distance',allergies:text('allergies',500),medications:text('medications',500),history:text('history',500)};
}
export function cleanSearchSettings(value){
 const profile=cleanProfile(value);
 return {region:profile.region,preference:profile.preference};
}
export function loadProfile(storage){
 const fallback={profile:emptyProfile(),remember:false,storageError:false};
 try{
  const legacy=storage.getItem(PROFILE_KEY);
  if(legacy!==null)storage.removeItem(PROFILE_KEY);
  const raw=storage.getItem(SETTINGS_KEY);
  if(raw!==null){
   let saved;try{saved=JSON.parse(raw);}catch{}
   if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
    const settings=cleanSearchSettings(saved);
    // Scrub unexpected fields even if an older client populated this key.
    storage.setItem(SETTINGS_KEY,JSON.stringify(settings));
    return {profile:{...emptyProfile(),...settings},remember:true,storageError:false};
   }
   storage.removeItem(SETTINGS_KEY);
  }
  if(legacy){
   try{return {...fallback,profile:{...emptyProfile(),...cleanSearchSettings(JSON.parse(legacy))}};}catch{}
  }
  return fallback;
 }catch{return {...fallback,storageError:true};}
}
export function persistProfile(storage,value,remember){
 try{
  storage.removeItem(PROFILE_KEY);
  if(remember)storage.setItem(SETTINGS_KEY,JSON.stringify(cleanSearchSettings(value)));
  else storage.removeItem(SETTINGS_KEY);
  return true;
 }catch{return false;}
}
export function renderProfile(state,t,escape){
 const p=state.profileDraft;
 const select=(key,items)=>'<select id="profile-'+key+'">'+items.map(([value,label])=>'<option value="'+value+'"'+(p[key]===value?' selected':'')+'>'+t(label)+'</option>').join('')+'</select>';
 const input=(key,label,max)=>'<div class="profile-field"><label for="profile-'+key+'">'+t(label)+'</label><input id="profile-'+key+'" maxlength="'+max+'" value="'+escape(p[key])+'"></div>';
 const notes=(key,label)=>'<div class="profile-field"><label for="profile-'+key+'">'+t(label)+' <span>'+t('optionalText')+'</span></label><textarea id="profile-'+key+'" maxlength="500" rows="2">'+escape(p[key])+'</textarea></div>';
 return '<section class="profile-view" aria-labelledby="profile-heading"><div class="profile-title"><h1 id="profile-heading" tabindex="-1">'+t('myInfo')+'</h1><p>'+t('profileCopy')+'</p></div>'+(state.profileStorageNotice?'<p class="field-error" role="alert">'+t('profileStorageNotice')+'</p>':'')+'<form id="profile-form" class="profile-form"><div class="profile-basic"><h2>'+t('profileBasics')+'</h2><div class="profile-grid">'+input('nickname','profileNickname',40)+'<div class="profile-field"><label for="profile-age">'+t('profileAge')+'</label>'+'<input id="profile-age" type="number" min="0" max="120" step="1" value="'+escape(p.age)+'">'+'</div>'+input('region','profileRegion',80)+'<div class="profile-field"><label for="profile-preference">'+t('profilePreference')+'</label>'+select('preference',[['distance','preferDistance'],['open','preferOpen'],['access','preferAccess']])+'</div></div><p class="profile-help">'+t('profileUsage')+'</p></div><div class="profile-health"><h2>'+t('profileHealth')+'</h2>'+notes('allergies','profileAllergies')+notes('medications','profileMedications')+notes('history','profileHistory')+'</div><div class="profile-save"><label class="remember-profile"><input id="profile-remember" type="checkbox"'+(state.profileRemember?' checked':'')+'><span>'+t('profileRemember')+'</span></label><p>'+t('profileStorage')+'</p><div><button class="primary-button" type="submit">'+t('profileSave')+'</button><button id="profile-delete" class="text-button danger" type="button">'+t('profileDelete')+'</button></div></div></form></section>';
}
