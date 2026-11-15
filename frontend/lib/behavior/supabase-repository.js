import {FavoriteLimitError} from './validation.js';
// The authenticated client keeps RLS active. Never use a service-role key here.
export function createSupabaseBehaviorRepository(client){
 const result=async query=>{const {data,error}=await query;if(error?.message?.includes('favorite_limit_20'))throw new FavoriteLimitError();if(error)throw error;return data;};
 return {
  readSettings:id=>result(client.from('capstone_search_setting').select('*').eq('user_id',id).maybeSingle()),
  async readExplicitSettings(id){const row=await result(client.from('capstone_search_setting').select('preference_explicit,personalization_explicit').eq('user_id',id).maybeSingle());return {preference:row?.preference_explicit===true,personalization:row?.personalization_explicit===true};},
  patchSettings:(_id,patch)=>result(client.rpc('capstone_patch_settings',{patch})),
  async listFavorites(id){const rows=await result(client.from('capstone_favorite').select('facility_id,type,name,address,created_at').eq('user_id',id).order('created_at').order('facility_id'));return rows.map(({facility_id,...row})=>({id:facility_id,...row}));},
  setFavorite(id,{facility,favorite}){if(!favorite)return result(client.from('capstone_favorite').delete().eq('user_id',id).eq('facility_id',facility.id));const {id:facility_id,...fields}=facility;return result(client.from('capstone_favorite').upsert({user_id:id,facility_id,...fields},{onConflict:'user_id,facility_id',ignoreDuplicates:true}));},
  deleteAll:()=>result(client.rpc('capstone_delete_behavior')),
 };
}
