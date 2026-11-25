import {sameOrigin,verifiedAccount} from '../../../lib/supabase/auth.js';
import {supabaseConfig} from '../../../lib/supabase/config.js';
import {createCareHandler,createRefStore} from '../../../lib/care-engine-server.mjs';
import {createBehaviorService} from '../../../lib/behavior/service.js';
import {createSupabaseBehaviorRepository} from '../../../lib/behavior/supabase-repository.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// 엔진 데이터: Supabase ref 스키마(검사 통과 시) → 실패하면 같은 버전의 시드 CSV
// 읽기는 요청을 기다리게 하지 않는다(처음엔 CSV, 읽기가 끝나면 Supabase). 모듈이 로드될 때 미리 읽기 시작.
const refStore=createRefStore({supabaseConfig:()=>supabaseConfig()});
void refStore.warm();
// 추천 순위용: 가입을 마친 로그인 사용자의 자주 쓴 기관 횟수. 비회원·개인화 OFF면 null
async function frequentCounts(){
 const {client,user,ready}=await verifiedAccount();
 if(!ready||!user)return null;
 return createBehaviorService({repository:createSupabaseBehaviorRepository(client)}).getFrequentFacilityCounts({user:{id:user.id}});
}
const handle=createCareHandler({sameOrigin,refStore,frequentCounts});
export const POST=handle;
