// 문진 엔진 데이터를 Supabase ref 스키마에서 읽는다(서버 전용). 엔진은 같은 검사(loadIntakeDataFromRows)를 거친 뒤에만 쓴다.
// 읽을 수 없거나 검사에 실패하면 null을 돌려주고, 처리기는 같은 버전의 시드 CSV로 계속 동작한다.

/** 엔진이 읽는 표와 정렬 키(시드 CSV와 같은 순서로 받기 위해 기본 키 순). */
export const REF_TABLES=Object.freeze({
 data_version:'version',
 questionnaire:'id',
 questionnaire_item:'order_no,link_id',
 questionnaire_answer_option:'link_id,order_no',
 questionnaire_enable_when:'id',
 safety_rule:'rule_id',
 safety_rule_condition:'id',
 output_mapping:'id',
 department:'dept_id',
 symptom:'symptom_id',
 symptom_department:'symptom_id',
 symptom_department_variant:'symptom_id,sex,age_band,rank',
 symptom_synonym:'id',
 fallback_department:'grp,rank',
 app_config:'key',
 // 다국어 번역(005_ref_i18n.sql). DB에 아직 없으면 읽기가 실패하고 같은 버전의 시드 CSV(번역 포함)로 동작한다.
 text_i18n:'target,key,locale',
});
const PAGE=1000;

/** ref 표 전체를 읽는다. 표마다 1000행씩 나눠 받는다. */
export async function fetchRefTables({url,key,fetchImpl=fetch,signal}={}){
 if(!url||!key)throw new Error('supabase_not_configured');
 const headers={apikey:key,Authorization:`Bearer ${key}`,'Accept-Profile':'ref'};
 const tables={};
 for(const [name,order] of Object.entries(REF_TABLES)){
  const rows=[];
  for(let offset=0;;offset+=PAGE){
   const query=`${url}/rest/v1/${name}?select=*&order=${order.split(',').map(c=>c+'.asc').join(',')}&limit=${PAGE}&offset=${offset}`;
   const response=await fetchImpl(query,{headers,signal});
   if(!response.ok)throw new Error(`ref_${name}_${response.status}`);
   const page=await response.json();
   if(!Array.isArray(page))throw new Error(`ref_${name}_shape`);
   rows.push(...page);
   if(page.length<PAGE)break;
  }
  tables[name]=rows;
 }
 return tables;
}

/**
 * Supabase에서 엔진 데이터를 만들어 캐시한다(기본 10분). 요청은 읽기를 기다리지 않는다:
 * 캐시가 없으면 뒤에서 읽기를 시작하고 null(호출 측이 같은 버전 CSV로 동작), 캐시가 오래되면 지난 캐시를 쓰며 뒤에서 새로 읽는다.
 * 읽기에 실패하면 60초 뒤에 다시 시도한다. (첫 읽기가 4~6초 걸려 프론트 8초 제한에 걸리지 않게 하기 위함)
 * @param {{config:()=>({url:string,key:string}), buildData:(tables:object)=>object, ttlMs?:number, now?:()=>number, onError?:(e:Error)=>void}} options
 */
export function createSupabaseRefStore({config,buildData,fetchImpl=fetch,ttlMs=10*60*1000,now=Date.now,onError=()=>{}}){
 let cached=null,loadedAt=0,pending=null,retryAfter=0;
 const refresh=()=>{
  pending??=(async()=>{
   try{
    const {url,key}=config();
    cached=buildData(await fetchRefTables({url,key,fetchImpl,signal:AbortSignal.timeout(15000)}));loadedAt=now();
   }catch(error){retryAfter=now()+60*1000;onError(error);}
   finally{pending=null;}
  })();
  return pending;
 };
 function getData(){
  if(!(cached&&now()-loadedAt<ttlMs)&&now()>=retryAfter)void refresh();
  return cached;
 }
 /** 서버 시작 때 미리 읽기(테스트에서는 읽기가 끝날 때까지 기다리는 데 쓴다). */
 getData.ready=()=>pending??Promise.resolve();
 return getData;
}
