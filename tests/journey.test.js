// Learning-journey archive (learning-journey-v2): deterministic, evidence-preserving, AI output labelled.
//   node --test tests/journey.test.js
// Fixtures: the committed SQLi / calculus / memory records (already in the repo) and synthetic records built here.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const J=require('../journey.js');const C=require('../concept-note.js');const N=require('../notes.js');
const fx=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',n),'utf8'));
const SQLI=()=>fx('sqli_time_blind_record.json'),CALC=()=>fx('calc_material_record.json'),MEM=()=>fx('memory_session.json').record;
const AI=fx('sqli_concept_note_ai.json');
const withNote=l=>({...l,conceptNote:C.clean({...AI.raw,kind:'ai',generatedBy:{provider:'fixture',model:AI.model},at:Date.parse('2026-11-23T18:00:00+09:00'),basis:C.basisKey(l)},l)});
/** What a Markdown reader shows for notes.esc() text: hard breaks → newlines, escapes removed, kept spaces restored. */
const shown=md=>md.replace(/ {2}\n/g,'\n').replace(/\\([\\`*_\[\]<>#|~&$\-+=.)])/g,'$1').replace(/^ +/gm,m=>' '.repeat(m.length));
const part=(md,a,b)=>{const i=md.indexOf(`\n## ${a}`),j=b?md.indexOf(`\n## ${b}`):md.length;assert.ok(i>=0&&j>i,`section ${a}`);return md.slice(i,j)};
const appendix=md=>{const m=md.match(/\n(`{3,})json\n([\s\S]*)\n\1\n$/);assert.ok(m,'JSON appendix at the end');return m[2]};
const one=t=>String(t).replace(/\s+/g,' ').trim();
const HEADS=['기록 정보','1. 처음 질문과 처음 이해','2. 학습 활동의 순서','3. 질문과 막힌 곳','4. 시도, 예상, 선택','5. 내 설명과 AI 피드백','6. 기록으로 보이는 학습 과정','7. 아직 풀리지 않은 질문','8. 원래 학습 기록 전체','9. 원본 데이터 (JSON)'];

test('SHA-256 is the standard one (Korean, emoji, empty, block boundaries, long)',()=>{
 for(const s of ['','abc','학습 과정 기록','🙂👩‍💻 é é','x'.repeat(55),'x'.repeat(56),'x'.repeat(64),'가'.repeat(100000)])
  assert.equal(J.sha256(s),crypto.createHash('sha256').update(s,'utf8').digest('hex'),JSON.stringify(s.slice(0,12)))});

test('structure: ten sections in order, the format named, the privacy notice at the top',()=>{
 const md=J.markdown(SQLI());
 let at=0;for(const h of HEADS){const i=md.indexOf(`\n## ${h}\n`);assert.ok(i>at,h);at=i}
 assert.ok(md.startsWith(`# ${SQLI().lesson.title} — 학습 과정 기록\n`));
 assert.match(md,/learning-journey-v2/);assert.match(md.slice(0,600),/대화 전체가 들어 있어요/);
 assert.ok(!/^#{7,} /m.test(md),'no heading deeper than h6');
});

test('deterministic and read-only: same record → same bytes; the record is never changed',()=>{
 for(const make of [SQLI,CALC,MEM,()=>withNote(SQLI())]){const l=make(),before=JSON.stringify(l);
  const a=J.markdown(l),b=J.markdown(JSON.parse(before));assert.equal(a,b);assert.equal(JSON.stringify(l),before);
  assert.equal(J.fileName(l),J.fileName(JSON.parse(before)))}
});

test('recoverable: the JSON appendix is the record exactly, and the header hash identifies it',()=>{
 for(const l of [SQLI(),CALC(),MEM(),withNote(SQLI())]){const md=J.markdown(l),js=appendix(md);
  assert.deepEqual(JSON.parse(js),l);assert.equal(js,JSON.stringify(l,null,2));
  const h=crypto.createHash('sha256').update(js,'utf8').digest('hex');
  assert.ok(md.slice(0,1500).includes(`SHA-256 \`${h}\``),'header hash');assert.ok(part(md,'9. 원본').includes(h))}
});

test('the learner’s exact words: every typed message, prediction, explanation and reflection survive verbatim',()=>{
 for(const l of [SQLI(),CALC(),MEM()]){const md=J.markdown(l),orig=shown(part(md,'8. 원래','9. 원본')),journey=shown(md.slice(0,md.indexOf('\n## 8.')));
  for(const m of l.dialogue.filter(m=>m.role==='learner')){
   assert.ok(orig.includes(m.text.replace(/\n+$/,'')),'original record: '+m.text.slice(0,20));
   assert.ok(journey.includes(one(m.text)),'timeline: '+m.text.slice(0,20))}
  for(const d of l.drafts){assert.ok(journey.includes(d.text),'explanation verbatim');assert.ok(orig.includes(d.text))}
  if(l.prediction){assert.ok(journey.includes(l.prediction));assert.ok(orig.includes(l.prediction))}
  if(l.reflection)assert.ok(journey.includes(l.reflection))}
 // section 8 is CURIVEN's existing full export (byte-tested elsewhere against a synthetic golden export), headings shifted
 const l=SQLI(),md=J.markdown(l),full=N.lessonMarkdown(l,{now:l.updatedAt,shift:2}).replace(/\n+$/,'');
 assert.ok(part(md,'8. 원래','9. 원본').includes(full));
});

test('message numbers (#n) match the concept note’s numbering of the learner’s messages',()=>{
 for(const l of [SQLI(),CALC(),MEM()]){const md=J.markdown(l),s3=part(md,'3. 질문','4. 시도');
  for(const m of C.learnerMessages(l))assert.ok(s3.includes(`- #${m.n} ${N.esc(m.text.replace(/\s+/g,' ').trim())} —`),`#${m.n}`)}
});

test('chronology: only timed actions in the table, in time order; untimed ones listed apart, never given a time',()=>{
 for(const l of [SQLI(),CALC(),MEM()]){const md=J.markdown(l),sec=part(md,'2. 학습','3. 질문');
  const rows=sec.split('\n').filter(x=>/^\| \d{4}-/.test(x)),times=rows.map(x=>x.slice(2,18));
  assert.deepEqual([...times].sort(),times,'non-decreasing');
  const timedLearner=l.dialogue.filter(m=>m.role==='learner'&&Number.isFinite(m.at)).length;
  assert.equal(rows.filter(x=>/\| (버튼: |내 메시지 #)/.test(x)).length,timedLearner,'one row per learner message, none invented');
  assert.equal(rows.filter(x=>/\| 설명 \d+ 작성 \|/.test(x)).length,l.drafts.filter(d=>Number.isFinite(d.at)).length);
  const untimedScen=l.scenarios.filter(s=>!Number.isFinite(s.at)).length;
  assert.equal(rows.filter(x=>/사고 실험 \d+ 응답/.test(x)).length,l.scenarios.length-untimedScen);
  if(untimedScen)assert.match(sec,/\*\*시각이 남지 않은 기록\*\*/);
  if(l.prediction)assert.ok(!rows.some(x=>x.includes('처음 예상')),'the prediction has no time in the record')}
 // memory: its scenario answers carry times and appear in the table
 assert.match(part(J.markdown(MEM()),'2. 학습','3. 질문'),/\| 2000-\d\d-\d\d \d\d:\d\d \| 사고 실험 1 응답 \|/);
});

test('metadata matches the record (counts, period, model, material)',()=>{
 const l=SQLI(),md=J.markdown(l),info=part(md,'기록 정보','1. 처음');
 assert.match(info,/직접 쓴 메시지 8개, 버튼 요청 5개, 사고 실험 응답 3개, 내 설명 1개/);
 const t=[l.createdAt,...l.dialogue.map(m=>m.at),...l.drafts.map(d=>d.at)];
 assert.ok(info.includes(`${N.when(Math.min(...t))} ~ ${N.when(Math.max(...t))}`));assert.match(info,/fixture · fixture-model/);
 const c=J.markdown(CALC()),ci=part(c,'기록 정보','1. 처음');
 assert.match(ci,/math\\_lecture\.pdf \(PDF, 4쪽; 읽지 못한 곳 p\.3\)/);assert.match(ci,/질문 없이 수업 자료에서 시작/);
 assert.match(ci,/직접 쓴 메시지 3개, 버튼 요청 0개, 사고 실험 응답 1개, 내 설명 0개/);
});

test('AI output is labelled and never attributed to the learner; mappings are marked as inferred',()=>{
 const l=withNote(SQLI()),md=J.markdown(l),fb=l.drafts[0].feedback.summary;
 // the feedback text appears only in the AI section (and the original record / JSON), never as the learner's words
 const before5=md.slice(0,md.indexOf('\n## 5.')),s5=part(md,'5. 내 설명','6. 기록');
 assert.ok(!shown(before5).includes(fb.slice(0,40)));assert.ok(shown(s5).includes(fb.slice(0,40)));
 assert.match(s5,/AI가 쓴 부분은 참고 의견이고, 맞는지 확인된 판단이 아니에요/);assert.match(s5,/AI 분류/);assert.match(s5,/\*\*AI 피드백\*\* _\(AI · /);
 assert.match(s5,/바로잡혔다고 AI가 정리한 설명/);assert.match(s5,/사실을 바로잡은 것인지 표현을 다듬은 것인지는 따로 확인되지 않았어요/);
 for(const c of l.conceptNote.corrections)assert.ok(shown(s5).includes(c.text));
 const s6=part(md,'6. 기록','7. 아직');assert.match(s6,/AI가 정리하며 표시한 연결이에요\. 직접 확인된 대응이 아니에요/);
 for(const s of l.conceptNote.sections)for(const n of s.asks||[])assert.match(s6,new RegExp(`\\| #${n} \\|[^\\n]*‘${s.heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\\\./g,'\\\\?\\.')}’`));
 assert.match(part(md,'1. 처음','2. 학습'),/예상해 볼 질문\*\* _\(AI가 낸 질문\)_/);
});

test('no fabricated claims: no mastery, traits, achievements or improvement; one explanation → change not knowable',()=>{
 for(const l of [SQLI(),CALC(),MEM(),withNote(SQLI())]){const md=J.markdown(l),own=md.slice(0,md.indexOf('\n## 8.'));
  assert.ok(!/(이해했어요|숙달|마스터|실력이 늘|향상되었|성장했|뛰어난|우수한|성실|끈기|열정적|역량을 갖춘|능력을 보여)/.test(own),'no claims');
  if(l.drafts.length===1)assert.match(own,/고쳐 쓴 설명이 없어서, 이해가 달라졌는지는 이 기록만으로 알 수 없어요/);
  if(!l.drafts.length)assert.match(own,/내 설명이 없어서, 생각의 변화를 기록으로 볼 수는 없어요/)}
});

test('unresolved questions come from the record: an unanswered message, AI questions without an answer',()=>{
 const md=J.markdown(CALC()),s7=part(md,'7. 아직','8. 원래');
 assert.match(s7,/#3 미분가능하지 않은 함수도 있어요\?/);
 assert.match(J.markdown(SQLI()),/이 목록에 따로 모은 질문이 없어요/);
});

test('missing or partial records never throw and say what is missing instead of guessing',()=>{
 const cases=[{id:'empty'},{id:'nolesson',topic:'빈 탐험',lesson:null,dialogue:[],drafts:[],scenarios:[]},
  {id:'odd',topic:'이상한 값',lesson:{},dialogue:[null,{role:'learner',text:'시각 없는 질문?'},{role:'learner',text:'실패한 질문?',at:5,status:'failed'},{role:'learner',text:'메모',at:6,status:'noted'}],drafts:[{text:'시각 없는 설명'}],scenarios:[{i:0,choice:null,unsure:true}],predictionUnsure:true,events:[{type:'stage',at:'2026-11-20T01:00:00Z'},{at:'bad'}]}];
 for(const l of cases){const before=JSON.stringify(l);let md;assert.doesNotThrow(()=>{md=J.markdown(l)},l.id);assert.equal(JSON.stringify(l),before);
  assert.deepEqual(JSON.parse(appendix(md)),l);for(const h of HEADS)assert.ok(md.includes(`\n## ${h}\n`),h)}
 const odd=J.markdown(cases[2]),s2=part(odd,'2. 학습','3. 질문');
 assert.ok(!/\| \d{4}-[^|]*\| 내 메시지 #1 \|/.test(s2),'no time invented for an untimed message');assert.match(s2,/- 내 메시지 #1: 시각 없는 질문\?/);
 assert.match(s2,/\| 내 메시지 #2 \| 실패한 질문\? · 답을 받지 못함 \|/);assert.match(s2,/\| 내 메시지 #3 \| 메모 · 메모로만 남김 \|/);assert.match(s2,/- 설명 1 작성/);assert.match(s2,/잘 모르겠다고 함/);
 assert.match(part(odd,'7. 아직','8. 원래'),/#2 실패한 질문\?/);
 assert.match(part(odd,'기록 정보','1. 처음'),/형식이 맞지 않는 대화 1개는 이 정리에서 빠졌어요\. ‘9\. 원본 데이터’의 JSON에는 그대로 있어요\./);
 assert.match(J.markdown({id:'empty'}),/_시각이 기록된 활동이 없어요\._/);assert.match(J.markdown({id:'empty'}),/_시각 기록 없음_/);
 assert.throws(()=>J.markdown(null));
});

test('escaping, Korean and Unicode: hostile and unusual text renders exactly as typed and cannot break the document',()=>{
 const nasty=['**굵게** _기울임_ `코드` <script>alert(1)</script> | 칸 | # 제목','```\n코드 블록 흉내\n```','````네 개````','$x$ 와 $$y$$ 그리고 \\백슬래시','1. 번호 같은 줄\n- 목록 같은 줄\n> 인용 같은 줄','이모지 🙂👩‍💻 결합 é·é 한자 學習 아랍어 مرحبا','  앞 공백과 끝 공백  '];
 const l={id:'u',topic:'유니코드 <시험> | 탐험',question:'유니코드 <시험> | 탐험',createdAt:Date.parse('2026-11-01T01:00:00Z'),updatedAt:Date.parse('2026-11-01T02:00:00Z'),
  lesson:{title:'제목 # | * _'},prediction:nasty[0],reflection:nasty[5],drafts:[{text:nasty.join('\n'),at:Date.parse('2026-11-01T01:30:00Z')}],scenarios:[],
  dialogue:nasty.map((t,i)=>({id:'m'+i,role:'learner',text:t,at:Date.parse('2026-11-01T01:00:00Z')+i*60000,status:'noted'}))};
 const md=J.markdown(l),own=md.slice(0,md.indexOf('\n## 8.'));
 assert.ok(!/<script>/.test(md.slice(0,md.indexOf('\n## 9.'))),'no raw HTML outside the JSON code block');
 // the table stays three columns: every | inside a cell is escaped
 for(const row of part(md,'2. 학습','3. 질문').split('\n').filter(x=>/^\| \d{4}/.test(x)))assert.equal(row.replace(/\\\|/g,'').split('|').length,5,row);
 const block=own.slice(own.indexOf('**내가 작성한 설명** _(내 글)_')).split('\n\n')[1].split('\n').map(x=>x.replace(/^> ?/,'')).join('\n');
 assert.equal(shown(block).split('\n').map(x=>x.trimEnd()).join('\n'),nasty.join('\n').split('\n').map(x=>x.trimEnd()).join('\n'),'explanation verbatim (block quote)');
 for(const t of nasty)assert.ok(shown(own).includes(one(t)),'one-line form: '+t.slice(0,10));
 const js=appendix(md);assert.deepEqual(JSON.parse(js),l);const run=Math.max(...(js.match(/`+/g)||['']).map(x=>x.length));
 assert.ok(md.includes('\n'+'`'.repeat(Math.max(3,run+1))+'json\n'),'fence longer than any backtick run inside');
 assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(md),'no broken surrogate pairs');
});

test('long explorations: 400 messages with long text are complete and fast enough',()=>{
 const t0=Date.parse('2026-11-01T00:00:00Z'),l={id:'long',topic:'긴 탐험',createdAt:t0,updatedAt:t0+999999,lesson:{title:'긴 탐험'},drafts:[],scenarios:[],dialogue:[]};
 for(let i=0;i<200;i++){l.dialogue.push({id:'q'+i,role:'learner',text:`질문 ${i} `+'가나다'.repeat(300)+'?',at:t0+i*2000});l.dialogue.push({id:'a'+i,role:'tutor',replyTo:'q'+i,text:'답 '.repeat(800),at:t0+i*2000+1000})}
 const s=Date.now(),md=J.markdown(l),ms=Date.now()-s;
 assert.ok(ms<5000,`took ${ms} ms`);assert.equal((part(md,'2. 학습','3. 질문').match(/\| 내 메시지 #/g)||[]).length,200);
 assert.ok(md.includes('질문 199 '));assert.deepEqual(JSON.parse(appendix(md)),l);
});

test('local only: the archive module and its UI make no network, AI or Notion request and write no storage',()=>{
 const src=fs.readFileSync(path.join(__dirname,'..','journey.js'),'utf8');
 for(const bad of ['fetch(','XMLHttpRequest','/api/','localStorage','sessionStorage','Date.now(','new Date()','Math.random'])assert.ok(!src.includes(bad),bad);
 const ui=fs.readFileSync(path.join(__dirname,'..','tutor-ui.js'),'utf8'),fn=ui.slice(ui.indexOf('function openJourney'),ui.indexOf('\nconst ',ui.indexOf('function openJourney'))>0?ui.indexOf('\n',ui.indexOf('d.showModal')):undefined);
 assert.ok(fn.includes('CuriJourney.markdown'));for(const bad of ['post(','fetch(','/api/','persist(','flushDraft','saveToNotion'])assert.ok(!fn.includes(bad),bad);
 assert.equal(J.fileName(SQLI()),'curiven-journey-도서-검색은-어떻게-입력을-분리하나요-20000101.md');
 assert.match(J.fileName({id:'x',topic:'a/b:c*?"<>|d'}),/^curiven-journey-a b c d|^curiven-journey-a-b-c-d/);
});
