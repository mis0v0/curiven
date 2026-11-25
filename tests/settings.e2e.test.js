// Navigation & settings (phase A) and the everyday lesson-generation flow without developer controls (phase B).
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/settings.e2e.test.js
// ALL AI RESPONSES ARE MOCKED in the browser. Optional: SCREEN_DIR=<dir> saves screenshots.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');
const {openSettings}=require('./ui_helpers.js');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8700+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'지우',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.SCREEN_DIR;
const shot=async(page,name,full=true)=>{if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:full})}};
const clone=x=>JSON.parse(JSON.stringify(x));

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT,CURIVEN_DEV_TOOLS:''}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
/** lesson: (body) => {status, json} | data. `gate` lets a test hold the generation response. */
async function open(lessons,active,{lesson=()=>SAMPLE,viewport={width:1280,height:900},online=true}={}){
 const ctx=await browser.newContext({viewport,acceptDownloads:true});const calls=[],dialogs=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:online?{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}:{provider:'chatgpt',online:false,status:'signed_out'}}));
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());calls.push(body);
  const out=await lesson(body);if(out&&out.status)return r.fulfill(out).catch(()=>{});
  return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:out}}).catch(()=>{})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.accept()});
 await page.goto(URL);await page.waitForFunction(o=>new RegExp(o?'ChatGPT 연결':'연결 안 됨').test(document.querySelector('#status').textContent),online);
 return {ctx,page,calls,errors,dialogs};
}
const raw=page=>page.evaluate(k=>localStorage.getItem(k),KEY);
const isOpen=page=>page.evaluate(()=>document.getElementById('settings').open);
const noSideScroll=async page=>{const w=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth}));assert.ok(w.doc<=w.win,`no horizontal page scroll (${w.doc}>${w.win})`)};
function memAt(stage){const l=clone(MEM);l.stage=stage;l.maxStage=Math.max(l.maxStage||0,stage);delete l.draftInProgress;return l}

test('sidebar: journey, new exploration and one settings entry — no AI, export, backup or import controls',async()=>{
 const {ctx,page,errors}=await open([memAt(1)],'mem');
 const side=await page.locator('aside.side').innerText();
 assert.equal(await page.locator('aside.side nav#nav[aria-label="학습 단계"]').count(),1,'the journey (step list) is there');assert.doesNotMatch(side,/YOUR JOURNEY/,'Phase 2D-B: no decorative English label');assert.match(side,/새로운 탐험/);assert.equal((await page.textContent('#settingsBtn')).trim(),'설정','icon + “설정” only');
 for(const word of ["백업","불러오기","AI 연결","학습 노트","JSON","Notion"])assert.ok(!side.includes(word),`sidebar has no “${word}”`);
 assert.equal(await page.locator('aside.side button').count(),6+2,'six stages + new exploration + settings');
 assert.equal(await page.isVisible('#exportData'),false);assert.equal(await page.isVisible('#importData'),false);
 assert.equal(await page.getAttribute('#settingsBtn','aria-haspopup'),'dialog');
 await shot(page,'a-start-learning-desktop',false);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('settings: every tab reachable; unfinished learning input survives; Esc and the back button return to the lesson',async()=>{
 const l=memAt(1);l.prediction='';delete l.predictionUnsure;
 const {ctx,page,errors,dialogs}=await open([l],'mem');
 const before=await raw(page);
 await page.fill('#prediction','소리와 설명 카드가 기억에 섞일 것 같아요');
 await page.click('#settingsBtn');assert.ok(await isOpen(page));
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.settingsTab),'profile','focus moves into the dialog');
 for(const tab of ['ai','data','profile'])await openSettings(page,tab);
 assert.equal(await page.getAttribute('[data-settings-tab=profile]','aria-current'),'page');
 assert.equal(await page.inputValue('#nickname'),'지우','profile moved, not reset');
 await page.keyboard.press('Escape');assert.equal(await isOpen(page),false,'Esc closes');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'settingsBtn','focus returns to the entry');
 assert.equal(await page.inputValue('#prediction'),'소리와 설명 카드가 기억에 섞일 것 같아요','typed text kept');
 // Status polling or another re-render while settings are open must not drop it either.
 await openSettings(page,'ai');await page.evaluate(()=>status(true));await page.click('#settingsBack');
 assert.equal(await page.inputValue('#prediction'),'소리와 설명 카드가 기억에 섞일 것 같아요');
 assert.equal(await raw(page),before,'opening settings changed no learning record');
 // The header status opens the AI tab directly.
 await page.click('#status');await page.waitForSelector('#aiSettings');assert.match(await page.textContent('#aiState'),/연결됨/);
 // Unsaved profile edits are asked about, then kept or dropped as chosen.
 await openSettings(page,'profile');await page.fill('#nickname','새 이름');await page.click('#settingsClose');
 assert.match(dialogs.at(-1),/저장하지 않은 프로필 변경/);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('settings: an unsent explanation draft and tutor message survive opening settings',async()=>{
 const {ctx,page,errors}=await open([memAt(4)],'mem');
 await page.fill('#draft','기억은 녹화가 아니라 다시 만드는 과정이라서');await page.click('#helpToggle');await page.fill('#helpRegion textarea','왜 확신은 정확성과 다를까?');
 await openSettings(page,'data');await page.click('#settingsBack');
 assert.equal(await page.inputValue('#draft'),'기억은 녹화가 아니라 다시 만드는 과정이라서');
 assert.equal(await page.inputValue('#helpRegion textarea'),'왜 확신은 정확성과 다를까?');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('data tab: JSON backup is unchanged; the concept-note file is in the Notion dialog, no downloads in the history card',async()=>{
 const done=memAt(5);done.complete=true;
 const {ctx,page,errors}=await open([done],'mem');
 await openSettings(page,'data');await shot(page,'a-settings-data-desktop',false);
 const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#exportData')]);
 const backup=JSON.parse(fs.readFileSync(await dl.path(),'utf8'));
 assert.equal(backup.format,'curiven-v01');assert.equal(backup.lessons[0].drafts[0].text,MEM.drafts[0].text,'learner text verbatim');
 await page.click('#settingsBack');
 await page.waitForSelector('text=오늘의 발견을 돌아봐요');
 const atlasOpen=await page.evaluate(()=>!document.getElementById('atlasOverlay').hidden);if(atlasOpen)await page.click('#atlasClose');
 await page.click('#notionSaveBtn');await page.waitForSelector('#noteDialog[open]');
 const [md]=await Promise.all([page.waitForEvent('download'),page.click('#noteFileDownload')]);
 assert.match(md.suggestedFilename(),/\.md$/);await page.keyboard.press('Escape');
 assert.equal(await page.locator('#exportNote').count(),0);assert.ok(await page.isHidden('#exportJourney'),'on the completion screen the history card has no download: the completion actions have it');
 await shot(page,'a-completion-desktop',false);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('generation: topic, one status line, elapsed time, cancel, retry after failure — no prompt copy or JSON paste',async()=>{
 let release,fail=true;
 const {ctx,page,calls,errors}=await open([],null,{lesson:async b=>{if(b.mode!=='lesson')return {};await new Promise(z=>{release=z});
  if(fail)return {status:502,json:{ok:false,error:'AI 응답을 받지 못했어요.'}};return SAMPLE}});
 await page.fill('#topic','블랙홀은 왜 빛을 가둘까?');await page.click('#startExplore');
 await page.waitForSelector('#preparePanel');
 assert.equal(await page.textContent('.prepare-topic'),'블랙홀은 왜 빛을 가둘까?');
 assert.match(await page.textContent('#prepareStatus'),/만들고 있어요/);
 assert.doesNotMatch(await page.textContent('#preparePanel'),/다른 화면으로 이동해도 계속|프롬프트|JSON/);
 assert.match(await page.textContent('#preparePanel'),/새로고침하면 준비가 멈춰요/,'states what stops it');
 for(const s of ['#import-lesson','text=AI 생성 프롬프트 복사','#devTools'])assert.equal(await page.locator(s).count(),0,s);
 await page.waitForFunction(()=>document.getElementById('prepareElapsed')?.textContent!=='0:00',null,{timeout:4000});
 await shot(page,'b-generating-desktop',false);
 // failure → clear message + retry; no manual fallback appears
 release();await page.waitForSelector('#preparePanel >> text=다시 시도');
 assert.match(await page.textContent('#prepareStatus'),/AI 응답을 받지 못했어요/);assert.equal(await page.locator('#import-lesson').count(),0);
 await shot(page,'b-failed-desktop',false);
 fail=false;await page.click('#preparePanel >> text=다시 시도');await page.waitForSelector('text=준비 취소');
 // cancel → nothing installed; a late answer is ignored
 await page.click('text=준비 취소');await page.waitForSelector('#preparePanel >> text=탐험 만들기');release();await page.waitForTimeout(300);
 const s=JSON.parse(await raw(page));assert.equal(s.lessons[0].lesson,null,'cancelled result ignored');
 await page.click('#preparePanel >> text=탐험 만들기');release&&setTimeout(()=>release(),50);await page.waitForSelector('#prediction',{timeout:5000});
 assert.equal(calls.filter(c=>c.mode==='lesson').length,3);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('mobile: sidebar and settings fit a phone; the dialog fills the screen and scrolls inside',async()=>{
 const {ctx,page,errors}=await open([memAt(1)],'mem',{viewport:{width:375,height:740}});
 await noSideScroll(page);await shot(page,'a-start-learning-mobile',false);
 for(const tab of ['profile','ai','data']){await openSettings(page,tab);await noSideScroll(page);
  const r=await page.evaluate(()=>{const d=document.getElementById('settings').getBoundingClientRect();return {w:d.width,h:d.height}});
  assert.ok(r.w>=370&&r.h>=700,`full screen (${r.w}x${r.h})`);await shot(page,'a-settings-'+tab+'-mobile',false)}
 assert.ok(await page.isVisible('#settingsBack'),'the way back is visible');
 await page.click('#settingsBack');assert.equal(await isOpen(page),false);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('existing records: legacy and boundary-free lessons are byte-identical after using settings',async()=>{
 const legacy={id:'old-1',topic:'HTTP 쿠키와 세션',interest:'추리 소설',level:'some',stage:5,maxStage:5,lesson:SAMPLE,prediction:'x',scenarios:[],drafts:[{text:'예전 설명',at:1,feedback:null}],feedback:null,events:[{at:'2026-01-01T00:00:00Z',what:'탐험 완료'}],createdAt:1,updatedAt:1,complete:true};
 const {ctx,page,errors}=await open([legacy,memAt(3)],'mem');const before=await raw(page);
 for(const tab of ['profile','ai','data'])await openSettings(page,tab);await page.click('#settingsBack');
 assert.equal(await raw(page),before);
 assert.deepEqual(errors,[]);await ctx.close();
});
