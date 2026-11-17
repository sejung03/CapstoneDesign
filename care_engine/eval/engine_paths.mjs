// 문진 엔진 경로별 질문 수(네트워크 없음, 가짜 LLM). "고정 질문 대비 질문 수" 평가의 기초 자료.
// 실행: npm run eval:paths  → 표 출력 + eval/out/engine_paths_<시각>.json (사용자 원문 없음: 시나리오 이름·질문 ID·숫자만)
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {simulate, scenarios, fixedQuestionCount} from './engine_scenarios.mjs';
import {ENGINE_VERSION} from '../engine/index.mjs';
import {loadIntakeData} from '../engine/intake-data.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const fixed = fixedQuestionCount();
  const rows = [];
  for (const s of scenarios()) {
    const r = await simulate(s);
    rows.push({
      scenario: s.name,
      note: s.note,
      questions: r.questionCount,
      engineQuestions: r.engineQuestionCount,
      dataQuestions: r.questionCount - r.engineQuestionCount,
      expected: s.expect ? `${s.expect[0]}~${s.expect[1]}` : null,
      ratioToFixed: Number((r.questionCount / fixed).toFixed(2)),
      result: r.resultKind,
      usedSkip: r.usedSkip,
      llmCalls: r.llmCalls.classify + r.llmCalls.profile,
      contractErrors: r.contractErrors.length,
      asked: r.asked,
    });
  }
  const pad = (v, n) => String(v ?? '-').padEnd(n);
  console.log(`문진 엔진 경로별 질문 수 (${ENGINE_VERSION}, 데이터 ${loadIntakeData().dataVersion})`);
  console.log(`고정 질문 수(엔진이 묻는 문항 전부) = ${fixed}`);
  console.log(`${pad('시나리오', 28)}${pad('질문', 6)}${pad('엔진', 6)}${pad('표(§8)', 8)}${pad('고정 대비', 10)}${pad('결과', 11)}${pad('skip', 6)}LLM`);
  for (const r of rows) {
    console.log(`${pad(r.scenario, 28)}${pad(r.questions, 6)}${pad(r.engineQuestions, 6)}${pad(r.expected, 8)}${pad(r.ratioToFixed, 10)}${pad(r.result, 11)}${pad(r.usedSkip ? 'yes' : '', 6)}${r.llmCalls}`);
  }
  const outDir = path.join(HERE, 'out');
  mkdirSync(outDir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const file = path.join(outDir, `engine_paths_${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({engineVersion: ENGINE_VERSION, fixedQuestionCount: fixed, rows}, null, 2)}\n`, 'utf8');
  console.log(`저장: ${path.relative(process.cwd(), file)}`);
  if (rows.some((r) => r.contractErrors > 0 || r.result.startsWith('error'))) process.exitCode = 1;
}

main().catch(() => { console.error('engine_paths: 실행 실패'); process.exitCode = 1; });
