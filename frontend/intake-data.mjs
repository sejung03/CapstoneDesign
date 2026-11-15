import {phrase,expandLocales,localizedLabels,localizedText,locales} from './i18n.mjs';
// UI fixtures only. Question wording and medical rules belong to the questionnaire team.
export function intakeLabel(label,locale='ko'){
 return localizedText(label,locale);
}
export function normalizeIntakeQuestionnaire(raw){
 const fail=()=>{throw new TypeError('Invalid intake questionnaire');};
 const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:fail();
 const label=value=>{
  try{return localizedLabels(value,300);}catch{return fail();}
 };
 if(!raw||!Array.isArray(raw.questions)||raw.questions.length<1||raw.questions.length>5)return fail();
 const questions=raw.questions.map(question=>{
  if(question?.type!=='singleChoice'||typeof question.required!=='boolean')return fail();
  if(!Array.isArray(question.options)||question.options.length<1||question.options.length>12)return fail();
  const options=question.options.map(option=>({id:id(option?.id),label:label(option?.label)}));
  if(new Set(options.map(option=>option.id)).size!==options.length)return fail();
  return {id:id(question.id),type:'singleChoice',label:label(question.label),required:question.required,options};
 });
 if(new Set(questions.map(question=>question.id)).size!==questions.length)return fail();
 return {id:id(raw.id),version:id(raw.version),questions};
}
export const mockIntakeQuestionnaire=normalizeIntakeQuestionnaire({
 id:'intake-preview',version:'mock-2',questions:[1,2].map(number=>({
  id:'question-'+number,type:'singleChoice',label:Object.fromEntries(locales.map(locale=>[locale,phrase(locale,'Question {0}',[number])])),required:true,
  options:[
   {id:'option-1',label:expandLocales({ko:'선지 1',en:'Option 1'})},
   {id:'option-2',label:expandLocales({ko:'선지 2',en:'Option 2'})},
   {id:'unknown',label:expandLocales({ko:'잘 모르겠어요',en:'Not sure'})}
  ]
 }))
});
export function intakeSelection(question,answers={}){
 const value=Object.hasOwn(answers,question.id)?answers[question.id]:null;
 return question.options.find(option=>option.id===value)||null;
}
export function buildIntakeSubmission(questionnaire,answers={}){
 return {
  questionnaireId:questionnaire.id,questionnaireVersion:questionnaire.version,
  answers:questionnaire.questions.map(question=>{
   const option=intakeSelection(question,answers);
   return {questionId:question.id,type:'singleChoice',label:{...question.label},value:option?.id??null,optionLabel:option?{...option.label}:null};
  })
 };
}
// Preserve original question/answer text for the report, without classification.
export function intakeAnswerNotes(questionnaire,answers,locale='ko'){
 if(!questionnaire)return '';
 return buildIntakeSubmission(questionnaire,answers).answers.filter(answer=>answer.value!==null)
  .map(answer=>intakeLabel(answer.label,locale)+': '+intakeLabel(answer.optionLabel,locale)).join('\n');
}
