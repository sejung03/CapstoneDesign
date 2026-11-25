import {createHmac, timingSafeEqual} from 'node:crypto';

const cookie = 'capstone_voice_preview';
// 외부 음성 인식 동의는 업체별로 따로 받는다. 업체가 바뀌면 이전 업체 기준의 동의 쿠키는 통하지 않는다(서명에 범위가 들어감).
// 브라우저(voice-client.mjs)의 x-voice-consent 값과 같아야 한다.
export const VOICE_CONSENT_SCOPES = Object.freeze({openai:'openai-stt-preview-v1', baze:'baze-stt-v1'});
const lifetime = 3600;
const extensions = {'audio/webm':'webm', 'audio/mp4':'mp4', 'audio/ogg':'ogg', 'audio/wav':'wav'};
const respond = (detail, status) => Response.json({detail}, {status,headers:{'Cache-Control':'no-store'}});
const signature = (expiry, secret, scope) => createHmac('sha256', secret).update(scope+':'+expiry).digest('hex');
const grantCookie = request => request.headers.get('cookie')?.split(';').map(item=>item.trim())
  .find(item=>item.startsWith(cookie+'='))?.slice(cookie.length+1) || '';

export function hasVoiceGrant(request, secret, scope = VOICE_CONSENT_SCOPES.openai, now = Math.floor(Date.now()/1000)) {
  if (!secret) return false;
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(grantCookie(request));
  if (!match || Number(match[1]) <= now) return false;
  return timingSafeEqual(Buffer.from(match[2]),Buffer.from(signature(match[1],secret,scope)));
}

/** 동의 쿠키의 서명 부분. 브라우저별 업로드 횟수 제한의 키로만 쓴다(검증은 hasVoiceGrant). */
export function voiceGrantKey(request) { return grantCookie(request).split('.')[1] || ''; }

export async function grantVoice(request, secret, scope = VOICE_CONSENT_SCOPES.openai, now = Math.floor(Date.now()/1000)) {
  if (!secret) return respond('voice_service_unavailable',503);
  // A dedicated action and header require an explicit acknowledgement from our own UI.
  if (request.headers.get('x-voice-consent') !== scope) return respond('voice_consent_required',403);
  const expiry = String(now+lifetime);
  const value = expiry+'.'+signature(expiry,secret,scope);
  return new Response(null,{status:204,headers:{
    'Cache-Control':'no-store',
    'Set-Cookie':cookie+'='+value+'; Path=/api/voice; Max-Age='+lifetime+'; HttpOnly; Secure; SameSite=Strict',
  }});
}

export async function transcribeManaged(request, mime, body, {apiKey, fetchImpl, language='ko'}) {
  if (!apiKey) return respond('voice_service_unavailable',503);
  try {
    const form = new FormData();
    form.set('file',new Blob([body],{type:mime}),'recording.'+extensions[mime]);
    form.set('model','gpt-transcribe');
    form.set('language',language);
    const res = await fetchImpl('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{Authorization:'Bearer '+apiKey},body:form,
      redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)]),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return respond(res.status===429?'stt_busy':'stt_unavailable',res.status===429?429:503);
    }
    const value = await res.json();
    const text = typeof value?.text==='string'?value.text.trim():'';
    if (!text) return respond('no_speech',422);
    return Response.json({text:text.slice(0,1000)},{headers:{'Cache-Control':'no-store'}});
  } catch (cause) {
    return cause?.name==='TimeoutError'?respond('voice_timeout',504):respond('stt_unavailable',503);
  }
}
