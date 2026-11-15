import {phrase,expandLocales} from './i18n.mjs';
// General reporting guidance, not symptom triage or treatment selection.
export const emergencyResources={
 instructions:[
  expandLocales({ko:'환자가 있는 위치를 알려 주세요. 주소를 모르면 주변 건물이나 도로명을 설명해 주세요.',en:'Tell the dispatcher where the patient is. Describe nearby buildings or streets if you do not know the address.'}),
  expandLocales({ko:'환자의 상태와 의식·호흡 여부를 알려 주세요.',en:'Describe the patient’s condition and whether they are conscious and breathing.'}),
  expandLocales({ko:'119 상담원의 질문에 답하고 안내를 따라 주세요.',en:'Answer the 119 dispatcher’s questions and follow their instructions.'})
 ],
 source:{label:'소방청 119 구급신고 요령',url:'https://www.nfsa.go.kr/nfa/safetyinfo/emergencyservice/119emergencydeclaration/'},
 videos:[{youtubeId:'CGG9g1pvJ4g',title:expandLocales({ko:'생명을 살리는 심폐소생술 - 119가 도와드려요',en:'Life-saving CPR — 119 can help'}),source:'질병관리청 국가손상정보포털 (2023)',sourceUrl:'https://www.kdca.go.kr/injury/biz/injury/recsroom/ruleNdManual/ruleNdManualView.do?no=81'}]
};

// Additional reviewed topics can be supplied through connectCare({emergencyGuides}).
export const defaultEmergencyGuides=[{
 id:'cpr',title:expandLocales({ko:'심폐소생술 안내·영상',en:'CPR guidance and video'}),
 instructions:[],videos:emergencyResources.videos,source:{label:emergencyResources.videos[0].source,url:emergencyResources.videos[0].sourceUrl}
}];

// Short, source-backed reference cards. These are not generated from symptoms.
// Scope and source are visible; the backend selects a reviewed topic ID only.
defaultEmergencyGuides.push(
 {id:'choking',title:expandLocales({ko:'성인 기도폐쇄 (하임리히법)',en:'Adult choking (Heimlich manoeuvre)'}),instructions:[
  expandLocales({ko:'기침할 수 있으면 기침을 계속하도록 돕습니다. 입 안을 손가락으로 무작정 훑지 않습니다.',en:'Encourage coughing if possible. Do not blindly sweep the mouth with your fingers.'}),
  expandLocales({ko:'말하거나 숨 쉬거나 기침하기 어려우면 주변에 119 신고를 요청하고, 등을 앞으로 숙인 상태에서 어깨뼈 사이를 손꿈치로 최대 5회 두드립니다.',en:'If they cannot speak, breathe or cough, ask someone to call 119. Lean them forward and give up to 5 back blows between the shoulder blades.'}),
  expandLocales({ko:'해결되지 않으면 배꼽 위를 안쪽과 위쪽으로 최대 5회 밀어 올리고, 도움을 받을 때까지 반복합니다. 영아와 임신부에게 복부 밀어올리기를 시행하지 않습니다. 119의 안내를 따르세요.',en:'If unsuccessful, give up to 5 inward and upward abdominal thrusts above the navel. Repeat while awaiting help. Do not use abdominal thrusts on babies or pregnant people. Follow 119 instructions.'})
 ],videos:[],source:{label:'British Red Cross · Adult choking',url:'https://www.redcross.org.uk/first-aid/learn-first-aid/choking'}},
 {id:'bleeding',title:expandLocales({ko:'심한 출혈',en:'Heavy bleeding'}),instructions:[
  expandLocales({ko:'주변에 119 신고를 요청하고 깨끗한 천이나 거즈로 상처를 단단히 눌러 지혈합니다.',en:'Ask someone to call 119 and apply firm pressure using a clean cloth or dressing.'}),
  expandLocales({ko:'박힌 물체는 빼지 말고 그 주위를 누릅니다. 구조대가 올 때까지 압박을 유지하고 119의 안내를 따르세요.',en:'Do not remove an embedded object; press around it. Keep pressure on the wound until help arrives and follow 119 instructions.'})
 ],videos:[],source:{label:'British Red Cross · Heavy bleeding',url:'https://www.redcross.org.uk/first-aid/learn-first-aid/bleeding-heavily'}},
 {id:'burns',title:expandLocales({ko:'뜨거운 물·열에 의한 화상',en:'Thermal burns and scalds'}),instructions:[
  expandLocales({ko:'화상 부위를 시원한 흐르는 물로 20분 동안 식힙니다. 주변 옷과 장신구는 제거하되 피부에 붙은 것은 떼지 않습니다.',en:'Cool the burn under cool running water for 20 minutes. Remove nearby clothing and jewellery, but leave anything stuck to the skin.'}),
  expandLocales({ko:'물집을 터뜨리거나 크림·기름을 바르지 않습니다. 화상이 넓거나 깊은 경우, 얼굴 화상, 화학물질·전기로 인한 화상은 119에 연락해 안내를 받으세요.',en:'Do not burst blisters or apply creams or oils. Call 119 for large or deep burns, facial burns, or burns caused by chemicals or electricity.'})
 ],videos:[],source:{label:'NHS · Burns and scalds (2026)',url:'https://www.nhs.uk/conditions/Burns-and-scalds/'}},
 {id:'seizure',title:expandLocales({ko:'경련·발작',en:'Seizures'}),instructions:[
  expandLocales({ko:'위험한 장소가 아니면 억지로 옮기지 말고 머리를 부드럽게 받칩니다. 경련이 시작되고 끝난 시각을 확인합니다.',en:'Move them only if they are in danger. Cushion their head and note when the seizure starts and ends.'}),
  expandLocales({ko:'입에 손가락이나 물건을 넣지 않고, 완전히 회복하기 전에는 음식이나 음료를 주지 않습니다.',en:'Do not put fingers or objects in their mouth, or give food or drink before full recovery.'}),
  expandLocales({ko:'처음 발생했거나 5분 이상 지속되는 경우, 의식이 돌아오지 않거나 호흡이 어려운 경우에는 119에 연락하세요.',en:'Call 119 for a first seizure, one lasting over 5 minutes, failure to regain consciousness, or breathing difficulties.'})
 ],videos:[],source:{label:'NHS · Seizure first aid',url:'https://www.nhs.uk/symptoms/what-to-do-if-someone-has-a-seizure-fit/'}}
);
defaultEmergencyGuides.push({id:'aed',title:expandLocales({ko:'자동심장충격기 (AED)',en:'Automated external defibrillator (AED)'}),instructions:[
 expandLocales({ko:'119에 신고하고 주변에 도움을 요청하세요. 다른 사람이 있으면 AED를 가져오도록 요청합니다.',en:'Call 119 and ask for help. If someone else is present, ask them to fetch an AED.'}),
 expandLocales({ko:'AED 전원을 켜고 기기의 그림·음성 안내에 따라 맨가슴에 패드를 붙입니다. 여러 명이 있으면 패드를 붙이는 동안에도 심폐소생술을 이어갑니다.',en:'Switch on the AED and follow its diagrams and spoken instructions to attach pads to the bare chest. With more than one rescuer, continue CPR while attaching pads.'}),
 expandLocales({ko:'기기가 심장 리듬을 분석하거나 충격을 전달할 때는 환자에게 손대지 않습니다. 이후에도 기기와 119의 안내를 따르세요.',en:'Do not touch the person during rhythm analysis or shock delivery. Continue to follow the AED and 119 instructions.'})
],videos:[],source:{label:'NHS inform · How to use an AED',url:'https://www.nhsinform.scot/tests-and-treatments/first-aid/how-to-use-an-aed/'}});
