// 일상 표현 증상 시나리오(eval/symptom_phrases_v1.json: 보강에 쓴 문장, _v2.json: 보강 뒤 따로 쓴 확인용 문장)를 사전 매칭(engine/dictionary-match.mjs)에 넣어 본다. LLM 없음.
// 통과: 기대 증상 중 하나가 사전 후보(최대 5개) 안에 있음. 못 찾음(후보 0개)·틀림(후보는 있으나 기대 증상 없음)을 따로 센다.
//   node eval/symptom_phrases.mjs            두 세트 요약 + 실패 목록
//   node eval/symptom_phrases.mjs --all      모든 문장의 후보
//   node eval/symptom_phrases.mjs --min 0.9  통과율이 이보다 낮으면 종료 코드 1
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadIntakeData} from '../engine/intake-data.mjs';
import {matchSymptoms} from '../engine/dictionary-match.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// v3(11/18): 증상 프롬프트 v2를 쓰기 전에 따로 쓴 확인용. 증상이 아닌 문장(intent)도 있다.
export const PHRASE_SETS = Object.freeze({
  v1: path.join(HERE, 'symptom_phrases_v1.json'),
  v2: path.join(HERE, 'symptom_phrases_v2.json'),
  v3: path.join(HERE, 'symptom_phrases_v3.json'),
});
export const loadPhrases = (set) => JSON.parse(readFileSync(PHRASE_SETS[set], 'utf8')).cases;

/** 사전 후보(got)로 본 통과. fallback 증상·증상이 아닌 문장(intent)은 후보가 없어야 한다. */
export const phraseOk = (c, got) => (c.fallback || c.intent ? got.length === 0 : c.expect.some((id) => got.includes(id)));

/** @returns {{total:number, pass:number, notFound:object[], wrong:object[], rows:object[]}} */
export function runPhrases(data = loadIntakeData(), cases = loadPhrases('v1')) {
  const rows = cases.map((c) => {
    const got = matchSymptoms(c.text, data.refData);
    // fallback 증상(통계 없음)은 후보가 될 수 없다 → 후보가 없어야 통과
    const ok = phraseOk(c, got);
    return {...c, got, ok};
  });
  return {
    total: rows.length,
    pass: rows.filter((r) => r.ok).length,
    notFound: rows.filter((r) => !r.ok && r.got.length === 0),
    wrong: rows.filter((r) => !r.ok && r.got.length > 0),
    rows,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const data = loadIntakeData();
  const name = (id) => data.refData.symptoms.get(id)?.nameKo ?? id;
  const show = (row) => `  ${row.text}  → 기대 ${row.intent ? `후보 없음(${row.intent})` : row.fallback ? `후보 없음(${name(row.fallback)}는 통계 없는 증상)` : row.expect.map(name).join('|')} / 후보 [${row.got.map(name).join(', ')}]`;
  const i = args.indexOf('--min');
  let fail = false;
  for (const set of Object.keys(PHRASE_SETS)) {
    const r = runPhrases(data, loadPhrases(set));
    console.log(`[${set}] 통과 ${r.pass}/${r.total} (${(100 * r.pass / r.total).toFixed(1)}%) · 못 찾음 ${r.notFound.length} · 틀림 ${r.wrong.length}`);
    if (args.includes('--all')) for (const row of r.rows) console.log((row.ok ? 'ok ' : 'NG ') + show(row));
    if (r.notFound.length) { console.log('못 찾음:'); r.notFound.forEach((row) => console.log(show(row))); }
    if (r.wrong.length) { console.log('틀림:'); r.wrong.forEach((row) => console.log(show(row))); }
    if (i >= 0 && r.pass / r.total < Number(args[i + 1])) fail = true;
  }
  if (fail) process.exit(1);
}
