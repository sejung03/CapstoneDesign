import {CARE_CONSENT_VERSION} from '../care-adapter.mjs';

// 녹음을 외부 음성 인식으로 보내는 일은 건강정보 수집·이용 동의(health-consent.mjs careAiHealthNotice)에 포함된다.
// 따로 동의 쿠키를 만들지 않고, 브라우저가 동의한 안내 버전을 x-health-consent로 보내면 지금 버전과 같은지만 본다
// (/api/care가 OpenAI 전송 동의를 확인하는 방식과 같다). 안내 버전이 바뀌면 이전 동의로는 보낼 수 없다.
export function hasHealthConsentForVoice(request) {
  return request.headers.get('x-health-consent') === CARE_CONSENT_VERSION;
}

/** 업로드 횟수 제한(BAZE 비용) 키: 접속 주소. Vercel은 x-real-ip / x-forwarded-for에 넣는다 */
export function voiceClientKey(request) {
  return request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'anonymous';
}

const extensions = {'audio/webm':'webm', 'audio/mp4':'mp4', 'audio/ogg':'ogg', 'audio/wav':'wav'};
const respond = (detail, status) => Response.json({detail}, {status,headers:{'Cache-Control':'no-store'}});

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
