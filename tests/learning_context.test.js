// Learning context, visual explanations, source statuses and conversation opinion rules (pure).
// node --test tests/learning_context.test.js — the server-side mirror is tests/test_learning_context.py.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const L=require('../learning.js');const T=require('../tutor.js');
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const clone=x=>JSON.parse(JSON.stringify(x));

test('learningContext carries the story, prediction and choices; outcomes only after answering (same shape the server test uses)',()=>{
 const c=L.learningContext(MEM);
 assert.equal(c.story,MEM.lesson.story);assert.deepEqual(c.prediction,{question:MEM.lesson.prediction,learner:'',unsure:true});
 assert.match(c.scenarios[0].question,/녹음에는 종소리가 없었습니다/);
 assert.deepEqual(Object.keys(c.scenarios[0]).sort(),['answered','learnerChoice','options','question','reason','statedOutcome','title','unsure']);
 assert.equal(c.scenarios[0].learnerChoice,'두 번째 집단에서 더 높아질 수 있다.');assert.equal(c.scenarios[0].title,'소리와 설명 카드');
 const fresh=clone(MEM);fresh.scenarios=[{i:1,choice:null,unsure:true,at:1}];const f=L.learningContext(fresh);
 assert.equal(f.scenarios[0].answered,false);assert.equal(f.scenarios[0].reason,undefined);assert.equal(f.scenarios[0].statedOutcome,undefined);assert.equal(f.scenarios[0].learnerChoice,null);
 assert.equal(f.scenarios[1].unsure,true);assert.equal(f.scenarios[1].learnerChoice,null);assert.ok(f.scenarios[1].reason);
 assert.equal(L.learningContext({lesson:null}),null);
 assert.ok(!JSON.stringify(c).includes('answerIndex')&&!JSON.stringify(c).includes('"hint"'));
});

test('scenario titles: the app-added “사고 실험 N:” prefix is shown once; the stored title is untouched',()=>{
 for(const [raw,shown] of [['사고 실험 1: 소리와 설명 카드','소리와 설명 카드'],['사고실험 2 - 확신','확신'],['생각 실험 3. 빛','빛'],['Thought experiment 1: light','light'],['질문의 힘','질문의 힘'],['사고 실험의 한계','사고 실험의 한계'],['','']])assert.equal(L.scenarioTitle(raw),shown,raw);
 assert.equal(MEM.lesson.scenarios[0].title,'사고 실험 1: 소리와 설명 카드');
});

test('visuals: two fixed shapes, malformed or unsafe specs dropped, at most two per lesson; old lessons unchanged',()=>{
 const flow={type:'flow',title:'흐름',relation:'possible',steps:[{label:'원래 사건'},{label:'나중의 오정보'},{label:'부정확한 보고',detail:'항상은 아님'}]};
 assert.equal(T.cleanVisual(flow).steps.length,3);assert.equal(T.cleanVisual({...flow,relation:'proves'}).relation,'sequence');
 for(const bad of [null,{type:'flow',title:'x',steps:[{label:'a'}]},{type:'chart',title:'수치',data:[1,2]},{type:'html',title:'x',html:'<img onerror=alert(1)>'},
  {type:'compare',title:'x',columns:['a','b'],rows:[{aspect:'r',values:['1']},{aspect:'s',values:['1','2']}]},{...flow,title:' '}])assert.equal(T.cleanVisual(bad),null,JSON.stringify(bad));
 const v=clone(MEM.lesson);v.technical=[...v.technical,...v.technical].map(t=>({...t,visual:flow}));v.reading=[{claim:'c',query:'q',title:'가짜 책',url:'https://x'}];
 const out=T.normalizeExtras(v);assert.equal(out.technical.filter(t=>t.visual).length,2);assert.deepEqual(out.reading,[{claim:'c',query:'q'}]);
 const old=clone(MEM.lesson);T.normalizeExtras(old);assert.ok(!old.technical.some(t=>'visual' in t));assert.ok(!('reading' in old));
});

test('sources: AI suggestions and app-built searches are labelled as unchecked; no citation fields; links are search pages',()=>{
 const l=clone(MEM);const app=T.readingList(l);
 assert.equal(app.length,4);assert.ok(app.every(r=>r.status==='app-search'));assert.equal(app[0].query,'선택적인 부호화');
 for(const r of app)for(const x of r.links)assert.match(x.url,/^https:\/\/(scholar\.google\.com\/scholar|www\.google\.com\/search)\?q=/);
 l.lesson.reading=T.cleanReading([{claim:'사후 오정보 효과',query:'misinformation effect review',kind:'리뷰 논문'},{claim:'링크',query:'https://evil'}]);
 const ai=T.readingList(l);assert.equal(ai.length,1);assert.equal(ai[0].status,'ai-suggested');assert.ok(!('title' in ai[0])&&!('url' in ai[0]));
 assert.ok(!ai.some(r=>r.status==='checked'||r.status==='retrieved-checked'),'nothing claims live verification');
});

test('conversation: an opinion is shown only on what the learner asserted, never on questions or premise checks',()=>{
 assert.equal(T.opinionText({verdict:'misconception',utterance:'claim'}),'AI 의견: 사실과 다른 부분이 있어요');
 assert.equal(T.opinionText({verdict:'imprecise',utterance:'hypothesis'}),'AI 의견: 대체로 맞아요 · 다듬을 점이 있어요');
 for(const a of [null,{verdict:'assumption',utterance:'check'},{verdict:'imprecise',utterance:'check'},{verdict:'correct',utterance:'question'},{verdict:'unclear',utterance:'claim'}])assert.equal(T.opinionText(a),null,JSON.stringify(a));
 // Test A: a synthetic confirmation question with a scripted assessment, shows no label and no notice.
 const r=T.validateReply({reply:'네, 다만 유무보다 제시 방식이 중요해요.',assessment:{verdict:'imprecise',quote:'설명을 읽은 순서도 기록해야 하는 거죠',note:'n'}},'그럼 설명을 읽은 순서도 기록해야 하는 거죠?','ask');
 assert.equal(r.assessment.verdict,'assumption');assert.equal(r.assessment.adjustedFrom,'imprecise','kept in the record');assert.equal(T.opinionText(r.assessment),null);assert.equal(r.uncertainty,'');
});

// Phase 2B (learner test: question mode and understanding review were indistinguishable) — two explicit actions.
test('ask and check are two explicit, distinct actions; ask never grades; old records still read',()=>{
 assert.equal(T.INTENTS.ask.label,'질문하기');assert.equal(T.INTENTS.check.label,'내 이해 확인받기');assert.equal(T.INTENTS.reply.label,'답 보내기');
 const claim='기억은 저장된 그대로 꺼내는 녹화예요.';
 const asked=T.validateReply({reply:'r',assessment:{verdict:'misconception',quote:claim,note:'n'}},claim,'ask');assert.equal(asked.assessment,null,'ask: a statement is answered, not graded');assert.equal(asked.assessmentDropped,'misconception','kept in the record');
 const checked=T.validateReply({reply:'r',assessment:{verdict:'misconception',quote:claim,note:'n'}},claim,'check');assert.equal(checked.assessment.verdict,'misconception');assert.ok(T.opinionText(checked.assessment));
 const premise=T.validateReply({reply:'r',assessment:{verdict:'misconception',quote:'기억은 녹화라서 정확한 거죠',note:'n'}},'기억은 녹화라서 정확한 거죠?','check');assert.equal(premise.assessment.verdict,'assumption','check mode: a question with a doubtful premise is clarified, never labelled a misconception');assert.equal(T.opinionText(premise.assessment),null);
 const l={lesson:MEM.lesson,dialogue:[]};assert.ok(T.addLearner(l,{text:'내가 이해한 건 이런 뜻이야.',intent:'check'},1,'x').ok,'older intent accepted');
});

test('a hedged or questioning quote that spans two sentences is not a confirmed misconception (scripted case, mirrors server)',()=>{
 const draft=MEM.drafts[0].text,q='아마 이 종을 전에 들은 적 있나요? 라고 물으면';
 assert.equal(L.quoteKind(q,draft),'check');assert.equal(L.sentenceKind('아마추어 사진가가 찍었다'),'claim');
 const f=L.validateFeedback({schema:2,summary:'s',misconceptions:[{quote:q,issue:'i',why:'w',question:'q'}]},[],draft);
 assert.equal(f.misconceptions.length,0);assert.equal(f.precision[0].reclassified,'check');
});
