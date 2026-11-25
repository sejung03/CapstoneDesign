import assert from 'node:assert/strict';
import test from 'node:test';
import {emergencyCallHref, emergencySmsHref, requestsEmergencyHelp} from '../emergency-contact.mjs';
import {forwardVoice} from '../lib/voice-server.mjs';
import {CARE_CONSENT_VERSION} from '../care-adapter.mjs';
import {koreanSpeechText,synthesizeSpeech,transcribeRecording} from '../voice-client.mjs';

test('only an explicit spoken request signals the 119 handoff', () => {
  for (const command of ['119에 전화해 주세요.', '일일구에 신고해 줘']) {
    assert.equal(requestsEmergencyHelp(command), true);
  }
  for (const text of ['119에 전화하지 마세요', '119에 전화해 주세요, 라고 말했어요', '119 번호가 뭐예요?', '']) {
    assert.equal(requestsEmergencyHelp(text), false);
  }
  assert.equal(emergencyCallHref, 'tel:119');
  assert.equal(emergencySmsHref, 'sms:119');
});

test('Korean TTS speaks 119 as separate digits without changing dialing or longer numbers', async t => {
  assert.equal(koreanSpeechText('119에 전화하세요. 119. 2119, 1190, 119.5, 1.119'),
    '일일구에 전화하세요. 일일구. 2119, 1190, 119.5, 1.119');
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, '/api/voice/tts');
    assert.deepEqual(JSON.parse(init.body), {text:'일일구에 전화하세요.'});
    return new Response('RIFF');
  });
  assert.equal(await (await synthesizeSpeech('119에 전화하세요.')).text(),'RIFF');
});

test('English readout preserves 119 dialing and English recognition sends the selected language',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  assert.equal(init.headers['x-voice-language'],'en');
  if(url.endsWith('/tts')){
   assert.equal(JSON.parse(init.body).text,'Call one one nine. 1190');
   return new Response('RIFF');
  }
  return Response.json({text:'Yes'});
 });
 assert.equal(await (await synthesizeSpeech('Call 119. 1190',undefined,'en')).text(),'RIFF');
 assert.equal(await transcribeRecording(new Blob(['mock recording'],{type:'audio/webm'}),undefined,'en'),'Yes');
 assert.equal(emergencyCallHref,'tel:119');
});

test('voice proxy rejects invalid requests before reaching the local service', async t => {
  const previous = process.env.NEXT_PUBLIC_VOICE_ENABLED;
  t.after(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_VOICE_ENABLED;
    else process.env.NEXT_PUBLIC_VOICE_ENABLED = previous;
  });
  delete process.env.NEXT_PUBLIC_VOICE_ENABLED;
  const makeRequest = (body = '{}', type = 'application/json') => new Request('http://127.0.0.1:3080/api/voice/tts', {
    method: 'POST', headers: {'content-type': type}, body,
  });
  let forwarded = 0;
  const opts = {sameOrigin: () => true, fetchImpl: async (url, init) => {
    forwarded++;
    assert.equal(url, 'http://127.0.0.1:3091/tts');
    assert.equal(init.body.toString(), '{"text":"안녕하세요"}');
    return new Response('RIFF', {headers: {'content-type': 'audio/wav'}});
  }};
  assert.equal((await forwardVoice(makeRequest(), 'tts', opts)).status, 404);
  process.env.NEXT_PUBLIC_VOICE_ENABLED = '1';
  assert.equal((await forwardVoice(makeRequest(), 'tts', {...opts, sameOrigin: () => false})).status, 403);
  assert.equal((await forwardVoice(makeRequest('', 'text/plain'), 'tts', opts)).status, 415);
  assert.equal((await forwardVoice(makeRequest('x'.repeat(8193)), 'tts', opts)).status, 413);
  assert.equal(forwarded, 0);
  const response = await forwardVoice(makeRequest('{"text":"안녕하세요"}'), 'tts', opts);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'RIFF');
  assert.equal(forwarded, 1);
});

test('transcription goes to OpenAI only with the current health consent (no separate voice consent)',async()=>{
  const env={NEXT_PUBLIC_VOICE_ENABLED:'1',VOICE_STT_PROVIDER:'openai',VERCEL_ENV:'production',NODE_ENV:'production',VOICE_CONSENT_SECRET:'test-secret',OPENAI_API_KEY:'test-key',VOICE_OPENAI_API_KEY:'unused-old-key'};
  const request=(path,headers={},body)=>new Request('https://preview.example/api/voice/'+path,{method:'POST',headers,body});
  const audio=(consent='',language='en')=>request('stt',{'content-type':'audio/webm;codecs=opus',...(consent?{'x-health-consent':consent}:{}),'x-voice-language':language},'mock recording');
  let count=0;
  const opts={env,sameOrigin:()=>true,fetchImpl:async(url,init)=>{
    count++;
    assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(init.headers.Authorization,'Bearer test-key');
    assert.equal(init.body.get('language'),'en');
    assert.equal(init.body.get('model'),'gpt-transcribe');
    assert.equal(init.body.get('file').name,'recording.webm');
    assert.equal(await init.body.get('file').text(),'mock recording');
    return Response.json({text:' 기침이 나요 '});
  }};
  // 녹음 전송은 건강정보 수집·이용 동의에 포함된다: 지금 안내 버전에 동의한 요청만 OpenAI로 보낸다
  assert.equal((await forwardVoice(audio(),'stt',opts)).status,403);
  assert.equal((await forwardVoice(audio('care-openai-1'),'stt',opts)).status,403); // 음성이 포함되기 전 안내에 한 동의
  assert.equal((await forwardVoice(request('consent'),'consent',opts)).status,404); // 따로 받는 음성 동의는 없앴다
  const consent=CARE_CONSENT_VERSION;
  assert.equal((await forwardVoice(audio(consent),'stt',{...opts,env:{...env,NEXT_PUBLIC_VOICE_ENABLED:'0'}})).status,404);
  assert.equal((await forwardVoice(audio(consent),'stt',{...opts,sameOrigin:()=>false})).status,403);
  assert.equal((await forwardVoice(audio(consent,'xx'),'stt',opts)).status,400);
  assert.equal(count,0);
  const answer=await forwardVoice(audio(consent),'stt',opts);
  assert.equal(answer.status,200);
  assert.deepEqual(await answer.json(),{text:'기침이 나요'});
  assert.equal(count,1);
  const missingKey = await forwardVoice(audio(consent),'stt',{...opts,env:{...env,OPENAI_API_KEY:undefined}});
  assert.equal(missingKey.status,503);
  assert.equal(count,1);
  const defaultProvider = await forwardVoice(audio(consent),'stt',{...opts,env:{...env,VOICE_STT_PROVIDER:undefined,NEXT_PUBLIC_VOICE_EXTERNAL_STT:'1'}});
  assert.equal(defaultProvider.status,200);
  assert.equal(count,2);
  assert.equal((await forwardVoice(audio(consent),'stt',{...opts,env:{...env,VERCEL_ENV:'preview'}})).status,200);
  assert.equal(count,3);
});
