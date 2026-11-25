import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardVoice} from '../lib/voice-server.mjs';
import {readWavInfo, signOperation, verifyOperation, createUploadLimiter, transcribeBaze} from '../lib/voice-baze.mjs';
import {encodeWav, trimAndNormalize, transcribeRecording} from '../voice-client.mjs';
import {CARE_CONSENT_VERSION} from '../care-adapter.mjs';

const SECRET = 'test-secret';
const env = {NEXT_PUBLIC_VOICE_ENABLED: '1', VOICE_STT_PROVIDER: 'baze', VERCEL_ENV: 'preview', VOICE_CONSENT_SECRET: SECRET, BAZE_API_KEY: 'baze-key'};
const BASE = 'https://factchat-cloud.mindlogic.ai/v1/gateway';
// 1초짜리 가상 음성(440Hz)을 16kHz 모노 WAV로
const speech = (seconds = 1) => Float32Array.from({length: 16000 * seconds}, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / 16000));
const wav = async (samples = speech()) => Buffer.from(await encodeWav(samples).arrayBuffer());
const request = (path, headers = {}, body) => new Request('https://preview.example/api/voice/' + path, {method: 'POST', headers, body});

// 녹음 전송은 건강정보 수집·이용 동의에 포함된다(따로 받는 음성 동의 없음). 브라우저는 동의한 안내 버전을 헤더로 보낸다
const CONSENT = {'x-health-consent': CARE_CONSENT_VERSION};

test('browser WAV encoding gives the exact 16kHz mono 16-bit format BAZE needs, trimming silence', async () => {
  const silence = new Float32Array(16000);
  const padded = Float32Array.from([...silence, ...speech(), ...silence]);
  const trimmed = trimAndNormalize(padded);
  assert.ok(trimmed.length < padded.length && trimmed.length >= 16000);
  assert.ok(Math.max(...trimmed.map(Math.abs)) > 0.85);
  assert.throws(() => trimAndNormalize(silence), /no_speech/);
  const info = readWavInfo(await wav(trimmed));
  assert.deepEqual([info.format, info.channels, info.sampleRate, info.bits], [1, 1, 16000, 16]);
  assert.ok(Math.abs(info.seconds - trimmed.length / 16000) < 0.001);
  assert.equal(readWavInfo(Buffer.from('not a wav file at all, just some text bytes here.')), null);
});

test('operation tokens are signed, expire and cannot be forged for another job', () => {
  const now = 1_800_000_000;
  const token = signOperation('op_123', SECRET, now);
  assert.equal(verifyOperation(token, SECRET, now + 10), 'op_123');
  assert.equal(verifyOperation(token, SECRET, now + 601), null);
  assert.equal(verifyOperation(token.replace('op_123', 'op_999'), SECRET, now), null);
  assert.equal(verifyOperation(token, 'other-secret', now), null);
});

test('BAZE needs the current health consent; an older notice version does not carry over', async () => {
  const opts = {env, sameOrigin: () => true, fetchImpl: async () => { throw new Error('must not call BAZE'); }};
  const body = await wav();
  const audio = (headers = {}) => request('stt', {'content-type': 'audio/wav', ...headers}, body);
  assert.equal((await forwardVoice(audio(), 'stt', opts)).status, 403);
  assert.equal((await forwardVoice(audio({'x-health-consent': 'care-openai-1'}), 'stt', opts)).status, 403);
  assert.equal((await forwardVoice(request('consent', {'x-voice-consent': 'baze-stt-v1'}), 'consent', opts)).status, 404); // 따로 받는 음성 동의는 없앴다
  // webm은 BAZE가 거부하므로 서버가 먼저 막는다(비용 청구 전)
  assert.equal((await forwardVoice(request('stt', {'content-type': 'audio/webm', ...CONSENT}, 'webm'), 'stt', opts)).status, 415);
  // 운영 주소에서도 사용자 동의가 없으면 거절한다.
  assert.equal((await forwardVoice(audio(), 'stt', {...opts, env: {...env, VERCEL_ENV: 'production', NODE_ENV: 'production'}})).status, 403);
});

test('upload sends the BAZE form, waits for the result and returns the text', async () => {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, init = {}) => {
    calls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer baze-key');
    if (init.method === 'POST') {
      assert.equal(url, BASE + '/audio/transcriptions/');
      assert.equal(init.body.get('model'), 'stt-async-v5');
      assert.deepEqual(init.body.getAll('language_hints'), ['ko']);
      assert.equal(init.body.get('enable_speaker_diarization'), 'false');
      assert.equal(init.body.get('file').type, 'audio/wav');
      return Response.json({operation_id: 'op_1', credits_charged: 0.6});
    }
    assert.equal(url, BASE + '/audio/transcriptions/op_1/');
    polls++;
    return Response.json(polls < 2 ? {status: 'processing'} : {status: 'completed', text: ' 기침이 나요 '});
  };
  const opts = {env, sameOrigin: () => true, fetchImpl};
  const answer = await forwardVoice(request('stt', {'content-type': 'audio/wav', ...CONSENT}, await wav()), 'stt', opts);
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), {text: '기침이 나요'});
  assert.equal(polls, 2);
});

test('a slow job returns a token; the browser continues with stt-status until it is done', async () => {
  let done = false;
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST') return Response.json({operation_id: 'op_slow'});
    return Response.json(done ? {status: 'completed', text: '열이 나요'} : {status: 'pending'});
  };
  // 서버가 기다리는 시간을 0으로: 바로 202
  const pending = await transcribeBaze(request('stt'), await wav(), {apiKey: 'k', secret: SECRET, fetchImpl, waitMs: 0});
  assert.equal(pending.status, 202);
  const {token} = await pending.json();
  const status = body => forwardVoice(request('stt-status', {'content-type': 'application/json', ...CONSENT}, JSON.stringify(body)), 'stt-status', {env, sameOrigin: () => true, fetchImpl});
  assert.equal((await status({token: 'forged.1234567890.' + 'a'.repeat(64)})).status, 403);
  done = true;
  const answer = await status({token});
  assert.deepEqual(await answer.json(), {text: '열이 나요'});
});

test('failures do not leak details, and no_speech is reported when BAZE hears nothing', async () => {
  const run = async fetchImpl => transcribeBaze(request('stt'), await wav(), {apiKey: 'k', secret: SECRET, fetchImpl, waitMs: 2000});
  assert.equal((await run(async () => new Response('quota', {status: 402}))).status, 503);
  assert.equal((await run(async () => new Response('slow down', {status: 429}))).status, 429);
  const empty = async (url, init = {}) => init.method === 'POST' ? Response.json({operation_id: 'op_e'}) : Response.json({status: 'completed', text: '  '});
  assert.deepEqual(await (await run(empty)).json(), {detail: 'no_speech'});
  const failed = async (url, init = {}) => init.method === 'POST' ? Response.json({operation_id: 'op_f'}) : Response.json({status: 'failed', error: 'internal provider message'});
  const response = await run(failed);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /internal provider message/);
  assert.equal((await transcribeBaze(request('stt'), await wav(speech(31)), {apiKey: 'k', secret: SECRET, fetchImpl: failed})).status, 413);
});

test('uploads are limited per client', () => {
  let t = 0;
  const allow = createUploadLimiter({limit: 2, windowMs: 1000, now: () => t});
  assert.equal(allow('a'), true);assert.equal(allow('a'), true);assert.equal(allow('a'), false);
  assert.equal(allow('b'), true);
  t = 1001;assert.equal(allow('a'), true);
});

test('the browser converts to WAV for BAZE and follows pending tokens', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push([url, init.headers['content-type']]);
    if (url === '/api/voice/stt') return Response.json({pending: true, token: 'tok'}, {status: 202});
    return Response.json({text: '배가 아파요'});
  };
  try {
    const text = await transcribeRecording(new Blob(['webm']), undefined, 'ko', {provider: 'baze', convert: async () => encodeWav(speech()), statusDelayMs: 0});
    assert.equal(text, '배가 아파요');
    assert.deepEqual(sent, [['/api/voice/stt', 'audio/wav'], ['/api/voice/stt-status', 'application/json']]);
  } finally { globalThis.fetch = realFetch; }
});
