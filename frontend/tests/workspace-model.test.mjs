import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace,intakeSnapshot,conversationFacilities} from '../workspace-model.mjs';
import {mockIntakeQuestionnaire as q} from '../intake-data.mjs';
test('workspace defaults to conversation without storage or an open panel',()=>assert.deepEqual(createWorkspace(),{panel:null,expanded:false,intake:false}));
test('skipped intake preserves unanswered status and counts only real selected options',()=>{
 const answers={[q.questions[0].id]:q.questions[0].options[0].id};
 assert.deepEqual(intakeSnapshot(q,answers,{symptom:''},{skipped:true,step:1}),{status:'partial',stoppedQuestionId:q.questions[1].id,answeredCount:1,totalQuestions:2});
 assert.equal(intakeSnapshot(q,{}, {symptom:''},{skipped:true}).status,'skipped');
 assert.equal(intakeSnapshot(q,{[q.questions[0].id]:'invalid'}, {symptom:''},{skipped:true}).answeredCount,0);
 assert.equal(intakeSnapshot(q,answers,{symptom:''}).status,'complete');
});

import {connectCare} from '../care-client.mjs';
test('backend connection rejects invalid configuration before loading or changing the application',async()=>{
 await assert.rejects(connectCare({requestAssistant:42}),/requestAssistant/);
 await assert.rejects(connectCare({rankFacilities:42}),/rankFacilities/);
 await assert.rejects(connectCare({emergencyGuides:[{id:'invalid'}]}),/Invalid emergency/);
 await assert.rejects(connectCare({questionnaire:{questions:[]}}),/Invalid intake/);
 await assert.rejects(connectCare(),/browser/);
});

test('chat recommendations exclude closed and unknown hours and sort real route distances first',()=>{
 const items=[{id:'closed',status:'closed',distance:0.1},{id:'unknown',status:'unknown',distance:0.2},{id:'no-route',status:'open',distance:null},{id:'far',status:'open',distance:2},{id:'near',status:'open',distance:0.5}];
 assert.deepEqual(conversationFacilities(items).map(item=>item.id),['near','far','no-route']);
 assert.equal(items[0].id,'closed');
 assert.deepEqual(conversationFacilities(items.slice(0,2)),[]);
});
