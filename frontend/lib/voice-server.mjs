import {hasHealthConsentForVoice, transcribeManaged, voiceClientKey} from './voice-managed.mjs';
import {transcribeBaze, bazeStatus, createUploadLimiter} from './voice-baze.mjs';

const voiceLanguages=new Set(['ko','en','zh','vi','uz']);
const audioTypes = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav']);
const headers = {'cache-control': 'no-store'};
const error = (code, status) => Response.json({detail: code}, {status, headers});

async function readBody(request, limit) {
  if (!request.body) return Buffer.alloc(0);
  if (Number(request.headers.get('content-length')) > limit) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return Buffer.concat(chunks, length);
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

// BAZE 업로드는 비용이 드니 접속 주소별로 횟수를 제한한다. 서버 인스턴스마다 따로 센다.
const bazeUploads = createUploadLimiter();

// 외부 음성 인식(VOICE_STT_PROVIDER=openai|baze)은 배포 환경 구분 없이 설정과 사용자 동의를 확인한다.
// 동의는 건강정보 수집·이용 동의 하나로 받는다(따로 음성 동의를 받지 않음, voice-managed.mjs hasHealthConsentForVoice).
export async function forwardVoice(request, action, {sameOrigin, fetchImpl = fetch, env = process.env, allowUpload = bazeUploads}) {
  if (env.NEXT_PUBLIC_VOICE_ENABLED !== '1' || !['stt', 'tts', 'stt-status'].includes(action)) {
    return error('voice_disabled', 404);
  }
  if (!sameOrigin(request)) return error('invalid_origin', 403);

  const provider = env.VOICE_STT_PROVIDER || (env.NEXT_PUBLIC_VOICE_EXTERNAL_STT === '1' ? 'openai' : undefined);
  const managed = provider === 'openai' || provider === 'baze';
  if (managed && action === 'tts') return error('voice_disabled',404);
  if (action === 'stt-status' && provider !== 'baze') return error('voice_disabled',404);
  if (managed && !hasHealthConsentForVoice(request)) return error('voice_consent_required',403);

  const contentType = request.headers.get('content-type') || '';
  const mime = contentType.split(';')[0].trim();
  const stt = action === 'stt';
  if (stt ? !audioTypes.has(mime) || (provider === 'baze' && mime !== 'audio/wav') : mime !== 'application/json') {
    return error('unsupported_media_type', 415);
  }

  let body;
  try {
    body = await readBody(request, stt ? 4 * 1024 * 1024 : 8192);
  } catch {
    return error('invalid_body', 400);
  }
  if (!body) return error('body_too_large', 413);
  if (!body.length) return error('empty_body', 400);

  const bazeOptions = {apiKey:env.BAZE_API_KEY,baseUrl:env.BAZE_BASE_URL||undefined,model:env.BAZE_STT_MODEL||undefined,fetchImpl,secret:env.VOICE_CONSENT_SECRET};
  if (action === 'stt-status') return bazeStatus(request,body,bazeOptions);

  const requestedLanguage=request.headers.get('x-voice-language');
  if(requestedLanguage&&!voiceLanguages.has(requestedLanguage))return error('invalid_voice_language',400);
  const language=requestedLanguage||'ko';
  if (provider === 'baze') {
    if (!allowUpload(voiceClientKey(request))) return error('stt_busy',429);
    return transcribeBaze(request,body,{...bazeOptions,language});
  }
  if (managed) return transcribeManaged(request,mime,body,{apiKey:env.OPENAI_API_KEY,fetchImpl,language});

  const port = Number(env.VOICE_SERVICE_PORT || 3091);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return error('invalid_voice_port', 503);
  }

  try {
    const upstream = await fetchImpl('http://127.0.0.1:' + port + '/' + action, {
      method: 'POST',
      headers: {'content-type': mime,'x-voice-language':language},
      body,
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(stt ? 180000 : 30000)]),
    });
    const type = upstream.headers.get('content-type')?.split(';')[0];
    if (type !== (upstream.ok && !stt ? 'audio/wav' : 'application/json')) {
      void upstream.body?.cancel().catch(() => {});
      return error('invalid_voice_response', 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {...headers, 'content-type': type},
    });
  } catch (cause) {
    return cause.name === 'TimeoutError'
      ? error('voice_timeout', 504)
      : error('voice_service_unavailable', 503);
  }
}
