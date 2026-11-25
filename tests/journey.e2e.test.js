// Learning-journey archive in the browser: “학습 과정 기록 다운로드 (.md)” opens a full preview, downloads only on
// request, and never touches the AI, Notion or the stored record.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/journey.e2e.test.js
// Isolated server (tests/isolation.js); /api/notion and /api/ai are mocked and every request is recorded.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {chromium}=require('playwright-core');
const J=require('../journey.js');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9800+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const fx=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',n),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:[],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.CURIVEN_SHOTS||null;

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});

async function open(lesson,{viewport={width:1440,height:960},notion=true,ready='#journeyDownload'}={}){
 const ctx=await browser.newContext({viewport,reducedMotion:'reduce',acceptDownloads:true,timezoneId:Intl.DateTimeFormat().resolvedOptions().timeZone});
 await ctx.addInitScript(`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons:[lesson],active:lesson.id}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-6.1-sol',models:[]}}));
 await ctx.route('**/api/ai',r=>r.fulfill({status:500,json:{ok:false,error:'no AI in this test'}}));
 await ctx.route('**/api/notion/**',r=>{const u=r.request().url();
  if(u.endsWith('/status'))return r.fulfill({json:notion?{ok:true,available:true,connected:true,page:{id:'p',title:'학습 노트',url:'https://www.notion.so/p'},autoSave:false}:{ok:true,available:true,connected:false,page:null,autoSave:false}});
  if(u.endsWith('/entry'))return r.fulfill({json:{ok:true,saved:null}});
  return r.fulfill({status:500,json:{ok:false,error:'unexpected Notion call in this test'}})});
 const page=await ctx.newPage();const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',q=>requests.push(q.method()+' '+new globalThis.URL(q.url()).pathname));
 await page.goto(URL);await page.waitForSelector(ready);await page.keyboard.press('Escape');
 return {ctx,page,errors,requests};
}
const stored=page=>page.evaluate(k=>localStorage.getItem(k),KEY);
async function shot(page,name){if(!SHOTS)return;fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:false})}

test('preview first, then download: the file is exactly the preview, and the same bytes as the Node module',async()=>{
 const {ctx,page,errors,requests}=await open(fx('sqli_time_blind_record.json'));
 assert.equal(await page.textContent('#journeyDownload'),'학습 과정 기록 다운로드');
 assert.ok(await page.isVisible('#notionSaveBtn'),'the Notion save stays its own action');
 const before=await stored(page),n0=requests.length;
 await page.click('#journeyDownload');await page.waitForSelector('#journeyDialog[open]');
 assert.equal(await page.textContent('#journeyTitle'),'학습 과정 기록 미리 보기');
 assert.match(await page.textContent('#journeyDialog .journey-note'),/AI와 나눈 대화 전체가 들어 있어요.*어디에도 올리거나 공유하지 않아요/);
 const preview=await page.textContent('#journeyPreview');
 const lesson=JSON.parse(before).lessons[0];assert.equal(preview,J.markdown(lesson),'browser and Node produce the same archive for the stored record');
 await shot(page,'journey-preview-1440');
 const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#journeyConfirm')]);
 assert.equal(dl.suggestedFilename(),J.fileName(lesson));assert.equal(fs.readFileSync(await dl.path(),'utf8'),preview,'downloaded = previewed');
 await page.click('#journeyDialog .settings-foot .btn.secondary');await page.waitForSelector('#journeyDialog',{state:'detached'});
 const during=requests.slice(n0);assert.deepEqual(during.filter(x=>/\/api\//.test(x)),[],'no API request while previewing or downloading: '+during.join(', '));
 assert.equal(await stored(page),before,'the stored record is byte-for-byte unchanged');
 assert.ok(await page.isVisible('#notionSaveBtn'));assert.deepEqual(errors,[]);await ctx.close();
});

test('a material-based exploration without Notion: still local, Esc closes',async()=>{
 const l=fx('calc_material_record.json');l.stage=5;l.maxStage=5;l.complete=true;
 const {ctx,page,errors,requests}=await open(l,{notion:false});
 const before=await stored(page),n0=requests.length;
 await page.click('#journeyDownload');await page.waitForSelector('#journeyDialog[open]');
 const preview=await page.textContent('#journeyPreview');
 assert.match(preview,/math\\_lecture\.pdf \(PDF, 4쪽; 읽지 못한 곳 p\.3\)/);assert.match(preview,/#3 미분가능하지 않은 함수도 있어요\?/);
 await page.keyboard.press('Escape');await page.waitForSelector('#journeyDialog',{state:'detached'});
 assert.deepEqual(requests.slice(n0).filter(x=>/\/api\//.test(x)),[]);assert.equal(await stored(page),before);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('completion screen without a Notion connection: the save and the one archive download; none in the sidebar',async()=>{
 const {ctx,page,errors}=await open(fx('sqli_time_blind_record.json'),{notion:false});
 await page.waitForSelector('#notionSaveBtn:not([disabled])');
 assert.deepEqual(await page.locator('#notionSave .actions button').allTextContents(),['Notion에 개념 노트 저장','학습 과정 기록 다운로드']);
 assert.equal(await page.locator('#exportNote, #noteDownload').count(),0);assert.ok(await page.isHidden('#exportJourney'),'one archive action at a time');assert.deepEqual(errors,[]);await ctx.close();
});

test('an exploration still in progress: the record card offers the archive; preview and download change nothing',async()=>{
 const l=fx('calc_material_record.json');assert.equal(l.complete,false);
 const {ctx,page,errors,requests}=await open(l,{notion:true,ready:'#exportJourney:not([hidden])'});
 assert.equal(await page.textContent('#exportJourney'),'학습 과정 기록 다운로드');assert.equal(await page.locator('#journeyDownload, #notionSave').count(),0,'no completion actions yet');
 const before=await stored(page),n0=requests.length;
 await page.click('#exportJourney');await page.waitForSelector('#journeyDialog[open]');
 const preview=await page.textContent('#journeyPreview');assert.equal(preview,J.markdown(JSON.parse(before).lessons[0]));assert.match(preview,/\*\*진행\*\*: 진행 중/);
 const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#journeyConfirm')]);assert.equal(fs.readFileSync(await dl.path(),'utf8'),preview);
 await page.keyboard.press('Escape');await page.waitForSelector('#journeyDialog',{state:'detached'});
 assert.deepEqual(requests.slice(n0).filter(x=>/\/api\//.test(x)),[],'no AI or Notion request');
 const after=await stored(page);assert.equal(after,before,'record byte-identical');const s=JSON.parse(after).lessons[0];assert.equal(s.complete,false);assert.equal(s.stage,l.stage);
 assert.ok(await page.isVisible('#exportJourney'),'still offered: downloading does not complete the exploration');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('a completed exploration revisited at an earlier stage: the record card offers it; back on the completion screen it does not',async()=>{
 const {ctx,page,errors}=await open(fx('sqli_time_blind_record.json'));
 assert.ok(await page.isHidden('#exportJourney'));
 await page.click('text=내 설명 다시 보기');await page.waitForSelector('#exportJourney:not([hidden])');assert.equal(await page.locator('#journeyDownload').count(),0);
 await page.click('.navitem:has-text("6.")');await page.waitForSelector('#journeyDownload');assert.ok(await page.isHidden('#exportJourney'));
 assert.deepEqual(errors,[]);await ctx.close();
});

test('phone width, in progress: the record-card action is reachable and its preview fits',async()=>{
 const {ctx,page,errors}=await open(fx('calc_material_record.json'),{viewport:{width:390,height:844},ready:'#exportJourney:not([hidden])'});
 const b=await page.locator('#exportJourney').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=390,'inside the screen');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no sideways page scroll');
 await page.locator('#exportJourney').scrollIntoViewIfNeeded();await shot(page,'journey-inprogress-card-390');
 await page.click('#exportJourney');await page.waitForSelector('#journeyDialog[open]');const box=await page.locator('#journeyDialog').boundingBox();assert.ok(box.width<=390&&box.x>=0);
 assert.ok(await page.locator('#journeyConfirm').isVisible());assert.deepEqual(errors,[]);await ctx.close();
});

test('phone width: the preview fits the screen and scrolls inside the dialog',async()=>{
 const {ctx,page,errors}=await open(fx('memory_session.json').record,{viewport:{width:390,height:844}});
 await page.click('#journeyDownload');await page.waitForSelector('#journeyDialog[open]');
 const box=await page.locator('#journeyDialog').boundingBox(),pre=await page.locator('#journeyPreview').evaluate(e=>({sh:e.scrollHeight,ch:e.clientHeight,sw:e.scrollWidth,cw:e.clientWidth}));
 assert.ok(box.width<=390&&box.x>=0,'dialog within the viewport');assert.ok(pre.sh>pre.ch,'long content scrolls inside the preview');assert.ok(pre.sw<=pre.cw+1,'no sideways scrolling: long lines wrap');
 assert.ok(await page.locator('#journeyConfirm').isVisible());await shot(page,'journey-preview-390');
 assert.deepEqual(errors,[]);await ctx.close();
});
