// Markdown learning note (pure).  node --test tests/notes.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const T=require('../tutor.js');const N=require('../notes.js');
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const SAMPLE=JSON.parse(fs.readFileSync(path.join(__dirname,'..','sample_cookie_lesson.json'),'utf8'));
/** Inverse of the note's escaping (what a Markdown renderer shows). */
const shown=md=>md.replace(/ {2}\n/g,'\n').replace(/\\([\\`*_\[\]<>#|~&\-+=.)])/g,'$1').replace(/^ +/gm,m=>' '.repeat(m.length));

const TRICKY='# 제목 아님\n- 목록 아님\n1. 번호 아님\n*별*과 _밑줄_, `코드`, <b>태그</b>, [링크](x) & 그리고 \\ 백슬래시\n    들여쓴 줄';
function record(){
 const l={id:'A',topic:'SQL Injection 처음 배우기',interest:'',level:'beginner',stage:5,maxStage:5,lesson:JSON.parse(JSON.stringify(SQLI)),
  prediction:'',predictionUnsure:true,scenarios:[{i:0,choice:null,unsure:true,at:3},{i:1,choice:1,at:4}],reflection:'처음엔 몰랐는데 따옴표가 핵심이었어요.',
  drafts:[],feedback:null,events:[{at:'2026-11-22T05:19:00Z',what:'x'}],createdAt:Date.parse('2026-11-22T05:19:00Z'),updatedAt:Date.parse('2026-11-22T05:32:00Z'),complete:true,
  generatedBy:{provider:'chatgpt',model:'gpt-test'},profileUsed:{nickname:'비밀닉네임',interests:['비밀관심사'],meaning:'비밀이유'}};
 const fb={schema:2,summary:'핵심을 짚었어요.',correct:[{quote:'입력이 SQL 구조로 해석되어서',point:'핵심 원인'}],precision:[{quote:'문자열로 처리해서',issue:'바인딩과 문자열 처리 구분',why:'값은 문자열에 한정되지 않음',question:'바인딩은 무엇을 따로 전달할까요?'}],misconceptions:[],missing:[{issue:'식별자',question:'ORDER BY의 열 이름은 바인딩할 수 있을까요?'}],explained:[],uncertainty:'',reviewer:{provider:'chatgpt',model:'gpt-test',at:9}};
 l.drafts.push({text:'sqli은 입력이 SQL 구조로 해석되어서 생긴다. 바인딩은 문자열로 처리해서 넣는다.\n'+TRICKY,at:Date.parse('2026-11-22T05:25:00Z'),feedback:fb});
 l.drafts.push({text:'고친 설명: 바인딩은 쿼리 구조와 값을 따로 전달한다.',at:Date.parse('2026-11-22T05:30:00Z'),feedback:null});
 const r=T.addLearner(l,{text:'값을 쿼리랑 따로 보내는 거죠?',intent:'reply',ref:{kind:'feedback',draftAt:l.drafts[0].at,type:'precision',index:0}},10,'m1').msg;
 T.attachReply(l,r.id,{reply:'맞아요. 예를 들면:\n```sql\nSELECT title FROM books WHERE title = ?\n```\n입력은 ? 자리의 값이에요.',followUp:'그럼 열 이름도 ?로 넘길 수 있을까요?',assessment:{verdict:'correct',quote:'값을 쿼리랑 따로',note:'정확'},uncertainty:'',withheld:0},{provider:'chatgpt',model:'gpt-test'},11,'t1');
 T.addLearner(l,{text:'ORDER BY는 왜 안 되는지 나중에 찾아보기',noted:true},12,'m2');
 const g=T.addLearner(l,{text:'',intent:'simpler'},13,'m3').msg;T.attachReply(l,g.id,{reply:'더 쉽게 말하면, 입력은 글자일 뿐 명령이 아니어야 해요.',followUp:'',assessment:null,uncertainty:'불확실한 부분 없음',withheld:0},{model:'gpt-test'},14,'t2');
 const s=T.addLearner(l,{text:'왜 모든 행이 나와요? ``` 이상한 백틱',ref:{kind:'scenario',i:0}},15,'m4').msg;T.attachReply(l,s.id,{reply:'```js\nconst q = `WHERE title = \'${input}\'`;\n```\n조건이 항상 참이에요.',followUp:'',assessment:null,uncertainty:'',withheld:0},{},16,'t3');
 return l;
}

test('every learner-written string appears exactly as written when the Markdown is rendered',()=>{
 const l=record(),md=N.lessonMarkdown(l,{now:Date.parse('2026-11-22T06:00:00Z')}),view=shown(md);
 const mine=[l.reflection,...l.drafts.map(d=>d.text),...l.dialogue.filter(m=>m.role==='learner'&&!m.quick).map(m=>m.text),l.topic];
 for(const s of mine)assert.ok(view.includes(s),'missing verbatim: '+s.slice(0,40));
 assert.ok(!md.includes('\n# 제목 아님'),'a learner line starting with # is not turned into a heading');
 assert.ok(!/\n- 목록 아님/.test(md)&&!/\n1\. 번호 아님/.test(md),'no accidental lists');
 assert.ok(!md.includes('<b>'),'no raw HTML passes through');
});

test('code blocks from AI replies and lesson examples are real fenced blocks, kept verbatim',()=>{
 const md=N.lessonMarkdown(record());
 assert.ok(md.includes("```sql\nSELECT title FROM books WHERE title = ?\n```"));
 assert.ok(md.includes("```sql\nSELECT title FROM books WHERE title = '' OR '1'='1'\n```"),'lesson example code');
 assert.ok(md.includes("```js\nconst q = `WHERE title = '${input}'`;\n```"),'inline backticks inside a code block kept');
 assert.equal(N.fence('a\n````\nb'),'`````\na\n````\nb\n`````','fence longer than any backtick run inside');
 assert.ok(shown(md).includes('왜 모든 행이 나와요? ``` 이상한 백틱'),'learner backticks escaped, not a fence');
 assert.equal((md.match(/^`{3,}/gm)||[]).length%2,0,'all fences closed');
});

test('structure: a learning journey first, the full record in an appendix; AI questions apart from mine',()=>{
 const md=N.lessonMarkdown(record());
 const heads=['# SQL Injection: 값이어야 할 글자가 명령이 될 때 — CURIVEN 학습 노트','## 처음 생각','## 핵심 개념','## 사고 실험에서 발견한 것','## 내 설명과 생각의 변화','## 내가 던진 질문','## 다시 볼 점과 남은 질문','## 출처와 신뢰도','## 부록: 전체 기록','### 개념 설명 전문 (AI 생성)','### 대화 기록'];
 let at=-1;for(const h of heads){const i=md.indexOf(h+'\n');assert.ok(i>at,'in order: '+h);at=i}
 assert.match(md,/\*\*내 예상:\*\* _“아직 잘 모르겠어요”라고 하고 넘어갔어요._/);assert.match(md,/- 내 선택: _잘 모르겠다고 함_/);
 assert.match(md,/AI가 만든 가상 상황이에요. 실제로 한 실험이 아니에요./);
 assert.match(md,/### 설명 1 · 처음 쓴 설명/);assert.match(md,/### 설명 2 · 고쳐 쓴 설명/);
 assert.match(md,/\*\*AI 피드백 \(gpt-test\):\*\*/);assert.match(md,/AI 의견: 맞게 이해했어요/);
 const mine=md.split('## 내가 던진 질문')[1].split('\n## ')[0],open=md.split('## 다시 볼 점과 남은 질문')[1].split('\n## ')[0];
 assert.match(mine,/ORDER BY는 왜 안 되는지 나중에 찾아보기 _\(메모만 함\)_/);assert.match(mine,/값을 쿼리랑 따로 보내는 거죠\? _\(답을 받음\)_/);
 assert.ok(!mine.includes('바인딩은 무엇을 따로 전달할까요'),'AI questions are not listed as mine');assert.ok(!mine.includes('더 쉽게 설명해 줘'),'button requests are not authored questions');
 assert.match(open,/ORDER BY의 열 이름은 바인딩할 수 있을까요\?/);assert.match(open,/열 이름도 \?로 넘길 수 있을까요/,'unanswered tutor follow-up stays open');
 // The learner only asked back in that item's thread: not marked answered, and says so.
 assert.match(open,/바인딩은 무엇을 따로 전달할까요\? _\(이 질문에 대한 대화를 이어 갔지만, 답했다는 기록은 없어요\)_/);
 assert.match(md,/\[학술 검색\]\(https:\/\/scholar\.google\.com\/scholar\?q=/,'actionable search links');assert.match(md,/개념 이름으로 찾아보기|AI 제안 · 아직 확인 안 됨/);
});

test('only this lesson: no profile, credentials or other records',()=>{
 const md=N.lessonMarkdown(record());
 for(const secret of ['비밀닉네임','비밀관심사','비밀이유','token','csrf','@'])assert.ok(!md.toLowerCase().includes(secret.toLowerCase()),secret);
});

test('old records (no dialogue, no layers, v1 feedback, missing fields) still produce a note',()=>{
 const old={id:'o',topic:'HTTP 쿠키',stage:5,lesson:SAMPLE,prediction:'x',scenarios:[{i:0,choice:0,at:1}],drafts:[{text:'예전 설명',at:1,feedback:{summary:'s',correct:['c'],misconceptions:[],missing:[],demonstrated:['k1']}}],events:[],createdAt:1,updatedAt:1,complete:true};
 const md=N.lessonMarkdown(old);assert.match(md,/예전 설명/);assert.match(md,/별도로 모은 대화 질문이 없어요/);assert.ok(!md.includes('AI 튜터와 나눈 대화'));
 assert.doesNotThrow(()=>N.lessonMarkdown({id:'x',topic:'빈 기록',lesson:null,drafts:[],scenarios:[],events:[]}));
 assert.equal(N.fileName({topic:'a/b:c*?'},Date.parse('2026-11-22T12:00:00')),'curiven-note-a-b-c-20261122.md');
});

/* Synthetic dialogue with repeated questions and a feedback reply. */
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
test('memory session note: no duplicated headings, questions once, answered items not pending, no internal notices',()=>{
 const md=N.lessonMarkdown(MEM,{now:MEM.updatedAt}),view=shown(md);
 assert.ok(!/사고 실험 1: 사고 실험 1|사고 실험 \d+ · 사고 실험/.test(md),'no duplicated “사고 실험 N” prefix');assert.match(md,/### 1\\\. 소리와 설명 카드/);
 const mine=md.split('## 내가 던진 질문')[1].split('\n## ')[0];
 assert.equal((mine.match(/설명을 읽은 순서도/g)||[]).length,1,'the question sent twice is listed once');assert.match(mine,/_\(2번 물어봄\)_/);
 assert.match(mine,/어떤 자료부터 비교하면 좋을까요\?/,'a question asked inside a feedback thread is a question I asked');
 const open=md.split('## 다시 볼 점과 남은 질문')[1].split('\n## ')[0];
 assert.ok(!open.includes('어떤 기록에서 단서를 얻었나요'),'the feedback question the learner answered is not pending');
 assert.match(open,/원래 소리를 확인할 방법/);assert.match(open,/카드를 언제 공개/);
 assert.match(md.split('## 내 설명과 생각의 변화')[1].split('\n## ')[0],/원본 녹음과 나중에 읽은 설명을 따로 비교/,'my answer appears as my idea');
 for(const internal of ['앱의 조정','이렇게 표시했어요','대신 위처럼','질문에 담긴 전제를 함께 확인했어요','판정을 붙이지','표시하지 않았어요','응답 형식이 어긋나'])assert.ok(!md.includes(internal),internal);
 // Every learner word is still recoverable, exactly (including both sends of the repeated question, in the appendix).
 for(const m of MEM.dialogue.filter(x=>x.role==='learner'&&!x.quick))assert.ok(view.includes(m.text.trimEnd()),m.text);
 assert.ok(view.includes(MEM.drafts[0].text));assert.equal((md.split('## 부록')[1].match(/설명을 읽은 순서도/g)||[]).length,2,'the transcript keeps both sends');
 assert.equal(JSON.stringify(MEM),fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8').includes('"record"')?JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record):'','the record itself is not modified by exporting');
});

test('Notion form: same journey and verbatim learner text, no H1 (the page title), no transcript appendix',()=>{
 const r=record(),md=N.lessonMarkdown(r,{notion:true}),full=N.lessonMarkdown(r);
 assert.ok(!/^# /m.test(md),'no H1');assert.ok(!md.includes('부록'),'no appendix or reference to one');
 assert.ok(!md.includes('### 대화 기록'));
 for(const h of ['## 처음 생각','## 내 설명과 생각의 변화','## 내가 던진 질문','## 다시 볼 점과 남은 질문','## 출처와 신뢰도'])assert.ok(md.includes(h+'\n'),h);
 for(const d of r.drafts)assert.ok(md.includes(N.esc(d.text.split('\n')[0])),'learner explanation verbatim (escaped)');
 assert.equal(full.split('## 부록')[0].replace(/^# .*\n\n/,''),full.split('## 부록')[0].replace(/^# .*\n\n/,''),'file form unchanged');
 assert.ok(!/adjustedFrom|assessmentDropped|withheld|reclassified/.test(md),'no internal diagnostics');
});

test('A learner question remains verbatim in a recorded explanation and is not claimed absent',()=>{
 const lesson={topic:'채소 보관',lesson:{title:'채소 보관'},drafts:[{at:1,text:'잎채소는 왜 냉장 보관하나요?'}],dialogue:[]};
 for(const md of [N.lessonMarkdown(lesson),require('../concept-note').exportMarkdown(lesson),require('../journey').markdown(lesson)]){
  assert.ok(md.includes('잎채소는 왜 냉장 보관하나요?'));
  assert.doesNotMatch(md,/직접 남긴 질문이 아직 없어요|기록상 답을 받지 못한 질문은 없어요/);
 }
});
