// Durable feedback references in the real explain stage: what the learner sees, what is stored, and what the tutor is
// actually sent (/api/ai is mocked and every request body is captured). Isolated server; no real AI, no Notion.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/feedback_refs.e2e.test.js
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9600+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:[],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const AT=Date.parse('2026-11-20T10:00:00+09:00');
const TEXT='열은 높은 곳에서 낮은 곳으로 흐른다. 차가운 기운이 들어와서 식는다. 열은 차가운 쪽으로 가나요?';
const Q={quote:'열은 차가운 쪽으로 가나요?',issue:'Q-ITEM 질문을 오개념으로 봄',why:'질문이에요.',question:'Q의 질문?'};
const CI={quote:'차가운 기운이 들어와서 식는다',issue:'C-ITEM 차가운 기운이 들어온다고 봄',why:'이동하는 것은 열이에요.',question:'C의 질문?'};
function record(){const m=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','memory_session.json'),'utf8')).record;
 // stored by an older validator: the quoted question Q kept as misconception #0, and a legacy reply to position 0
 const stored={schema:2,summary:'요약이에요.',correct:[],precision:[],missing:[],explained:[],uncertainty:'',misconceptions:[{...Q},{...CI}],reviewer:{provider:'chatgpt',model:'gpt-test',at:AT+60000}};
 return {...m,stage:4,maxStage:5,complete:false,drafts:[{text:TEXT,at:AT,feedback:stored}],
  dialogue:[...m.dialogue,{id:'legacyQ',role:'learner',text:'Q에 답했어요 (예전 화면)',at:AT+120000,status:'answered',intent:'reply',ref:{kind:'feedback',draftAt:AT,type:'misconceptions',index:0}},
   {id:'legacyQr',role:'tutor',replyTo:'legacyQ',text:'Q에 대한 예전 답',at:AT+130000}]}}

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lesson){
 const ctx=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});const sent=[];
 await ctx.addInitScript(`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons:[lesson],active:lesson.id}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 await ctx.route('**/api/notion/**',r=>r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}}));
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());sent.push(body);
  if(body.mode==='tutor')return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:{reply:'튜터의 답: '+body.message,followUp:'',assessment:null,uncertainty:''}}});
  if(body.mode==='feedback')return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:{schema:2,summary:'새 피드백 요약.',correct:[],precision:[],missing:[{issue:'NEW-MISSING 열평형 조건',question:'언제 멈출까요?'}],explained:[],uncertainty:'',
   misconceptions:[{quote:'차가운 기운이 계속 들어온다',issue:'NEW-C 차가운 기운',why:'이동하는 것은 열이에요.',question:'무엇이 이동하나요?'}]}}});
  return r.fulfill({status:500,json:{ok:false,error:'unexpected'}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForSelector('#draftHistory');await page.keyboard.press('Escape');
 return {ctx,page,errors,sent};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const box=(at,type,i)=>`fb_${at}_${type}_${i}`;

test('a drifted legacy reply is shown apart, never under another critique; a new reply sends the tutor exactly its item',async()=>{
 const {ctx,page,errors,sent}=await open(record());
 // what the learner sees: C is today's first misconception; the old reply to Q is NOT shown as C's thread
 const c=page.locator('#draftHistory [data-fb="misconceptions:0"]');assert.match(await c.textContent(),/C-ITEM/);
 assert.equal(await page.locator('#draftHistory .tutor-own',{hasText:'Q에 답했어요'}).count(),0,'not inside any item thread');
 const un=page.locator(`#fbUnplaced-${AT}`);assert.match(await un.locator('summary').textContent(),/어느 피드백 항목에 대한 대화인지 확인할 수 없어요 \(1개\)/);
 assert.match(await un.textContent(),/나: Q에 답했어요 \(예전 화면\)[\s\S]*AI 튜터 \(AI\): Q에 대한 예전 답/);
 // reply to C through the real composer, and inspect what goes to /api/ai
 await page.click(`#draftHistory .tutor-open`);await page.fill(`#tin-${box(AT,'misconceptions',0)}`,'C에 대해 답할게요');await page.click(`#draftHistory .tutor-send`);
 await page.waitForFunction(()=>/튜터의 답: C에 대해 답할게요/.test(document.getElementById('draftHistory')?.textContent||''));
 const t=sent.filter(b=>b.mode==='tutor');assert.equal(t.length,1);
 assert.equal(t[0].focus.kind,'feedback');assert.equal(t[0].focus.issue,CI.issue);assert.equal(t[0].focus.question,CI.question);assert.equal(t[0].focus.quote,CI.quote);
 const raw=JSON.stringify(t[0]);assert.ok(!raw.includes(Q.issue),'the other critique is nowhere in the request');assert.ok(!raw.includes('Q에 답했어요'),'nor the unplaced conversation (history)');
 // what is stored: the reference carries the item's words (legacy feedback has no ids to carry)
 const rec=await stored(page),mine=rec.lessons[0].dialogue.find(m=>m.text==='C에 대해 답할게요');
 assert.deepEqual(mine.ref,{kind:'feedback',draftAt:AT,type:'misconceptions',index:0,seen:{issue:CI.issue,quote:CI.quote}});
 assert.deepEqual(rec.lessons[0].drafts[0].feedback.misconceptions.map(x=>x.issue),[Q.issue,CI.issue],'the stored feedback is not rewritten');
 assert.equal(rec.lessons[0].dialogue.find(m=>m.id==='legacyQ').ref.index,0,'nor the legacy reply');
 // reload: the same placement; the growth-stage view agrees
 await page.reload();await page.waitForSelector('#draftHistory');await page.keyboard.press('Escape');
 assert.equal(await page.locator('#draftHistory .tutor-own',{hasText:'C에 대해 답할게요'}).count(),1,'the new reply is in C’s thread after reload');
 assert.equal(await page.locator('#draftHistory .tutor-own',{hasText:'Q에 답했어요'}).count(),0);assert.equal(await page.locator(`#fbUnplaced-${AT}`).count(),1);
 const about=await page.evaluate(()=>Object.fromEntries(CuriJourney.chain(data.lessons[0])[0].thread.map(t=>[t.text,t.about])));
 assert.deepEqual(about,{'Q에 답했어요 (예전 화면)':'어느 항목인지 확인할 수 없는 피드백','C에 대해 답할게요':'‘개념 바로잡기’ 항목'});
 assert.deepEqual(errors,[]);await ctx.close();
});

test('new feedback is stored with ids; a reply carries them; the tutor gets that item after reload',async()=>{
 const l=record();l.dialogue=l.dialogue.filter(m=>!m.id.startsWith('legacyQ'));
 const {ctx,page,errors,sent}=await open(l);
 await page.fill('#draft','열은 높은 곳에서 낮은 곳으로 흐른다. 그런데 차가운 기운이 계속 들어온다고 생각해요.');
 await page.click('text=설명 저장하고 피드백 받기');await page.waitForFunction(()=>/NEW-C/.test(document.getElementById('draftHistory')?.textContent||''));
 const rec=await stored(page),d=rec.lessons[0].drafts.at(-1),f=d.feedback;
 assert.match(f.id,/^[A-Za-z0-9_-]{8,64}$/);assert.ok([...f.misconceptions,...f.missing].every(x=>/^[A-Za-z0-9_-]{8,64}$/.test(x.id)),'every item has an id');
 assert.equal(sent.filter(b=>b.mode==='feedback').length,1);
 await page.reload();await page.waitForSelector('#draftHistory');await page.keyboard.press('Escape');
 await page.click(`#draftHistory .tutor-open`);await page.fill(`#tin-${box(d.at,'misconceptions',0)}`,'새 피드백에 답해요');await page.click('#draftHistory .tutor-send');
 await page.waitForFunction(()=>/튜터의 답: 새 피드백에 답해요/.test(document.getElementById('draftHistory')?.textContent||''));
 const t=sent.filter(b=>b.mode==='tutor').at(-1);assert.equal(t.focus.issue,'NEW-C 차가운 기운');assert.ok(!JSON.stringify(t).includes('NEW-MISSING'),'the other item is not sent');
 const ref=(await stored(page)).lessons[0].dialogue.find(m=>m.text==='새 피드백에 답해요').ref;
 assert.equal(ref.fid,f.id);assert.equal(ref.iid,f.misconceptions[0].id);assert.equal(ref.seen.issue,'NEW-C 차가운 기운');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('explain stage on a phone: long unbroken feedback and explanation text wraps; the page never gets wider',async()=>{
 const l=record(),run='끊김없이이어지는아주긴토큰'.repeat(12);l.drafts[0].text=TEXT+' '+run;l.drafts[0].feedback.misconceptions[1].issue='C-ITEM '+run;
 const ctx=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await ctx.addInitScript(`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons:[l],active:l.id}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 await ctx.route('**/api/**',r=>r.request().url().endsWith('/api/status')?r.fallback():r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}}));
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(URL);await page.waitForSelector('#draftHistory');await page.keyboard.press('Escape');
 await page.$$eval('#draftHistory details',ds=>ds.forEach(d=>d.open=true));
 const w=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(w[0]<=w[1],'page width '+w);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('an embedded-question assertion keeps its corrective question ahead of existing precision',async()=>{
 const l=record(),d=l.drafts[0],quote='어디가 뜨거운지',q='이 장치가 직접 측정하는 값은 무엇일까요?';
 d.text='이 저울은 어디가 뜨거운지 표시해요. 온도는 물체의 성질이에요.';
 d.feedback.misconceptions=[{quote,issue:'측정량을 혼동했어요.',why:'저울은 온도를 재지 않아요.',question:q}];
 d.feedback.precision=[{quote:'온도는 물체의 성질',issue:'범위를 좁혀요.',why:'성질은 여러 가지예요.',question:'어떤 성질일까요?'}];
 const {ctx,page}=await open(l);
 assert.match(await page.locator('[data-fb="misconceptions:0"]').textContent(),/다시 생각하기/);
 assert.ok((await page.locator('[data-fb="misconceptions:0"]').textContent()).includes(q));
 assert.ok(!(await page.locator('[data-fb="precision:0"]').textContent()).includes('어떤 성질일까요?'));
 await ctx.close();
});
