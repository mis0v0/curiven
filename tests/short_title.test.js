// Phase 2C-R — short exploration titles: AI value when valid, learner rename first, conservative fallback for old records.
// node --test tests/short_title.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../copy.js'),T=require('../tutor.js'),N=require('../notes.js');
const CASES=require('./fixtures/short_title_cases.json');
const FILE=CASES.file,WEB='웹 입문: 서버가 보내고 브라우저가 보여 주는 과정과 HTML·CSS·JavaScript';
const rec=(lesson,extra={})=>({id:'r1',topic:'t',stage:5,maxStage:5,complete:true,drafts:[],scenarios:[],events:[],lesson:{hook:'h',concepts:[],...lesson},...extra});

test('rules: valid short titles pass; generic, decorative, question, chapter, filename and over-long ones are refused',()=>{
 for(const v of CASES.valid)assert.equal(C.cleanShort(v,FILE),v,v);
 for(const v of CASES.invalid)assert.equal(C.cleanShort(v,FILE),null,JSON.stringify(v));
 for(const [v,out] of CASES.trimmed)assert.equal(C.cleanShort(v,FILE),out);
 assert.equal(C.cleanShort(null),null);assert.equal(C.cleanShort(42),null);
});
test('new lesson: a valid AI shortTitle is used; the full title, question and file stay separate',()=>{
 const l=rec({title:'미분: 한 순간의 변화율',shortTitle:'미분의 원리'},{question:'미분이 뭐야?'}),id=C.identity(l);
 assert.equal(id.short,'미분의 원리');assert.equal(id.shortSource,'ai');assert.equal(id.title,'미분: 한 순간의 변화율');assert.equal(id.question,'미분이 뭐야?');
 const sq=C.identity(rec({title:'SQL Injection: 값이어야 할 글자가 명령이 될 때',shortTitle:'SQL 인젝션'}));assert.equal(sq.short,'SQL 인젝션');
});
test('invalid or missing AI shortTitle → conservative fallback from the stored title (no AI call, never the file name)',()=>{
 const mat={material:{name:FILE,kind:'pdf'},topic:'수업 자료: '+FILE};
 for(const bad of [undefined,'','학습 내용','01장_웹프로그래밍과_HTML5개요','✦ 웹','웹 입문이란?',WEB]){
  const id=C.identity(rec({title:WEB,shortTitle:bad},mat));assert.equal(id.short,'웹 입문',String(bad));assert.equal(id.shortSource,'derived')}
 assert.equal(C.identity(rec({title:'기억은 왜 왜곡될까? 소리와 설명 카드를 비교하는 활동'})).short,'기억의 왜곡');
 assert.equal(C.identity(rec({title:'뉴런은 어떻게 신호를 전달할까요? 시냅스 이야기'})).short,'뉴런의 신호 전달');
 assert.equal(C.identity(rec({title:'엔트로피란 무엇일까'})).short,'엔트로피');
});
test('fallback never invents a topic: an unparseable question title stays identifiable and is marked for renaming',()=>{
 const id=C.identity(rec({title:'블랙홀은 왜 빛을 가둘까'},{question:null}));
 assert.equal(id.short,'블랙홀은 왜 빛을 가둘까');assert.equal(id.shortSource,'fallback');
 const q=C.identity(rec({title:'블랙홀은 왜 빛을 가둘까'},{question:'블랙홀'}));assert.equal(q.short,'블랙홀','the learner’s own words');
 const long=C.identity(rec({title:'가'.repeat(60)}));assert.ok(long.short.length<=C.SHORT_MAX&&long.short.endsWith('…'));
 // A bad generated title that copies the file: chapter prefix and underscores dropped, never the raw file name.
 const f=C.identity(rec({title:'01장_웹프로그래밍과_HTML5개요'},{material:{name:FILE,kind:'pdf'}}));assert.ok(!f.short.includes('_')&&!f.short.includes('.pdf')&&!/^01장/.test(f.short),f.short);
});
test('historic records: read without rewriting; ids, questions, titles, files untouched',()=>{
 const l=rec({title:WEB},{id:'lesson-legacy-1',topic:'수업 자료: '+FILE,material:{name:FILE,kind:'pdf',pageCount:1,pages:[{n:1,text:'x'}],unreadable:[]}}),before=JSON.stringify(l);
 const id=C.identity(l);assert.equal(id.short,'웹 입문');assert.equal(id.title,WEB);assert.deepEqual(id.file,{name:FILE,kind:'pdf'});assert.equal(id.question,null);
 assert.equal(JSON.stringify(l),before);
});
test('manual rename wins over AI and fallback; an unusable rename is ignored; nothing else changes',()=>{
 const l=rec({title:WEB,shortTitle:'웹 입문'},{displayTitle:'오늘의 웹 이야기'});
 assert.equal(C.identity(l).short,'오늘의 웹 이야기','the learner’s choice: AI wording rules do not apply to it');
 for(const bad of ['','   ','가'.repeat(21),'a\u0007b',5]){l.displayTitle=bad;assert.equal(C.identity(l).shortSource,'ai',JSON.stringify(bad))}
 l.displayTitle='HTML 첫걸음';const id=C.identity(l);assert.equal(id.short,'HTML 첫걸음');assert.equal(id.shortSource,'manual');assert.equal(id.title,WEB);
 
});
test('Notion/Markdown and tutor payload keep the full lesson title, even after a rename',()=>{
 const l=rec({title:WEB,shortTitle:'웹 입문',story:'s',prediction:'p',explainPrompt:'e',technical:[],scenarios:[]},{displayTitle:'HTML 첫걸음',material:{name:FILE,kind:'pdf',pageCount:1,pages:[{n:1,text:'x'}],unreadable:[]},topic:'수업 자료: '+FILE});
 const md=N.lessonMarkdown(l,{now:Date.UTC(2026,10,23)});assert.ok(md.startsWith('# '+WEB),'note heading');assert.ok(!md.includes('HTML 첫걸음'));
 assert.match(N.fileName(l,Date.UTC(2026,10,23)),/^curiven-note-웹-입문-서버가/,'export file name unchanged');
 assert.equal(T.payload(l,{text:'q',intent:'ask',ref:null,stage:3},null).lesson.title,WEB);
});
test('imported lesson JSON: shortTitle cleaned like the server does (kept when valid, dropped otherwise)',()=>{
 const v={title:'미분: 한 순간의 변화율',shortTitle:' 미분의 원리 '};T.normalizeExtras(v);assert.equal(v.shortTitle,'미분의 원리');
 for(const bad of ['학습 내용','미분: 한 순간의 변화율','미분이란?',7]){const w={title:'미분: 한 순간의 변화율',shortTitle:bad};T.normalizeExtras(w);assert.ok(!('shortTitle' in w),String(bad))}
});
