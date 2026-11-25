// Phase 2B — exploration identity: the learner's question, the display title and the uploaded file are different things.
// node --test tests/identity.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const C=require('../copy.js'),N=require('../notes.js'),T=require('../tutor.js');
const FILE='01장_웹프로그래밍과_HTML5개요.pdf',TITLE='웹 입문: 서버가 보내고 브라우저가 보여 주는 과정과 HTML·CSS·JavaScript';
const material={name:FILE,kind:'pdf',pageCount:2,pages:[{n:1,text:'웹 프로그래밍 개요'},{n:2,text:'HTML5는 구조를 만든다'}],unreadable:[]};
const lesson={title:TITLE,hook:'주소창에 주소를 치면 무슨 일이 일어날까요?',story:'s',prediction:'p',explainPrompt:'e',concepts:[{id:'k1',name:'HTML',description:'구조'},{id:'k2',name:'CSS',description:'모양'}],technical:[],scenarios:[]};
// A record saved before `question` existed, exactly as the old app wrote it (D: the real PDF case).
const legacy=()=>({id:'lesson-legacy-1',topic:'수업 자료: '+FILE,material,lesson,stage:5,maxStage:5,complete:true,drafts:[],scenarios:[],events:[{at:'2026-11-20T00:00:00Z',what:'수업 자료로 시작: '+FILE}],createdAt:1,updatedAt:2});

test('legacy material record: generated title shown, file kept as the source, no invented learner question',()=>{
 const l=legacy(),before=JSON.stringify(l),id=C.identity(l);
 assert.deepEqual(id,{id:'lesson-legacy-1',question:null,title:TITLE,titleSource:'generated',short:'웹 입문',shortSource:'derived',lead:lesson.hook,file:{name:FILE,kind:'pdf'}});
 assert.equal(JSON.stringify(l),before,'reading the identity never rewrites the record');
});
test('legacy material record with a typed question keeps that question as the learner’s',()=>{
 const l={...legacy(),topic:'HTML과 CSS는 어떻게 나뉘나요?'};assert.equal(C.identity(l).question,'HTML과 CSS는 어떻게 나뉘나요?');assert.equal(C.identity(l).title,TITLE);
});
test('new records: `question` is explicit (empty for a material start), title falls back safely before generation',()=>{
 assert.equal(C.identity({id:'n',topic:'수업 자료: '+FILE,question:'',material,lesson:null}).question,null);
 assert.equal(C.identity({id:'n',topic:'수업 자료: '+FILE,question:'',material,lesson:null}).title,'01장_웹프로그래밍과_HTML5개요','before generation: the file name, without pretending it is a topic');
 assert.equal(C.identity({id:'n',topic:'블랙홀',question:'블랙홀',lesson:null}).title,'블랙홀');
 assert.equal(C.identity({id:'n',topic:'블랙홀',lesson:{title:'  '}}).title,'블랙홀','an empty generated title falls back to the question');
 assert.equal(C.identity({}).title,'이름 없는 탐험');
});
test('note: the title heads the note; the original file stays in the source details; no fake first question',()=>{
 const md=N.lessonMarkdown(legacy(),{now:Date.UTC(2026,10,23)});
 assert.match(md,new RegExp('^# '+TITLE.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/:/g,':')));
 assert.match(md,/\*\*처음 궁금했던 것:\*\* _질문 없이 수업 자료에서 시작했어요\._/);
 assert.ok(md.includes('**수업 자료:** 01장\\_웹프로그래밍과\\_HTML5개요.pdf'),'original filename (escaped) in the source line');
 assert.ok(!md.includes('처음 궁금했던 것:** 수업 자료'),'the placeholder topic is not shown as a question');
 assert.match(N.fileName(legacy(),Date.UTC(2026,10,23)),/^curiven-note-웹-입문-서버가/);
 assert.match(N.fileName({topic:'SQL Injection',question:'SQL Injection',lesson},Date.UTC(2026,10,23)),/^curiven-note-SQL-Injection-\d{8}\.md$/,'free-topic note names are unchanged');
});
test('tutor and reading list see the subject, never the file name',()=>{
 const l=legacy();assert.equal(T.payload(l,{text:'q',intent:'ask',ref:null,stage:3},null).lesson.title,TITLE);
 assert.ok(T.readingList(l).every(r=>!r.query.includes('.pdf')));
});
