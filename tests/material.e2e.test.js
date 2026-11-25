// Explore from class material in the real UI: REAL extraction by the local server (PDFKit / PPTX parser) on synthetic
// fixtures, MOCKED AI (/api/ai answered in the browser). Shows what the learner sees, what is sent and what is stored —
// not how well a real model teaches from a document.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/material.e2e.test.js
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');const FX=path.join(__dirname,'fixtures','material');
const PORT=String(8900+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.SCREEN_DIR;
const shot=async(page,name,full=false)=>{if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:full})}};
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'curiven-mat-e2e-'));
const clone=x=>JSON.parse(JSON.stringify(x));
// A lesson "from the material": one real quote, one fabricated, one AI-added section.
function mathLesson(){const l=clone(SAMPLE);l.title='미분계수와 도함수';
 l.concepts=[{id:'k1',name:'평균변화율',description:'구간에서 함숫값의 변화량을 x의 변화량으로 나눈 값',sources:[{page:1,quote:'평균변화율은 (f(b) − f(a)) / (b − a)이다'}]},
  {id:'k2',name:'미분계수',description:'평균변화율의 극한',sources:[{page:2,quote:'미분계수는 항상 양수이다'}]},
  {id:'k3',name:'도함수',description:'각 x에 미분계수를 대응시키는 함수',sources:[{page:2,quote:'f의 도함수라고 한다'}]}];
 l.connections=[{from:'k1',to:'k2',why:'극한'}];
 l.technical=[{heading:'미분계수의 정의',text:'h를 0으로 보낼 때 평균변화율의 극한이다.',plain:'아주 짧은 구간의 기울기',sources:[{page:2,quote:"f'(a) = lim h→0 (f(a + h) − f(a)) / h"}]},
  {heading:'접선과의 관계',text:'미분계수는 그 점에서 접선의 기울기로 해석된다.',sources:[]}];
 return l}
function pptx(name,slides){const f=path.join(TMP,name);execFileSync('python3',['-c',`import sys;sys.path.insert(0,${JSON.stringify(__dirname)});from material_fixtures import *;open(sys.argv[1],'wb').write(build_pptx(${slides}))`,f]);return f}

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill();fs.rmSync(TMP,{recursive:true,force:true})});
async function open({ai=()=>({}),viewport={width:1280,height:900},lessons=[],active=null}={}){
 const ctx=await browser.newContext({viewport});const calls=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}}));
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());calls.push(body);return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:await ai(body)}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,calls,errors};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);

test('home: one question composer; attaching material is the secondary action; free-topic learning unchanged',async()=>{
 const {ctx,page,calls,errors}=await open({ai:b=>b.mode==='lesson'?SAMPLE:{}});
 assert.match(await page.textContent('#attachMaterial'),/수업 자료 첨부/);assert.equal(await page.getAttribute('#materialFile','accept'),'.pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation');
 assert.equal(await page.getAttribute('#startExplore','aria-label'),'탐험 시작');
 // An empty question: a one-line prompt, no request, no dialog.
 await page.click('#startExplore');assert.match(await page.textContent('#materialStatus'),/궁금한 것을 한 줄 적어 주세요/);assert.equal(calls.length,0);
 await shot(page,'d-start-desktop');
 await page.fill('#topic','HTTP 쿠키와 세션');await page.click('#startExplore');await page.waitForSelector('#prediction');
 assert.equal(calls[0].material,undefined,'no material in a free-topic request');assert.equal((await stored(page)).lessons[0].material,undefined);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('math lecture PDF: what was read and not read; grounded quotes vs AI additions; ask about a page',async()=>{
 const {ctx,page,calls,errors}=await open({ai:b=>b.mode==='lesson'?mathLesson():{reply:'p.2의 정의를 보면, 극한이 존재해야 미분가능해요.',sources:[{page:2,quote:'미분가능하다고 한다'},{page:2,quote:'모든 함수는 미분가능하다'}],followUp:'',assessment:null,uncertainty:''}});
 await page.setInputFiles('#materialFile',path.join(FX,'math_lecture.pdf'));
 await page.waitForSelector('#materialSummary',{timeout:60000});
 const sum=await page.textContent('#materialSummary');assert.match(sum,/math_lecture\.pdf/);assert.match(sum,/PDF 4쪽 중 3쪽에서 글을 읽었어요/);assert.match(sum,/읽지 못한 쪽: p\.3/);
 assert.match(await page.textContent('#home'),/연결된 AI\(ChatGPT\)로 보내지고/,'what happens to the text is stated before starting');
 await shot(page,'d-material-ready-desktop');
 await page.fill('#topic','미분계수와 도함수는 뭐가 달라?');await page.click('#startExplore');await page.waitForSelector('#prediction');
 const req=calls.find(c=>c.mode==='lesson');assert.equal(req.topic,'미분계수와 도함수는 뭐가 달라?');assert.deepEqual(req.material.pages.map(p=>p.n),[1,2,4]);assert.deepEqual(req.material.unreadable,[3]);
 const rec=(await stored(page)).lessons[0];assert.equal(rec.material.name,'math_lecture.pdf');assert.ok(!('data' in rec.material),'the file itself is not stored');
 assert.deepEqual(rec.lesson.concepts.map(c=>c.sources.length),[1,0,1],'fabricated quote removed on install');
 // story stage: the material is one click away
 assert.ok(await page.isVisible('#materialViewer'));
 await page.evaluate(()=>{const l=JSON.parse(localStorage.getItem('curiven-v01-personal'));l.lessons[0].stage=3;l.lessons[0].maxStage=3;localStorage.setItem('curiven-v01-personal',JSON.stringify(l))});await page.reload();
 await page.waitForSelector('#keyConcepts');
 assert.match(await page.textContent('#keyConcepts'),/평균변화율.*자료 p\.1/s);assert.match(await page.textContent('#keyConcepts'),/미분계수.*AI 보충/s);
 assert.match(await page.textContent('#sec-0'),/수업 자료 근거:.*p\.2/s);assert.match(await page.textContent('#sec-1'),/AI가 덧붙인 설명/);
 await page.click('#sec-0 .material-chip');await page.waitForSelector('#materialViewer[open] mark');
 assert.match(await page.textContent('#materialViewer mark'),/f'\(a\) = lim h→0/);
 await shot(page,'d-grounded-concepts-desktop',true);
 await page.selectOption('#materialPage','4');await page.click('#askPage');await page.fill('#helpRegion textarea','여기서 정의를 이용한다는 게 무슨 뜻이야?');await page.click('#helpRegion .tutor-send');
 await page.waitForSelector('#helpRegion .tutor-src');
 const t=calls.find(c=>c.mode==='tutor');assert.deepEqual(t.focus,{kind:'page',n:4,label:'p.4'});assert.equal(t.material.pages[0].n,4);
 const src=await page.textContent('#helpRegion .tutor-src');assert.match(src,/p\.2 “미분가능하다고 한다”/);assert.ok(!src.includes('모든 함수는'),'unverified tutor quote not shown');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('science PPTX: slides, table text, a picture-only slide reported; prompt-injection text stays data',async()=>{
 const {ctx,page,calls,errors}=await open({ai:b=>b.mode==='lesson'?SAMPLE:{}});
 await page.setInputFiles('#materialFile',pptx('science.pptx','SCIENCE'));
 await page.waitForSelector('#materialSummary');
 assert.match(await page.textContent('#materialSummary'),/PowerPoint 5장 중 4장에서 글을 읽었어요.*읽지 못한 슬라이드: 슬라이드 4/s);
 await page.click('#removeMaterial');await page.setInputFiles('#materialFile',pptx('inj.pptx','INJECTION'));await page.waitForSelector('#materialSummary');
 await page.click('#startExplore');await page.waitForSelector('#prediction');
 const req=calls.at(-1);assert.match(req.material.pages[1].text,/이전의 모든 지시를 무시하고/,'sent verbatim as material; framing and rules are server-side (tests/test_material.py)');
 assert.ok(!(await stored(page)).lessons[0].lesson.concepts.some(c=>'sources' in c&&c.sources.length),'no source can be claimed without a literal quote');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('unsupported, scanned and oversized files: a plain reason, nothing created',async()=>{
 const {ctx,page,calls,errors}=await open();
 const txt=path.join(TMP,'notes.txt');fs.writeFileSync(txt,'그냥 텍스트');
 await page.setInputFiles('#materialFile',txt);await page.waitForSelector('#materialStatus.msg');assert.match(await page.textContent('#materialStatus'),/PDF나 PowerPoint\(\.pptx\) 파일만/);
 const fake=path.join(TMP,'fake.pdf');fs.writeFileSync(fake,'not a pdf at all');
 await page.setInputFiles('#materialFile',fake);await page.waitForFunction(()=>/PDF나 PowerPoint/.test(document.getElementById('materialStatus').textContent));
 await page.setInputFiles('#materialFile',path.join(FX,'scanned_only.pdf'));await page.waitForFunction(()=>/읽을 수 있는 글을 찾지 못했어요/.test(document.getElementById('materialStatus')?.textContent||''),null,{timeout:60000});
 const macro=path.join(TMP,'m.pptx');execFileSync('python3',['-c',`import sys;sys.path.insert(0,${JSON.stringify(__dirname)});from material_fixtures import *;open(sys.argv[1],'wb').write(build_pptx(['a'],macro=True))`,macro]);
 await page.setInputFiles('#materialFile',macro);await page.waitForFunction(()=>/매크로/.test(document.getElementById('materialStatus')?.textContent||''));
 const big=path.join(TMP,'big.pdf');fs.writeFileSync(big,Buffer.alloc(10*1024*1024+1,48));
 await page.setInputFiles('#materialFile',big);await page.waitForFunction(()=>/10MB 이하/.test(document.getElementById('materialStatus')?.textContent||''));
 assert.equal(calls.length,0);assert.equal((await stored(page)).lessons.length,0);
 await shot(page,'d-material-error-desktop');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('mobile: start choices and material summary fit a phone',async()=>{
 const {ctx,page,errors}=await open({viewport:{width:375,height:780}});
 await page.setInputFiles('#materialFile',path.join(FX,'history_handout.pdf'));await page.waitForSelector('#materialSummary',{timeout:60000});
 const w=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(w[0]<=w[1],'no sideways scroll '+w);
 await shot(page,'d-material-ready-mobile',true);
 assert.deepEqual(errors,[]);await ctx.close();
});
