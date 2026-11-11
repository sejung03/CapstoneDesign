// Session-only presentation state. No clinical branching or persistence.
export function createWorkspace(){return {panel:null,expanded:false,intake:false};}
export function intakeSnapshot(questionnaire,answers,draft,{skipped=false,step=0}={}){
 const completed=questionnaire.questions.filter(q=>Object.hasOwn(answers,q.id)&&q.options.some(option=>option.id===answers[q.id])).length;
 return {status:skipped?(completed||draft.symptom?'partial':'skipped'):'complete',stoppedQuestionId:skipped?questionnaire.questions[step]?.id||null:null,answeredCount:completed,totalQuestions:questionnaire.questions.length};
}

// Only schedule-confirmed open facilities appear as chat recommendations.
// Distance comes from the existing route lookup; missing distance stays last.
export function conversationFacilities(items){
 return items.filter(item=>item.status==='open').sort((a,b)=>{
  const distance=item=>Number.isFinite(item.distance)?item.distance:Infinity;
  return distance(a)-distance(b)||(a.providerOrder??0)-(b.providerOrder??0);
 });
}
