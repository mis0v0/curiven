// Class material helpers (material.js), tutor payload/sources and note provenance — pure, no browser.
// node --test tests/material.test.js   (server-side mirror: tests/test_material.py)
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const M=require('../material.js');const T=require('../tutor.js');const N=require('../notes.js');
const SAMPLE=JSON.parse(fs.readFileSync(path.join(__dirname,'..','sample_cookie_lesson.json'),'utf8'));
const MAT={name:'math_lecture.pdf',kind:'pdf',pageCount:4,unreadable:[3],omitted:[],pages:[
 {n:1,text:'미분 강의 노트 1주차\n1. 평균변화율\n함수 y = f(x)에서 x가 a에서 b까지 변할 때 평균변화율은 (f(b) − f(a)) / (b − a)이다.'},
 {n:2,text:"3. 미분계수의 정의\nf'(a) = lim h→0 (f(a + h) − f(a)) / h\n이 극한이 존재할 때 f는 x = a에서\n미분가능하다고 한다."},
 {n:4,text:'연습 문제\nf(x) = x²일 때 x = 3에서의 미분계수를 정의를 이용해 구하시오.'}]};
const clone=x=>JSON.parse(JSON.stringify(x));

test('verify: a source counts only if its quote is literally on that page (whitespace/NFC tolerant)',()=>{
 const ok=M.verify([{page:2,quote:'이 극한이 존재할 때 f는 x = a에서 미분가능하다고 한다.'},{page:2,quote:'도함수는 항상 연속이다'},{page:3,quote:'미분계수'},{page:1,quote:'평균'},{page:'2',quote:'미분계수의 정의'},{page:2,quote:'미분계수의 정의'.normalize('NFD')}],MAT);
 assert.deepEqual(ok,[{page:2,quote:'이 극한이 존재할 때 f는 x = a에서 미분가능하다고 한다.'},{page:2,quote:'미분계수의 정의'}]);
 assert.deepEqual(M.verify(null,MAT),[]);assert.deepEqual(M.verify([{page:1,quote:'평균변화율'}],null),[]);
});

test('groundLesson: every item of a material lesson gets a verified list; fabricated quotes are removed',()=>{
 const l=clone(SAMPLE);l.concepts[0].sources=[{page:2,quote:'미분가능하다고 한다'},{page:4,quote:'교과서 12쪽에 따르면'}];l.technical[0].sources=[{page:3,quote:'그래프'}];
 M.groundLesson(l,MAT);assert.deepEqual(l.concepts[0].sources,[{page:2,quote:'미분가능하다고 한다'}]);assert.deepEqual(l.technical[0].sources,[]);assert.deepEqual(l.concepts[1].sources,[]);
});

test('fromServer and summary: bounded record; what was not read is stated plainly',()=>{
 const m=M.fromServer({...MAT,pages:[...MAT.pages,{n:'x',text:'y'},{n:9,text:'   '}],extra:'dropped'},5);
 assert.deepEqual(Object.keys(m).sort(),['at','kind','name','omitted','pageCount','pages','unreadable']);assert.equal(m.pages.length,3);
 assert.deepEqual(M.summary(m),['PDF 4쪽 중 3쪽에서 글을 읽었어요.','읽지 못한 쪽: p.3 — 그림이나 스캔이라 글자 정보가 없을 수 있어요.']);
 const s=M.summary({...m,kind:'pptx',unreadable:[4],omitted:[13]});assert.match(s[0],/PowerPoint 4장 중 3장/);assert.match(s[1],/슬라이드 4/);assert.match(s[2],/슬라이드 13부터는/);
 assert.equal(M.fromServer({pages:[]}),null);
});

test('tutor: material lessons send the asked page and keyword matches within budget; others send none',()=>{
 const l={id:'x',topic:'미분',lesson:clone(SAMPLE),material:MAT,dialogue:[],scenarios:[],drafts:[]};
 const r=T.addLearner(l,{text:'이 쪽의 미분가능이 무슨 뜻이야?',intent:'ask',ref:{kind:'page',n:4}},1,'m1');assert.ok(r.ok);assert.deepEqual(r.msg.ref,{kind:'page',n:4});
 const p=T.payload(l,r.msg,null);assert.equal(p.material.pages[0].n,4,'the page asked about first');assert.ok(p.material.pages.some(x=>x.n===2),'keyword match');
 assert.deepEqual(p.focus,{kind:'page',n:4,label:'p.4'});assert.ok(JSON.stringify(p.material).length<M.TUTOR_CHARS+2000);
 const plain={...l,material:undefined};assert.equal('material' in T.payload(plain,r.msg,null),false);
 // replies: only sources verified against this lesson's material are stored
 const reply=T.validateReply({reply:'정의에 따르면…',sources:[{page:2,quote:'미분가능하다고 한다'},{page:2,quote:'지어낸 인용'}]},'질문?','ask');
 const t=T.attachReply(l,'m1',reply,{provider:'chatgpt',model:'m'},2,'t1');assert.deepEqual(t.sources,[{page:2,quote:'미분가능하다고 한다'}]);
 const l2={...clone(l),material:undefined};T.addLearner(l2,{text:'질문?',intent:'ask'},1,'m2');assert.equal('sources' in T.attachReply(l2,'m2',reply,{},2,'t2'),false);
});

test('notes: material provenance — which items came from the file, which the AI added, and what a citation means',()=>{
 const les=clone(SAMPLE);M.groundLesson(Object.assign(les,{concepts:les.concepts.map((c,i)=>i?c:{...c,sources:[{page:2,quote:'미분가능하다고 한다'}]})}),MAT);
 const l={id:'x',topic:'수업 자료: math_lecture.pdf',lesson:les,material:MAT,dialogue:[],scenarios:[],drafts:[],events:[],createdAt:1,updatedAt:1};
 for(const md of [N.lessonMarkdown(l),N.lessonMarkdown(l,{notion:true})]){
  assert.match(md,/\*\*수업 자료:\*\* math\\_lecture\.pdf \(PDF, 4쪽; 읽지 못한 곳 p\.3\)/);assert.ok(!md.includes('수업%20%EC'),'search links never use the file name');
  assert.match(md,/_\(수업 자료 p\.2\)_/);assert.match(md,/_\(AI 보충\)_/);assert.match(md,/파일 내용이 맞다는 확인은 아니에요/)}
 {const md=N.lessonMarkdown({...l,material:undefined});assert.ok(!md.includes('**수업 자료:**')&&!md.includes('AI 보충')&&!md.includes('수업 자료 p.'),'ordinary lessons unchanged')}
});

test('locate: finds a verified quote in the original text across line breaks and typographic dashes',()=>{
 const t=MAT.pages[1].text;const at=M.locate(t,"f'(a) = lim h→0 (f(a + h) - f(a)) / h");assert.ok(at);assert.equal(t.slice(...at),"f'(a) = lim h→0 (f(a + h) − f(a)) / h");
 assert.equal(M.excerpt(MAT,{page:2,quote:"f'(a) = lim h→0 (f(a + h) - f(a)) / h"}),"f'(a) = lim h→0 (f(a + h) − f(a)) / h",'shown as written in the file');
 const b=M.locate(t,'x = a에서 미분가능하다고');assert.equal(t.slice(...b),'x = a에서\n미분가능하다고');assert.equal(M.locate(t,'없는 구절'),null);
});
