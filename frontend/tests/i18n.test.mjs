import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {copy} from '../copy.mjs';
import {phrase,locales,localizedText,normalizeLocale} from '../i18n.mjs';
import {normalizeAssistantResponse} from '../assistant.mjs';
import {normalizeIntakeQuestionnaire,intakeLabel} from '../intake-data.mjs';
import {reportMessage} from '../report.mjs';
const source=JSON.parse(readFileSync(new URL('../locales/source.json',import.meta.url)));
const placeholders=s=>[...s.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort();
test('all five languages have every product copy key and every fixed phrase',()=>{
 for(const locale of locales){assert.deepEqual(Object.keys(copy[locale]).sort(),Object.keys(copy.ko).sort());for(const value of Object.values(copy[locale]))assert.ok(typeof value==='string'&&value.trim());}
 for(const locale of ['zh','vi','uz']){
  const catalog=JSON.parse(readFileSync(new URL(`../locales/${locale}.json`,import.meta.url)));
  for(const key of Object.keys(source)){assert.ok(catalog[key]?.trim(),`${locale}: ${key}`);assert.deepEqual(placeholders(catalog[key]),placeholders(key));if(key.includes('119'))assert.ok(catalog[key].includes('119'));}
 }
});
test('translations interpolate values without losing original user or facility text',()=>{
 assert.equal(phrase('ko','{0} years',[27]),'만 27세');
 assert.equal(normalizeLocale('invalid'),'ko');
 assert.equal(localizedText({ko:'가상 병원 원문'},'vi'),'가상 병원 원문');
 assert.equal(localizedText({ko:'한국어',vi:'Tiếng Việt'},'vi'),'Tiếng Việt');
});
test('assistant replies and questionnaire options retain all supported language labels',()=>{
 const labels={ko:'질문',en:'Question',zh:'问题',vi:'Câu hỏi',uz:'Savol'};
 const q=normalizeIntakeQuestionnaire({id:'test',version:'1',questions:[{id:'q1',type:'singleChoice',required:true,label:labels,options:[{id:'o1',label:labels}]}]});
 assert.equal(intakeLabel(q.questions[0].label,'uz'),'Savol');
 const r=normalizeAssistantResponse({summary:labels,followUp:q.questions[0]});assert.equal(r.summary.zh,'问题');assert.equal(r.followUp.options[0].label.vi,'Câu hỏi');
 assert.throws(()=>normalizeAssistantResponse({summary:{...labels,uz:123}}));
 for(const locale of locales)assert.ok(reportMessage(locale,'labels').length===8);
});
