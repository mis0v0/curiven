// Notion settings and saving from the completion screen, in the real UI with /api/notion/* MOCKED in the browser.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/notion.e2e.test.js
// No request reaches Notion. Server-side behaviour (Keychain, page mapping, duplicates) is tested in tests/test_notion.py.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');
const {openSettings}=require('./ui_helpers.js');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8800+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'지우',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const TOKEN='ntn_'+'A1b2C3d4'.repeat(6);
const PAGE={id:'1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9',title:'CURIVEN 노트',url:'https://www.notion.so/1a2b3c4d5e6f40718293a4b5c6d7e8f9'};
const SHOTS=process.env.SCREEN_DIR;
const shot=async(page,name,full=false)=>{if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:full})}};
const clone=x=>JSON.parse(JSON.stringify(x));

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lessons,active,notion){
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});const posts=[],dialogs=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}}));
 await ctx.route('**/api/notion/status',r=>r.fulfill({json:{ok:true,...notion.state}}));
 await ctx.route('**/api/notion/*',async r=>{const action=r.request().url().split('/').pop();if(action==='status')return r.fallback();const body=JSON.parse(r.request().postData()||'{}');posts.push({action,body});
  const out=await notion.handle(action,body);return r.fulfill(out.status?out:{json:{ok:true,...out}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.accept()});
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,posts,errors,dialogs};
}
/** Mirrors notion_link.save() since 2026-11-24: CURIVEN publishes, it does not sync. 'update' (also auto-save) makes only
    the FIRST page; with a page saved it is refused (update_disabled), after an unresolved create too (unconfirmed);
    'new' needs confirm once a page exists or a create is unresolved; 'overwrite' is refused. */
const MSG={archived:'이 노트의 Notion 페이지가 휴지통에 있어요. 새 페이지는 만들지 않았어요.',unavailable:'이 노트의 Notion 페이지를 열 수 없어요. 삭제됐거나 접근 권한이 없을 수 있어요. 새 페이지는 만들지 않았어요.',
 unconfirmed:'Notion에 페이지가 만들어졌는지 확인하지 못했어요. 만들어졌을 수 있어서 다시 만들지 않았어요. 저장 위치를 Notion에서 확인한 뒤, 필요하면 ‘새 페이지로 저장’을 고를 수 있어요.',
 update_disabled:'이미 저장한 Notion 페이지는 CURIVEN이 바꾸지 않아요. Notion에서 고친 내용을 지킬 안전한 방법이 아직 없어서 업데이트를 꺼 두었어요. 원래 페이지는 그대로예요. 필요하면 새 페이지로 저장할 수 있어요.'};
const refuse=(status,code)=>({status,json:{ok:false,code,error:MSG[code]||code}});
function fakeNotion({connected=false,autoSave=false,saved=null}={}){const n={state:{available:true,connected,page:connected?PAGE:null,autoSave},saved,pending:false,failNext:0,unconfirmedNext:0,trash:false,unavailable:false,pages:0,
 async handle(action,body){
  if(action==='connect'){if(body.token!==TOKEN)return {status:401,json:{ok:false,error:'Notion 토큰이 올바르지 않거나 취소됐어요.'}};n.state={...n.state,connected:true,page:PAGE};return n.state}
  if(action==='auto'){n.state={...n.state,autoSave:!!body.autoSave};return n.state}
  if(action==='test')return {...n.state,checkedAt:'2026-11-22T12:00:00+00:00'};
  if(action==='disconnect'){n.state={available:true,connected:false,page:null,autoSave:false};return n.state}
  if(action==='entry')return {saved:n.pending?{unconfirmed:true,at:'2026-11-24T00:00:00+00:00'}:n.saved};
  if(action==='reconnect'){if(n.trash)return {status:409,json:{ok:false,code:'archived',error:'Notion 휴지통에 아직 있어요. Notion에서 복원한 뒤 다시 연결해 주세요.'}};if(n.unavailable)return refuse(409,'unavailable');
   const {archived,archivedAt,...rest}=n.saved;n.saved=rest;return {saved:n.saved}}
  if(action==='check'){if(n.checkGate)await n.checkGate.shift();if(n.trash){n.saved={...n.saved,archived:true,archivedAt:'2026-11-24T00:00:00+00:00'};return refuse(409,'archived')}
   if(n.unavailable)return refuse(409,'unavailable');
   if(n.checkError)return {status:503,json:{ok:false,code:'network',error:'Notion에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'}};
   return {remote:{checkedAt:'2026-11-24T12:00:00+00:00',...n.remote}}}
  if(action!=='save')return {status:404,json:{ok:false}};
  const mode=body.mode||'update';
  if(mode==='overwrite')return {status:409,json:{ok:false,code:'overwrite_disabled',error:'Notion에서 바뀐 페이지를 덮어쓰는 기능은 꺼 두었어요.'}};
  if(mode==='new'){if((n.saved||n.pending)&&body.confirm!==true)return {status:400,json:{ok:false,code:'confirm_required',error:'새 페이지로 저장하려면 확인이 필요해요.'}}}
  else{if(n.pending)return refuse(409,'unconfirmed');
   if(n.saved)return n.saved.archived?refuse(409,'archived'):refuse(409,'update_disabled')}
  if(n.failNext){n.failNext--;return {status:400,json:{ok:false,code:'validation_error',error:'Notion이 노트를 받아들이지 않았어요: bad'}}}
  if(n.unconfirmedNext){n.unconfirmedNext--;n.pending=true;return refuse(503,'unconfirmed')}
  n.pages++;n.pending=false;n.saved={url:`https://www.notion.so/0000000000004000800000000000000${n.pages}`,savedAt:'2026-11-22T12:00:00+00:00',contentKey:body.contentKey};
  return {...n.saved,action:mode==='new'?'new':'created'}}};return n}
function done(){const l=clone(MEM);l.stage=5;l.maxStage=5;l.complete=true;return l}
const raw=page=>page.evaluate(k=>localStorage.getItem(k),KEY);
/** The save dialog: open it from the completion screen's Notion button. */
async function noteDialog(page){await page.click('#notionSaveBtn');await page.waitForSelector('#noteDialog[open]')}
async function confirmSave(page){await noteDialog(page);await page.click('#noteConfirm')}
const ACTIONS='#notionSave .actions button, #notionSave .actions a';
const saves=posts=>posts.filter(p=>p.action==='save');
const lineHas=(page,re)=>page.waitForFunction(s=>new RegExp(s).test(document.getElementById('notionLine')?.textContent||''),re.source);
async function closeAtlas(page){await page.waitForSelector('text=오늘의 발견을 돌아봐요');if(await page.evaluate(()=>!document.getElementById('atlasOverlay').hidden))await page.click('#atlasClose')}
const SAVED=()=>({url:'https://www.notion.so/saved',savedAt:'2026-11-22T12:00:00+00:00',contentKey:'pending'});

test('settings → Notion: guided connect; the token is a password field, sent once, never stored in the browser',async()=>{
 const n=fakeNotion();const {ctx,page,posts,errors}=await open([done()],'mem',n);
 await openSettings(page,'notion');
 assert.match(await page.textContent('#notionSettings'),/연결하고 저장하기 전에는 아무것도 보내지 않아요/);
 assert.match(await page.textContent('.notion-steps'),/콘텐츠 읽기·업데이트·삽입/);assert.match(await page.textContent('.notion-steps'),/연결 추가/);
 assert.equal(await page.getAttribute('#notionToken','type'),'password');
 await shot(page,'c-notion-connect-desktop');
 await page.fill('#notionToken','ntn_wrong_wrong_wrong_wrong');await page.fill('#notionPage',PAGE.url);await page.click('text=연결 확인하고 저장');
 await page.waitForSelector('#notionStatus.msg');assert.match(await page.textContent('#notionStatus'),/토큰이 올바르지 않거나/);
 await page.fill('#notionToken',TOKEN);await page.click('text=연결 확인하고 저장');await page.waitForSelector('#notionState');
 assert.match(await page.textContent('#notionState'),/CURIVEN 노트/);assert.equal(await page.locator('#notionToken').count(),0);
 await shot(page,'c-notion-connected-desktop');
 const everything=await page.evaluate(()=>JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage})+document.documentElement.outerHTML);
 assert.ok(!everything.includes(TOKEN),'token not in storage or DOM');
 assert.equal(posts.filter(p=>JSON.stringify(p.body).includes(TOKEN)).length,1,'token sent only in the connect request');
 await page.check('#notionAuto');await page.waitForFunction(()=>/자동으로 저장해요/.test(document.getElementById('notionStatus')?.textContent||''));
 assert.deepEqual(posts.at(-1),{action:'auto',body:{autoSave:true}});
 assert.equal(posts.filter(p=>p.action==='save').length,0,'connecting sends no learning data');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('completion: first save through the dialog; afterwards view, a NEW page, download — nothing offers to update',async()=>{
 const n=fakeNotion({connected:true});const {ctx,page,posts,dialogs,errors}=await open([done()],'mem',n);await closeAtlas(page);
 const before=await raw(page);
 await page.waitForSelector('#notionSaveBtn:not([disabled])');assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['Notion에 개념 노트 저장','학습 과정 기록 다운로드']);
 assert.equal(await page.locator('#main >> text=학습 노트 저장').count(),0,'no ambiguous “save” label');assert.equal(await page.locator('#noteDownload, #conceptMake').count(),0,'no second download, no note making on the screen');
 assert.equal(await page.locator('.right .card button.small-action:visible').count(),1,'on the completion screen the sidebar keeps only “크게 보기”');
 await shot(page,'d-completion-unsaved-desktop',true);
 await noteDialog(page);assert.equal(await page.textContent('#noteDialogTitle'),'Notion에 개념 노트 저장');
 assert.match(await page.textContent('#noteDialogIntro'),/새 페이지로 저장돼요/);assert.ok(await page.isVisible('#noteDialog .cn-preview'),'what will be saved can be previewed');
 assert.ok(await page.isVisible('#conceptMake'),'note making lives in the dialog');assert.ok(await page.isVisible('#noteFileDownload'));assert.equal(await page.locator('#noteCheckRemote').count(),0,'nothing to check before a page exists');
 assert.deepEqual(await page.$$eval('#noteDialog button.btn:not(.secondary):not(.minor)',b=>b.map(x=>x.textContent)),['Notion에 저장'],'one primary action in the dialog');
 await shot(page,'d-save-dialog-desktop');
 await page.click('#noteDialog .settings-foot .btn.secondary');await page.waitForSelector('#noteDialog',{state:'detached'});assert.equal(saves(posts).length,0,'cancel sends nothing');
 await confirmSave(page);await page.waitForSelector('#notionOpen');
 assert.match(await page.textContent('#notionLine'),/Notion에 저장됨/);assert.equal(await page.getAttribute('#notionOpen','target'),'_blank');
 const s=saves(posts)[0].body;
 assert.equal(s.explorationId,'mem');assert.equal(s.title,MEM.lesson.title);assert.equal(s.mode,'update','the first save: the default mode, which only ever creates the first page');
 assert.ok(s.markdown.includes(window_esc(MEM.drafts[0].text.split('\n')[0].slice(0,20))),'learner explanation present');
 assert.ok(!/^# /m.test(s.markdown),'no duplicate H1 — the page title is the title');
 const order=['처음 궁금했던 것','AI 종합 없이','## 핵심 개념','## 출처와 신뢰도','<toggle>\n학습 기록','### 처음 생각','### 사고 실험에서 발견한 것','### 내 설명과 생각의 변화','### 내가 던진 질문','### 다시 볼 점과 남은 질문','### 원래 기록','</toggle>'].map(h=>h==='</toggle>'?s.markdown.lastIndexOf(h):s.markdown.indexOf(h));
 assert.ok(order.every(i=>i>=0)&&order.every((v,i)=>!i||v>order[i-1]),'concept note, then history: '+order);
 assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['Notion에서 보기 ↗','새 페이지로 저장','학습 과정 기록 다운로드']);
 await lineHas(page,/바뀐 내용 없음/);assert.match(await page.textContent('#notionLine'),/저장한 뒤 CURIVEN에서 바뀐 내용 없음$/);
 await noteDialog(page);assert.equal(await page.textContent('#noteDialogTitle'),'새 Notion 페이지로 저장');
 assert.match(await page.textContent('#noteDialogIntro'),/이미 저장한 Notion 페이지는 CURIVEN이 바꾸지 않아요.*업데이트는 꺼 두었어요.*새 페이지가 하나 더 생기고, 원래 페이지는 그대로 남아요/);
 await page.waitForSelector('#noteUnchanged:not([hidden])');assert.match(await page.textContent('#noteUnchanged'),/같은 내용의 페이지가 하나 더 생겨요/);
 assert.equal(await page.textContent('#noteConfirm'),'새 페이지로 저장');assert.ok(await page.isEnabled('#noteConfirm'),'the learner may still keep a copy');
 await shot(page,'d-new-page-dialog-desktop');
 await page.keyboard.press('Escape');await page.waitForSelector('#noteDialog',{state:'detached'});assert.equal(saves(posts).length,1,'closing sends nothing');
 await confirmSave(page);await lineHas(page,/저장됨/);await page.waitForSelector('#notionOpen');
 assert.deepEqual(saves(posts).map(p=>[p.body.mode,p.body.confirm]),[['update',undefined],['new',true]],'the dialog’s confirm is the explicit choice of a new page');
 assert.equal(await raw(page),before,'saving to Notion never changes the learning record');assert.deepEqual(dialogs,[]);
 await shot(page,'d-completion-saved-desktop',true);assert.deepEqual(errors,[]);await ctx.close();
});
function window_esc(s){return s.replace(/[\\`*_{}\[\]()#+\-.!|<>~]/g,m=>'\\'+m)}

test('a refused first save says so, keeps the record, and can be retried',async()=>{
 const n=fakeNotion({connected:true});n.failNext=1;const {ctx,page,errors}=await open([done()],'mem',n);await closeAtlas(page);
 const before=await raw(page);
 await confirmSave(page);await page.waitForSelector('#notionSave .msg');
 assert.match(await page.textContent('#notionSave'),/저장하지 못했어요: Notion이 노트를 받아들이지 않았어요.*학습 기록은 그대로예요/);
 assert.equal(await page.locator('#notionSave a').count(),0,'no link, no success state');assert.equal(await raw(page),before);
 assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['다시 시도','학습 과정 기록 다운로드']);await page.click('#notionRetry');await page.waitForSelector('#notionOpen');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('auto-save runs once on completion; it never reaches a saved page; nothing is sent when Notion is not connected',async()=>{
 const l=clone(MEM);l.stage=4;l.maxStage=4;l.complete=false;
 const n=fakeNotion({connected:true,autoSave:true});const {ctx,page,posts,errors}=await open([l],'mem',n);
 await page.click('text=학습 마무리하기 →');await closeAtlas(page);await page.waitForSelector('#notionOpen');
 assert.equal(saves(posts).length,1);
 await page.click('text=내 설명 다시 보기');await page.click('text=학습 마무리하기 →');await closeAtlas(page);await page.waitForTimeout(200);
 assert.equal(saves(posts).length,1,'re-opening the completion screen does not save again');await ctx.close();
 // an exploration that already has a page (e.g. records restored) completes with auto-save on: refused, real state shown
 const m=fakeNotion({connected:true,autoSave:true,saved:SAVED()});const t2=await open([clone(l)],'mem',m);
 await t2.page.click('text=학습 마무리하기 →');await closeAtlas(t2.page);await t2.page.waitForSelector('#notionOpen');await lineHas(t2.page,/Notion에 저장됨/);
 assert.deepEqual(saves(t2.posts).map(p=>p.body.mode),['update']);assert.equal(m.pages,0,'nothing created, nothing replaced');
 assert.equal(await t2.page.getAttribute('#notionOpen','href'),'https://www.notion.so/saved');
 assert.deepEqual(await t2.page.locator(ACTIONS).allTextContents(),['Notion에서 보기 ↗','새 페이지로 저장','학습 과정 기록 다운로드']);
 assert.deepEqual(t2.errors,[]);await t2.ctx.close();
 const off=fakeNotion();const t=await open([clone(l)],'mem',off);
 await t.page.click('text=학습 마무리하기 →');await closeAtlas(t.page);
 assert.equal(saves(t.posts).length,0);
 await t.page.waitForSelector('#notionSaveBtn:not([disabled])');assert.deepEqual(await t.page.locator('#notionSave button, #notionSave a').allTextContents(),['Notion에 개념 노트 저장','학습 과정 기록 다운로드']);
 await noteDialog(t.page);assert.match(await t.page.textContent('#noteDialogIntro'),/먼저 Notion을 연결해야 해요/);assert.equal(await t.page.textContent('#noteConfirm'),'Notion 연결하기');
 await shot(t.page,'d-save-dialog-disconnected-desktop');
 await t.page.click('#noteConfirm');await t.page.waitForSelector('#notionSettings');assert.equal(saves(t.posts).length,0);
 assert.deepEqual([...errors,...t.errors],[]);await t.ctx.close();
});

test('saved earlier: viewing asks only for CURIVEN’s record; a stale client’s update is refused and the real state shown',async()=>{
 const n=fakeNotion({connected:true,saved:SAVED()});const {ctx,page,posts,errors}=await open([done()],'mem',n);await closeAtlas(page);await page.waitForSelector('#notionOpen');
 assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['Notion에서 보기 ↗','새 페이지로 저장','학습 과정 기록 다운로드']);
 await noteDialog(page);await page.waitForTimeout(200);assert.deepEqual([...new Set(posts.map(p=>p.action))],['entry'],'viewing and opening the dialog ask Notion nothing');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>saveToNotion(data.lessons[0],'update'));await page.waitForSelector('#notionOpen');await lineHas(page,/Notion에 저장됨/);
 await page.evaluate(()=>post('/api/notion/save',{explorationId:'mem',title:'t',markdown:'x',mode:'overwrite',confirm:true}).catch(e=>e.code)).then(c=>assert.equal(c,'overwrite_disabled'));
 assert.equal(n.pages,0,'nothing created or replaced');assert.deepEqual(saves(posts).map(p=>p.body.mode),['update','overwrite']);
 assert.equal(posts.filter(p=>p.action==='entry').length,2,'after the refusal the saved state is read again');assert.deepEqual(errors,[]);await ctx.close();
});

test('archived: no link and no save on reload or revisit, even with auto-save on; a new page only after confirming',async()=>{
 const n=fakeNotion({connected:true,autoSave:true,saved:{...SAVED(),url:'https://www.notion.so/trashed',contentKey:null,archived:true,archivedAt:'2026-11-24T00:00:00+00:00'}});n.trash=true;
 const {ctx,page,posts,dialogs,errors}=await open([done()],'mem',n);await closeAtlas(page);await page.waitForSelector('#notionReconnect');
 assert.match(await page.textContent('#notionLine'),/휴지통/);
 assert.equal(await page.locator('#notionOpen').count(),0,'no link to the trashed page');assert.equal(await page.locator('#notionSaveBtn').count(),0);
 assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['새 페이지로 저장','다시 연결','학습 과정 기록 다운로드']);
 await shot(page,'d-archived-desktop',true);
 await page.reload();await closeAtlas(page);await page.waitForSelector('#notionReconnect');
 await page.click('text=내 설명 다시 보기');await page.click('text=학습 마무리하기 →');await closeAtlas(page);await page.waitForSelector('#notionReconnect');await page.waitForTimeout(200);
 assert.equal(saves(posts).length,0,'reloading and returning to the completion screen send nothing');
 await page.click('#notionReconnect');await lineHas(page,/아직 있어요/);assert.ok(await page.isVisible('#notionReconnect'),'still archived: reconnect stays available');
 await page.evaluate(()=>{window.__c=window.confirm;window.confirm=()=>false});await page.click('#notionSaveNew');await page.waitForTimeout(200);
 assert.equal(saves(posts).length,0,'cancelled: nothing sent');await page.evaluate(()=>{window.confirm=window.__c});
 await page.click('#notionSaveNew');await page.waitForSelector('#notionOpen');assert.match(dialogs.at(-1),/새 페이지를 만들까요\? 원래 페이지는 그대로 둬요/);
 assert.deepEqual(saves(posts).map(p=>[p.body.mode,p.body.confirm]),[['new',true]]);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('an unresolved first save: nothing is retried or guessed; the destination to check; a new page only after a duplicate warning',async()=>{
 const n=fakeNotion({connected:true});n.unconfirmedNext=1;const {ctx,page,posts,dialogs,errors}=await open([done()],'mem',n);await closeAtlas(page);
 await confirmSave(page);await lineHas(page,/만들어졌는지 확인하지 못했어요/);
 assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['저장 위치 열기 ↗','새 페이지로 저장','학습 과정 기록 다운로드'],'no “다시 시도”');
 assert.equal(await page.getAttribute('#notionDest','href'),PAGE.url);assert.equal(await page.locator('#notionOpen, #notionRetry').count(),0,'no link to an unconfirmed page');
 await shot(page,'d-unconfirmed-desktop',true);
 await page.reload();await closeAtlas(page);await lineHas(page,/만들어졌는지 확인하지 못했어요/);assert.equal(await page.locator('#notionSaveBtn').count(),0,'the unresolved state survives a reload');
 await page.evaluate(()=>saveToNotion(data.lessons[0],'update'));await lineHas(page,/만들어졌는지 확인하지 못했어요/);   // a stale retry
 await page.evaluate(()=>{window.__c=window.confirm;window.confirm=m=>(window.__m=m,false)});await page.click('#notionSaveNew');await page.waitForTimeout(150);
 assert.match(await page.evaluate(()=>window.__m),/이미 만들어졌을 수 있어요.*같은 노트가 두 개가 될 수 있어요/);await page.evaluate(()=>{window.confirm=window.__c});
 assert.deepEqual(saves(posts).map(p=>p.body.mode),['update','update'],'one send, then one refused stale retry; the cancelled confirm sent nothing');assert.equal(n.pages,0);
 await page.click('#notionSaveNew');await page.waitForSelector('#notionOpen');assert.deepEqual(saves(posts).at(-1).body.mode,'new');assert.equal(saves(posts).at(-1).body.confirm,true);
 assert.equal(n.pages,1);assert.deepEqual(errors,[]);await ctx.close();
});

// The dialog's read-only check of a saved page: informational; nothing in it writes to that page.
const REMOTE='## 핵심 개념\n\nNotion에서 직접 적은 메모 <b>태그도 글자로</b>\n';
async function openSaved(n){const t=await open([done()],'mem',n);await closeAtlas(t.page);await t.page.waitForSelector('#notionOpen');await noteDialog(t.page);await t.page.waitForSelector('#noteCheckRemote');return t}
const gate=()=>{let open;const p=new Promise(r=>open=r);p.open=open;return p};

test('check of a saved page: explicit, read-only, shows the live content; the only write is the dialog’s new page',async()=>{
 for(const [remote,re,text] of [[{state:'changed',markdown:REMOTE,clipped:false},/CURIVEN이 저장한 뒤 Notion에서 이 페이지가 바뀌었어요.*CURIVEN이 바꾸지 않아요/,REMOTE],
                                 [{state:'same'},/저장할 때 확인한 내용과 같아요/,null],[{state:'unreadable'},/모두 읽을 수 없어서 비교하지 못했어요/,null],
                                 [{state:'unknown',markdown:REMOTE,clipped:true},/비교할 기준이 없어요/,REMOTE+'\n…(앞부분만 보여 줘요)']]){
  const n=fakeNotion({connected:true,saved:SAVED()});n.remote=remote;const {ctx,page,posts,errors}=await openSaved(n);
  assert.deepEqual([...new Set(posts.map(p=>p.action))],['entry'],'opening the dialog asks Notion nothing');assert.ok(await page.isHidden('#noteRemote'));
  await page.click('#noteCheckRemote');await page.waitForSelector('#noteRemote:not([hidden])');assert.match(await page.textContent('#noteRemote'),re);
  if(text){assert.equal(await page.textContent('#noteRemoteText'),text);assert.equal(await page.locator('#noteRemoteText b').count(),0,'shown as text')}
  assert.equal(await page.locator('#noteDialog button').filter({hasText:/되돌리기|덮어쓰기|업데이트/}).count(),0);
  if(remote.state==='changed')await shot(page,'d-new-page-dialog-remote-changed-desktop');
  assert.equal(saves(posts).length,0);assert.deepEqual(errors,[]);await ctx.close()}
});

test('stale check answers are dropped: a closed/reopened dialog, a newer check, or a save in between',async()=>{
 const n=fakeNotion({connected:true,saved:SAVED()});n.remote={state:'changed',markdown:REMOTE,clipped:false};const {ctx,page,posts,errors}=await openSaved(n);
 const answered=()=>page.waitForResponse(r=>r.url().endsWith('/api/notion/check'));
 const g1=gate();n.checkGate=[g1];await page.click('#noteCheckRemote');await page.waitForFunction(()=>/확인하는 중/.test(document.getElementById('noteCheckRemote')?.textContent||''));
 await page.keyboard.press('Escape');await page.waitForSelector('#noteDialog',{state:'detached'});await noteDialog(page);await page.waitForSelector('#noteCheckRemote');
 let r=answered();g1.open();await r;await page.waitForTimeout(200);
 assert.ok(await page.isHidden('#noteRemote'),'the first dialog’s answer does not appear in the new one');
 const g2=gate(),g3=gate();n.checkGate=[g2,g3];await page.click('#noteCheckRemote');
 await page.evaluate(()=>{checkRemote(data.lessons[0])});   // a second check while the first is pending (the button is disabled; called directly)
 n.remote={state:'same'};r=answered();g3.open();await r;await page.waitForFunction(()=>/같아요/.test(document.getElementById('noteRemote')?.textContent||''));
 n.remote={state:'changed',markdown:REMOTE,clipped:false};r=answered();g2.open();await r;await page.waitForTimeout(200);
 assert.match(await page.textContent('#noteRemote'),/같아요/,'the older answer is ignored');
 const g4=gate();n.checkGate=[g4];await page.click('#noteCheckRemote');
 await page.evaluate(()=>{const id=data.lessons[0].id;notionSaves.set(id,{...notionSaves.get(id)})});
 r=answered();g4.open();await r;await page.waitForTimeout(200);
 assert.equal(await page.locator('#noteRemoteText').count(),0,'an answer about an older saved state is not shown');
 assert.equal(saves(posts).length,0);assert.deepEqual(errors,[]);await ctx.close();
});

test('check finds a trashed, deleted or unreachable page: archived / unavailable states, or the reason; nothing written',async()=>{
 for(const flag of ['trash','unavailable']){const n=fakeNotion({connected:true,saved:SAVED()});const {ctx,page,posts,errors}=await openSaved(n);n[flag]=true;
  await page.click('#noteCheckRemote');await page.waitForSelector('#noteDialog',{state:'detached'});
  if(flag==='trash'){await page.waitForSelector('#notionReconnect');assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['새 페이지로 저장','다시 연결','학습 과정 기록 다운로드'])}
  else{await lineHas(page,/열 수 없어요/);assert.deepEqual(await page.locator(ACTIONS).allTextContents(),['다시 연결','새 페이지로 저장','학습 과정 기록 다운로드']);
   await page.click('#notionReconnect');await lineHas(page,/열 수 없어요/);n.unavailable=false;await page.click('#notionReconnect');await page.waitForSelector('#notionOpen')}
  assert.equal(saves(posts).length,0);assert.equal(n.pages,0);assert.deepEqual(errors,[]);await ctx.close()}
 const n=fakeNotion({connected:true,saved:SAVED()});n.checkError=true;const {ctx,page,posts,errors}=await openSaved(n);
 await page.click('#noteCheckRemote');await page.waitForSelector('#noteRemote.msg');assert.match(await page.textContent('#noteRemote'),/연결할 수 없어요/);
 assert.ok(await page.isEnabled('#noteCheckRemote'),'the learner can check again');
 n.checkError=false;n.remote={state:'same'};await page.click('#noteCheckRemote');await page.waitForFunction(()=>/같아요/.test(document.getElementById('noteRemote')?.textContent||''));
 assert.equal(posts.filter(p=>p.action==='check').length,2,'one request per click, no automatic retry');
 await page.keyboard.press('Escape');await page.waitForSelector('#noteDialog',{state:'detached'});await noteDialog(page);await page.waitForSelector('#noteCheckRemote');
 assert.ok(await page.isHidden('#noteRemote'),'a closed dialog forgets the check');assert.equal(posts.filter(p=>p.action==='check').length,2,'reopening sends nothing');
 assert.equal(saves(posts).length,0);assert.deepEqual(errors,[]);await ctx.close();
});

test('static: auto-save is called only from the first completion; the UI never builds an overwrite',()=>{
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),ui=fs.readFileSync(path.join(ROOT,'notion-ui.js'),'utf8');
 assert.doesNotMatch(ui,/'overwrite'|expectedRemote/,'no request with mode "overwrite" can be built by the UI');
 assert.doesNotMatch(ui,/노트 업데이트|덮어쓰기/,'no update or overwrite action is offered');
 const calls=[...html.matchAll(/notionAfterComplete\(/g)];assert.equal(calls.length,1);
 assert.match(html,/if\(!l\.complete\)\{l\.complete=true;track\(l,'탐험 완료'\);setStage\(l,5\);notionAfterComplete\(l\);return\}/);
 assert.match(ui,/function notionAfterComplete\(l\)\{if\(notionState\.connected&&notionState\.autoSave\)saveToNotion\(l\)\}/,'auto-save uses the default mode (the server makes only a first page with it)');
});
