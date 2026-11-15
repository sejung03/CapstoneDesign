// 두 평가 결과를 나란히 비교(나중에 gemini vs openai).
// 사용: node eval/compare.mjs eval/out/a.json eval/out/b.json
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const fmt = (r) => (r && typeof r === 'object' && 'hit' in r ? `${r.hit}/${r.n} (${r.value})` : r == null ? '-' : typeof r === 'object' ? JSON.stringify(r) : String(r));

export function compareRows(a, b) {
  const ma = a.metrics;
  const mb = b.metrics;
  // 설계 9-3 결정 순서: 응급 놓친 비율 → profile 정밀도 → Recall@10 → 실패율 → 지연
  const rows = [
    ['응급 놓친 비율', ma.emergencyMissRate?.value, mb.emergencyMissRate?.value],
    ['profile 정밀도', ma.profilePrecision, mb.profilePrecision],
    ['Recall@10', ma.recallAt10, mb.recallAt10],
    ['실패율', ma.failureRate, mb.failureRate],
    ['지연 p50(ms)', ma.latencyMs?.p50, mb.latencyMs?.p50],
    ['지연 p95(ms)', ma.latencyMs?.p95, mb.latencyMs?.p95],
    ['Top-1', ma.top1, mb.top1],
    ['no_match 정확도', ma.noMatchAccuracy, mb.noMatchAccuracy],
    ['의도 정확도', ma.intentAccuracy, mb.intentAccuracy],
    ['profile 재현율', ma.profileRecall, mb.profileRecall],
    ['실패 사유', ma.failuresByReason, mb.failuresByReason],
    ['반복 일치율', ma.repeatAgreement, mb.repeatAgreement],
    ...Object.keys(ma.candidateRecall ?? {}).map((k) => [`후보 ${k}`, ma.candidateRecall[k], mb.candidateRecall?.[k]]),
  ];
  return rows.map(([name, x, y]) => ({지표: name, A: fmt(x), B: fmt(y)}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fa, fb] = process.argv.slice(2);
  if (!fa || !fb) throw new Error('사용: node eval/compare.mjs a.json b.json');
  const a = JSON.parse(readFileSync(fa, 'utf8'));
  const b = JSON.parse(readFileSync(fb, 'utf8'));
  const head = (x, f) => `${path.basename(f)} — ${x.providerName}/${x.model}, ${x.versions?.promptSymptom}, ${x.dataVersion}, 사례 ${x.caseCount}`;
  console.log(`A: ${head(a, fa)}`);
  console.log(`B: ${head(b, fb)}`);
  if (a.casesFile !== b.casesFile) console.log('주의: 두 결과의 사례 파일이 다르다');
  console.table(compareRows(a, b));
}
