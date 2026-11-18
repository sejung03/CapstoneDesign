import {sameOrigin} from '../../../lib/supabase/auth.js';
import {supabaseConfig} from '../../../lib/supabase/config.js';
import {createCareHandler,createRefStore} from '../../../lib/care-engine-server.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// 엔진 데이터: Supabase ref 스키마(검사 통과 시) → 실패하면 같은 버전의 시드 CSV
// 읽기는 요청을 기다리게 하지 않는다(처음엔 CSV, 읽기가 끝나면 Supabase). 모듈이 로드될 때 미리 읽기 시작.
const refStore=createRefStore({supabaseConfig:()=>supabaseConfig()});
void refStore.warm();
const handle=createCareHandler({sameOrigin,refStore});
export const POST=handle;
