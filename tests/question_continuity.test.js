// Learner questions raised inside a self-explanation (Q3-C2) and tutor quotation fidelity — pure logic.
//   node --test tests/question_continuity.test.js
// Fixtures are synthetic, written for these tests. They check what the app suggests, sends and stores; they say nothing
// about whether a tutor answer is correct or whether a learner learned anything.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const L=require('../learning.js');const T=require('../tutor.js');const N=require('../notes.js');
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const shown=md=>md.replace(/ {2}\n/g,'\n').replace(/\\([\\`*_\[\]<>#|~&\-+=.)])/g,'$1');

test('suggested questions: only the learner\'s own questions by form, in their exact words and order',()=>{
 const cases=[
  ['explanation without a question','열은 온도가 높은 곳에서 낮은 곳으로 이동해요. 그래서 커피가 식어요.',[]],
  ['explanation followed by a genuine question','열은 높은 곳에서 낮은 곳으로 이동해요. 그런데 진공에서도 열이 이동하나요?',['그런데 진공에서도 열이 이동하나요?']],
  ['several questions in one explanation','바인딩은 값을 따로 보내요. 그럼 숫자 칸도 위험한가요? 저장 프로시저는 안전할까요?',['그럼 숫자 칸도 위험한가요?','저장 프로시저는 안전할까요?']],
  ['question mark with no space after it','이게 왜 그런 거죠?그래서 헷갈려요.',['이게 왜 그런 거죠?']],
  ['embedded interrogative that is an assertion','왜 식는지는 아직 잘 모르겠지만 열이 빠져나가는 것 같아요.',[]],
  ['stated wonder is an information request','쿠키가 언제 지워지는지 궁금해요.',['쿠키가 언제 지워지는지 궁금해요.']],
  ['hedged but meaningful assertions','아마 세션은 서버에 저장되는 것 같아요. 쿠키는 브라우저에 있을 거예요.',[]],
  ['해요체 assertions that sentenceKind would misread','물이 끓으면 수증기가 올라가요. 그래서 뚜껑이 들썩이니까요.',[]],
  ['a quoted question that is not the learner\'s own','선생님이 “왜 하늘은 파랄까?”라고 물으셨는데, 빛이 산란되기 때문이에요.',[]],
  ['a question with an incorrect assumption','블랙홀은 빛보다 빠르게 움직여서 빛을 잡는 건가요?',['블랙홀은 빛보다 빠르게 움직여서 빛을 잡는 건가요?']],
  ['correct explanation with an optional follow-up','사건의 지평선 안에서는 탈출 속도가 광속보다 커요. 혹시 지평선 밖에서는 빛이 빠져나올 수 있나요?',['혹시 지평선 밖에서는 빛이 빠져나올 수 있나요?']],
  ['the same question twice is offered once','왜 그럴까요? 정말 왜 그럴까요? 왜 그럴까요?',['왜 그럴까요?','정말 왜 그럴까요?']]];
 for(const [name,text,want] of cases){const got=L.learnerQuestions(text);
  assert.deepEqual(got,want,name);
  for(const q of got)assert.ok(text.includes(q),`${name}: suggestion is an exact substring of the learner's text`)}
 assert.equal(L.learnerQuestions('가요? '.repeat(9)+'마지막인가요?').length<=5,true,'bounded');
 assert.deepEqual(L.learnerQuestions(''),[]);assert.deepEqual(L.learnerQuestions(null),[]);
});

function lesson(){
 const l={id:'Q',topic:'SQL Injection',lesson:JSON.parse(JSON.stringify(SQLI)),stage:4,maxStage:4,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:1,updatedAt:1,complete:false};
 const k=l.lesson.concepts[0];
 const text=`SQL 인젝션은 ${k.name} 때문에 입력이 명령처럼 실행되는 문제예요. 바인딩을 쓰면 입력값이 명령으로 해석되지 않아요. 그런데 숫자만 받는 칸이면 바인딩 없이도 안전한 건가요?`;
 const fb=L.stampFeedback(L.validateFeedback({schema:2,summary:'원리를 짚었어요.',correct:[],precision:[],misconceptions:[],missing:[],explained:[{id:k.id,quote:`${k.name} 때문에 입력이 명령처럼 실행되는`}],uncertainty:''},l.lesson.concepts.map(c=>c.id),text),()=>'stable-id-'+Math.random().toString(36).slice(2,10));
 l.drafts.push({text,at:1000,feedback:fb});l.feedback=fb;l.feedbackFor=1000;
 return l;
}

test('a draft reference names exactly one saved explanation and carries it to the tutor as context only',()=>{
 const l=lesson(),q=L.learnerQuestions(l.drafts[0].text)[0];
 assert.deepEqual(T.cleanRef({kind:'draft',at:1000,extra:'x'}),{kind:'draft',at:1000});
 for(const bad of [{kind:'draft'},{kind:'draft',at:'1000'},{kind:'draft',at:NaN}])assert.equal(T.cleanRef(bad),null);
 assert.equal(T.refKey({kind:'draft',at:1000}),'dr:1000');
 const m=T.addLearner(l,{text:q,intent:'ask',ref:{kind:'draft',at:1000}},2000,'m1').msg;
 assert.equal(m.text,q,'stored exactly as confirmed');assert.equal(m.status,'pending');
 const p=T.payload(l,m,null);
 assert.equal(p.message,q);assert.equal(p.intent,'ask');assert.deepEqual(p.focus,{kind:'draft',draft:l.drafts[0].text});
 // It belongs to the lesson conversation (the one help region), never to a feedback item's thread.
 assert.ok(T.stream(l,null).includes(m));assert.equal(T.stream(l,T.itemRef(l,l.drafts[0],'summary',0)).length,0);
 assert.deepEqual(T.draftFor(l,m.ref),{draft:l.drafts[0],n:1});
 // Unknown or ambiguous explanation → no focus at all (never a guess).
 assert.equal(T.focusFor(l,{kind:'draft',at:999}),null);
 l.drafts.push({text:'같은 시각의 다른 설명',at:1000,feedback:null});
 assert.equal(T.focusFor(l,{kind:'draft',at:1000}),null);assert.equal(T.draftFor(l,{kind:'draft',at:1000}),null);
});

test('asking about one\'s own question changes no feedback, completion or concept evidence',()=>{
 const l=lesson(),before=JSON.stringify({drafts:l.drafts,feedback:l.feedback,complete:l.complete}),status=[...L.conceptStatus(l)];
 const q=L.learnerQuestions(l.drafts[0].text)[0];
 const m=T.addLearner(l,{text:q,intent:'ask',ref:{kind:'draft',at:1000}},2000,'m1').msg;
 // Even if a model tried to grade the question, ask mode answers it: only a doubtful premise is noted, never shown as an opinion.
 const r=T.validateReply({reply:'숫자 칸도 서버에서는 문자열로 받을 수 있어서 검증이 필요해요.',assessment:{verdict:'misconception',quote:q,note:'n'}},m.text,m.intent);
 assert.equal(r.assessment.verdict,'assumption');assert.equal(T.opinionText(r.assessment),null);
 T.attachReply(l,m.id,r,{provider:'chatgpt',model:'gpt-test'},2100,'t1');
 const n=T.addLearner(l,{text:'다른 질문은 나중에',intent:'ask',ref:{kind:'draft',at:1000},noted:true},2200,'m2').msg;
 assert.equal(n.status,'noted');
 assert.equal(JSON.stringify({drafts:l.drafts,feedback:l.feedback,complete:l.complete}),before,'explanation, its feedback and completion untouched');
 assert.deepEqual([...L.conceptStatus(l)],status,'concept tiers come only from explanation feedback, not from the conversation');
 const tutor=l.dialogue.find(x=>x.role==='tutor');assert.equal(tutor.replyTo,'m1');assert.equal(tutor.text,r.reply,'reply kept apart from the learner\'s words');
});

test('tutor opinion quotations are exported only as the learner actually wrote them',()=>{
 const l=lesson();l.stage=5;l.complete=true;
 const said='SQL 인젝션은 입력값을 쿼리에 그대로 이어 붙여서 생겨요. 바인딩을 쓰면 입력값이 명령으로 해석되지 않아요.';
 const m=T.addLearner(l,{text:said,intent:'check'},3000,'c1').msg;
 // A tolerated paraphrase that flips the meaning (해석되지 않아요 → 해석돼요) is accepted by the 80% quote check …
 const r=T.validateReply({reply:'r',assessment:{verdict:'misconception',quote:'입력값이 명령으로 해석돼요',note:'n'}},said,'check');
 assert.equal(r.assessment.quote,'입력값이 명령으로 해석돼요','the stored record is unchanged');
 T.attachReply(l,m.id,r,{model:'gpt-test'},3100,'ct1');
 const md=shown(N.lessonMarkdown(l,{now:4000}));
 // … but the note never puts those words in the learner's mouth: it shows the sentence they wrote.
 assert.ok(!md.includes('“입력값이 명령으로 해석돼요”'),'paraphrase is not shown as a quotation');
 assert.match(md,/AI 의견: 사실과 다른 부분이 있어요 — “바인딩을 쓰면 입력값이 명령으로 해석되지 않아요\.”/);
 // A quotation that is not in the message at all is dropped, not shown.
 const m2=T.addLearner(l,{text:'바인딩은 값을 따로 보내요.',intent:'check'},3200,'c2').msg;
 T.attachReply(l,m2.id,{reply:'r',followUp:'',assessment:{verdict:'imprecise',quote:'완전히 다른 문장',note:''},uncertainty:'',withheld:0},{},3300,'ct2');
 const md2=shown(N.lessonMarkdown(l,{now:4000}));assert.ok(!md2.includes('완전히 다른 문장'));
 assert.match(md2,/AI 의견: 대체로 맞아요 · 다듬을 점이 있어요\n/);
});

test('notes: a question from an explanation is labelled as such; a reclassified question is a premise check, not a correction',()=>{
 const l=lesson();l.stage=5;l.complete=true;const q=L.learnerQuestions(l.drafts[0].text)[0];
 T.addLearner(l,{text:q,intent:'ask',ref:{kind:'draft',at:1000},noted:true},2000,'m1');
 const md=shown(N.lessonMarkdown(l,{now:4000}));
 assert.match(md,/내 설명 1을 쓰다가 생긴 질문/);assert.ok(md.includes(q),'the question appears exactly as written');
 const text=l.drafts[0].text,fb=L.validateFeedback({schema:2,summary:'s',correct:[],precision:[{quote:'바인딩을 쓰면 입력값이 명령으로 해석되지 않아요',issue:'조건 보완',why:'근거',question:'질문'}],
  misconceptions:[{quote:'숫자만 받는 칸이면 바인딩 없이도 안전한 건가요',issue:'숫자 칸도 위험해요.',why:'문자열로 받을 수 있어요.',question:'글자가 들어오면?'}],missing:[],explained:[],uncertainty:''},l.lesson.concepts.map(c=>c.id),text);
 assert.equal(fb.misconceptions.length,0,'a question is never kept as a misconception');assert.equal(fb.precision[1].reclassified,'check');
 l.drafts[0].feedback=fb;const md2=shown(N.lessonMarkdown(l,{now:4000}));
 assert.match(md2,/- 다듬을 점: “바인딩을 쓰면 입력값이 명령으로 해석되지 않아요” — 조건 보완/);
 assert.match(md2,/- 질문·가설의 전제 확인: “숫자만 받는 칸이면 바인딩 없이도 안전한 건가요” — 숫자 칸도 위험해요\./);
});
