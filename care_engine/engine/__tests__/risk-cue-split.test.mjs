// 11/17 LCR1: 민감 단서 두 갈래(강한 단서 / 넓은 단어). LC 재개 지시서 "이번에 정한 것 2"를 테스트로 고정한다.
// 문장은 모두 지어낸 짧은 문장이다(방법·수단 없음).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EMERGENCY_TEXT} from '../templates.mjs';
import {sensitiveCueHits} from '../sensitive-choice.mjs';
import {SENSITIVE_NOTICE_CUE_RE} from '../constants.mjs';
import * as constants from '../constants.mjs';
import {call, fakeLlm} from './helpers.mjs';

// 민감 안내도, LLM 차단도 없어야 하는 문장(지시서 2번 목록 그대로)
const MUST_PASS = [
  '독감 주사 맞았는데 열이 나요',
  '예방접종 맞고 팔이 아파요',
  '백신 맞았어요',
  '수액 맞았어요',
  '침 맞고 왔어요',
  '공에 맞았어요',
  '모기 때려잡았어',
  '자살 예방 교육 들었어요',
  '폭력적인 영화 봤어요',
];
// 지금처럼 안내가 나와야 하는 문장(규칙 또는 강한 단서)
const MUST_NOTICE = [
  '성추행을 당했어요',
  '스토킹 때문에 무서워요',
  '죽고 싶어요',
  '협박을 받고 있어요',
  '폭행당했어요',
];
const BROAD_ONLY = '어제 그 사람한테 맞았어요';

function llmCalls(c) {
  return c.classify.length + c.combined.length + c.risk.length + c.profile.length;
}

test('LCR1: 넓은 단어만 있는 의료·일상 문장은 민감 안내도 LLM 차단도 없다(위험 LLM을 부른다)', async () => {
  for (const text of MUST_PASS) {
    assert.deepEqual(sensitiveCueHits([text]), [], text);
    const llm = fakeLlm();
    const {out, calls} = await call({messages: [text], llm});
    assert.equal(out.trace.sensitive, undefined, text);
    assert.ok(!/^SENSITIVE_CHOICE_/.test(out.response.followUp?.id ?? ''), text);
    assert.notEqual(out.response.emergency?.active, true, text);
    assert.equal(calls.risk.length + calls.combined.length, 1, `${text}: LLM 차단 없음`);
  }
});

test('LCR1: 피해·위협·자살 문장은 지금처럼 기관 안내 + 선택이 나온다', async () => {
  for (const text of MUST_NOTICE) {
    const llm = fakeLlm();
    const {out, calls} = await call({messages: [text], llm});
    assert.equal(out.response.emergency.active, true, text);
    assert.ok(Object.values(EMERGENCY_TEXT).some((t) => t.message === out.response.emergency.message.ko), text);
    assert.equal(out.response.followUp.id, 'SENSITIVE_CHOICE_1', text);
    assert.deepEqual(out.trace.sensitive, {kind: 'sensitive_referral'}, text);
    assert.equal(llmCalls(calls), 0, `${text}: LLM 호출 0`);
  }
});

test('LCR1: 넓은 단어만 있는 문장은 LLM 위험 신호가 판단한다(violence → 안내 선택, none → 일반 흐름)', async () => {
  assert.deepEqual(sensitiveCueHits([BROAD_ONLY]), []);
  const v = fakeLlm({risk: {riskSignal: 'violence', meta: {attempts: 1}}});
  const hit = await call({messages: [BROAD_ONLY], llm: v});
  assert.equal(v.calls.risk.length, 1);
  assert.equal(hit.out.response.followUp.id, 'SENSITIVE_CHOICE_1');
  assert.equal(hit.out.response.emergency.message.ko, EMERGENCY_TEXT.violence_notice_1366.message);
  assert.deepEqual(hit.out.trace.sensitive, {kind: 'sensitive_referral'});

  const n = fakeLlm({risk: {riskSignal: 'none', meta: {attempts: 1}}});
  const plain = await call({messages: [BROAD_ONLY], llm: n});
  assert.equal(n.calls.risk.length, 1);
  assert.equal(plain.out.trace.sensitive, undefined);
  assert.equal(plain.out.response.followUp.id, 'Q0');
  assert.deepEqual(plain.out.trace.llm.risk, {called: true, signal: 'none'});
});

test('LCR1: 강한 단서 목록에 넓은 단어가 없고, 예전 넓은 정규식은 없어졌다', () => {
  for (const w of ['맞았', '때리', '때려', '때렸', '위협', '해치']) assert.ok(!SENSITIVE_NOTICE_CUE_RE.test(w), w);
  for (const w of ['폭행', '성폭행', '성폭력', '성추행', '추행', '강간', '스토킹', '스토커', '몰카', '몰래카메라', '협박', '자살', '자해', '죽고싶', '죽이겠', '죽이려', '죽여버']) {
    assert.ok(SENSITIVE_NOTICE_CUE_RE.test(w), w);
  }
  assert.equal(constants.SENSITIVE_CUE_RE, undefined);
});

test('LCR1: 갈래·우선순위(112 > 1366 > 109)와 바로 앞뒤 쓰임 제외', () => {
  const key = (t) => sensitiveCueHits([t])[0]?.messageKey ?? null;
  assert.equal(key('누군가 저를 협박해요'), 'threat_notice_112');
  assert.equal(key('회사에서 추행이 있었어요'), 'violence_notice_1366');
  assert.equal(key('요즘 자해 생각이 나요'), 'crisis_notice_109');
  assert.equal(key('스토커가 협박해요'), 'threat_notice_112');
  assert.equal(key('자해하고 스토킹도 당했어요'), 'violence_notice_1366');
  // 쓰임 제외(작품·교육·뉴스·정보 질문)
  for (const t of ['자살 예방 캠페인 포스터', '스토킹 처벌법이 생겼대요', '뉴스에서 폭행 사건 봤어요', '추행이란 뜻이 뭐예요', '스토킹 신고 방법 알려줘', '몰래카메라 예능 봤어요']) {
    assert.equal(key(t), null, t);
  }
  // '방법'은 '법' 제외에 걸리지 않는다(109는 정보 질문이어도 안내)
  assert.equal(key('자살 방법'), 'crisis_notice_109');
  // 1366: 피해자가 '나'인 서술은 드라마 근처여도 걸린다(RF6 판단 #15 원칙)
  assert.equal(key('드라마 보다가 생각났는데 누가 저를 스토킹해요'), 'violence_notice_1366');
  // 112: 장난·사소한 이유의 과장 표현은 넘긴다(규칙 FT-THREAT-01과 같은 목록, 넘긴 문장은 LLM이 본다)
  for (const t of ['숙제 때문에 엄마가 나를 죽이려고 해', '동생이 내 과자 먹어서 죽여버릴거야', '협박하듯이 커피 사오래요 ㅋㅋ']) assert.equal(key(t), null, t);
  // 쓰임 제외가 없는 다른 위치의 단서가 있으면 걸린다
  assert.equal(key('자살 예방 교육 들었는데 사실 저도 자살 생각이 나요'), 'crisis_notice_109');
});
