// 후보 생성 자체 평가: 사전 leave-one-out (LLM 없음, 정답 라벨 없이 가능).
// 동의어 한 행을 색인에서 빼고 그 term을 입력으로 넣었을 때, 그 행의 symptomId가 상위 k 안에 있는 비율.
// 주의: "사전과 글자가 비슷한 표현"에 대한 대리 지표다. 바꿔 말한 표현의 재현율은 팀 평가셋으로 다시 잰다.
//
// 사용: node eval/candidate_loo.mjs
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadRefData} from '../llm/ref-data.mjs';
import {buildCandidates, scoreTerm} from '../llm/candidates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KS = [10, 20, 40, 60];
const KMAX = Math.max(...KS);

export function runLoo(ref = loadRefData()) {
  // 대상: 후보가 될 수 있는 증상(fallback·상위 증상 제외)의 동의어 행
  const rows = ref.synonyms.filter((s) => ref.symptoms.get(s.symptomId).isCandidate);
  const excludedRows = ref.synonyms.length - rows.length;
  const bySym = new Map();
  for (const s of ref.synonyms) {
    if (!bySym.has(s.symptomId)) bySym.set(s.symptomId, []);
    bySym.get(s.symptomId).push(s);
  }

  const hits = Object.fromEntries(KS.map((k) => [k, 0]));
  const byType = new Map();
  const missed40 = [];
  const reasons = {only_row: 0, no_overlap: 0, outranked: 0};

  for (const row of rows) {
    const index = {...ref, synonyms: ref.synonyms.filter((s) => s.id !== row.id)};
    const cands = buildCandidates(row.term, index, {k: KMAX, mode: 'retrieve'});
    const rank = cands.findIndex((c) => c.symptomId === row.symptomId); // -1이면 없음
    for (const k of KS) if (rank >= 0 && rank < k) hits[k] += 1;
    const t = byType.get(row.termType) ?? {n: 0, hit40: 0};
    t.n += 1;
    if (rank >= 0 && rank < 40) t.hit40 += 1;
    byType.set(row.termType, t);

    if (!(rank >= 0 && rank < 40)) {
      const others = bySym.get(row.symptomId).filter((s) => s.id !== row.id);
      const bestOther = Math.max(0, ...others.map((s) => scoreTerm(row.termNorm, s.termNorm)));
      let reason;
      if (others.length === 0) reason = 'only_row';
      else if (bestOther === 0) reason = 'no_overlap';
      else reason = 'outranked';
      reasons[reason] += 1;
      missed40.push({id: row.id, term: row.term, symptomId: row.symptomId, termType: row.termType, reason, rank: rank >= 0 ? rank + 1 : null});
    }
  }

  const n = rows.length;
  const recall = Object.fromEntries(KS.map((k) => [`R@${k}`, {hit: hits[k], n, recall: round(hits[k] / n)}]));
  const termTypeRecall40 = Object.fromEntries([...byType.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([tt, v]) => [tt, {hit: v.hit40, n: v.n, recall: round(v.hit40 / v.n)}]));
  const noOverlapExamples = missed40.filter((m) => m.reason === 'no_overlap').slice(0, 20)
    .map(({term, symptomId}) => ({term, symptomId}));

  return {
    dataVersion: ref.dataVersion,
    mode: 'retrieve',
    evaluatedRows: n,
    excludedRows,
    recall,
    termTypeRecall40,
    missed40Count: missed40.length,
    missed40Reasons: reasons,
    noOverlapExamples,
    missed40,
    note: '사전 leave-one-out 대리 지표. 바꿔 말한 표현의 재현율은 팀 평가셋으로 다시 잰다.',
  };
}

function round(x) {
  return Math.round(x * 10000) / 10000;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runLoo();
  const outDir = path.join(HERE, 'out');
  mkdirSync(outDir, {recursive: true});
  writeFileSync(path.join(outDir, 'candidate_loo.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`data_version ${result.dataVersion}, 평가 행 ${result.evaluatedRows} (제외 ${result.excludedRows})`);
  console.table(Object.fromEntries(Object.entries(result.recall).map(([k, v]) => [k, v])));
  console.table(result.termTypeRecall40);
  console.log('놓친 사유(@40):', result.missed40Reasons);
}
