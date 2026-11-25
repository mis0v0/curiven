// Phase 2C-R — quieter constellation: short titles everywhere on the map, rename, folded legend, spacing of action groups.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/phase2cr.e2e.test.js
// Isolated fixture records only; no AI, no Notion writes (Notion API is mocked as disconnected).
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9700+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:[],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const clone=x=>JSON.parse(JSON.stringify(x));
const FILE='01장_웹프로그래밍과_HTML5개요.pdf',WEB_TITLE='웹 입문: 서버가 보내고 브라우저가 보여 주는 과정과 HTML·CSS·JavaScript';
const web=(id='web')=>({id,topic:'수업 자료: '+FILE,stage:5,maxStage:5,complete:true,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:2,updatedAt:2,
 material:{name:FILE,kind:'pdf',pageCount:1,pages:[{n:1,text:'x'}],unreadable:[]},
 lesson:{title:WEB_TITLE,hook:'h',story:'s',prediction:'p',explainPrompt:'e',scenarios:[],technical:[],concepts:[{id:'k1',name:'웹 서버',description:'요청에 응답'},{id:'k2',name:'웹 브라우저',description:'화면에 그림'},{id:'k3',name:'HTML',description:'구조'}],connections:[{from:'k2',to:'k1',why:'요청과 응답'}]}});
const mem=()=>{const l=clone(MEM);l.complete=true;l.stage=5;l.maxStage=5;l.feedback=l.drafts[0].feedback={...l.drafts[0].feedback,explained:[{id:'k4',quote:'소리의 출처를 혼동할 수 있어요'}]};return l};
const sq=()=>({id:'sq',topic:'SQL Injection',stage:5,maxStage:5,complete:true,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:3,updatedAt:3,lesson:{...clone(SQLI),shortTitle:'SQL 인젝션'}});
const calc=()=>({id:'calc',topic:'미분이 뭐야?',question:'미분이 뭐야?',stage:5,maxStage:5,complete:true,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:4,updatedAt:4,
 lesson:{title:'미분: 한 순간의 변화율',shortTitle:'미분의 원리',hook:'h',story:'s',prediction:'p',explainPrompt:'e',scenarios:[],technical:[],concepts:[{id:'k1',name:'변화율',description:'d'},{id:'k2',name:'접선',description:'d'}],connections:[]}});

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lessons,active,{viewport={width:1440,height:960}}={}){
 const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});
 await ctx.addInitScript(`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 const notion=[];await ctx.route('**/api/notion/**',r=>{if(r.request().method()!=='GET')notion.push(r.request().url());r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,errors,notion};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const atlasAll=async page=>{await page.evaluate(()=>openAtlas(data.lessons[0]));await page.waitForSelector('#atlasOverlay:not([hidden])');await page.click('[data-atlas-mode=all]')};
const topicLabels=page=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#atlasSvg .atlas-topic')].map(g=>[g.dataset.id.split(':')[0],g.querySelector('.atlas-topic-label').textContent])));

test('short titles: atlas, overview, jump list and small map use the same short name; the file name never heads anything',async()=>{
 const {ctx,page,errors}=await open([mem(),web(),sq(),calc()],'web');
 assert.equal(await page.textContent('#map .mini-title'),'웹 입문','small map');
 await atlasAll(page);
 assert.deepEqual(await topicLabels(page),{[MEM.id]:'기억의 왜곡',web:'웹 입문',sq:'SQL 인젝션',calc:'미분의 원리'});
 const opts=await page.$$eval('#atlasJump option',o=>o.map(x=>[x.textContent,x.title]));
 assert.deepEqual(opts.map(o=>o[0]),['기억의 왜곡','웹 입문','SQL 인젝션','미분의 원리']);assert.equal(opts[1][1],WEB_TITLE,'full title on hover');
 const svgText=await page.textContent('#atlasSvg');assert.ok(!svgText.includes('.pdf')&&!svgText.includes('01장'));
 assert.deepEqual(errors,[]);await ctx.close();
});

test('duplicate topics: separate stars, numbered for display only; records untouched',async()=>{
 const a=web('w1'),b=web('w2');b.createdAt=9;const before=JSON.stringify([a,b]);
 const {ctx,page,errors}=await open([a,b],'w1');await atlasAll(page);
 assert.deepEqual(await topicLabels(page),{w1:'웹 입문',w2:'웹 입문 (2)'});
 assert.equal(JSON.stringify((await stored(page)).lessons),before);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('full title, question and source file: one tap away in 탐험 정보, and exposed to assistive tech',async()=>{
 const {ctx,page,errors}=await open([calc(),web()],'calc');await page.evaluate(()=>openAtlas(data.lessons[0]));
 assert.equal(await page.textContent('#atlasInfoTitle'),'미분의 원리');
 assert.equal(await page.isVisible('.atlas-about .atlas-full-title'),false,'folded by default');
 await page.click('.atlas-about summary');
 assert.equal(await page.textContent('.atlas-about .atlas-full-title'),'미분: 한 순간의 변화율');assert.equal(await page.textContent('.atlas-about .atlas-question'),'미분이 뭐야?');
 assert.equal(await page.getAttribute('#atlasSvg [data-id="calc:topic"]','aria-description'),'미분: 한 순간의 변화율');
 assert.equal(await page.getAttribute('#atlasSvg [data-id="calc:topic"]','aria-label'),'미분의 원리: 탐험');
 await page.click('[data-atlas-mode=all]');await page.click('#atlasSvg [data-id="web:topic"]');await page.click('.atlas-about summary');
 assert.equal(await page.textContent('.atlas-about .atlas-file'),FILE,'original file name kept as source metadata');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('rename: explicit save only, wins over the AI title, persists across reloads; Notion title and record data untouched',async()=>{
 const lessons=[web(),calc()],before=clone(lessons);const {ctx,page,errors,notion}=await open(lessons,'web');
 await page.evaluate(()=>openAtlas(data.lessons[0]));await page.click('#atlasRename');
 await page.fill('#atlasRenameInput','HTML 첫걸음');await page.click('.atlas-rename-cancel');
 assert.equal(await page.textContent('#atlasInfoTitle'),'웹 입문','cancel keeps the old name');assert.ok(!('displayTitle' in (await stored(page)).lessons[0]));
 await page.click('#atlasRename');await page.fill('#atlasRenameInput','x'.repeat(19)+'yz');assert.equal(await page.inputValue('#atlasRenameInput'),'x'.repeat(19)+'y','input limited to 20');
 await page.fill('#atlasRenameInput','  ');await page.keyboard.press('Escape');assert.equal(await page.isVisible('#atlasOverlay'),true,'Escape cancels the rename, not the atlas');
 await page.click('#atlasRename');await page.fill('#atlasRenameInput','HTML 첫걸음');await page.keyboard.press('Enter');
 assert.equal(await page.textContent('#atlasInfoTitle'),'HTML 첫걸음');assert.equal(await page.textContent('#atlasSvg [data-id="web:topic"] .atlas-topic-label'),'HTML 첫걸음');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'atlasRename','focus returns to the control');
 await page.click('#atlasClose');await page.reload();await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 assert.equal(await page.textContent('#map .mini-title'),'HTML 첫걸음','small map after reload');
 const s=(await stored(page)).lessons[0];assert.equal(s.displayTitle,'HTML 첫걸음');
 for(const k of Object.keys(before[0]))assert.deepEqual(s[k],before[0][k],k);
 assert.equal(await page.evaluate(()=>notionMarkdown(data.lessons[0]).title),WEB_TITLE,'Notion page title is the lesson title, not the rename');
 // Reset to the generated name.
 await page.evaluate(()=>openAtlas(data.lessons[0]));await page.click('#atlasRename');await page.click('.atlas-rename-reset');
 assert.equal(await page.textContent('#atlasInfoTitle'),'웹 입문');assert.ok(!('displayTitle' in (await stored(page)).lessons[0]));
 assert.deepEqual(notion,[],'no Notion writes');assert.deepEqual(errors,[]);await ctx.close();
});

test('quiet atlas: one heading, no intro copy, no replay button; legend and the mastery note live in 표시 안내',async()=>{
 const {ctx,page,errors}=await open([mem(),web()],MEM.id);await page.evaluate(()=>openAtlas(data.lessons[0]));
 assert.equal((await page.textContent('.atlas-header')).replace('×','').trim(),'나의 우주');
 const text=await page.textContent('.atlas-window');
 for(const w of ['Your knowledge universe','YOUR KNOWLEDGE UNIVERSE','오늘의 발견이 별이 되었어요','작은 질문들이 이어져','선택한 탐험','이 탐험에서 만난 개념 ','다시 펼치기','전체 보기'])assert.ok(!text.includes(w),w);
 assert.equal(await page.locator('#atlasReplay').count(),0);
 assert.equal(await page.isVisible('.atlas-note'),false);await page.click('#atlasGuide summary');
 assert.match(await page.textContent('.atlas-note'),/숙달을 판정하지 않아요/);assert.match(await page.getAttribute('#atlasSvg','aria-label'),/숙달을 판정하지 않아요/);
 // Evidence wording for concepts is unchanged.
 await page.locator(`#atlasSvg [data-id="${MEM.id}:k4"]`).click();const info=await page.textContent('#atlasInfo');
 assert.match(info,/◉ AI가 내 설명과 연결한 개념/);assert.match(info,/이해를 확인한 시험 결과는 아니에요/);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('completion screen: no repeated counts or decorative copy; the card names the exploration by its short title',async()=>{
 const {ctx,page,errors}=await open([calc()],'calc');const main=await page.textContent('#main');
 for(const w of ['새로 탐험한 주제','A LITTLE UNIVERSE','별자리가 되었어요','펼쳐보기'])assert.ok(!main.includes(w),w);
 assert.equal(await page.textContent('.constellation-teaser h3'),'미분의 원리');assert.match(main,/이해를 다 끝냈다는 판정은 아니에요/,'accuracy note kept');
 await page.click('.atlas-launch');await page.waitForSelector('#atlasOverlay:not([hidden])');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('action groups: 12–16px between buttons on desktop; stacked full-width with the same gap on a phone; 44px targets',async()=>{
 const l=web();l.stage=0;
 for(const vp of [{width:1440,height:900},{width:390,height:844}]){
  const {ctx,page,errors}=await open([l],'web',{viewport:vp});await page.waitForSelector('.resume-actions');
  const g=await page.evaluate(()=>[...document.querySelectorAll('#main .actions')].filter(a=>a.offsetParent&&a.querySelectorAll(':scope>.btn').length>1).map(a=>{const b=[...a.querySelectorAll(':scope>.btn')].map(x=>x.getBoundingClientRect());
   return {cls:a.className,h:b[1].left>=b[0].right-1?b[1].left-b[0].right:null,v:b[1].top>=b[0].bottom-1?b[1].top-b[0].bottom:null,min:Math.min(...b.map(r=>r.height)),w:b.map(r=>Math.round(r.width)),aw:Math.round(a.getBoundingClientRect().width)}}));
  const r=g.find(x=>x.cls.includes('resume-actions'));assert.ok(r,'resume buttons share one action group');
  for(const x of g){assert.ok(x.min>=44,`${vp.width} ${x.cls}: target ${x.min}`);
   if(vp.width>560){assert.ok(x.h>=12&&x.h<=16,`${vp.width} ${x.cls}: horizontal gap ${x.h}`)}
   else{assert.ok(x.v>=12&&x.v<=16,`${vp.width} ${x.cls}: vertical gap ${x.v}`);assert.ok(x.w.every(w=>w>=x.aw-1),'full width when stacked')}}
  console.log(vp.width,JSON.stringify(g));
  assert.deepEqual(errors,[]);await ctx.close()}
});
