import {sameOrigin} from '../../../../lib/supabase/auth.js';
import {forwardVoice} from '../../../../lib/voice-server.mjs';

export const runtime = 'nodejs';
// BAZE: 업로드(최대 15초) + 결과 대기(최대 8초). 그 뒤는 브라우저가 stt-status로 이어서 묻는다.
export const maxDuration = 30;

export async function POST(request, {params}) {
  const {action} = await params;
  return forwardVoice(request, action, {sameOrigin});
}
