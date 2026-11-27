// Phase 2B — learner-first language, ask/check, beginner scaffolding, sources and exploration identity, scenarios A–H.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/phase2b.e2e.test.js
// ALL AI RESPONSES ARE MOCKED and every record is an isolated fixture (no real Notion, no real learner data).
// These tests show what the interface does with given content; they are NOT evidence that AI-generated teaching
// content is accurate (that was reviewed separately, by reading the fixtures and the prompts).
// Optional: SCREEN_DIR=<dir> saves screenshots.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..'),FX=path.join(__dirname,'fixtures/material');
const PORT=String(9600+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.SCREEN_DIR;
const shot=async(page,name,full=true)=>{if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:full})}};
const clone=x=>JSON.parse(JSON.stringify(x));
const rec=(id,lesson,stage,extra={})=>({id,topic:'SQL Injection',interest:'',level:'beginner',stage,maxStage:Math.max(stage,extra.maxStage??stage),lesson:clone(lesson),prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:1700000000000,updatedAt:1700000000000,complete:stage===5,...extra});
const reply=(text,extra={})=>({reply:text,followUp:'',assessment:null,uncertainty:'',...extra});

/* D — the real case, reconstructed: a PDF exploration saved by the previous version (topic = app placeholder). */
const FILE='01장_웹프로그래밍과_HTML5개요.pdf',WEB_TITLE='웹 입문: 서버가 보내고 브라우저가 보여 주는 과정과 HTML·CSS·JavaScript';
const WEB_MAT={name:FILE,kind:'pdf',pageCount:3,unreadable:[],omitted:[],at:1700000000000,pages:[
 {n:1,text:'1장 웹 프로그래밍과 HTML5 개요\n웹은 클라이언트와 서버로 이루어진다.'},
 {n:2,text:'웹 브라우저는 웹 서버에 페이지를 요청하고, 서버는 HTML 문서를 응답으로 보낸다.'},
 {n:3,text:'HTML은 문서의 구조를, CSS는 표현을, JavaScript는 동작을 담당한다.'}]};
const WEB={title:WEB_TITLE,hook:'주소창에 주소를 입력하면 화면이 나타나기까지 무슨 일이 일어날까요?',
 prerequisites:[{term:'서버',plain:'요청을 받아 웹페이지 같은 자료를 보내 주는 컴퓨터예요.',example:'학교 홈페이지를 보내 주는 학교의 컴퓨터'}],
 story:'수업 과제로 자기소개 페이지를 만든 민지는 친구 휴대폰에서도 같은 페이지가 보이는 게 신기했어요.',prediction:'친구가 주소를 입력했을 때 페이지는 어디에서 오는 걸까요?',
 scenarios:[{title:'요청과 응답',question:'브라우저가 페이지를 요청하면 서버는 무엇을 보낼까요?',options:['HTML 문서','완성된 화면 사진'],answerIndex:0,reason:'서버는 HTML 문서를 보내고, 화면은 브라우저가 그려요.'}],
 concepts:[{id:'k1',name:'웹 서버',description:'요청에 응답해 문서를 보내는 프로그램',sources:[{page:2,quote:'서버는 HTML 문서를 응답으로 보낸다'}]},
  {id:'k2',name:'웹 브라우저',description:'문서를 받아 화면에 그리는 프로그램',sources:[{page:2,quote:'웹 브라우저는 웹 서버에 페이지를 요청하고'}]},
  {id:'k3',name:'HTML·CSS·JavaScript',description:'구조·표현·동작을 나누어 맡는 언어',sources:[{page:3,quote:'HTML은 문서의 구조를, CSS는 표현을'}]}],
 connections:[{from:'k2',to:'k1',why:'요청과 응답'},{from:'k1',to:'k3',why:'보내는 문서의 내용'}],
 technical:[{heading:'요청과 응답',plain:'브라우저가 달라고 하면 서버가 문서를 보내요.',steps:['주소 입력','브라우저가 요청','서버가 HTML 응답','브라우저가 화면에 그림'],text:'브라우저는 HTTP 요청을 보내고 서버는 HTML 문서를 응답한다.',sources:[{page:2,quote:'서버는 HTML 문서를 응답으로 보낸다'}]},
  {heading:'세 언어의 역할',plain:'구조, 모양, 움직임을 나누어 맡아요.',text:'HTML은 구조, CSS는 표현, JavaScript는 동작을 담당한다.',
   visual:{type:'compare',title:'세 언어의 역할',columns:['HTML','CSS','JavaScript'],rows:[{aspect:'맡는 일',values:['구조','표현','동작']},{aspect:'예',values:['제목과 문단','글자 색','버튼 반응']}]},sources:[{page:3,quote:'HTML은 문서의 구조를, CSS는 표현을'}]},
  {heading:'캐시',text:'브라우저는 받은 자료를 저장해 두었다가 다시 쓸 수 있다.',sources:[]}],
 explainPrompt:'페이지를 열면 서버는 ___하고 브라우저는 ___한다. 이 과정을 정리해 보세요.',limitations:'자료 밖 일반 지식(캐시)은 AI가 보충했어요.'};
const webLegacy=(extra={})=>({id:'legacy-web-1',topic:'수업 자료: '+FILE,interest:'',level:'beginner',material:clone(WEB_MAT),lesson:clone(WEB),stage:5,maxStage:5,complete:true,prediction:'',predictionUnsure:true,
 scenarios:[{i:0,choice:0,at:1700000001000}],drafts:[{text:'브라우저가 요청하면 서버가 HTML을 보내고 브라우저가 화면을 그려요.',at:1700000002000,feedback:null}],
 dialogue:[{id:'d1',role:'learner',text:'HTML이랑 CSS 차이가 뭐예요?',intent:'ask',ref:null,stage:3,at:1700000003000,status:'answered'},{id:'d2',role:'tutor',replyTo:'d1',text:'HTML은 구조, CSS는 모양이에요.',followUp:'',assessment:null,uncertainty:'',withheld:0,reviewer:{provider:'chatgpt',model:'m',at:1700000003500},at:1700000003500}],
 events:[{at:'2026-11-20T01:00:00.000Z',what:'수업 자료로 시작: '+FILE},{at:'2026-11-20T01:05:00.000Z',what:'탐험 완료'}],createdAt:1700000000000,updatedAt:1700000004000,...extra});

/* C — calculus: a mathematically careful lesson; an unsupported "graph" visual from the model must not render. */
const CALC={title:'미분: 한 순간의 변화율',hook:'자동차 속도계는 “지금 이 순간”의 속도를 어떻게 알까요?',
 prerequisites:[{term:'변화율',plain:'한 양이 바뀔 때 다른 양이 얼마나 바뀌는지의 비율이에요.',example:'2시간에 100km를 가면 평균 시속 50km예요.'}],
 story:'자전거로 언덕을 내려오던 하준은 속도계 숫자가 계속 바뀌는 것을 보았어요.',prediction:'“지금 이 순간의 속도”는 어떻게 정할 수 있을까요?',
 scenarios:[{title:'구간을 줄이면',question:'시간 구간을 점점 짧게 잡으면 평균 속도는 어떻게 될까요?',options:['한 값에 가까워질 수 있다','항상 0이 된다'],answerIndex:0,hint:'구간이 0이 되는 것과 0에 가까워지는 것을 구별해 보세요.',reason:'구간을 0에 가깝게 할 때 평균 변화율이 한 값에 가까워지면 그 값이 순간 변화율이에요. 구간을 정확히 0으로 두면 나눗셈을 할 수 없어요.'}],
 concepts:[{id:'k1',name:'평균변화율',description:'구간 양 끝 함숫값의 차를 x의 차로 나눈 값'},{id:'k2',name:'극한',description:'어떤 값에 한없이 가까워질 때 다가가는 값'},{id:'k3',name:'미분계수',description:"f'(a) = lim h→0 (f(a+h) − f(a))/h, 극한이 존재할 때"}],
 connections:[{from:'k1',to:'k3',why:'극한을 취함'}],
 technical:[{heading:'미분계수의 정의',plain:'아주 짧은 구간에서의 평균변화율이 다가가는 값이에요.',text:"f'(a) = lim h→0 (f(a+h) − f(a))/h. 이 극한이 존재할 때만 a에서 미분가능하다.",
   visual:{type:'graph',title:'접선',points:[[0,0],[1,1]]},conditions:'모든 함수가 미분가능한 것은 아니에요. 예: |x|는 x=0에서 미분가능하지 않아요.'},
  {heading:'평균과 순간',plain:'평균은 구간 전체, 순간은 한 점에서의 변화율이에요.',text:'평균변화율은 구간에 대해, 미분계수는 한 점에 대해 정의된다.',
   visual:{type:'compare',title:'평균변화율과 미분계수',columns:['평균변화율','미분계수'],rows:[{aspect:'대상',values:['구간 [a, b]','한 점 a']},{aspect:'계산',values:['(f(b) − f(a))/(b − a)','h→0일 때의 극한']}]}}],
 explainPrompt:'평균변화율에서 미분계수로 넘어가는 과정을 이해한 만큼 설명해 볼까요?',explainTitle:'순간 변화율의 뜻을 정리해요',limitations:''};

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lessons,active,{ai=()=>reply('답'),viewport={width:1440,height:960},reducedMotion}={}){
 const ctx=await browser.newContext({viewport,reducedMotion});const calls=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 await ctx.route('**/api/notion/**',r=>r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}}));
 await ctx.route('**/api/ai',async r=>{const b=JSON.parse(r.request().postData());calls.push(b);return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:await ai(b,calls)}})});
 const page=await ctx.newPage();const errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));
 // accept() rejects if the page closes first; keep that from escaping as an unhandled rejection after a test ends
 page.on('dialog',d=>{dialogs.push(d.message());d.accept().catch(()=>{})});
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,calls,errors,dialogs};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const nav=(page,n)=>page.click(`.navitem:has-text("${n}.")`);
const noSideScroll=async(page,label)=>{const [w,v]=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(w<=v,`${label}: page ${w}px > viewport ${v}px`)};

test('A — complete beginner (SQL Injection): terms explained before they are needed, no prediction required',async()=>{
 const {ctx,page,calls,errors}=await open([rec('A',SQLI,1)],'A');
 // The stage label is stable and the heading is the exploration itself.
 assert.equal((await page.textContent('.stage-label')).trim(),'이야기');assert.equal(await page.textContent('#main h2'),SQLI.title);
 const pre=page.locator('#prereqs');assert.equal(await pre.getAttribute('open'),'','open for a beginner');
 const order=await page.evaluate(()=>{const all=[...document.querySelectorAll('#prereqs, .story, #prediction')];return all.map(e=>e.id||e.className)});
 assert.deepEqual(order,['prereqs','story','prediction'],'definitions come before the story and the prediction');
 const terms=await pre.locator('.tutor-term strong').allTextContents();assert.deepEqual(terms.slice(0,2).sort(),['SQL','쿼리'].sort(),'terms the story uses come first');
 for(const row of await pre.locator('.tutor-term').all()){assert.ok((await row.locator('p').first().textContent()).length>5);assert.match(await row.textContent(),/예:/,'one concrete example each')}
 assert.ok(await pre.locator('.term-more').first().isVisible(),'a deeper explanation is available on demand');
 await shot(page,'A-desktop-story');
 // Thought experiments: a term the question uses but the story never introduced is shown before the options.
 await page.click('text=예상 없이 둘러보기');await page.waitForSelector('.stage[data-stage="2"]');
 assert.equal((await stored(page)).lessons[0].predictionUnsure,true,'going on without a prediction is recorded honestly');
 const s2=page.locator('.concept',{hasText:'생각 실험 2'});const td=s2.locator('details.tutor-terms');
 assert.equal(await td.getAttribute('open'),'','“값 바인딩” is explained before the learner must choose');assert.match(await td.textContent(),/값 바인딩/);
 // Asking for more about a term: answered in place, nothing typed elsewhere is lost.
 await nav(page,2);await page.fill('#prediction','결과가 이상하게 나올 것 같아요');
 await page.locator('#prereqs .term-more').first().click();await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.equal(await page.inputValue('#prediction'),'결과가 이상하게 나올 것 같아요','the unsent prediction survives the question');
 const c=calls.at(-1);assert.equal(c.intent,'meaning');assert.equal(c.focus.kind,'term');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('B — memory distortion: an open question is answered, never graded; a doubtful premise is clarified, not labelled',async()=>{
 const l=clone(MEM);l.stage=3;l.maxStage=4;l.dialogue=[];
 const {ctx,page,calls,errors}=await open([l],l.id,{ai:b=>b.message.includes('녹화')
  ?reply('기억은 녹화처럼 그대로 저장되기보다, 떠올릴 때마다 다시 구성돼요. 그래서 “녹화라서 정확하다”는 전제는 맞지 않을 수 있어요.',{assessment:{verdict:'misconception',quote:'기억은 녹화라서 정확한 거죠',note:'전제'}})
  :reply('좋은 질문이에요. 질문의 표현 방식이 떠올리는 내용에 영향을 줄 수 있어요.',{assessment:{verdict:'imprecise',quote:'질문 방식이 기억을 바꾸나요',note:'n'}})});
 await page.click('#helpToggle');await page.waitForSelector('#tutorThread');
 assert.equal(await page.textContent('#tutorThread .tutor-send'),'질문하기');assert.equal(await page.textContent('#tutorThread .tutor-check'),'내 이해 확인받기');
 await page.fill('#tutorThread textarea','질문 방식이 기억을 바꾸나요?');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.equal(await page.locator('#tutorThread .tutor-assess').count(),0,'a question is answered, not graded');
 // Even sent for review, a question with a false premise is clarified in the reply and never called a misconception.
 await page.fill('#tutorThread textarea','기억은 녹화라서 정확한 거죠?');await page.click('#tutorThread .tutor-check');await page.waitForFunction(()=>document.querySelectorAll('#tutorThread .tutor-msg.ai').length===2);
 const txt=await page.textContent('#tutorThread');assert.equal(await page.locator('#tutorThread .tutor-assess').count(),0);
 for(const label of ['사실과 다른','오개념','misconception','assumption','utterance'])assert.ok(!txt.includes(label),label);
 const d=(await stored(page)).lessons[0].dialogue;assert.equal(d[1].assessment.verdict,'assumption');assert.equal(d[3].assessment.verdict,'assumption');assert.equal(d[3].assessment.adjustedFrom,'misconception','kept in the record');
 assert.deepEqual(calls.map(c=>c.intent),['ask','check']);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('C — calculus: precise text kept verbatim, comparison as a table, no invented graph, thought experiments not called real',async()=>{
 const {ctx,page,errors}=await open([rec('C',CALC,2,{topic:'미분이 뭐예요?',question:'미분이 뭐예요?',maxStage:4})],'C');
 assert.match(await page.textContent('.stage .sub'),/생각으로 해 보는 실험/);
 await nav(page,4);await page.waitForSelector('#keyConcepts');
 assert.equal(await page.locator('#main figure[data-visual=graph], #main .tech-section svg').count(),0,'an unsupported model “graph” never renders');
 assert.match(await page.textContent('.tech-section:nth-of-type(1) .tech-precise'),/f'\(a\) = lim h→0 \(f\(a\+h\) − f\(a\)\)\/h\. 이 극한이 존재할 때만/,'the definition with its condition, unchanged');
 const tb=page.locator('figure[data-visual=compare] table');assert.equal(await tb.locator('caption').textContent(),'평균변화율과 미분계수');assert.equal(await tb.locator('tbody th[scope=row]').count(),2);
 const st=(await stored(page)).lessons[0].lesson.technical[0];assert.equal(st.visual.type,'graph','the stored lesson is not rewritten; the display just refuses it');
 await nav(page,5);assert.equal(await page.textContent('#main h2'),'순간 변화율의 뜻을 정리해요','topic-specific heading from the lesson');assert.equal((await page.textContent('.stage-label')).trim(),'설명');
 assert.match(await page.textContent('#explainQuestion'),/이해한 만큼 설명해 볼까요/);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('D — PDF web fundamentals: meaningful title everywhere, file name and page citations kept, record never rewritten',async()=>{
 const legacy=webLegacy();const before=JSON.stringify(legacy);
 const {ctx,page,errors}=await open([legacy],legacy.id);
 // Constellation: the exploration star is named by the lesson title, not the file.
 await page.evaluate(()=>openAtlas(data.lessons[0]));await page.waitForSelector('#atlasSvg .atlas-topic-label');
 const star=await page.evaluate(()=>{const t=modelAtlas(data.lessons[0],'today').nodes.find(n=>n.topic);return {name:t.name,full:t.fullTitle}});assert.deepEqual(star,{name:'웹 입문',full:WEB_TITLE});
 const allName=await page.evaluate(()=>modelAtlas(data.lessons[0],'all').nodes.find(n=>!n.topic).lessonTopic);assert.equal(allName,'웹 입문');
 const label=await page.evaluate(()=>[...document.querySelectorAll('#atlasSvg .atlas-topic-label')].map(t=>t.textContent).join('|'));assert.ok(!label.includes('.pdf'),'no file name on the map: '+label);
 await shot(page,'D-desktop-constellation',false);
 await page.keyboard.press('Escape');await page.evaluate(()=>{const o=document.getElementById('atlasOverlay');if(o&&!o.hidden)document.getElementById('atlasClose').click()});
 // Learning UI: the title, with the file in the source details and page references next to the content.
 await nav(page,4);await page.waitForSelector('#keyConcepts');
 assert.equal(await page.textContent('#stageContext'),WEB_TITLE);
 assert.match(await page.textContent('#sources'),new RegExp('올린 파일\\('+FILE.replace(/[.]/g,'\\.')+'\\)'));
 assert.match(await page.textContent('#keyConcepts'),/웹 서버 — .*자료 p\.2/);
 assert.ok(await page.locator('.tech-section').first().locator('.material-chip',{hasText:'p.2'}).isVisible());
 assert.match(await page.textContent('.tech-section:nth-of-type(3)'),/AI가 덧붙인 설명/,'AI-added content is marked as such');
 assert.ok(await page.locator('#limitations').isVisible());
 await shot(page,'D-desktop-concepts');
 // Explanation stage: the old fill-in-the-blanks prompt is an optional guide, not the request.
 await nav(page,5);assert.equal(await page.locator('#explainQuestion').count(),0);assert.equal(await page.isVisible('.explain-template'),false);
 await page.click('#explainScaffold summary');assert.match(await page.textContent('.explain-template'),/서버는 ___하고/);
 // Note and Notion payload: title as the name, the file as the source, no invented first question.
 const md=await page.evaluate(()=>window.CuriNotes.lessonMarkdown(data.lessons[0]));
 assert.ok(md.startsWith('# '+WEB_TITLE.replace(/:/g,':')));assert.match(md,/처음 궁금했던 것:\*\* _질문 없이 수업 자료에서 시작했어요/);assert.ok(md.includes('01장\\_웹프로그래밍과\\_HTML5개요.pdf'));
 assert.equal(await page.evaluate(()=>notionMarkdown(data.lessons[0]).title),WEB_TITLE);
 const s=(await stored(page)).lessons[0];for(const k of ['id','topic','material','lesson','dialogue','drafts','events','createdAt'])assert.deepEqual(s[k],JSON.parse(before)[k],k);
 assert.ok(!('question' in s),'no question is invented for an old record');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('D — a new material exploration stores no question, shows the file before generation and the title after',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'curiven-2b-'));const f=path.join(tmp,FILE);fs.copyFileSync(path.join(FX,'math_lecture.pdf'),f);
 let release;const gate=new Promise(r=>{release=r});
 const {ctx,page,errors}=await open([],null,{ai:async b=>{if(b.mode==='lesson'){await gate;return clone(WEB)}return reply('답')}});
 await page.setInputFiles('#materialFile',f);await page.waitForSelector('#materialSummary',{timeout:60000});
 await page.click('#startExplore');await page.waitForSelector('#preparePanel');
 assert.equal(await page.textContent('.prepare-topic'),'수업 자료에서 시작하는 탐험');assert.match(await page.textContent('#preparePanel'),new RegExp('수업 자료: '+FILE.replace('.','\\.')));
 release();await page.waitForSelector('.stage[data-stage="1"]');
 assert.equal(await page.textContent('#main h2'),WEB_TITLE);
 const s=(await stored(page)).lessons[0];assert.equal(s.question,'');assert.equal(s.material.name,FILE);
 assert.equal(await page.evaluate(()=>CuriCopy.identity(data.lessons[0]).question),null);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('E — returning learner: old explorations, conversations and constellation links stay intact',async()=>{
 const mem=clone(MEM);mem.complete=true;mem.stage=5;mem.maxStage=5;const sq=rec('sq',SQLI,5,{complete:true});const web=webLegacy();
 const lessons=[mem,sq,web],before=clone(lessons);
 const {ctx,page,errors}=await open(lessons,null);
 for(const id of [mem.id,'sq',web.id]){await page.evaluate(i=>{data.active=i;persist();render()},id);for(const n of [2,3,4,5,6]){await nav(page,n);await page.waitForSelector(`.stage[data-stage="${n-1}"]`)}}
 const s=(await stored(page)).lessons;
 for(const [i,b] of before.entries()){for(const k of ['id','topic','lesson','dialogue','drafts','events','scenarios','prediction','createdAt','material'])assert.deepEqual(s[i][k],b[k],`${b.id}.${k}`);assert.ok(!('question' in s[i]))}
 const atlas=await page.evaluate(()=>{const m=modelAtlas(data.lessons[0],'all');return {topics:m.nodes.filter(n=>n.topic).map(n=>n.fullTitle),links:m.edges.filter(e=>e.kind!=='membership').length}});
 assert.deepEqual(atlas.topics.sort(),[MEM.lesson.title,SQLI.title,WEB_TITLE].sort());
 assert.ok(atlas.links>=MEM.lesson.connections.length+SQLI.connections.length+WEB.connections.length,'every saved connection is still drawn');
 // Condensed history: the record is complete, the panel shows a few lines and the rest on request.
 await page.evaluate(i=>{data.active=i;render()},mem.id);
 assert.ok(await page.locator('#journal li').count()<=5);if(mem.events.length>5){await page.click('#journalAll summary');assert.equal(await page.locator('#journalAll li').count(),mem.events.length)}
 assert.deepEqual(errors,[]);await ctx.close();
});

test('F — real dialogue: ask → answer → learner reply → review → correction → revised explanation, one context',async()=>{
 const D1='바인딩은 입력을 문자열로 바꿔서 SQL Injection을 막아요.',D2='값 바인딩은 쿼리 구조를 먼저 고정하고 입력은 값으로만 따로 전달해서, 입력이 명령으로 해석되지 않게 해요.';
 const {ctx,page,calls,errors}=await open([rec('F',SQLI,4,{maxStage:4})],'F',{ai:b=>{
  if(b.mode==='feedback')return {schema:2,summary:'핵심 방향은 맞아요.',correct:[],precision:[{quote:'입력을 문자열로 바꿔서',issue:'바인딩과 문자열 변환은 달라요',why:'바인딩은 값을 구조와 따로 전달해요.',question:'바인딩은 무엇을 따로 보낼까요?'}],misconceptions:[],missing:[],explained:[],uncertainty:''};
  if(b.intent==='ask')return reply('값 바인딩은 쿼리의 틀을 먼저 정해 두고, 입력은 그 틀의 빈자리에 값으로만 넣는 방식이에요.',{followUp:'그럼 입력에 따옴표가 있으면 어떻게 될까요?'});
  if(b.intent==='reply')return reply('맞아요, 따옴표도 값의 일부일 뿐이에요.',{assessment:{verdict:'correct',quote:'따옴표도 그냥 글자로 취급돼요',note:''}});
  if(b.intent==='check')return reply('“문자열로 바꿔서”는 정확하지 않아요. 바인딩은 형 변환이 아니라 구조와 값을 따로 전달하는 방식이에요. 다음으로, 설명에서 “무엇을 따로 전달하는지”를 한 문장으로 고쳐 보세요.',{assessment:{verdict:'misconception',quote:'입력을 문자열로 바꿔서',note:'형 변환과 구분'},followUp:'바인딩은 무엇과 무엇을 따로 보낼까요?'});
  return reply('답')}});
 await page.fill('#draft',D1);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('.fb-precision');
 await page.click('#helpToggle');await page.fill('#tutorThread textarea','값 바인딩이 정확히 뭐예요?');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-follow');
 await page.click('#tutorThread .tutor-answer');assert.match(await page.textContent('.tutor-replying'),/따옴표가 있으면/);
 assert.equal(await page.locator('#tutorThread .tutor-check').count(),0,'answering a tutor question is one clear action');
 await page.fill('#tutorThread textarea','따옴표도 그냥 글자로 취급돼요');await page.click('#tutorThread .tutor-send');await page.waitForFunction(()=>document.querySelectorAll('#tutorThread .tutor-msg.ai').length===2);
 await page.fill('#tutorThread textarea','결국 바인딩은 입력을 문자열로 바꿔서 막는 거예요.');await page.click('#tutorThread .tutor-check');await page.waitForFunction(()=>document.querySelectorAll('#tutorThread .tutor-msg.ai').length===3);
 assert.match(await page.textContent('#tutorThread .tutor-msg.ai:last-of-type .tutor-assess'),/AI 의견: 사실과 다른 부분이 있어요/);
 assert.match(await page.textContent('#tutorThread .tutor-msg.me:nth-last-of-type(2) .tutor-who'),/이해 확인 요청/);
 const tc=calls.filter(c=>c.mode==='tutor');assert.deepEqual(tc.map(c=>c.intent),['ask','reply','check']);assert.deepEqual(tc.map(c=>c.history.length),[0,2,4],'each turn carries the conversation so far');
 // The learner revises the explanation in the same place; the earlier one stays.
 await page.fill('#draft',D2);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('text=내 최신 설명 · 설명 2');
 const s=(await stored(page)).lessons[0];assert.deepEqual(s.drafts.map(d=>d.text),[D1,D2]);
 assert.deepEqual(s.dialogue.filter(m=>m.role==='learner').map(m=>[m.text,m.intent]),[['값 바인딩이 정확히 뭐예요?','ask'],['따옴표도 그냥 글자로 취급돼요','reply'],['결국 바인딩은 입력을 문자열로 바꿔서 막는 거예요.','check']],'exact words, exact attribution');
 const md=await page.evaluate(()=>window.CuriNotes.lessonMarkdown(data.lessons[0]));assert.match(md,/\*\*나\*\* \(이해 확인 요청\)/);assert.ok(md.includes('결국 바인딩은 입력을 문자열로 바꿔서 막는 거예요.'));
 await shot(page,'F-desktop-dialogue');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('G — mobile 390: no clipped controls, readable diagrams, reachable tutor input on every learning stage',async()=>{
 const l=webLegacy({stage:1});const {ctx,page,errors}=await open([l],l.id,{viewport:{width:390,height:844},reducedMotion:'reduce'});
 for(const n of [2,3,4,5,6]){await page.evaluate(s=>{data.lessons[0].stage=s;render()},n-1);await page.waitForSelector(`.stage[data-stage="${n-1}"]`);await noSideScroll(page,'stage '+n);
  if(SHOTS)await shot(page,`G-mobile-stage${n}`)}
 await page.evaluate(()=>{data.lessons[0].stage=3;render()});
 const fit=await page.evaluate(()=>{const w=document.querySelector('figure[data-visual=compare] .viz-scroll');return w.scrollWidth<=w.clientWidth+1});assert.ok(fit,'the comparison table fits');
 await page.click('#helpToggle');const box=page.locator('#tutorThread');await box.locator('textarea').scrollIntoViewIfNeeded();
 for(const sel of ['textarea','.tutor-send','.tutor-check']){const b=await box.locator(sel).boundingBox();assert.ok(b&&b.x>=0&&b.x+b.width<=390,`${sel} inside the screen`);if(sel!=='textarea')assert.ok(b.height>=44,`${sel} touch size`)}
 await noSideScroll(page,'tutor open');await shot(page,'G-mobile-tutor',false);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('H — Korean IME: Enter that confirms a Hangul composition never sends',async()=>{
 const {ctx,page,calls,errors,dialogs}=await open([rec('H',SQLI,3,{maxStage:4})],'H');
 const composingEnter=(sel,extra={})=>page.evaluate(([s,x])=>{const el=document.querySelector(s);el.focus();
  const a=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true,...x});el.dispatchEvent(a);
  const b=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...x});Object.defineProperty(b,'keyCode',{get:()=>229});el.dispatchEvent(b)},[sel,extra]);
 await page.click('#helpToggle');await page.fill('#tutorThread textarea','바인딩');
 await composingEnter('#tutorThread textarea',{ctrlKey:true});await composingEnter('#tutorThread textarea',{metaKey:true});
 await page.waitForTimeout(300);assert.equal(calls.length,0,'tutor: nothing sent while composing');assert.equal(await page.inputValue('#tutorThread textarea'),'바인딩');
 await page.click('#homeLogo');await page.waitForSelector('#home');await page.fill('#topic','블랙홀');await composingEnter('#topic');
 await page.waitForTimeout(300);assert.equal(calls.length,0,'home: no exploration created while composing');assert.equal((await stored(page)).lessons.length,1);
 await page.press('#topic','Enter');await page.waitForFunction(()=>document.getElementById('preparePanel'));assert.equal(calls.length,1,'a real Enter still starts');
 // The default AI mock answers with a tutor reply, not a lesson, so this generation fails and the app reports it
 // (toast() falls back to a native alert on this screen). Wait for that outcome before closing, so it cannot land
 // on a closing page (the cause of an intermittent unhandled rejection in full-suite runs).
 for(let i=0;i<50&&!dialogs.length;i++)await page.waitForTimeout(100);
 assert.deepEqual(dialogs,['자료를 불러오지 못했어요: 필수 학습 자료 항목이 없어요.']);
 assert.deepEqual(errors,[]);await ctx.close();
});
