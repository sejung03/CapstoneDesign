import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanProfile,normalizeAge,hasProfileChanges,emptyProfile} from '../profile.mjs';
import {reportSource} from '../report.mjs';
test('completed age accepts zero and whole years, rejects age groups and invalid input without guessing birth dates',()=>{
 for(const value of ['0','30','120',0,30])assert.equal(normalizeAge(value),String(value));
 for(const value of ['',null,'adult','senior','-1','121','1.5','1e2'])assert.equal(normalizeAge(value),'');
 assert.equal(cleanProfile({age:'030'}).age,'30');
});
test('unsaved health drafts do not change report values and zero completed years is included',()=>{
 const profile={...emptyProfile(),age:'0',allergies:'저장한 알레르기'},draft={...profile,age:'30',allergies:'미저장'};
 assert.equal(hasProfileChanges(profile,draft),true);assert.equal(hasProfileChanges(profile,{...profile}),false);
 const state={locale:'ko',profile,profileDraft:draft,draft:{symptom:'',onset:''},chat:{messages:[]},assistant:{answers:[]}};
 assert.equal(reportSource(state,key=>key).age,'만 0세');assert.equal(reportSource(state,key=>key).allergies,'저장한 알레르기');
});
