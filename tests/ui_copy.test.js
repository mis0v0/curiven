// UI copy guards (UI phase 1): no positional directions in learner-facing strings, one name for prerequisite terms.
// node --test tests/ui_copy.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const T=require('../tutor.js');
const ROOT=path.resolve(__dirname,'..');
const UI=['index.html','copy.js','home-ui.js','tutor-ui.js','settings-ui.js','notion-ui.js','material-ui.js','boundary-ui.js','constellation.js','notes.js','journey.js'];
// String literals that contain Hangul (learner-facing copy).
function strings(file){const src=fs.readFileSync(path.join(ROOT,file),'utf8'),out=[];const re=/(['`])((?:\\.|(?!\1)[^\\\n])*)\1/g;let m;
 while((m=re.exec(src)))if(/[가-힣]/.test(m[2]))out.push({file,line:src.slice(0,m.index).split('\n').length,text:m[2]});return out}

test('no positional directions (left/right/above/below) in the app’s own copy',()=>{
 // Allowed: Notion's own interface ("오른쪽 위 •••" in Notion), and "페이지 아래" meaning a child page in Notion.
 const allowed=[/Notion 페이지를 열고 오른쪽 위 •••/,/페이지 아래(에|\s*페이지)/,/그 아래 페이지/];
 const bad=UI.flatMap(strings).filter(s=>/(왼쪽|오른쪽|위에서|위에 |아래에서|아래에 |아래 ‘|아래의 |밑에)/.test(s.text)&&!allowed.some(a=>a.test(s.text)));
 assert.deepEqual(bad.map(b=>`${b.file}:${b.line} ${b.text.slice(0,60)}`),[]);
});

test('prerequisite terms have one name, defined once',()=>{
 assert.equal(T.prereqLabel(4),'먼저 알아볼 개념 4개');
 const all=UI.flatMap(strings).map(s=>s.text).join('\n');
 for(const old of ['먼저 알아 두면 좋은 말','시작하기 전에 알아 두면','이 문제에 나오는 용어','먼저 알아 둔 말'])assert.ok(!all.includes(old),old);
 const ui=fs.readFileSync(path.join(ROOT,'tutor-ui.js'),'utf8');assert.equal((ui.match(/T\.prereqLabel\(/g)||[]).length,2,'story and thought-experiment stages use the shared label');
});

test('note actions say what they do: one archive download, Notion is a save, a NEW page or a link',()=>{
 const all=UI.flatMap(strings).map(s=>s.text);
 assert.ok(!all.some(t=>/^(이 탐험의 )?학습 노트 저장$/.test(t)),'the ambiguous “학습 노트 저장” label is gone');
 for(const t of ['Notion에 개념 노트 저장','새 페이지로 저장','학습 과정 기록 다운로드','Notion 없이 이 노트를 파일로 받기 (.md)'])assert.ok(all.includes(t),t);
 assert.ok(!all.some(t=>/업데이트$|덮어쓰기/.test(t)),'2026-11-24: nothing offers to update or overwrite a saved Notion page');
 assert.ok(!all.includes('Markdown 다운로드')&&!all.includes('학습 과정 기록 다운로드 (.md)'),'no second, competing download button');
});

// Phase 2B — one stage vocabulary, calm polite speech, no forced familiarity.
test('stage copy: stable labels, polite headings, none of the old forced or banmal phrasing',()=>{
 const C=require('../copy.js');
 assert.deepEqual(C.STAGES.map(s=>s.label),['시작','이야기','탐구','개념','설명','성장']);
 for(const s of C.STAGES){assert.match(s.heading,/(요|요\?)$/,s.heading);if(s.sub)assert.match(s.sub,/요\.$/,s.sub)}
 const all=UI.flatMap(strings).map(s=>s.text).join('\n');
 for(const old of ['네 언어','내려놓','다시 시작할까?','무슨 일이 일어날까?','LOOK HOW FAR','A STORY TO BEGIN','IN YOUR OWN WORDS','THE REAL CONCEPT','EXPERIMENT WITH IDEAS','THOUGHT EXPERIMENT'])assert.ok(!all.includes(old),old);
 // A topic-specific heading replaces the default only where the lesson provides one; the label never changes.
 assert.deepEqual(C.stageCopy(4,{explainTitle:'웹페이지가 만들어지는 과정을 정리해요'}),{label:'설명',heading:'웹페이지가 만들어지는 과정을 정리해요',sub:C.STAGES[4].sub,topicHeading:true});
 assert.equal(C.stageCopy(4,{}).heading,'지금까지 이해한 내용을 정리해요');assert.equal(C.stageCopy(3,{explainTitle:'x'}).heading,'이제 원리를 알아볼까요?');
});

test('self-explanation: a fill-in-the-blanks prompt is an optional guide, never the default request',()=>{
 const C=require('../copy.js');
 const old=C.explainInvite({explainPrompt:'페이지를 열면 서버는 ___하고 브라우저는 ___한다. 이 과정을 정리해 보세요.'});
 assert.equal(old.question,'');assert.match(old.template,/___/);assert.equal(old.starters.length,3);
 const open=C.explainInvite({explainPrompt:'브라우저가 페이지를 보여 주기까지 무슨 일이 일어나는지 이해한 만큼 설명해 볼까요?',explainStarters:['내가 이해한 건…','___ 때문에']});
 assert.equal(open.template,'');assert.match(open.question,/설명해 볼까요/);assert.deepEqual(open.starters,['내가 이해한 건…'],'a blank starter is dropped');
 for(const t of ['( )','（ ）','□ 안에','[ ]'])assert.ok(C.isBlankTemplate(t),t);assert.ok(!C.isBlankTemplate('HTML(구조)과 CSS(모양)'));
});
