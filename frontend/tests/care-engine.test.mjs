// /api/care 처리기와 브라우저 어댑터. 실제 문진 엔진(../care_engine)을 LLM 없이(mock provider) 부른다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCareHandler,loadEngine,loadEngineEnv,engineConsent,createRefStore,warmCareLlm} from '../lib/care-engine-server.mjs';
import {createCareAssistant,createCareRanking,careHealthNotice,CARE_CONSENT_VERSION} from '../care-adapter.mjs';
import {rankFacilities} from '../lib/care-ranking.mjs';
import {fetchRefTables,createSupabaseRefStore,REF_TABLES} from '../lib/care-data-supabase.mjs';
import {normalizeAssistantResponse} from '../assistant.mjs';
import {normalizeHealthNotice,localHealthNotice,careAiHealthNotice,careAiHealthNoticeEn} from '../health-consent.mjs';

for(const key of ['LLM_PROVIDER','OPENAI_API_KEY','LLM_DEV_CONSENT'])delete process.env[key];
const ORIGIN='http://127.0.0.1:3080';
const handler=createCareHandler({sameOrigin:request=>request.headers.get('origin')===ORIGIN});
const post=(body,headers={})=>new Request(ORIGIN+'/api/care',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
const payload=(over={})=>({reason:'message',locale:'ko',intake:null,messages:['기침이 나요'],followUpAnswers:[],profile:{age:'',allergies:'',medications:'',history:''},search:{region:'',type:'all',department:'all',openOnly:false,mode:'walk'},...over});

test('care: 엔진이 로드되고 첫 메시지에 질문 하나를 돌려준다(프론트 계약 통과, trace 없음)',async()=>{
 const res=await handler(post(payload()));
 assert.equal(res.status,200);
 assert.equal(res.headers.get('cache-control'),'no-store');
 const data=await res.json();
 assert.equal(data.trace,undefined);
 assert.ok(data.followUp?.id);
 const normalized=normalizeAssistantResponse(data);
 assert.equal(normalized.followUp.id,data.followUp.id);
});

test('care: 응급·민감·약국·skip 응답도 프론트 normalizeAssistantResponse를 통과한다',async()=>{
 const cases=[
  payload({messages:['아기가 숨을 안 쉬어요']}),
  payload({messages:['죽고 싶어요']}),
  payload({messages:['문 연 약국 찾아줘']}),
  payload({reason:'skip',followUpAnswers:[{questionId:'Q0',value:'no'}]}),
  payload({reason:'followup',messages:['오늘 갑자기 몸이 이상해요'],followUpAnswers:[{questionId:'SENSITIVE_CHOICE_1',value:null}]}),
 ];
 for(const p of cases){
  const res=await handler(post(p));
  assert.equal(res.status,200,p.messages[0]);
  const data=await res.json();
  assert.doesNotThrow(()=>normalizeAssistantResponse(data),p.messages[0]);
 }
 const em=await (await handler(post(cases[0]))).json();
 assert.equal(em.emergency.active,true);
 const sens=await (await handler(post(cases[1]))).json();
 assert.match(sens.followUp.id,/^SENSITIVE_CHOICE_1$/);
});

test('care: 잘못된 요청은 엔진을 부르지 않고 거절한다',async()=>{
 let loads=0;const h=createCareHandler({sameOrigin:r=>r.headers.get('origin')===ORIGIN,loadEngine:async()=>{loads++;return loadEngine();}});
 assert.equal((await h(new Request(ORIGIN+'/api/care',{method:'GET'}))).status,405);
 assert.equal((await h(post(payload(),{origin:'https://evil.example'}))).status,403);
 assert.equal((await h(post(payload(),{'content-type':'text/plain'}))).status,415);
 assert.equal((await h(post('{bad'))).status,400);
 assert.equal((await h(post('[]'))).status,400);
 assert.equal((await h(post({...payload(),messages:['x'.repeat(70000)]}))).status,413);
 assert.equal(loads,0);
 const unsupported=await h(post(payload({reason:'bogus'})));
 assert.equal(unsupported.status,400);
 assert.deepEqual(await unsupported.json(),{error:'unsupported_reason'});
});

test('care: 엔진을 불러오지 못하면 503(임의 응답을 만들지 않음)',async()=>{
 const h=createCareHandler({sameOrigin:()=>true,loadEngine:async()=>{throw new Error('missing');}});
 const res=await h(post(payload()));
 assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{error:'engine_unavailable'});
});

test('care: 개발 환경에서만 care_engine/.env의 LLM 키를 채우고, 이미 있는 값과 다른 키는 건드리지 않는다',()=>{
 const file='OPENAI_API_KEY=sk-test\nLLM_PROVIDER=openai\nLLM_DEV_CONSENT=true\nSUPABASE_SECRET_KEY=nope\n';
 const io={dir:'/x',read:()=>file,exists:()=>true};
 const prod={NODE_ENV:'production'};
 assert.deepEqual(loadEngineEnv({env:prod,...io}),[]);
 assert.equal(prod.OPENAI_API_KEY,undefined);
 const dev={NODE_ENV:'development',LLM_PROVIDER:'mock'};
 assert.deepEqual(loadEngineEnv({env:dev,...io}).sort(),['LLM_DEV_CONSENT','OPENAI_API_KEY']);
 assert.equal(dev.LLM_PROVIDER,'mock');
 assert.equal(dev.SUPABASE_SECRET_KEY,undefined);
 assert.deepEqual(loadEngineEnv({env:{NODE_ENV:'development'},dir:'/x',read:()=>file,exists:()=>false}),[]);
});

test('care adapter: 답하지 않은 위험·민감 질문 ID를 value:null로 계속 보내고, 답하거나 새 대화면 뺀다',async()=>{
 const sent=[];let next={followUp:{id:'RISK_CONFIRM_1'}};
 const fetchImpl=async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json(next);};
 const ask=createCareAssistant({fetchImpl});
 await ask({messages:['a'],followUpAnswers:[]});
 next={followUp:{id:'Q0'}};
 await ask({reason:'skip',messages:['a'],followUpAnswers:[]});
 assert.deepEqual(sent[1].followUpAnswers,[{questionId:'RISK_CONFIRM_1',value:null}]);
 await ask({messages:['a','b'],followUpAnswers:[{questionId:'RISK_CONFIRM_1',value:'risk_no'}]});
 assert.deepEqual(sent[2].followUpAnswers,[{questionId:'RISK_CONFIRM_1',value:'risk_no'}]);
 await ask({messages:['a','b'],followUpAnswers:[]});
 assert.deepEqual(sent[3].followUpAnswers,[]);
 next={followUp:{id:'SENSITIVE_CHOICE_1'}};
 await ask({messages:['c'],followUpAnswers:[]});
 next={followUp:{id:'Q0'}};
 await ask({messages:['d'],followUpAnswers:[]}); // 새 대화
 assert.deepEqual(sent[5].followUpAnswers,[]);
 assert.equal(sent[0].messages[0],'a');
});

test('care adapter: 서버 오류는 예외로 알려 프론트 재시도 UI가 뜨게 한다, 처리 안내는 형식 검사를 통과한다',async()=>{
 const ask=createCareAssistant({fetchImpl:async()=>Response.json({error:'internal'},{status:500})});
 await assert.rejects(()=>ask({messages:['a']}),/care_500/);
 assert.doesNotThrow(()=>normalizeHealthNotice(careHealthNotice));
});

test('care consent: 지금 안내 버전을 확인한 요청만 외부 AI 동의, 그 밖에는 granted:false(개발용 동의도 쓰지 않음)',()=>{
 const env={LLM_PROVIDER:'openai'};
 assert.deepEqual(engineConsent({granted:true,version:CARE_CONSENT_VERSION},env),{granted:true,provider:'openai',version:CARE_CONSENT_VERSION,healthInfo:true});
 for(const c of [undefined,null,{granted:true,version:'old'},{granted:false,version:CARE_CONSENT_VERSION},'yes'])assert.deepEqual(engineConsent(c,env),{granted:false});
 assert.equal(engineConsent({granted:true,version:CARE_CONSENT_VERSION},{}).provider,'mock');
 // 11/18: 외부 AI 안내(careAiHealthNotice)를 쓴다 → 그 안내에 동의한 요청은 외부 AI 동의. 원래 안내(외부 AI 없음)에 동의한 요청은 아니다
 assert.equal(careHealthNotice,careAiHealthNotice);
 assert.equal(careHealthNotice.version,CARE_CONSENT_VERSION);
 assert.deepEqual(engineConsent({granted:true,version:careHealthNotice.version},env),{granted:true,provider:'openai',version:CARE_CONSENT_VERSION,healthInfo:true});
 assert.deepEqual(engineConsent({granted:true,version:localHealthNotice.version},env),{granted:false});
 // 안내 문구는 실제 동작과 맞아야 한다: 외부 업체·나라, 가리는 항목, 가려지지 않는 항목, 저장하지 않게 요청, 진단 아님
 for(const word of ['OpenAI','미국','전화번호','주민등록번호','이름·주소','저장하지 않도록','진단하지 않습니다'])assert.ok(careAiHealthNotice.processing.includes(word),word);
 assert.doesNotThrow(()=>normalizeHealthNotice(careAiHealthNotice));
 assert.doesNotThrow(()=>normalizeHealthNotice(careAiHealthNoticeEn));
});

test('care consent: 처리기가 동의를 ctx로 넘기고 payload.consent는 엔진에 넘기지 않는다',async()=>{
 const seen=[];const fake={runCare:async(p,ctx,deps)=>{seen.push({p,ctx,deps});return {response:{followUp:{id:'Q0',type:'singleChoice',required:true,label:{ko:'질문'},options:[{id:'yes',label:{ko:'예'}}]}}};}};
 const h=createCareHandler({sameOrigin:()=>true,loadEngine:async()=>fake,env:{LLM_PROVIDER:'openai'},refStore:async()=>({marker:1})});
 assert.equal((await h(post({...payload(),consent:{granted:true,version:CARE_CONSENT_VERSION}}))).status,200);
 assert.equal(seen[0].p.consent,undefined);
 assert.equal(seen[0].ctx.consent.granted,true);
 assert.deepEqual(seen[0].deps,{refStore:{marker:1}});
 await h(post(payload()));
 assert.deepEqual(seen[1].ctx.consent,{granted:false});
 const noData=createCareHandler({sameOrigin:()=>true,loadEngine:async()=>fake,refStore:async()=>null});
 await noData(post(payload()));
 assert.deepEqual(seen[2].deps,{});
});

test('care ranking: 대표 진료과 → 진료가 확인된 곳 순, 같은 무리는 화면 순서 유지, 근거 없으면 추천 없음',()=>{
 const items=[
  {facilityId:'k-3',type:'hospital',department:'family',departments:['family','internal'],status:'open',displayOrder:0},
  {facilityId:'k-1',type:'hospital',department:'internal',departments:['internal'],status:'open',displayOrder:2},
  {facilityId:'k-2',type:'hospital',department:'internal',departments:['internal'],status:'open',displayOrder:1},
  {facilityId:'k-4',type:'hospital',department:'ent',departments:['ent'],status:'open',displayOrder:3},
 ];
 const r=rankFacilities({search:{department:'internal',type:'hospital'},candidates:{resultSetId:'results-1',items}});
 assert.equal(r.resultSetId,'results-1');
 assert.deepEqual(r.items.map(i=>i.facilityId),['k-2','k-1','k-3']);
 assert.match(r.items[0].reason.ko,/내과가 대표 진료과/);
 assert.match(r.items[2].reason.ko,/내과 진료가 확인된/);
 assert.ok(r.items.every(i=>i.reason.ko.length<=240));
 assert.deepEqual(rankFacilities({search:{department:'all'},candidates:{resultSetId:'r',items}}).items,[]);
 assert.deepEqual(rankFacilities({search:{department:'pharmacy',type:'pharmacy'},candidates:{resultSetId:'r',items}}).items,[]);
 const same=items.map(i=>({...i,department:'internal',departments:['internal']}));
 assert.deepEqual(rankFacilities({search:{department:'internal'},candidates:{resultSetId:'r',items:same}}).items,[]);
 assert.throws(()=>rankFacilities({search:{department:'internal'},candidates:{items}}));
});

test('care ranking: 처리기는 엔진을 부르지 않고 순위를 돌려주며, 어댑터는 대화 내용을 보내지 않는다',async()=>{
 let loads=0;const h=createCareHandler({sameOrigin:()=>true,loadEngine:async()=>{loads++;return loadEngine();}});
 const res=await h(post({reason:'recommendations',search:{department:'internal'},candidates:{resultSetId:'r1',items:[{facilityId:'a',department:'internal',departments:['internal'],status:'open',displayOrder:1},{facilityId:'b',department:'ent',departments:['ent'],status:'open',displayOrder:0}]}}));
 assert.equal(res.status,200);
 assert.deepEqual((await res.json()).items.map(i=>i.facilityId),['a']);
 assert.equal((await h(post({reason:'recommendations',candidates:null}))).status,400);
 assert.equal(loads,0);
 const sent=[];const rank=createCareRanking({fetchImpl:async(u,o)=>{sent.push(JSON.parse(o.body));return Response.json({resultSetId:'r',items:[]});}});
 await rank({reason:'recommendations',locale:'ko',messages:['비밀 증상'],followUpAnswers:[{questionId:'Q0',value:'no'}],profile:{age:'30'},search:{department:'internal'},candidates:{resultSetId:'r',items:[]}});
 assert.deepEqual(Object.keys(sent[0]).sort(),['candidates','locale','reason','search']);
});

test('care adapter: 확인한 안내 버전(11/18 외부 AI 안내)을 consent로 보낸다',async()=>{
 const sent=[];const ask=createCareAssistant({fetchImpl:async(u,o)=>{sent.push(JSON.parse(o.body));return Response.json({followUp:{id:'Q0'}});}});
 await ask({messages:['a'],followUpAnswers:[]});
 assert.deepEqual(sent[0].consent,{granted:true,version:CARE_CONSENT_VERSION});
});

test('care data: ref 표를 1000행씩 나눠 읽고, 요청은 읽기를 기다리지 않으며(처음엔 null=CSV), 실패하면 60초 뒤 다시 시도한다',async()=>{
 const calls=[];
 const fetchImpl=async(u)=>{calls.push(u);const off=Number(new URL(u).searchParams.get('offset'));const name=new URL(u).pathname.split('/').pop();
  const rows=name==='symptom_department_variant'?Array.from({length:off===0?1000:16},(_,i)=>({i})):[{x:1}];return Response.json(rows);};
 const t=await fetchRefTables({url:'https://p.supabase.co',key:'k',fetchImpl});
 assert.deepEqual(Object.keys(t).sort(),Object.keys(REF_TABLES).sort());
 assert.equal(t.symptom_department_variant.length,1016);
 assert.ok(calls.every(u=>u.includes('order=')));
 let clock=0,fail=true,built=0,errors=0;
 const store=createSupabaseRefStore({config:()=>({url:'https://p.supabase.co',key:'k'}),fetchImpl:async()=>fail?new Response('x',{status:500}):Response.json([]),buildData:()=>({built:++built}),now:()=>clock,onError:()=>errors++});
 assert.equal(store(),null); // 기다리지 않음 → CSV
 await store.ready();
 assert.equal(errors,1);
 fail=false;clock=30*1000;assert.equal(store(),null);await store.ready(); // 60초 안에는 다시 읽지 않음
 assert.equal(built,0);
 clock=61*1000;assert.equal(store(),null);await store.ready();
 assert.deepEqual(store(),{built:1});
 clock=62*1000;assert.deepEqual(store(),{built:1});
 clock=62*1000+10*60*1000;assert.deepEqual(store(),{built:1});await store.ready(); // 오래된 캐시를 쓰며 뒤에서 새로 읽음
 assert.deepEqual(store(),{built:2});
 const rs=createRefStore({supabaseConfig:null});assert.equal(await rs(),null);await rs.warm();
});

// 11/18 LLM 예열: 같은 데이터(refStore)로 엔진 warmLlm을 부르고, 실패해도 던지지 않는다. 실제 엔진은 mock이라 건너뛴다.
test('warmCareLlm: refStore 데이터를 넘기고 결과 개수·지연만 로그, 실패는 null',async()=>{
 const logs=[];let got=null;
 const fake={warmLlm:async(deps)=>{got=deps;return {skipped:null,results:[{sex:null,ok:true,latencyMs:900,error:null},{sex:'female',ok:false,latencyMs:0,error:'timeout'}]};}};
 const r=await warmCareLlm({loadEngine:async()=>fake,refStore:async()=>({marker:1}),log:m=>logs.push(m)});
 assert.deepEqual(got,{refStore:{marker:1}});assert.equal(r.results.length,2);
 assert.deepEqual(logs,['[care] LLM 예열 1/2 (900/0ms) 오류 timeout']);
 assert.equal(await warmCareLlm({loadEngine:async()=>{throw new Error('missing');},log:m=>logs.push(m)}),null);
 assert.equal(await warmCareLlm({loadEngine:async()=>({}),log:m=>logs.push(m)}),null);
 assert.equal(await warmCareLlm({loadEngine:async()=>({warmLlm:async()=>{throw new Error('boom');}}),log:m=>logs.push(m)}),null);
 const real=await warmCareLlm({log:m=>logs.push(m)});assert.deepEqual(real,{skipped:'mock',results:[]});
 assert.equal(logs.length,1);
});

// 11/18 되묻기: 실제 엔진(LLM 없음 = 지금 앱과 같음) + 어댑터. 사전이 못 찾으면 SYM_RETRY_<n>, 대화창에 더 적으면 답 없는 질문을 null로 보내 다시 찾는다.
test('care 되묻기: 못 찾으면 SYM_RETRY_1 → 더 적은 말이 사전에 맞으면 사전 확인, 또 못 찾으면 SYM_NOT_FOUND, 부위 버튼 → 부위 증상',async()=>{
 const fetchImpl=async(url,options)=>handler(post(JSON.parse(options.body)));
 const SAFE=[['Q0','no'],['N1','yes'],['N2','yes'],['N3','no'],['T1','self'],['T2','male'],['T3','age_19_64']].map(([questionId,value])=>({questionId,value}));
 const base={reason:'followup',locale:'ko',intake:null,profile:{age:'',allergies:'',medications:'',history:''},search:{region:'',type:'all',department:'all',openOnly:false,mode:'walk'}};
 let ask=createCareAssistant({fetchImpl});
 let r=await ask({...base,messages:['속이 영 이상하고 불편해요'],followUpAnswers:SAFE});
 assert.equal(r.followUp.id,'SYM_RETRY_1');
 assert.equal(r.followUp.options.length,12);
 assert.doesNotThrow(()=>normalizeAssistantResponse(r));
 // 대화창에 더 적음(버튼을 누르지 않음) → 어댑터가 SYM_RETRY_1:null을 붙여 보냄 → 사전 확인
 r=await ask({...base,reason:'message',messages:['속이 영 이상하고 불편해요','발목이 아파요'],followUpAnswers:SAFE});
 assert.equal(r.followUp.id,'SYM_DICT_CONFIRM');
 assert.ok(r.followUp.options.some(o=>o.id==='sym_L16'));
 // 새 대화: 더 적었는데도 못 찾음 → SYM_NOT_FOUND
 ask=createCareAssistant({fetchImpl});
 await ask({...base,messages:['그냥 좀 그래요'],followUpAnswers:SAFE});
 r=await ask({...base,reason:'message',messages:['그냥 좀 그래요','어제부터 계속 그래요'],followUpAnswers:SAFE});
 assert.equal(r.followUp.id,'SYM_NOT_FOUND');
 // 부위 버튼 → 성별(남성)에 맞는 부위 증상 + 여기 없어요
 ask=createCareAssistant({fetchImpl});
 r=await ask({...base,messages:['그냥 좀 그래요'],followUpAnswers:[...SAFE,{questionId:'SYM_RETRY_1',value:'area_urine'}]});
 assert.equal(r.followUp.id,'SYM_AREA_PICK');
 assert.deepEqual(r.followUp.options.map(o=>o.id),['sym_U01','sym_U02','sym_U06','sym_Y02','sym_Y07','sym_Y03','sym_other']);
});

// 11/18 문진 재설계: 상세 질문은 증상 이름이 들어간 문구 + 진행(추가 질문 n/전체). 프론트 정리기는 형식이 맞는 진행만 남긴다.
test('care 문진 재설계: 발목 통증 → 시작 질문에 증상 이름, 진행 1/4가 정리 뒤에도 남는다, 틀린 진행은 버린다',async()=>{
 const SAFE=[['Q0','no'],['N1','yes'],['N2','yes'],['N3','no'],['T1','self'],['T2','female'],['T3','age_19_64'],['SYM_DICT_CONFIRM','sym_L16']].map(([questionId,value])=>({questionId,value}));
 const data=await (await handler(post(payload({reason:'followup',messages:['발목이 아파요'],followUpAnswers:SAFE})))).json();
 assert.equal(data.followUp.id,'N5-1');
 assert.equal(data.followUp.label.ko,'발목 통증·불편 증상은 언제부터 있었나요?');
 assert.deepEqual(data.progress,{current:1,total:4});
 const n=normalizeAssistantResponse(data);
 assert.deepEqual(n.progress,{current:1,total:4});
 assert.equal(normalizeAssistantResponse({...data,progress:{current:5,total:4}}).progress,undefined);
 assert.equal(normalizeAssistantResponse({summary:{ko:'요약'},progress:{current:1,total:1}}).progress,undefined);
});
