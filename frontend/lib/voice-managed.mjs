import {createHmac, timingSafeEqual} from 'node:crypto';

const cookie = 'capstone_voice_preview';
const scope = 'openai-stt-preview-v1';
const lifetime = 3600;
const extensions = {'audio/webm':'webm', 'audio/mp4':'mp4', 'audio/ogg':'ogg', 'audio/wav':'wav'};
const respond = (detail, status) => Response.json({detail}, {status,headers:{'Cache-Control':'no-store'}});
const signature = (expiry, secret) => createHmac('sha256', secret).update(scope+':'+expiry).digest('hex');

export function hasVoiceGrant(request, secret, now = Math.floor(Date.now()/1000)) {
  if (!secret) return false;
  const value = request.headers.get('cookie')?.split(';').map(item=>item.trim())
    .find(item=>item.startsWith(cookie+'='))?.slice(cookie.length+1) || '';
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(value);
  if (!match || Number(match[1]) <= now) return false;
  return timingSafeEqual(Buffer.from(match[2]),Buffer.from(signature(match[1],secret)));
}

export async function grantVoice(request, secret, now = Math.floor(Date.now()/1000)) {
  if (!secret) return respond('voice_service_unavailable',503);
  // A dedicated action and header require an explicit acknowledgement from our own UI.
  if (request.headers.get('x-voice-consent') !== scope) return respond('voice_consent_required',403);
  const expiry = String(now+lifetime);
  const value = expiry+'.'+signature(expiry,secret);
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
