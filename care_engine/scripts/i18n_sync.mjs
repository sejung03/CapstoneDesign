// 번역 원본(data_pipeline/config/i18n_v1.csv)을 지금의 한국어 원문 목록과 맞춘다(접속 없음).
//  - 새 키는 빈 번역으로 추가, 없어진 키는 뺀다.
//  - 이미 있는 번역은 그대로 둔다. 원문(source_ko)이 바뀐 행은 source_ko를 그대로 두어 빌드가 "원문 바뀜"으로 알리게 한다.
// 사용: node scripts/i18n_sync.mjs   (care_engine에서)
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCsv} from '../llm/ref-data.mjs';
import {loadIntakeData} from '../engine/intake-data.mjs';
import {sourceTexts, TRANSLATED_LOCALES} from '../engine/i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const I18N_SOURCE = path.resolve(HERE, '../../data_pipeline/config/i18n_v1.csv');
export const COLUMNS = ['target', 'key', 'source_ko', 'review_status', ...TRANSLATED_LOCALES];

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(rows) {
  return `${[COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\n')}\n`;
}

/** 지금 원문 목록(current)과 기존 행(existing)을 합친다. */
export function mergeRows(current, existing) {
  const old = new Map(existing.map((r) => [`${r.target}|${r.key}`, r]));
  let added = 0, changed = 0;
  const rows = current.map(({target, key, sourceKo}) => {
    const prev = old.get(`${target}|${key}`);
    if (!prev) { added += 1; return {target, key, source_ko: sourceKo, review_status: 'draft', ...Object.fromEntries(TRANSLATED_LOCALES.map((l) => [l, '']))}; }
    if (prev.source_ko !== sourceKo) changed += 1;
    return {...Object.fromEntries(COLUMNS.map((c) => [c, prev[c] ?? ''])), target, key};
  });
  const keys = new Set(current.map((r) => `${r.target}|${r.key}`));
  const removed = existing.filter((r) => !keys.has(`${r.target}|${r.key}`)).length;
  return {rows, added, changed, removed};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const existing = existsSync(I18N_SOURCE) ? parseCsv(readFileSync(I18N_SOURCE, 'utf8')) : [];
  const {rows, added, changed, removed} = mergeRows(sourceTexts(loadIntakeData()), existing);
  writeFileSync(I18N_SOURCE, `﻿${toCsv(rows)}`, 'utf8');
  const filled = (l) => rows.filter((r) => r[l]).length;
  console.log(`저장: ${path.relative(process.cwd(), I18N_SOURCE)} (${rows.length}행, 새 키 ${added}, 원문 바뀜 ${changed}, 빠진 키 ${removed})`);
  console.log(`번역 채움: ${TRANSLATED_LOCALES.map((l) => `${l} ${filled(l)}/${rows.length}`).join(', ')}`);
}
