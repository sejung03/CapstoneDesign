// 11/17 다국어(care_engine/docs/다국어_설계.md). 한국어가 원본, en·zh·vi·uz는 번역 표(text_i18n)에서.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {call, data, SAFE_BASE} from './helpers.mjs';
import {sourceTexts, TRANSLATED_LOCALES, isSafetyKey, translate, templateSourceTexts} from '../i18n.mjs';
import {localizeEmergency, localizeFollowUp} from '../localize.mjs';
import {emergencyNotice, withAddon, REFERRAL_ADDONS, EMERGENCY_TEXT} from '../templates.mjs';
import {checkResponseContract} from '../contract.mjs';

const HANGUL = /[가-힣]/;
/** 모든 번역을 '검토됨'으로 바꾼 데이터(안전 문구가 검토된 뒤의 동작 확인용). */
function reviewedData() {
  const i18n = new Map([...data.i18n].map(([k, m]) => [k, new Map([...m].map(([l, e]) => [l, {...e, reviewed: true}]))]));
  return {...data, i18n, refData: {...data.refData, i18n}};
}

test('다국어: 번역할 원문 전부에 4개 언어 번역이 있고, 원문이 지금 한국어와 같다(빠짐·낡음 없음)', () => {
  const missing = [], stale = [];
  for (const {target, key, sourceKo} of sourceTexts(data)) {
    for (const l of TRANSLATED_LOCALES) {
      const e = data.i18n.get(`${target}|${key}`)?.get(l);
      if (!e) missing.push(`${target}:${key}:${l}`);
      else if (e.sourceKo !== sourceKo) stale.push(`${target}:${key}:${l}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(stale, []);
});

test('다국어: 데이터 문항의 질문·선택지는 5개 언어, 응답 계약 통과', async () => {
  const {out} = await call({messages: ['기침이 나요']});
  const f = out.response.followUp;
  assert.equal(f.id, 'Q0');
  for (const label of [f.label, ...f.options.map((o) => o.label)]) {
    assert.deepEqual(Object.keys(label).sort(), ['en', 'ko', 'uz', 'vi', 'zh']);
    for (const l of TRANSLATED_LOCALES) assert.ok(!HANGUL.test(label[l]), `${l}: ${label[l]}`);
  }
  assert.ok(checkResponseContract(out.response).ok);
});

test('다국어: 엔진 질문(증상 확인)의 증상 이름·선택지도 번역된다', () => {
  const ids = ['D01', 'N01'];
  const q = {id: 'SYM_DICT_CONFIRM', type: 'singleChoice', required: true, label: {ko: '말씀하신 증상이 이 중에 있나요?'},
    options: [...ids.map((id) => ({id: `sym_${id}`, label: {ko: data.refData.symptoms.get(id).nameKo}})),
      {id: 'sym_other', label: {ko: '다른 증상이에요'}}, {id: 'sym_unsure', label: {ko: '잘 모르겠어요'}}]};
  const out = localizeFollowUp(q, data);
  assert.equal(out.label.en, 'Is your symptom one of these?');
  assert.equal(out.options[0].label.en, 'Stomach ache');
  assert.equal(out.options[1].label.vi, 'Đau đầu');
  assert.equal(out.options[2].label.zh, '是其他症状');
  assert.ok(checkResponseContract({followUp: out}).ok);
});

test('다국어 원칙 4: 안전 문구(응급 안내·위험 확인·민감 선택)도 5개 언어로 나간다(검토 상태와 상관없이)', async () => {
  const urgent = await call({messages: ['아기가 숨을 안 쉬어요']});
  for (const field of ['title', 'message']) {
    assert.deepEqual(Object.keys(urgent.out.response.emergency[field]).sort(), ['en', 'ko', 'uz', 'vi', 'zh']);
  }
  assert.ok(urgent.out.response.emergency.message.en.includes('119'));
  const sens = await call({messages: ['죽고 싶어요']});
  assert.deepEqual(Object.keys(sens.out.response.followUp.label).sort(), ['en', 'ko', 'uz', 'vi', 'zh']);
  assert.deepEqual(Object.keys(sens.out.response.followUp.options[0].label).sort(), ['en', 'ko', 'uz', 'vi', 'zh']);
  for (const key of ['emergency.crisis_notice_109.message', 'addon.violence_notice_1366', 'q.risk_confirm.label', 'q.sensitive_choice.end', 'summary.footer']) {
    assert.ok(isSafetyKey('template', key), key);
  }
  assert.ok(!isSafetyKey('template', 'q.sym_dict_confirm.label'));
  assert.ok(!isSafetyKey('item', 'Q0'));
});

test('다국어 원칙 4: 모든 번역의 숫자(전화번호 119·109·112·1366, 24시간 등)가 원문과 같다', () => {
  const nums = (s) => (s.replace(/\{\d\}/g, '').match(/\d+/g) ?? []).sort();
  const bad = [];
  for (const [id, byLocale] of data.i18n) {
    for (const [l, e] of byLocale) if (JSON.stringify(nums(e.text)) !== JSON.stringify(nums(e.sourceKo))) bad.push(`${id}:${l}`);
  }
  assert.deepEqual(bad, []);
  // 안전 문구는 전화번호가 반드시 있다
  for (const [k, ko] of Object.entries(templateSourceTexts())) {
    if (!isSafetyKey('template', k)) continue;
    for (const phone of ['119', '109', '112', '1366']) {
      if (!ko.includes(phone)) continue;
      for (const l of TRANSLATED_LOCALES) assert.ok(data.i18n.get(`template|${k}`).get(l).text.includes(phone), `${k} ${l} ${phone}`);
    }
  }
});

test('다국어: 검토된 응급 안내는 언어마다 같은 순서로 덧붙임까지 조립하고, 한 문구라도 없으면 그 언어는 빼서 섞지 않는다', () => {
  const reviewed = reviewedData();
  const base = emergencyNotice('freetext_emergency_119').emergency;
  const withTwo = withAddon(withAddon(base, REFERRAL_ADDONS.crisis_notice_109), REFERRAL_ADDONS.threat_notice_112);
  const out = localizeEmergency(withTwo, reviewed);
  assert.equal(out.message.ko, withTwo.message.ko);
  for (const l of TRANSLATED_LOCALES) {
    assert.ok(out.title[l] && out.message[l], l);
    assert.ok(out.message[l].includes('109') && out.message[l].includes('112') && out.message[l].includes('119'), l);
  }
  assert.ok(out.message.en.endsWith('This service does not provide a diagnosis.'));
  assert.ok(checkResponseContract({emergency: out}).ok);
  // en의 112 덧붙임 번역만 없으면 en만 빠진다
  const noEnAddon = reviewedData();
  noEnAddon.i18n.get('template|addon.threat_notice_112').delete('en');
  const partial = localizeEmergency(withTwo, noEnAddon);
  assert.equal(partial.message.en, undefined);
  assert.equal(partial.title.en, undefined);
  assert.ok(partial.message.vi);
  // 모르는 객체({active:true} 등)는 그대로
  assert.deepEqual(localizeEmergency({active: true}, reviewed), {active: true});
});

test('다국어 원칙 3: 요약은 언어마다 따로 만들고 섞이지 않으며, 번역이 하나라도 없으면 그 언어 요약은 만들지 않는다', async () => {
  const answers = {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', 'N5-1': 'onset_1_3d', N12: 'impact_little', N7: 'no'}; // 11/18 재설계(기침은 통증 아님)
  // 11/18 재설계: N7~N13 '아니요' 채우기는 뺐다(N12는 불편 정도 선택지, 나머지 문항은 없어짐)
  const done = await call({reason: 'followup', messages: ['기침이 나요'], answers});
  assert.equal(done.out.trace.phase, 'complete');
  const s = done.out.response.summary;
  assert.deepEqual(Object.keys(s).sort(), ['en', 'ko', 'uz', 'vi', 'zh']);
  for (const l of TRANSLATED_LOCALES) assert.ok(!HANGUL.test(s[l]), `${l} 요약에 한국어가 섞임: ${s[l]}`);
  assert.match(s.en, /Main symptom: Cough/);
  assert.ok(checkResponseContract(done.out.response).ok);
  // 요약 끝 문구(summary.footer)의 en 번역만 없으면 en 요약만 빠진다
  const noEnFooter = reviewedData();
  noEnFooter.i18n.get('template|summary.footer').delete('en');
  const partial = await call({reason: 'followup', messages: ['기침이 나요'], answers, deps: {refStore: noEnFooter}});
  assert.equal(partial.out.response.summary.en, undefined);
  assert.equal(partial.out.response.summary.vi, s.vi);
  assert.equal(partial.out.response.summary.ko, s.ko);
});

test('다국어 원칙 6: 원문이 바뀌면 그 번역은 쓰지 않는다(한국어만)', () => {
  assert.deepEqual(translate(data.i18n, 'item', 'Q0', '바뀐 질문 문구'), {ko: '바뀐 질문 문구'});
  assert.equal(translate(data.i18n, 'item', 'Q0', data.itemById.get('Q0').textKo).en.length > 0, true);
});

test('다국어: 엔진 문구 키 목록이 템플릿과 맞고, 자리 표시는 번역에도 그대로 있다', () => {
  const src = templateSourceTexts();
  assert.equal(src['emergency.crisis_notice_109.message'], EMERGENCY_TEXT.crisis_notice_109.message);
  for (const key of ['summary.pain', 'summary.departmentRank']) {
    for (const l of TRANSLATED_LOCALES) {
      const t = data.i18n.get(`template|${key}`).get(l).text;
      assert.deepEqual(t.match(/\{\d\}/g).sort(), src[key].match(/\{\d\}/g).sort(), `${key} ${l}`);
    }
  }
});
