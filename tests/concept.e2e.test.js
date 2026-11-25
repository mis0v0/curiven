// Phase 2E — concept note on the completion screen: one explicit request, preview, edit, outdated notice, failure,
// and the Notion page / Markdown download built from the same note.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/concept.e2e.test.js
// Isolated fixture records only. The AI call is answered with scripted output for this record
// (validated by server.validate_note); Notion is mocked (connected, saves captured) — nothing reaches Notion.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9700+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/sqli_time_blind_record.json'),'utf8'));
const VALID=JSON.parse(execFileSync('python3',['-c',"import json,sys;sys.path.insert(0,'.');import server;d=json.load(open('tests/fixtures/sqli_concept_note_ai.json'));print(json.dumps(server.validate_note(d['raw'],8),ensure_ascii=False))"],{cwd:ROOT,env:isolatedEnv()}).toString());
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:[],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.CURIVEN_SHOTS||null;
const clone=x=>JSON.parse(JSON.stringify(x));

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT,CURIVEN_NOTION_SECRETS:'memory',CURIVEN_NOTION_DIR:fs.mkdtempSync(path.join(require('node:os').tmpdir(),'cn-notion-'))}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});

async function open(lessons,{viewport={width:1440,height:960},online=true,ai='ok',notion=true}={}){
 const ctx=await browser.newContext({viewport,reducedMotion:'reduce',acceptDownloads:true});
 await ctx.addInitScript(`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active:lessons[0].id}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:online?{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-6.1-sol',models:[]}:{provider:'chatgpt',online:false,status:'disconnected'}}));
 const calls=[];const state={ai};
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());calls.push(body);
  if(state.ai==='ok')await r.fulfill({json:{ok:true,data:VALID,provider:'chatgpt',model:'gpt-6.1-sol',ms:111000}});
  else if(state.ai==='slow'){await new Promise(x=>setTimeout(x,1500));await r.fulfill({json:{ok:true,data:VALID,provider:'chatgpt',model:'gpt-6.1-sol'}})}
  else await r.fulfill({status:400,json:{ok:false,error:'모델 응답이 올바른 JSON이 아니에요. 다시 시도하거나 수동 가져오기를 이용해 주세요.'}})});
 const saves=[];
 await ctx.route('**/api/notion/**',r=>{const u=r.request().url();
  if(u.endsWith('/status'))return r.fulfill({json:notion?{ok:true,available:true,connected:true,page:{id:'p',title:'학습 노트',url:'https://www.notion.so/p'},autoSave:false}:{ok:true,available:true,connected:false,page:null,autoSave:false}});
  if(u.endsWith('/entry'))return r.fulfill({json:{ok:true,saved:null}});
  if(u.endsWith('/save')){saves.push(JSON.parse(r.request().postData()));return r.fulfill({json:{ok:true,url:'https://www.notion.so/saved',savedAt:'2026-11-23T09:00:00Z',action:'created',contentKey:saves.at(-1).contentKey}})}
  return r.fulfill({json:{ok:true}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForSelector('#notionSave');
 await page.evaluate(()=>{const d=document.querySelector('.atlas-overlay,#atlas');if(d&&d.open!==undefined&&d.open)d.close?.()});
 await page.keyboard.press('Escape');
 return {ctx,page,calls,saves,state,errors};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
/** Concept-note making, preview and editing live in the Notion save / update dialog. */
async function noteDialog(page){await page.click('#notionSaveBtn');await page.waitForSelector('#noteDialog[open]')}
const learnerData=l=>JSON.stringify({d:l.dialogue,dr:l.drafts,p:l.prediction,s:l.scenarios,r:l.reflection,lesson:l.lesson});
async function shot(page,name){if(!SHOTS)return;fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:true})}

test('one primary action before a note exists; saving and downloading still work and give the basic concept-first note',async()=>{
 const {ctx,page,saves,calls,errors}=await open([clone(SQLI)]);
 await page.waitForSelector('#notionSaveBtn:not([disabled])');
 const primary=await page.$$eval('#notionSave button.btn:not(.secondary):not(.minor)',b=>b.map(x=>x.textContent));
 assert.deepEqual(primary,['Notion에 개념 노트 저장'],'no competing primary buttons');
 await shot(page,'done-before-note-1440');
 await noteDialog(page);assert.equal(await page.textContent('#conceptMake'),'개념 노트 만들기');
 const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#noteFileDownload')]);
 const md=fs.readFileSync(await dl.path(),'utf8');
 assert.ok(md.includes('## 검색어와 질의 구조') && md.indexOf('## 검색어와 질의 구조')<md.indexOf('## 학습 기록'),'concept first');
 assert.ok(md.includes('AI 종합 없이'),'honestly labelled as not synthesised');
 await page.click('#noteConfirm');await page.waitForSelector('#notionOpen');
 assert.equal(saves.length,1);assert.ok(saves[0].markdown.includes('<toggle>\n학습 기록'));assert.equal(calls.length,0,'no AI call without the learner asking');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('“개념 노트 만들기”: one bounded request, a preview, and the record keeps every learner word unchanged',async()=>{
 const {ctx,page,calls,saves,state,errors}=await open([clone(SQLI)]);state.ai='slow';
 const before=learnerData((await stored(page)).lessons[0]);
 await noteDialog(page);await page.click('#conceptMake');await page.waitForSelector('#conceptStatus');
 assert.match(await page.textContent('#conceptStatus'),/개념 노트를 만들고 있어요/);
 await page.waitForSelector('.cn-preview[open] .cn-article');
 assert.equal(calls.length,1);assert.equal(calls[0].mode,'note');
 assert.deepEqual(calls[0].messages.map(m=>m.text),SQLI.dialogue.filter(m=>m.role==='learner'&&!m.quick).map(m=>m.text),'the learner’s own words, numbered');
 assert.ok(JSON.stringify(calls[0]).length<120000);
 const rec=(await stored(page)).lessons[0];
 assert.equal(learnerData(rec),before,'dialogue, explanations, predictions and lesson untouched');
 assert.equal(rec.conceptNote.kind,'ai');assert.equal(rec.conceptNote.generatedBy.model,'gpt-6.1-sol');assert.ok(rec.conceptNote.basis);
 assert.equal(rec.conceptNote.resolved[0].question,SQLI.dialogue.find(m=>m.role==='learner'&&!m.quick).text);
 const text=await page.textContent('.cn-article');
 assert.ok(text.includes('서버 코드를 읽지 않아도 관찰할 수 있지만'));assert.ok(await page.$('.cn-article pre.cn-code code'),'code blocks rendered as code');
 assert.ok(await page.$('.cn-article .cn-table table'),'tables');assert.ok(!(await page.$('.cn-article script, .cn-article a')),'no markup from the model');
 assert.equal(await page.$$eval('#noteDialog button.btn:not(.secondary):not(.minor)',b=>b.map(x=>x.textContent).join()),'Notion에 저장','the save is the one primary action');
 await shot(page,'done-note-preview-1440');
 // the Notion page and the download are the same note
 await page.click('#noteConfirm');await page.waitForSelector('#notionOpen');
 const exp=await page.evaluate(()=>({n:CuriConcept.exportNotion(data.lessons[0],{now:0}),m:CuriConcept.exportMarkdown(data.lessons[0],{now:0}),title:CuriConcept.noteFor(data.lessons[0]).title}));
 assert.equal(saves[0].title,exp.title);assert.equal(saves[0].markdown.replace(/_CURIVEN에서 .*노트예요\..*_\n$/,''),exp.n.replace(/_CURIVEN에서 .*노트예요\..*_\n$/,''));
 await noteDialog(page);const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#noteFileDownload')]);const md=fs.readFileSync(await dl.path(),'utf8');
 assert.equal(md.replace(/_CURIVEN에서 .*노트예요\..*_\n$/,''),exp.m.replace(/_CURIVEN에서 .*노트예요\..*_\n$/,''));
 assert.ok(md.includes('## 검색어와 질의 구조'));
 assert.deepEqual(errors,[]);await ctx.close();
});

test('editing: the learner’s edit is kept, labelled, and exported; regenerating an edited note asks first',async()=>{
 const l=clone(SQLI);const {ctx,page,calls,errors}=await open([l]);
 await noteDialog(page);await page.click('#conceptMake');await page.waitForSelector('.cn-preview .cn-article');
 await page.click('#conceptEdit');await page.waitForSelector('.cn-edit');
 await page.fill('#cnEditTitle','내가 고친 제목');const body=page.locator('.cn-edit textarea.cn-body').first();await body.fill('내가 직접 다시 쓴 문단이에요.\n\n- 목록 하나');
 await shot(page,'done-note-edit-1440');
 await page.click('.cn-edit button[type=submit]');await page.waitForSelector('.cn-preview');
 const rec=(await stored(page)).lessons[0];assert.ok(rec.conceptNote.editedAt);assert.equal(rec.conceptNote.title,'내가 고친 제목');
 assert.match(await page.textContent('.cn-meta'),/직접 고침/);
 const md=await page.evaluate(()=>CuriConcept.exportMarkdown(data.lessons[0]));assert.ok(md.startsWith('# 내가 고친 제목'));assert.ok(md.includes('내가 직접 다시 쓴 문단이에요.\n\n- 목록 하나'));
 let asked=0;page.on('dialog',d=>{asked++;d.dismiss()});
 await page.click('#conceptRemake');await page.waitForTimeout(200);
 assert.equal(asked,1);assert.equal(calls.length,1,'dismissed: nothing regenerated');assert.equal((await stored(page)).lessons[0].conceptNote.title,'내가 고친 제목');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('outdated: when the exploration goes on after the note, the note is kept and says so',async()=>{
 const l=clone(SQLI);const {ctx,page,calls,errors}=await open([l]);
 await noteDialog(page);await page.click('#conceptMake');await page.waitForSelector('.cn-preview .cn-article');
 const keep=JSON.stringify((await stored(page)).lessons[0].conceptNote);
 await page.evaluate(()=>{const x=data.lessons[0];CuriTutor.addLearner(x,{text:'하나 더 물어볼게요?'},Date.now(),'late');persist();render()});
 await page.waitForSelector('#conceptStale');assert.match(await page.textContent('#conceptStale'),/새 내용은 아직 노트에 없어요/);
 assert.equal(JSON.stringify((await stored(page)).lessons[0].conceptNote),keep,'not regenerated or changed on its own');
 assert.equal(calls.length,1);
 assert.ok(await page.evaluate(()=>CuriConcept.exportMarkdown(data.lessons[0]).includes('이 노트를 만든 뒤에 이어진 학습 내용은 반영되지 않았어요')));
 assert.deepEqual(errors,[]);await ctx.close();
});

test('failure and offline: nothing is written, the reason is shown, and the basic note stays available',async()=>{
 const {ctx,page,errors}=await open([clone(SQLI)],{ai:'fail'});
 const before=JSON.stringify((await stored(page)).lessons[0]);
 await noteDialog(page);await page.click('#conceptMake');await page.waitForSelector('#conceptStatus[role=alert]');
 assert.match(await page.textContent('#conceptStatus'),/만들지 못했어요: 모델 응답이 올바른 JSON이 아니에요.*기본 노트/);
 const after=(await stored(page)).lessons[0];assert.ok(!after.conceptNote);assert.equal(JSON.stringify({...after,updatedAt:0}),JSON.stringify({...JSON.parse(before),updatedAt:0}));
 assert.ok(await page.isVisible('#noteFileDownload'));assert.equal(await page.textContent('#conceptMake'),'다시 시도');
 await ctx.close();
 const o=await open([clone(SQLI)],{online:false});await noteDialog(o.page);await o.page.waitForSelector('#conceptMake');
 assert.ok(await o.page.isDisabled('#conceptMake'));assert.match(await o.page.textContent('#conceptNote'),/AI가 연결되면 만들 수 있어요/);
 assert.deepEqual([...errors,...o.errors],[]);await o.ctx.close();
});

test('phone width: the preview fits without horizontal page scroll',async()=>{
 const {ctx,page,errors}=await open([clone(SQLI)],{viewport:{width:390,height:844}});
 await shot(page,'done-actions-390');
 await noteDialog(page);await page.click('#conceptMake');await page.waitForSelector('.cn-preview .cn-article');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal page scroll');
 const box=await page.locator('#noteDialog').boundingBox();assert.ok(box.x>=0&&box.width<=390,'the dialog fits the phone screen');assert.ok(await page.isVisible('#noteConfirm'),'the confirm stays reachable');
 await shot(page,'done-note-preview-390');
 assert.deepEqual(errors,[]);await ctx.close();
});
