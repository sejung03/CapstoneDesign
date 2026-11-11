export const emptyDraft = () => ({ symptom: "", onset: "", region: "" });
export function prepareDraft(values) {
 return {symptom:String(values.symptom??"").trim().slice(0,1000), onset:["today","yesterday","days","longer"].includes(values.onset)?values.onset:"",region:String(values.region??"").trim().slice(0,80)};
}
// Submitted questionnaire snapshot for the future LLM request; no inferred fields.
export function buildIntakeContext(draft) {
 const {symptom,onset,region}=prepareDraft(draft);
 return {symptom,onset,region};
}
export function appendSymptom(draft,message) {
 const addition=message.trim(); if(!addition)return {...draft};
 return {...draft,symptom:[draft.symptom,addition].filter(Boolean).join("\n").slice(0,1000)};
}