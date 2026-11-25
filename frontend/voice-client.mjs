import {normalizeLocale} from './i18n.mjs';

export const voiceEnabled = process.env.NEXT_PUBLIC_VOICE_ENABLED === '1';

export const managedVoice = process.env.NEXT_PUBLIC_VOICE_EXTERNAL_STT === '1';
// 외부 음성 인식 업체. 서버의 VOICE_STT_PROVIDER와 같게 둔다(다르면 동의 범위가 맞지 않아 서버가 거절한다).
export const voiceSttProvider = process.env.NEXT_PUBLIC_VOICE_STT_PROVIDER === 'baze' ? 'baze' : 'openai';
// lib/voice-managed.mjs VOICE_CONSENT_SCOPES와 같아야 한다
const consentScope = voiceSttProvider === 'openai' ? 'openai-stt-preview-v1' : 'baze-stt-v1';

export async function grantManagedVoice() {
  const response = await fetch('/api/voice/consent',{
    method:'POST',headers:{'x-voice-consent':consentScope},
  });
  return response.ok;
}

// ---- BAZE용 녹음 변환: 16kHz·모노·16bit PCM WAV (BAZE가 webm은 길이를 못 읽어 거부한다) ----
// 서버 FFmpeg 대신 브라우저에서 한다: 80Hz 이하·7600Hz 이상을 깎고, 앞뒤 무음을 자르고, 음량을 맞춘다.
const WAV_RATE = 16000, MAX_SECONDS = 30;

/** 앞뒤 무음을 자르고(앞뒤 0.2초 여유) 최고 음량을 -1dBFS 근처로 맞춘다. 소리가 없으면 'no_speech'. */
export function trimAndNormalize(samples, rate = WAV_RATE) {
  const win = Math.max(1, Math.round(rate * 0.02)), rms = [];
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / (end - i)));
  }
  const loudest = Math.max(0, ...rms), threshold = Math.max(0.005, loudest * 0.08);
  const first = rms.findIndex(value => value >= threshold), last = rms.findLastIndex(value => value >= threshold);
  if (loudest < 0.005 || first < 0) throw new Error('no_speech');
  const pad = Math.round(rate * 0.2), start = Math.max(0, first * win - pad), stop = Math.min(samples.length, (last + 1) * win + pad);
  const out = samples.slice(start, stop);
  let peak = 0;for (const value of out) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 0 ? Math.min(10, 0.89 / peak) : 1; // 잡음을 지나치게 키우지 않도록 최대 10배
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * gain));
  return out;
}

/** Float32 샘플 → 16bit PCM WAV Blob */
export function encodeWav(samples, rate = WAV_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF');view.setUint32(4, 36 + samples.length * 2, true);text(8, 'WAVE');
  text(12, 'fmt ');view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);view.setUint32(28, rate * 2, true);view.setUint16(32, 2, true);view.setUint16(34, 16, true);
  text(36, 'data');view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 0x7fff), true);
  return new Blob([buffer], {type: 'audio/wav'});
}

/** 브라우저 녹음(webm·mp4·ogg) → 16kHz 모노 WAV. 해독하지 못하면 'invalid_audio'. */
export async function toWav16k(recording, {AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext, Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext} = {}) {
  if (!AudioCtx || !Offline) throw new Error('invalid_audio');
  const context = new AudioCtx();
  let decoded;
  try { decoded = await context.decodeAudioData(await recording.arrayBuffer()); }
  catch { throw new Error('invalid_audio'); }
  finally { void context.close?.().catch(() => {}); }
  const length = Math.max(1, Math.ceil(Math.min(decoded.duration, MAX_SECONDS) * WAV_RATE));
  const offline = new Offline(1, length, WAV_RATE); // 1채널로 렌더링하면 스테레오는 자동으로 모노가 된다
  const source = offline.createBufferSource();source.buffer = decoded;
  const highpass = offline.createBiquadFilter();highpass.type = 'highpass';highpass.frequency.value = 80;
  const lowpass = offline.createBiquadFilter();lowpass.type = 'lowpass';lowpass.frequency.value = 7600;
  source.connect(highpass);highpass.connect(lowpass);lowpass.connect(offline.destination);source.start(0);
  const rendered = await offline.startRendering();
  return encodeWav(trimAndNormalize(rendered.getChannelData(0)));
}

const pause = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, {once: true});
});

const mimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function createRecorder(stream) {
  const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
  return mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream);
}

async function postVoice(action, body, contentType, signal, locale='ko') {
  const response = await fetch('/api/voice/' + action, {
    method: 'POST',
    headers: {'content-type': contentType,'x-voice-language':normalizeLocale(locale)},
    body,
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || 'voice_service_unavailable');
  }
  return response;
}

export async function transcribeRecording(recording, signal, locale='ko', {provider = managedVoice ? voiceSttProvider : 'local', convert = toWav16k, statusDelayMs = 1500, deadlineMs = 30000} = {}) {
  const audio = provider === 'baze' ? await convert(recording) : recording;
  const response = await postVoice('stt', audio, audio.type, signal, locale);
  let value = await response.json();
  // BAZE는 비동기: 서버가 기다린 시간 안에 안 끝나면 {pending, token}이 온다. 토큰으로 결과를 이어서 묻는다.
  const until = Date.now() + deadlineMs;
  while (value?.pending) {
    if (typeof value.token !== 'string' || Date.now() > until) throw new Error('voice_timeout');
    await pause(statusDelayMs, signal);
    value = await (await postVoice('stt-status', JSON.stringify({token: value.token}), 'application/json', signal, locale)).json();
  }
  return typeof value?.text === 'string' ? value.text : '';
}

const spoken119={ko:'일일구',en:'one one nine',zh:'一 一 九',vi:'một một chín',uz:'bir bir to‘qqiz'};
export const koreanSpeechText=text=>speechText(text,'ko');
export function speechText(text,locale='ko') {
  // Read the emergency number digit by digit without changing longer values.
  return text.replace(/(?<![0-9]|[0-9]\.)119(?![0-9]|\.[0-9])/gu, spoken119[normalizeLocale(locale)]);
}

export async function synthesizeSpeech(text, signal, locale='ko') {
  const response = await postVoice('tts', JSON.stringify({text: speechText(text,locale).slice(0, 1000)}), 'application/json', signal, locale);
  return response.blob();
}

// Detect a pause only after a short stretch of audible speech. Keep recording
// controls usable when Web Audio is missing or the browser suspends it.
export function stopAfterSpeechPause(stream, stop) {
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) return () => {};
  let context, source, timer, closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    source?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  };
  try {
    context = new Audio();
    const analyser = context.createAnalyser();
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const frames = new Float32Array(analyser.fftSize);
    let consecutive = 0, lastSound = null;
    timer = setInterval(() => {
      if (context.state !== 'running') return;
      analyser.getFloatTimeDomainData(frames);
      const audible = Math.sqrt(frames.reduce((sum, value) => sum + value * value, 0) / frames.length) >= 0.02;
      const now = performance.now();
      if (audible) {
        consecutive += 1;
        if (lastSound !== null || consecutive >= 3) lastSound = now;
      } else {
        consecutive = 0;
        if (lastSound !== null && now - lastSound >= 1500) {
          cleanup();
          stop();
        }
      }
    }, 50);
    void context.resume().catch(() => {});
    return cleanup;
  } catch {
    cleanup();
    return () => {};
  }
}
