// Concept note (Phase 2E): structure, synthesis bookkeeping, provenance and the two renderers.  node --test tests/concept_note.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const C=require('../concept-note.js');const N=require('../notes.js');const T=require('../tutor.js');
const fx=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',n),'utf8'));
const SQLI=()=>fx('sqli_time_blind_record.json');          // synthetic catalog-search scenario
const AI=fx('sqli_concept_note_ai.json');                    // scripted synthesis
const CALC=()=>fx('calc_material_record.json');             // real PDF + real lesson; synthetic dialogue (see _fixture)
const NOW=Date.parse('2026-11-23T18:00:00+09:00');
/** What a Markdown renderer shows for escaped text. */
const shown=md=>md.replace(/ {2}\n/g,'\n').replace(/\\([\\`*_\[\]<>#|~&$\-+=.)])/g,'$1').replace(/^ +/gm,m=>' '.repeat(m.length));
const aiNote=l=>C.clean({...AI.raw,kind:'ai',generatedBy:{provider:'chatgpt',model:AI.model},at:NOW,basis:C.basisKey(l)},l);
const conceptPart=md=>md.split(/\n## 학습 기록\n|\n<toggle>\n학습 기록/)[0];

test('the export fixture is a synthetic golden file: re-exporting the rebuilt record gives the same Markdown',()=>{
 const md=N.lessonMarkdown(SQLI(),{now:Date.parse('2000-01-01T12:00:00+09:00')});
 const orig=fs.readFileSync(path.join(__dirname,'fixtures','sqli_time_blind_export.md'),'utf8');
 assert.equal(md,orig);
 assert.ok(orig.split('\n').length>=420,'long transcript export');
});

test('body grammar: paragraphs, lists, code, math, tables, notes and sub-headings — nothing else becomes markup',()=>{
 const b=C.parse('첫 문단\n둘째 줄\n\n- 가\n- 나\n\n1. 하나\n2. 둘\n\n```python\nx = "<b>"\n```\n\n$$\nf\'(a)=\\lim_{h\\to0}\\frac{f(a+h)-f(a)}{h}\n$$\n\n| A | B |\n| --- | --- |\n| 1 \\| 2 | 3 |\n\n> 흔한 오해\n\n### 소제목\n\n<script>alert(1)</script> [링크](https://evil.example) ![img](x)');
 assert.deepEqual(b.map(x=>x.t),['p','ul','ol','code','math','table','note','h','p']);
 assert.equal(b[3].code,'x = "<b>"');assert.equal(b[3].lang,'python');
 assert.deepEqual(b[5].rows,[['1 | 2','3']]);
 for(const notion of [false,true]){const md=C.blocksMd(b,{notion});
  assert.ok(md.includes('\\<script\\>'),'raw HTML is escaped, never emitted');
  assert.ok(!/\]\(https:\/\/evil/.test(md.replace(/\\\[|\\\]/g,'')),'no link is produced from body text');
  assert.ok(md.includes('```python\nx = "<b>"\n```'),'code kept verbatim');
  assert.ok(md.includes('$$\nf\'(a)'),'math block');assert.ok(md.includes('| 1 \\| 2 | 3 |'),'pipe table with escaped bar')}
 assert.ok(C.blocksMd(b,{notion:true}).includes('<callout color="gray_bg">\n흔한 오해\n</callout>'));
 assert.ok(C.blocksMd(b).includes('> 흔한 오해'));
 assert.ok(C.blocksMd(C.parse('가격은 $5와 $10'),{notion:true}).includes('\\$5'),'$ never starts Notion inline math');
 // steps split by a formula keep counting; blank-separated items stay one list
 assert.deepEqual(C.parse('1. a\n\n$$\nx\n$$\n\n1. b\n\n1. c\n\n- z\n\n- y').map(x=>[x.t,x.start??null,x.items??null]),[['ol',1,['a']],['math',null,null],['ol',2,['b','c']],['ul',null,['z','y']]]);
 assert.ok(C.blocksMd(C.parse('1. a\n\n$$\nx\n$$\n\n1. b')).includes('2. b'));
});

test('SQLi (synthetic synthesis): the main body teaches every point the learner needed, before any history',()=>{
 const l=SQLI(),note=aiNote(l);assert.ok(note,'scripted output passes the client checks');
 const md=C.toMarkdown(note,l,{now:NOW}),body=shown(conceptPart(md));
 const has=(what,...alts)=>assert.ok(alts.some(re=>re.test(body)),what);
 // the closing ** sits before ')' so it renders as bold before a Korean particle (tests/emphasis.test.js)
 has('what SQL injection is',/\*\*SQL 삽입\(SQLi\*\*\)은 외부 입력이[^\n]*명령의 일부로 해석/);
 has('blind result',/조회한 값이 화면에 바로 나오지 않는/);
 has('relationship',/조건과 관찰 결과 사이에 연결/);
 has('condition-dependent work',/조건에 따라 처리량이 달라지면 시간에도 차이/);
 has('signal types',/내용 \| 표시 차이/);
 has('timing signal',/시간 \| 응답 간격/);
 has('timing uncertainty',/혼잡 때문일 수도/);
 has('limited knowledge',/시스템에 관한 가정은 따로 점검/);
 has('partial information',/목록 전체를 안다고 결론지을 수 없어요/);
 has('boundary',/입력과 명령의 경계/);
 const concept=conceptPart(md);
 assert.ok(concept.includes('WHERE title = " + title'));
 assert.ok(concept.includes('SELECT title FROM books WHERE title = ?'));
 // the learner's questions are quoted from the record (exact words), next to their answers
 for(const m of C.learnerMessages(l))assert.ok(shown(concept).includes(`“${m.text.replace(/\s+/g,' ').trim()}”`),'verbatim question: '+m.text.slice(0,20));
 // the corrected tutor wording is not reproduced as fact; the correction is disclosed
 assert.ok(l.dialogue.some(m=>m.text.includes('같은 책 한 권만 돌려줘요')));
 assert.ok(!concept.includes('같은 책 한 권만 돌려줘요'));
 assert.ok(note.corrections.some(c=>/제목만으로 책을 구별/.test(c.text)));
 // no mastery claims, no invented links or references in the AI part
 assert.ok(!/(이해했|숙달했|완전히 알게|마스터했)/.test(concept));
 assert.ok(!/https?:\/\//.test(note.sections.map(x=>x.body).join('\n')+note.lead));
 // concept first: the old log sections only appear in the history
 const i=md.indexOf('## 학습 기록');assert.ok(i>0);for(const h of ['### 처음 생각','### 내 설명과 생각의 변화','### 원래 기록'])assert.ok(md.indexOf(h)>i,h);
 assert.ok(!concept.includes('그림으로 보기'),'no numbered text called a diagram');
});

test('the learner’s words: kept exactly in the history, never authored by the model',()=>{
 const l=SQLI(),before=JSON.stringify(l),note=aiNote(l);
 // the model cannot put words in the learner's mouth: question text always comes from the record by number
 const forged=C.clean({...AI.raw,resolved:[{n:1,question:'나는 완벽히 이해했다',answer:'답이에요.'},{n:99,answer:'없는 번호'}]},l);
 assert.equal(forged.resolved.length,1);assert.equal(forged.resolved[0].question,C.learnerMessages(l)[0].text);
 for(const md of [C.toMarkdown(note,l,{now:NOW}),C.toNotion(note,l,{now:NOW})]){const v=shown(md);
  for(const m of l.dialogue.filter(m=>m.role==='learner'&&!m.quick))assert.ok(v.includes(m.text.trim()),'verbatim in history: '+m.text.slice(0,20));
  assert.ok(v.includes(l.drafts[0].text),'self-explanation verbatim');assert.ok(v.includes(l.prediction))}
 assert.equal(JSON.stringify(l),before,'rendering never changes the record');
});

test('Markdown and Notion carry the same concept content, code, citations and history; only the containers differ',()=>{
 const l=SQLI(),note=aiNote(l),md=C.toMarkdown(note,l,{now:NOW}),nt=C.toNotion(note,l,{now:NOW});
 const heads=s=>s.split('\n').filter(x=>/^## /.test(x)&&x!=='## 학습 기록');
 assert.deepEqual(heads(nt),heads(md).filter(x=>x!=='## 학습 기록'));
 const fences=s=>s.match(/```[\s\S]*?```/g);assert.deepEqual(fences(nt),fences(md));
 assert.ok(nt.includes('<toggle>\n학습 기록 — '),'history behind a toggle');assert.ok(!md.includes('<toggle>')&&!md.includes('<callout'),'plain Markdown has no Notion tags');
 assert.ok(!nt.includes('<details')&&!/^#{5,} /m.test(nt),'only syntax Notion v2 documents (no <details>, no h5+)');
 assert.ok(!nt.startsWith('# '),'the Notion page title is the page property');
 // toggles are well formed: title on the next line, children after one blank line, no padding before the close
 const opens=(nt.match(/<toggle>/g)||[]).length;assert.equal(opens,(nt.match(/<\/toggle>/g)||[]).length);
 assert.ok(!/\n\n<\/toggle>/.test(nt)&&!/<toggle>\n\n/.test(nt));
 // outside code, a literal '<' only opens a Notion tag we wrote
 const noCode=nt.replace(/```[\s\S]*?```/g,'');assert.ok(!/<(?!\/?(toggle|callout)\b)/.test(noCode.replace(/\\</g,'')),'every other < is escaped');
});

test('basic note (no AI synthesis): concept-first, each question beside its verbatim answer, labelled as not synthesised',()=>{
 const l=SQLI(),md=C.exportMarkdown(l,{now:NOW}),concept=conceptPart(md);
 assert.ok(concept.includes('AI 종합 없이'),'says it is the basic note');
 assert.ok(concept.indexOf('## 검색어와 질의 구조')<concept.indexOf('## 이번 탐험에서 나눈 질문과 답'));
 const q=concept.indexOf('“기호도 검색할 수 있나요?”'),a=concept.indexOf('기호도 값으로 전달하면 돼요');
 assert.ok(q>0&&a>q&&a-q<400,'answer follows its question');
 assert.ok(concept.includes('```python\n# 안전한 조회'),'tutor code kept as code');
 assert.ok(concept.includes('**흐름 — 검색 순서**')&&!concept.includes('그림으로 보기'),'a numbered flow is called a flow');
 assert.ok(concept.includes('| 기준 | 명령 | 값 |'),'comparison as a table');
 assert.equal(C.noteFor(l).kind,'basic');
});

test('material provenance: only quotes found on the cited page survive; the rest is plainly AI explanation',()=>{
 const l=CALC(),mat=l.material;
 const note=C.clean({title:'미분계수',lead:'핵심 문단이에요.',sections:[
  {heading:'정의',body:'본문',origin:'material',sources:[{page:2,quote:"f'(a) = lim h→0 (f(a + h) - f(a)) / h"},{page:3,quote:'자료에 없는 지어낸 구절이에요'},{page:9,quote:'없는 쪽'}]},
  {heading:'보충',body:'AI가 덧붙인 설명',origin:'lesson',sources:[]}]},l);
 assert.equal(note.sections[0].sources.length,1);assert.equal(note.sections[1].sources.length,0);
 const md=C.toMarkdown(note,l,{now:NOW}),nt=C.toNotion(note,l,{now:NOW});
 for(const s of [md,nt]){assert.ok(shown(s).includes("수업 자료 p.2: “f'(a) = lim h→0 (f(a + h) − f(a)) / h”"),'the quote as written in the file');assert.ok(!s.includes('지어낸 구절'));
  assert.ok(shown(s).includes('math_lecture.pdf'));assert.ok(/표시가 없는 부분은 AI의 설명이에요/.test(s))}
 // the basic note keeps the lesson's verified page citations beside each section
 assert.ok(shown(C.exportMarkdown(l,{now:NOW})).includes('수업 자료 p.1: “함수 y = f(x)에서'));
});

test('a learner who has not written a self-explanation, and a question that never got an answer',()=>{
 const l=CALC();assert.equal(l.drafts.length,0);
 const p=C.payload(l,null);assert.deepEqual(p.drafts,[]);assert.equal(p.messages.find(m=>m.n===3).answered,false);
 const md=C.exportMarkdown(l,{now:NOW});assert.ok(md.includes('_아직 남긴 설명이 없어요._'));
 assert.ok(!/(이해했|숙달)/.test(conceptPart(md).replace('이 노트는 숙달이나 이해를 판정하지 않아요','')));
 const note=C.clean({title:'t',lead:'l',sections:[{heading:'h',body:'b'}],open:[{n:3,why:'답을 받지 못했어요'}]},l);
 assert.equal(note.open[0].text,'미분가능하지 않은 함수도 있어요?');assert.ok(shown(C.toMarkdown(note,l)).includes('**내 질문** “미분가능하지 않은 함수도 있어요?”'));
});

test('staleness: a note made earlier is kept and marked outdated once the exploration goes on',()=>{
 const l=SQLI();l.conceptNote=aiNote(l);assert.equal(C.stale(l),false);
 const keep=JSON.stringify(l.conceptNote);
 T.addLearner(l,{text:'하나 더 궁금해요?'},NOW+1,'late');
 assert.equal(C.stale(l),true);assert.equal(JSON.stringify(l.conceptNote),keep,'never rewritten on its own');
 assert.ok(C.exportMarkdown(l,{now:NOW}).includes('이 노트를 만든 뒤에 이어진 학습 내용은 반영되지 않았어요'));
 assert.equal(C.noteFor(l).kind,'ai','the learner’s note is still what gets exported');
});

test('edited notes: the edit is what gets exported, and it is labelled as edited',()=>{
 const l=SQLI();const n=aiNote(l);n.sections[0].body='내가 고친 문단이에요.';l.conceptNote={...C.clean(n,l),editedAt:NOW};
 const md=C.exportMarkdown(l,{now:NOW});assert.ok(md.includes('내가 고친 문단이에요.'));assert.ok(md.includes('그 뒤에 내가 직접 고쳤어요'));
});

test('long conversations: the request is bounded and the Notion page leaves the transcript out with a note',()=>{
 const l=SQLI();const t=l.dialogue[0].at;
 for(let i=0;i<180;i++){const m=T.addLearner(l,{text:`긴 대화 질문 ${i} `+'가'.repeat(1800)+'?'},t+i*10,'x'+i).msg;
  T.attachReply(l,m.id,{reply:'답 '.repeat(1000),followUp:'',assessment:null,uncertainty:'',withheld:0},{model:'m'},t+i*10+1,'y'+i)}
 const p=C.payload(l,null);assert.ok(JSON.stringify(p).length<120000,'request stays within budget');assert.ok(p.omitted>0);
 const note={...aiNote(SQLI()),truncated:p.omitted};const nt=C.toNotion(note,l,{now:NOW}),md=C.toMarkdown(note,l,{now:NOW});
 assert.ok(nt.length<150000,'under the server’s Notion limit');assert.ok(nt.includes('대화 전문은 Notion에 넣지 않았어요'));
 assert.ok(md.includes('긴 대화 질문 179'),'the download keeps everything');
 assert.ok(md.includes(`메시지 ${p.omitted}개는 이 정리에 넣지 못했어요`));
});

test('malformed or failed synthesis never breaks the export and never invents content',()=>{
 const l=SQLI();
 for(const bad of [null,'문자열',[],{},{lead:'x'},{sections:[{heading:'h',body:'b'}]},{lead:'x',sections:[{heading:'',body:'b'},{body:'b'}]}])assert.equal(C.clean(bad,l),null);
 l.conceptNote={garbage:true};assert.equal(C.noteFor(l).kind,'basic','an unusable stored note falls back to the basic note');
 assert.doesNotThrow(()=>C.exportMarkdown({id:'x',topic:'빈 기록',lesson:null,drafts:[],scenarios:[],events:[]}));
 assert.doesNotThrow(()=>C.exportNotion({id:'x',topic:'빈 기록',lesson:null}));
 const n=C.clean({title:'t',lead:'l',sections:[{heading:'h',body:'b'.repeat(9000)},...Array.from({length:30},(_,i)=>({heading:'s'+i,body:'x'}))]},l);
 assert.ok(n.sections[0].body.length<=C.LIM.body&&n.sections.length<=C.LIM.sections);
});

test('historical records: an old note without a concept note still exports, and the old full note is unchanged',()=>{
 const legacy=fx('scaffold_sqli_lesson.json');const l={id:'old',topic:'SQL Injection',lesson:legacy,stage:5,maxStage:5,prediction:'',scenarios:[],drafts:[],events:[],createdAt:1,updatedAt:2,complete:true};
 const md=C.exportMarkdown(l,{now:NOW});assert.ok(md.startsWith('# '));assert.ok(md.includes('## 학습 기록'));
 assert.equal(N.lessonMarkdown(SQLI(),{now:Date.parse('2000-01-01T12:00:00+09:00')}),fs.readFileSync(path.join(__dirname,'fixtures','sqli_time_blind_export.md'),'utf8'));
});
