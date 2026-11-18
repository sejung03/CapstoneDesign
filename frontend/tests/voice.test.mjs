import assert from 'node:assert/strict';
import test from 'node:test';
import {emergencyCallHref, emergencySmsHref, requestsEmergencyHelp} from '../emergency-contact.mjs';
import {forwardVoice} from '../lib/voice-server.mjs';

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
