// BAZE AI 게이트웨이(마인드로직) 음성 인식. 엔진은 Soniox(기본 모델 stt-async-v5).
// 요청 형식은 BAZE 공식 CLI(@mindlogic-ai/baze 0.1.0, dist/commands/gen.js)와 같다:
//   POST {base}/audio/transcriptions/  form: file, model, language_hints(여러 번), enable_speaker_diarization=false
//        → {operation_id, credits_charged?}
//   GET  {base}/audio/transcriptions/{operation_id}/  → {status, text?, error?}
//        status가 processing·pending·submitted면 아직 진행 중, completed면 끝, 그 밖은 실패.
// 브라우저가 16kHz·모노·16bit PCM WAV로 바꿔 보낸다(BAZE가 webm은 길이를 못 읽어 거부함). 서버는 형식만 검사하고 그대로 넘긴다.
// 음성·받아쓴 글자는 저장하거나 로그에 남기지 않는다. 비용은 업로드 시점에 청구되므로(1분당 6크레딧) 업로드 전에 형식·길이를 막는다.
import {createHmac, timingSafeEqual} from 'node:crypto';

export const BAZE_DEFAULT_BASE_URL = 'https://factchat-cloud.mindlogic.ai/v1/gateway';
// Soniox 안내: stt-async-v5는 2026-12-15 제거 예정(이후 v6로 자동 전환). BAZE_STT_MODEL로 바꿀 수 있다.
export const BAZE_DEFAULT_MODEL = 'stt-async-v5';
export const BAZE_MAX_SECONDS = 30;
const SAMPLE_RATE = 16000;
const RUNNING = new Set(['processing', 'pending', 'submitted']);
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const TOKEN_LIFETIME = 600; // 결과 확인용 토큰 10분
const headers = {'Cache-Control': 'no-store'};
const respond = (detail, status) => Response.json({detail}, {status, headers});

/** 16kHz·모노·16bit PCM WAV인지 보고 길이(초)를 돌려준다. 아니면 null. */
export function readWavInfo(buffer) {
  if (!buffer || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12, fmt = null, dataBytes = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= buffer.length) {
      fmt = {format: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2), sampleRate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14)};
    } else if (id === 'data') {
      dataBytes = Math.min(size, buffer.length - body);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || dataBytes === null || fmt.format !== 1 || fmt.channels !== 1 || fmt.sampleRate !== SAMPLE_RATE || fmt.bits !== 16) return null;
  return {...fmt, dataBytes, seconds: dataBytes / (SAMPLE_RATE * 2)};
}

const tokenSignature = (id, expiry, secret) => createHmac('sha256', secret).update('baze-stt-op:' + id + ':' + expiry).digest('hex');
/** 작업 ID를 서명해 브라우저에 준다. 브라우저는 이 토큰으로만 결과를 물을 수 있다(남의 작업 ID를 넣어 볼 수 없음). */
export function signOperation(id, secret, now = Math.floor(Date.now() / 1000)) {
  const expiry = String(now + TOKEN_LIFETIME);
  return id + '.' + expiry + '.' + tokenSignature(id, expiry, secret);
}
export function verifyOperation(token, secret, now = Math.floor(Date.now() / 1000)) {
  const match = typeof token === 'string' && secret ? /^([A-Za-z0-9_-]{1,128})\.(\d{10})\.([a-f0-9]{64})$/.exec(token) : null;
  if (!match || Number(match[2]) <= now) return null;
  const expected = Buffer.from(tokenSignature(match[1], match[2], secret));
  return timingSafeEqual(Buffer.from(match[3]), expected) ? match[1] : null;
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, {once: true});
});

/** 결과를 until(ms 시각)까지 확인한다. {state:'completed',text} | {state:'pending'} | {state:'failed'} */
async function pollResult(id, {base, apiKey, fetchImpl, signal, until, interval = 700, now = Date.now}) {
  for (;;) {
    let res;
    try {
      res = await fetchImpl(base + '/audio/transcriptions/' + id + '/', {
        headers: {Authorization: 'Bearer ' + apiKey}, redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)].filter(Boolean)),
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      res = null; // 네트워크 오류·시간 초과는 다시 확인해 볼 만하다
    }
    if (res && res.ok) {
      const value = await res.json().catch(() => null);
      const status = typeof value?.status === 'string' ? value.status : '';
      if (status === 'completed') return {state: 'completed', text: typeof value.text === 'string' ? value.text.trim() : ''};
      if (!RUNNING.has(status)) return {state: 'failed'};
    } else if (res) {
      await res.body?.cancel().catch(() => {});
      if (res.status !== 429 && res.status < 500) return {state: 'failed'}; // 401·403·404는 기다려도 소용없다
    }
    if (now() + interval > until) return {state: 'pending'};
    await sleep(interval, signal);
  }
}

function result(outcome, id, secret) {
  if (outcome.state === 'completed') {
    if (!outcome.text) return respond('no_speech', 422);
    return Response.json({text: outcome.text.slice(0, 1000)}, {headers});
  }
  if (outcome.state === 'pending') return Response.json({pending: true, token: signOperation(id, secret)}, {status: 202, headers});
  return respond('stt_unavailable', 503);
}

/**
 * 녹음(WAV)을 BAZE에 올리고 waitMs까지 결과를 기다린다. 그 안에 안 끝나면 202 {pending, token}을 돌려주고
 * 브라우저가 stt-status로 이어서 묻는다(Vercel 함수 실행 시간 안에 끝내기 위해).
 */
export async function transcribeBaze(request, body, {apiKey, baseUrl = BAZE_DEFAULT_BASE_URL, model = BAZE_DEFAULT_MODEL, fetchImpl = fetch, language = 'ko', secret, waitMs = 8000, now = Date.now}) {
  if (!apiKey || !secret) return respond('voice_service_unavailable', 503);
  const info = readWavInfo(body);
  if (!info) return respond('invalid_audio', 422);
  if (info.seconds > BAZE_MAX_SECONDS + 0.5) return respond('recording_too_long', 413);
  if (info.seconds < 0.2) return respond('no_speech', 422);
  const base = String(baseUrl).replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) return respond('voice_service_unavailable', 503);
  const started = now();
  let operationId;
  try {
    const form = new FormData();
    form.set('file', new Blob([body], {type: 'audio/wav'}), 'recording.wav');
    form.set('model', model);
    for (const hint of [...new Set([language, 'ko'])]) form.append('language_hints', hint);
    form.set('enable_speaker_diarization', 'false');
    const res = await fetchImpl(base + '/audio/transcriptions/', {
      method: 'POST', headers: {Authorization: 'Bearer ' + apiKey}, body: form, redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return res.status === 429 ? respond('stt_busy', 429) : respond('stt_unavailable', 503);
    }
    const value = await res.json().catch(() => null);
    operationId = typeof value?.operation_id === 'string' && ID_RE.test(value.operation_id) ? value.operation_id : null;
    if (!operationId) return respond('stt_unavailable', 503);
    const outcome = await pollResult(operationId, {base, apiKey, fetchImpl, signal: request.signal, until: started + waitMs, now});
    return result(outcome, operationId, secret);
  } catch (cause) {
    return cause?.name === 'TimeoutError' ? respond('voice_timeout', 504) : respond('stt_unavailable', 503);
  }
}

/** 브라우저가 받은 토큰으로 결과를 묻는다. 서버는 waitMs까지 기다려 보고, 아직이면 같은 토큰을 다시 준다. */
export async function bazeStatus(request, body, {apiKey, baseUrl = BAZE_DEFAULT_BASE_URL, fetchImpl = fetch, secret, waitMs = 6000, now = Date.now}) {
  if (!apiKey || !secret) return respond('voice_service_unavailable', 503);
  let token;
  try { token = JSON.parse(body.toString('utf8'))?.token; } catch { return respond('invalid_body', 400); }
  const id = verifyOperation(token, secret);
  if (!id) return respond('invalid_operation', 403);
  const base = String(baseUrl).replace(/\/+$/, '');
  try {
    const outcome = await pollResult(id, {base, apiKey, fetchImpl, signal: request.signal, until: now() + waitMs, now});
    return result(outcome, id, secret);
  } catch (cause) {
    return cause?.name === 'TimeoutError' ? respond('voice_timeout', 504) : respond('stt_unavailable', 503);
  }
}

/** 한 브라우저(음성 동의 쿠키)당 업로드 횟수 제한. 서버 인스턴스마다 따로 센다(완전한 보호는 아님, 비용 폭주 완화용). */
export function createUploadLimiter({limit = 20, windowMs = 10 * 60 * 1000, now = Date.now} = {}) {
  const hits = new Map();
  return key => {
    const t = now(), recent = (hits.get(key) || []).filter(at => t - at < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(t); hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(at => t - at < windowMs)) hits.delete(k);
    return true;
  };
}
