export const voiceEnabled = process.env.NEXT_PUBLIC_VOICE_ENABLED === '1';

const mimeTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function createRecorder(stream) {
  const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
  return mimeType ? new MediaRecorder(stream, {mimeType}) : new MediaRecorder(stream);
}

async function postVoice(action, body, contentType, signal) {
  const response = await fetch('/api/voice/' + action, {
    method: 'POST',
    headers: {'content-type': contentType},
    body,
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || 'voice_service_unavailable');
  }
  return response;
}

export async function transcribeRecording(recording, signal) {
  const response = await postVoice('stt', recording, recording.type, signal);
  const {text} = await response.json();
  return text;
}

export async function synthesizeSpeech(text, signal) {
  const response = await postVoice('tts', JSON.stringify({text: text.slice(0, 1000)}), 'application/json', signal);
  return response.blob();
}
