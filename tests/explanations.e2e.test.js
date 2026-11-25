// Growth stage: each explanation shown with its AI feedback, the AI's rewrite (only if it wrote one), the conversation
// that followed and the next explanation — desktop and phone. Isolated server; /api/ai and /api/notion are mocked.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/explanations.e2e.test.js
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9700+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:[],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.SCREEN_DIR;
const shot=async(page,name)=>{if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:true})}};

const T0=Date.parse('2026-11-20T10:00:00+09:00'),min=m=>T0+m*60000;
const LONG='열은 온도가 높은 곳에서 낮은 곳으로 흐른다. 차가운 기운이 따뜻한 물체로 들어가서 물체가 식는다. '+'그래서 손을 얼음에 대면 차가운 기운이 손으로 들어오는 것 같다고 생각했어요. '.repeat(4)+'<b>굵게</b> 같은 글자도 그대로.';
const D2='열은 높은 곳에서 낮은 곳으로 이동한다. 물체가 식는 건 열이 빠져나가기 때문이다.';
const REV='열은 온도가 높은 물체에서 낮은 물체로 이동해요. 물체가 식는 것은 열이 빠져나가기 때문이에요.';
function record(){const m=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','memory_session.json'),'utf8')).record;
 const fb={schema:2,summary:'방향은 맞아요. 식는 이유를 다시 생각해 볼 수 있어요.',correct:[{quote:'열은 온도가 높은 곳에서 낮은 곳으로 흐른다',point:'방향이 맞아요.'}],precision:[],
  misconceptions:[{quote:'차가운 기운이 따뜻한 물체로 들어가서 물체가 식는다',issue:'‘차가운 기운’이 들어온다고 보았어요.',why:'이동하는 것은 열이에요.',question:'무엇이 이동할까요?'}],missing:[],explained:[],uncertainty:'',
  reviewer:{provider:'chatgpt',model:'gpt-test',at:min(2)},revision:REV};
 const fb2={schema:2,summary:'이동하는 것이 열이라는 점이 분명해요.',correct:[],precision:[{quote:'열이 빠져나가기 때문이다',issue:'어디로 빠져나가는지 덧붙여요.',why:'온도 차이가 방향을 정해요.',question:'어디로 갈까요?'}],
  misconceptions:[],missing:[],explained:[],uncertainty:'',reviewer:{provider:'chatgpt',model:'gpt-test',at:min(21)}};
 return {...m,stage:5,maxStage:5,complete:true,drafts:[{text:LONG,at:min(1),feedback:fb},{text:D2,at:min(20),feedback:fb2}],
  dialogue:[...m.dialogue,{id:'xf1',role:'learner',text:'그럼 식는 건 열이 나가는 건가요?',at:min(5),status:'answered',ref:{kind:'feedback',draftAt:min(1),type:'misconceptions',index:0}},
   {id:'xr1',role:'tutor',replyTo:'xf1',text:'맞아요. 열이 빠져나가면서 식어요.',at:min(6)}]}}

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lesson,viewport){
 const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});
 await ctx.addInitScript(`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons:[lesson],active:lesson.id}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 const requests=[];await ctx.route('**/api/ai',r=>{requests.push('ai');return r.fulfill({status:500,json:{ok:false,error:'no AI in this test'}})});
 await ctx.route('**/api/notion/**',r=>{const u=r.request().url();requests.push(u.split('/').pop());
  if(u.endsWith('/status'))return r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}});return r.fulfill({status:500,json:{ok:false}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForSelector('#explanationRounds');await page.keyboard.press('Escape');
 return {ctx,page,errors,requests};
}
const labels=(page,n)=>page.$$eval(`#xr-${n} .xr-label > span:first-child`,x=>x.map(e=>e.textContent));

for(const [name,viewport] of [['desktop',{width:1440,height:960}],['phone',{width:390,height:844}]])
test(`growth stage (${name}): explanations with their feedback, in sequence; full text one click away; AI parts labelled`,async()=>{
 const l=record(),{ctx,page,errors,requests}=await open(l,viewport);const before=await page.evaluate(k=>localStorage.getItem(k),KEY);
 assert.equal(await page.locator('text=마지막 내 설명').count(),0,'the bare last explanation is gone');
 assert.equal(await page.textContent('#xrTitle'),'내 설명과 AI 피드백');
 assert.deepEqual(await page.$$eval('#explanationRounds > details',d=>d.map(x=>[x.id,x.open])),[['xr-1',false],['xr-2',true],['xrUnlinked',false]],'the latest is open, earlier ones folded');
 assert.match(await page.textContent('#xr-1 > summary'),/ · 다음 설명 있음$/);assert.equal(await page.locator('#explanationRounds summary',{hasText:'다시 씀'}).count(),0,'order only, no revision wording');
 // the fixture's own two feedback follow-ups point at its original explanation, which this test replaced: they are
 // listed apart and counted (F4), not dropped and not attached to these explanations
 assert.match(await page.textContent('#xrUnlinked > summary'),/어느 설명의 피드백에 대한 대화인지 확인할 수 없어요 \(2개\)/);
 await page.click('#xr-1 > summary');
 assert.deepEqual(await labels(page,1),['내가 작성한 설명','AI 피드백','AI가 제안한 수정 설명','피드백에 이어진 대화','다음에 쓴 설명']);
 assert.equal(await page.textContent('#xr-1 .xr-next .xr-none'),'이 피드백을 받은 뒤에 썼어요. 피드백을 반영했는지는 기록으로 알 수 없어요.','order only, never a claimed revision');
 assert.deepEqual(await labels(page,2),['내가 작성한 설명','AI 피드백'],'no rewrite was written: no rewrite step');
 // the learner's long text: a preview, and the exact full text behind "전체 보기" (rendered as text, never as HTML)
 assert.match(await page.textContent('#xr-1 .xr-mine .xr-preview'),/…$/);assert.equal(await page.locator('#xr-1 .xr-mine b').count(),0);
 await page.click('#xr-1 .xr-mine .xr-full > summary');assert.equal(await page.textContent('#xr-1-text'),LONG);
 assert.ok(await page.isHidden('#xr-1 .xr-mine .xr-preview'),'the preview gives way to the full text (shown once)');
 assert.equal(await page.textContent('#xr-2-text'),D2,'a short text is shown whole');
 // AI: labelled, kinds shown, the rewrite only where the AI wrote one
 assert.match(await page.textContent('#xr-1 .xr-feedback .xr-tag'),/^AI · gpt-test$/);
 assert.deepEqual(await page.$$eval('#xr-1 .xr-item',x=>x.map(e=>e.dataset.kind)),['correct','concept']);
 assert.match(await page.textContent('#xr-1 .xr-item[data-kind="concept"]'),/^개념 바로잡기 \(AI 분류\) “차가운 기운이/);
 assert.equal(await page.textContent('#xr-1 .xr-revision .xr-tag'),'AI가 쓴 글');assert.equal(await page.textContent('#xr-1 .xr-revision .xr-whole'),REV);
 assert.equal(await page.locator('#xr-2 .xr-revision').count(),0);assert.equal(await page.locator('text=수정 설명 없음').count(),0,'no placeholder');
 assert.equal(await page.locator('#xr-1 .xr-mine .xr-tag').textContent(),'내 글');assert.notEqual(await page.$eval('#xr-1 .xr-mine',e=>getComputedStyle(e).borderLeftColor),await page.$eval('#xr-1 .xr-revision',e=>getComputedStyle(e).borderLeftColor),'the learner’s text and the AI rewrite look different');
 assert.match(await page.textContent('#xr-2 .xr-item'),/^표현·조건 다듬기 \(AI 분류\)/);
 await page.click('#xr-1 .xr-thread-all > summary');
 assert.deepEqual(await page.$$eval('#xr-1 .xr-msg',x=>x.map(e=>e.textContent)),['내 메시지 #'+(record().dialogue.filter(m=>m.role==='learner'&&!m.quick&&m.text?.trim()).length)+' · ‘개념 바로잡기’ 항목에 대해 — 그럼 식는 건 열이 나가는 건가요?','AI 튜터의 답 (AI): 맞아요. 열이 빠져나가면서 식어요.']);
 // "다음에 쓴 설명" goes to the next explanation
 await page.click('#xr-2 > summary');assert.equal(await page.$eval('#xr-2',d=>d.open),false);
 await page.click('#xr-1 .xr-go');assert.equal(await page.$eval('#xr-2',d=>d.open),true);assert.equal(await page.evaluate(()=>document.activeElement?.parentElement?.id),'xr-2');
 // layout: nothing wider than the screen; every round inside it
 const fit=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:window.innerWidth,boxes:[...document.querySelectorAll('.xr-round')].map(b=>b.getBoundingClientRect().right)}));
 assert.ok(fit.doc<=fit.win,JSON.stringify(fit));assert.ok(fit.boxes.every(r=>r<=fit.win),JSON.stringify(fit));
 await shot(page,`f-growth-explanations-${name}`);
 assert.deepEqual(requests.filter(x=>x==='ai'),[],'no AI request');assert.ok(!requests.includes('save'),'no Notion save');
 assert.equal(await page.evaluate(k=>localStorage.getItem(k),KEY),before,'viewing never changes the record');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('growth stage: feedback without a rewrite, a failed review, and no feedback',async()=>{
 const l=record();delete l.drafts[0].feedback.revision;l.drafts[1].feedback=null;l.drafts[1].feedbackError='시간 초과';
 l.drafts.push({text:'세 번째 설명이에요. 아직 피드백은 받지 않았어요.',at:min(30),feedback:null});
 const {ctx,page,errors}=await open(l,{width:1280,height:900});
 for(const n of [1,2])await page.click(`#xr-${n} > summary`);
 assert.equal(await page.locator('#explanationRounds .xr-revision').count(),0,'no rewrite anywhere');assert.deepEqual(await labels(page,1),['내가 작성한 설명','AI 피드백','피드백에 이어진 대화','다음에 쓴 설명']);
 assert.deepEqual(await labels(page,2),['내가 작성한 설명','AI 피드백','다음에 쓴 설명'],'no rewrite row when there was no feedback');
 assert.equal(await page.locator('#xr-2 .xr-next .xr-none').count(),0,'no order note without feedback');
 assert.equal(await page.textContent('#xr-2 .xr-feedback .xr-none'),'AI 피드백을 받지 못했어요: 시간 초과');
 assert.equal(await page.textContent('#xr-3 .xr-feedback .xr-none'),'AI 피드백 없음');assert.deepEqual(await labels(page,3),['내가 작성한 설명','AI 피드백']);
 assert.match(await page.textContent('#xr-3 > summary'),/설명 3 · .* · AI 피드백 없음$/);
 assert.deepEqual(errors,[]);await ctx.close();
});
