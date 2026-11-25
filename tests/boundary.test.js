// Unit tests for boundary.js — the topic-independent boundary evidence contract.
// The activity comes from the real pilot adapter (pilot_packs.py) so answer keys stay tied to the pack.
// Run: node --test tests/boundary.test.js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const B=require('../boundary.js');
const L=require('../learning.js');

const ROOT=path.resolve(__dirname,'..');
const ACTIVITY=JSON.parse(execFileSync('python3',['-c',"import json,pilot_packs as p;print(json.dumps(p.activity('http-cookie-vs-server-session',p.ROOT/'reference-packs',dev=True),ensure_ascii=False))"],{cwd:ROOT,encoding:'utf8'}));
const clone=v=>JSON.parse(JSON.stringify(v));
const fresh=(a=ACTIVITY,seed=0.37)=>B.attach(clone(a),1000,()=>seed);
function answerAll(b,right=true){for(const q of b.content.checks){const o=right?q.answer:q.options.find(x=>x.id!==q.answer).id;assert.equal(B.answerCheck(b,q.id,o,2000).ok,true)}}
function complete(b){for(const s of b.content.situations)B.recordPrediction(b,s.id,'예측 '+s.id,1500);B.recordExplanation(b,'쿠키는 식별자를 운반하고 세션 상태는 서버에 있어요.',1800);answerAll(b)}
/** A reviewed activity, as the adapter would produce after a complete human review (simulated, tests only). */
function reviewed(){const a=clone(ACTIVITY);a.pack.mode='reviewed';a.pack.gate={reviewStatus:'reviewed',coreEligible:true,mayAward:true,awardable:['K1','K3']};return a}

test('draft pilot: all checks correct is only a labelled preview, never keyed',()=>{
 const b=fresh();complete(b);const ev=B.evidence(b);
 assert.equal(b.pack.mode,'draft-preview');assert.equal(B.awardable(b),false);
 assert.equal(ev.keyed,false);assert.equal(ev.tier,'explained');assert.equal(ev.preview,true);assert.equal(ev.correctCount,2);
 assert.match(B.describe(ev,b.content.concepts),/성취 미리보기: 검토 중인 학습 자료라 성취로 기록되지 않아요/);
});

test('negative: tampered or inconsistent records cannot become keyed',()=>{
 const tamper=[
  b=>{b.pack.mode='reviewed'},                                            // mode flipped, gate still draft
  b=>{b.pack.mode='reviewed';b.pack.gate.reviewStatus='reviewed'},         // mayAward still false
  b=>{Object.assign(b.pack,{mode:'reviewed'});Object.assign(b.pack.gate,{reviewStatus:'reviewed',coreEligible:true,mayAward:true,awardable:['K1']})}, // K3 not awardable
  b=>{Object.assign(b.pack,{mode:'reviewed'});Object.assign(b.pack.gate,{reviewStatus:'draft',coreEligible:true,mayAward:true,awardable:['K1','K3']})},
  b=>{Object.assign(b.pack,{mode:'reviewed'});Object.assign(b.pack.gate,{reviewStatus:'reviewed',coreEligible:false,mayAward:true,awardable:['K1','K3']})},
  b=>{Object.assign(b.pack,{mode:'reviewed'});Object.assign(b.pack.gate,{reviewStatus:'reviewed',coreEligible:true,mayAward:'true',awardable:['K1','K3']})},
  b=>{Object.assign(b.pack,{mode:'reviewed'});delete b.pack.gate},
 ];
 for(const t of tamper){const b=fresh();complete(b);t(b);assert.equal(B.awardable(b),false);assert.notEqual(B.evidence(b).tier,'keyed')}
 // A stored "correct:true" next to a wrong choice is recomputed from the key, never trusted.
 const r=B.attach(reviewed(),1,()=>0.5);answerAll(r,false);r.answers.forEach(a=>{a.correct=true});
 assert.equal(B.evidence(r).correctCount,0);assert.equal(B.evidence(r).keyed,false);
});

test('positive control: only an eligible reviewed pack with every check correct reaches keyed',()=>{
 const b=B.attach(reviewed(),1,()=>0.5);complete(b);const ev=B.evidence(b);
 assert.equal(ev.tier,'keyed');assert.equal(ev.preview,false);
 assert.match(B.describe(ev,b.content.concepts),/완전한 이해를 뜻하지 않아요/);
 const one=B.attach(reviewed(),1,()=>0.5);complete(one);one.answers[1].choice=one.content.checks[1].options.find(o=>o.id!==one.content.checks[1].answer).id;
 assert.equal(B.evidence(one).tier,'explained');
});

test('activity validation rejects malformed server output',()=>{
 for(const bad of [null,{},{...ACTIVITY,contract:2},{...ACTIVITY,format:'x'},{...ACTIVITY,concepts:ACTIVITY.concepts.slice(0,1)},
  {...ACTIVITY,situations:ACTIVITY.situations.slice(0,1)},{...ACTIVITY,checks:[{...ACTIVITY.checks[0],answer:'z'}]},
  {...ACTIVITY,pack:{...ACTIVITY.pack,mode:'verified'}},{...ACTIVITY,pack:{...ACTIVITY.pack,gate:{...ACTIVITY.pack.gate,mayAward:'no'}}}])
  assert.throws(()=>B.attach(clone(bad)));
});

test('predictions keep the exact text, are recorded once, and are never scored',()=>{
 const b=fresh(),raw='  음… 서버가\n  다시 알아볼 것 같아요?  ';
 assert.deepEqual(B.recordPrediction(b,'S1','  ',1),{ok:false,reason:'short'});
 assert.deepEqual(B.recordPrediction(b,'S1','x'.repeat(B.MAX_TEXT+1),1),{ok:false,reason:'long'});
 assert.deepEqual(B.recordPrediction(b,'S9','예측입니다',1),{ok:false,reason:'unknown'});
 assert.equal(B.recordPrediction(b,'S1',raw,111).ok,true);
 assert.deepEqual(B.recordPrediction(b,'S1','바꾼 예측',112),{ok:false,reason:'already'});
 assert.equal(b.predictions[0].text,raw);assert.equal(b.predictions[0].at,111);
 assert.equal(B.evidence(b).tier,'encountered');
 // An "incorrect" prediction counts exactly like any other: exploring is the evidence, not being right.
 B.recordPrediction(b,'S2','쿠키가 있으니 그대로 로그인돼 있을 거예요',113);
 assert.equal(B.evidence(b).tier,'explored');
});

test('keyed checks: deterministic key, first answer only, choices and timestamps recorded',()=>{
 const b=fresh(),[k1,k3]=b.content.checks;
 assert.deepEqual(B.answerCheck(b,'K1','zz',5),{ok:false,reason:'option'});
 const wrong=k1.options.find(o=>o.id!==k1.answer).id;
 assert.deepEqual(B.answerCheck(b,'K1',wrong,10),{ok:true,correct:false});
 assert.deepEqual(B.answerCheck(b,'K1',k1.answer,11),{ok:false,reason:'already'});
 assert.deepEqual(B.answerCheck(b,'K3',k3.answer,12),{ok:true,correct:true});
 assert.deepEqual(b.answers,[{checkId:'K1',choice:wrong,correct:false,at:10},{checkId:'K3',choice:k3.answer,correct:true,at:12}]);
 const ev=B.evidence(b);assert.equal(ev.correctCount,1);assert.equal(ev.preview,false);assert.equal(ev.keyed,false);
});

test('answer keys and texts come from the pack; option order is shuffled but keyed by id',()=>{
 for(const q of ACTIVITY.checks)assert.equal(q.answer,'a');  // in the pack the key is always the first option
 const firsts=new Set();for(const seed of [0,0.2,0.4,0.6,0.8,0.99]){const b=fresh(ACTIVITY,seed);
  b.content.checks.forEach((q,i)=>{const src=ACTIVITY.checks[i];assert.equal(q.answer,src.answer);assert.equal(q.rationale,src.rationale);
   assert.deepEqual([...q.options].sort((x,y)=>x.id.localeCompare(y.id)),src.options);firsts.add(q.options[0].id)})}
 assert.ok(firsts.size>1,'the key is not always shown first');
});

test('skipping is recorded without penalty and can be undone',()=>{
 const b=fresh();for(const p of ['situations','explanation','checks'])B.skip(b,p,7);B.skip(b,'bogus',7);
 assert.deepEqual(Object.keys(b.skipped).sort(),['checks','explanation','situations']);
 const ev=B.evidence(b);assert.equal(ev.tier,'encountered');assert.deepEqual(ev.skipped.sort(),['checks','explanation','situations']);
 assert.doesNotMatch(B.describe(ev,b.content.concepts),/실패|틀렸|감점|부족/);
 B.unskip(b,'checks');assert.equal(b.skipped.checks,undefined);
 B.recordExplanation(b,'두 개념은 역할이 달라요. 쿠키는 운반, 세션은 서버 상태.',9);assert.equal(b.skipped.explanation,undefined);
});

test('incomplete explanations are refused; any submitted explanation is evidence of writing, not of correctness',()=>{
 const b=fresh();assert.deepEqual(B.recordExplanation(b,'쿠키는 서버',1),{ok:false,reason:'short'});
 assert.equal(B.recordExplanation(b,'쿠키랑 세션은 같은 거 아닌가요? 잘 모르겠어요.',2).ok,true);
 const ev=B.evidence(b);assert.equal(ev.tier,'explained');assert.equal(ev.aiReviewed,false);
 assert.match(B.TIER_TEXT.explained,/판정은 아니에요/);
});

test('no evidence text claims mastery, verification or permanence',()=>{
 const forbidden=/마스터|숙달|이해 완료|완전히 이해했|검증된|검증 완료|영구|뇌|master|verified|permanent/i;
 const all=[...Object.values(B.TIER_TEXT)];
 for(const setup of [b=>b,complete,b=>{B.skip(b,'checks',1)},b=>{answerAll(b,false)}]){const b=fresh();setup(b);all.push(B.describe(B.evidence(b),b.content.concepts))}
 const r=B.attach(reviewed(),1,()=>0.5);complete(r);all.push(B.describe(B.evidence(r),r.content.concepts));
 for(const t of all)assert.doesNotMatch(t.replace('완전한 이해를 뜻하지 않아요',''),forbidden,t);
});

test('old, partial or foreign records never throw and show nothing',()=>{
 for(const v of [undefined,null,{},{contract:2},{contract:1},{contract:1,content:{}},'x',[]]){assert.equal(B.evidence(v),null);assert.equal(B.awardable(v),false);assert.equal(B.usable(v),false)}
});

test('AI feedback reuses the existing coach and validator with the boundary concepts',()=>{
 const b=fresh(),p=B.feedbackLesson(b);
 assert.deepEqual(Object.keys(p).sort(),['concepts','explainPrompt','technical','title']);
 assert.deepEqual(p.concepts.map(c=>c.id),['cookie','server-session']);assert.equal(p.explainPrompt,ACTIVITY.prompt.text);
 const text='쿠키는 세션 식별자를 운반하고, 서버 측 세션은 서버가 그 식별자로 찾는 상태예요.';
 const f=L.validateFeedback({schema:2,summary:'좋아요',correct:[],precision:[],misconceptions:[],missing:[],explained:[{id:'cookie',quote:'쿠키는 세션 식별자를 운반하고'},{id:'session-id',quote:'식별자'}],uncertainty:'설명이 짧아 판단이 제한적이에요.'},p.concepts.map(c=>c.id),text);
 assert.deepEqual(f.explained.map(e=>e.id),['cookie']);assert.equal(f.uncertainty,'설명이 짧아 판단이 제한적이에요.');
});

test('concept matching for the constellation is exact (name or alias), never fuzzy',()=>{
 const [cookie,session]=ACTIVITY.concepts;
 assert.equal(B.matchConcept(cookie,[{id:'k2',name:'쿠키'}])?.id,'k2');
 assert.equal(B.matchConcept(cookie,[{id:'k',name:'HTTP Cookie'}])?.id,'k');
 assert.equal(B.matchConcept(session,[{id:'k3',name:'세션 ID'},{id:'k4',name:'서버 세션 저장소'}]),null);
 assert.equal(B.matchConcept(session,[{id:'k9',name:'서버 세션'}])?.id,'k9');
});
