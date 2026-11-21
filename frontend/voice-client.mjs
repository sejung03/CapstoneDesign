import {normalizeLocale} from './i18n.mjs';

export const voiceEnabled = process.env.NEXT_PUBLIC_VOICE_ENABLED === '1';

export const managedVoice = process.env.NEXT_PUBLIC_VOICE_EXTERNAL_STT === '1';

export async function grantManagedVoice() {
  const response = await fetch('/api/voice/consent',{
    method:'POST',headers:{'x-voice-consent':'openai-stt-preview-v1'},
  });
  return response.ok;
}

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

export async function transcribeRecording(recording, signal, locale='ko') {
  const response = await postVoice('stt', recording, recording.type, signal, locale);
  const {text} = await response.json();
  return text;
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
