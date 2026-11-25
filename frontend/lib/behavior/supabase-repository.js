import {FavoriteLimitError} from './validation.js';
// The authenticated client keeps RLS active. Never use a service-role key here.
// Facility counts: public.capstone_facility_choice (frontend/supabase/migrations/202611250001_capstone_facility_choice.sql).
// Department counts: app.department_choice (data_pipeline/db/migrations/007_app_department_choice.sql), consent-gated by RLS.
export function createSupabaseBehaviorRepository(client){
 const result=async query=>{const {data,error}=await query;if(error?.message?.includes('favorite_limit_20'))throw new FavoriteLimitError();if(error)throw error;return data;};
 return {
  readSettings:id=>result(client.from('capstone_search_setting').select('*').eq('user_id',id).maybeSingle()),
  async readExplicitSettings(id){const row=await result(client.from('capstone_search_setting').select('preference_explicit,personalization_explicit').eq('user_id',id).maybeSingle());return {preference:row?.preference_explicit===true,personalization:row?.personalization_explicit===true};},
  patchSettings:(_id,patch)=>result(client.rpc('capstone_patch_settings',{patch})),
  async listFavorites(id){const rows=await result(client.from('capstone_favorite').select('facility_id,type,name,address,created_at').eq('user_id',id).order('created_at').order('facility_id'));return rows.map(({facility_id,...row})=>({id:facility_id,...row}));},
  setFavorite(id,{facility,favorite}){if(!favorite)return result(client.from('capstone_favorite').delete().eq('user_id',id).eq('facility_id',facility.id));const {id:facility_id,...fields}=facility;return result(client.from('capstone_favorite').upsert({user_id:id,facility_id,...fields},{onConflict:'user_id,facility_id',ignoreDuplicates:true}));},
  deleteAll:()=>result(client.rpc('capstone_delete_behavior')),
  // Returns the new count, or null when the DB skipped it (personalization off).
  recordFacilityChoice:(_id,facility)=>result(client.rpc('capstone_record_facility_choice',{facility})),
  // Returns the new count, or null when health storage consent is missing.
  recordDepartmentChoice:(_id,key)=>result(client.schema('app').rpc('record_department_choice',{p_department:key})),
  async listFacilityChoices(id){const rows=await result(client.from('capstone_facility_choice').select('facility_id,type,name,choice_count,updated_at').eq('user_id',id).order('choice_count',{ascending:false}).order('updated_at',{ascending:false}));return rows.map(({facility_id,choice_count,...row})=>({id:facility_id,count:choice_count,...row}));},
  async listDepartmentChoices(id){const rows=await result(client.schema('app').from('department_choice').select('department_key,choice_count,updated_at').eq('user_id',id).order('choice_count',{ascending:false}).order('updated_at',{ascending:false}));return rows.map(({department_key,choice_count,updated_at})=>({key:department_key,count:choice_count,updated_at}));},
  async deleteFacilityChoices(id){return (await result(client.from('capstone_facility_choice').delete().eq('user_id',id).select('facility_id'))).length;},
  async deleteDepartmentChoices(id){return (await result(client.schema('app').from('department_choice').delete().eq('user_id',id).select('department_key'))).length;},
 };
}
