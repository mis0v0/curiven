// Q4-A: the self-explanation stage puts the latest SAVED explanation and its own feedback first, folds earlier versions,
// names unsaved edits, and keeps the contextual question reachable (also from the growth stage), in the real UI.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/focused_explanation.e2e.test.js
// ALL AI RESPONSES ARE MOCKED (scripted). These tests show what the interface shows, where focus goes and what is kept;
// they are NOT evidence that any feedback is right or that the layout helps anyone learn.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(7400+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
// Synthetic learner writing (not recorded from anyone).
const E1='SQL 인젝션은 입력칸에 이상한 글자를 넣어서 서버를 망가뜨리는 공격이에요. 특수문자를 다 지우면 막을 수 있을 것 같아요.';
const E2='SQL 인젝션은 입력값이 쿼리 문장에 그대로 이어 붙어서 명령처럼 실행되는 문제예요. 따옴표가 문장 구조를 바꿀 수 있어요.';
const E3='바인딩을 쓰면 쿼리 구조와 값이 따로 전달돼서 값이 명령으로 해석되지 않아요. 그런데 숫자만 받는 칸이면 바인딩 없이도 안전한 건가요?';
const Q3='그런데 숫자만 받는 칸이면 바인딩 없이도 안전한 건가요?';
// Shaped like the server's normalized output (schema 2, demonstrated).
const fbFor=(quote,summary)=>({schema:2,demonstrated:[],summary,correct:[{quote,point:'핵심을 짚었어요.'}],precision:[],misconceptions:[],
 missing:[{issue:'입력과 쿼리 구조를 분리하는 방법',question:'값과 명령을 따로 보내면 무엇이 달라질까요?'}],explained:[],uncertainty:''});
const FB1=fbFor('입력칸에 이상한 글자를 넣어서','출발점은 좋아요. 원인을 문장 구조로 보면 더 정확해요.');
const FB2=fbFor('입력값이 쿼리 문장에 그대로 이어 붙어서','원인을 정확히 짚었어요.');
const FB3=fbFor('쿼리 구조와 값이 따로 전달돼서','바인딩의 원리를 정확히 설명했어요.');
const stamp=(f,at)=>({...f,reviewer:{provider:'chatgpt',model:'gpt-test',at}});

const rec=(drafts=[],extra={})=>({id:'A',topic:'SQL Injection',interest:'',level:'beginner',stage:4,maxStage:4,lesson:SQLI,prediction:'',scenarios:[],drafts,feedback:null,events:[],createdAt:1700000000000,updatedAt:1700000000000,complete:false,...extra});
const three=(latestFb=true)=>[{text:E1,at:1000,feedback:stamp(FB1,1100)},{text:E2,at:2000,feedback:stamp(FB2,2100)},{text:E3,at:3000,feedback:latestFb?stamp(FB3,3100):null}];

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});

/** ai(body) → data | {status,json} | a Promise of either. Every /api/ai request body is recorded in `calls`. */
async function open(lessons,{ai=()=>({reply:'답'}),online=true,viewport={width:1280,height:900},ctx:given}={}){
 const ctx=given||await browser.newContext({viewport});const calls=[];
 if(!given)await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active:'A'}))});`);
 await ctx.unroute('**/api/status').catch(()=>{});await ctx.unroute('**/api/ai').catch(()=>{});
 await ctx.route('**/api/status',r=>r.fulfill({json:online?{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}:{provider:'chatgpt',online:false,status:'disconnected',sharing:false}}));
 const state={ai};
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());calls.push(body);const res=await state.ai(body);
  if(res&&res.status)return r.fulfill({status:res.status,json:res.json}).catch(()=>{});
  return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:res}}).catch(()=>{})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(URL);await page.waitForFunction(o=>new RegExp(o?'ChatGPT 연결':'연결 안 됨').test(document.querySelector('#status').textContent),online);
 await page.waitForSelector('#draft, #explanationRounds');
 return {ctx,page,calls,errors,state};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const deferred=()=>{let ok;const p=new Promise(r=>{ok=r});return {p,ok}};
const visible=(page,sel)=>page.isVisible(sel);

test('first explanation: reviewing is shown where the feedback will appear; it arrives there, is announced, and focus is not lost',async()=>{
 const gate=deferred();
 const {ctx,page,calls,errors}=await open([rec()],{ai:async b=>{await gate.p;return FB3}});
 assert.equal(await page.locator('#draftHistory').count(),0,'nothing to show before the first save');
 await page.fill('#draft',E3);await page.click('text=설명 저장하고 피드백 받기');
 await page.waitForSelector('#feedbackPending');
 assert.equal(await page.textContent('#currentTitle'),'내 최신 설명 · 설명 1');
 assert.equal(await page.getAttribute('#feedbackPending','role'),'status');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'currentTitle','keyboard focus goes to the explanation just saved, not to the page top');
 assert.equal(await page.locator('#explainStatus').count(),0,'no second "reviewing" message elsewhere');
 assert.equal(await page.locator('#earlierExplanations').count(),0,'a single version has no "earlier" section');
 const y=await page.evaluate(()=>scrollY);
 gate.ok();await page.waitForSelector('.current-expl .feedback');
 assert.equal(await page.evaluate(()=>scrollY),y,'the page does not jump when feedback arrives');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'currentTitle','focus stays where it was');
 assert.match(await page.textContent('.current-expl .new'),/바인딩의 원리를 정확히 설명했어요/);
 await page.waitForFunction(()=>/설명 1의 AI 피드백이 도착했어요/.test(document.getElementById('liveNote')?.textContent||''));
 assert.equal(await page.getAttribute('#liveNote','role'),'status');
 assert.equal(await page.locator('#feedbackPending').count(),0);
 assert.equal(calls.length,1);assert.deepEqual(errors,[]);await ctx.close();
});

test('feedback failure: stated on the latest explanation with a retry; the explanation is kept; retry succeeds',async()=>{
 let fail=true;
 const {ctx,page,calls,errors}=await open([rec()],{ai:()=>fail?{status:502,json:{ok:false,error:'모의 오류'}}:FB3});
 await page.fill('#draft',E3);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('#retryFeedback');
 assert.match(await page.textContent('.current-expl .feedback-missing'),/^AI 피드백을 받지 못했어요: .*\(내 설명은 저장됐어요\)$/);
 assert.equal(await page.textContent('#retryFeedback'),'AI 검토 다시 요청');
 await page.waitForFunction(()=>/설명 1의 AI 피드백을 받지 못했어요/.test(document.getElementById('liveNote')?.textContent||''));
 assert.deepEqual((await stored(page)).lessons[0].drafts.map(d=>d.text),[E3]);
 fail=false;await page.click('#retryFeedback');await page.waitForSelector('.current-expl .feedback');
 assert.equal(await page.locator('#retryFeedback').count(),0);assert.equal(calls.length,2);
 assert.deepEqual(errors.filter(e=>!/502/.test(e)),[]);await ctx.close();
});

test('latest explanation without feedback: said so plainly; an older explanation\'s feedback is folded away, never shown as the latest',async()=>{
 const {ctx,page,calls,errors}=await open([rec(three(false))],{ai:()=>FB3});
 assert.equal(await page.textContent('#currentTitle'),'내 최신 설명 · 설명 3');
 assert.equal(await page.textContent('.current-expl .old'),E3);
 assert.equal(await page.textContent('.current-expl .feedback-missing'),'설명 3에는 아직 AI 피드백이 없어요.');
 assert.equal(await page.locator('.current-expl .feedback').count(),0,'no feedback inside the latest explanation');
 assert.equal(await page.textContent('#retryFeedback'),'AI 피드백 받기');
 // Earlier versions: folded, newest first, each summarised by number, feedback state and the start of its text.
 assert.equal(await page.textContent('#earlierTitle'),'이전 설명 2개');
 assert.deepEqual(await page.$$eval('#earlierExplanations > details',ds=>ds.map(d=>[d.id,d.open])),[['draftOld-2',false],['draftOld-1',false]]);
 assert.match(await page.textContent('#draftOld-2 > summary'),/^설명 2 · AI 피드백 있음SQL 인젝션은 입력값이/);
 for(const s of ['원인을 정확히 짚었어요','출발점은 좋아요'])assert.equal(await visible(page,`text=${s}`),false,`older feedback "${s}" is not on screen until opened`);
 assert.equal(calls.length,0,'nothing is requested automatically');
 // Retry asks only for the latest explanation's feedback.
 await page.click('#retryFeedback');await page.waitForSelector('.current-expl .feedback');
 assert.equal(calls.length,1);assert.equal(calls[0].text,E3);
 const s=(await stored(page)).lessons[0];assert.equal(s.drafts[2].feedback.summary,FB3.summary);assert.equal(s.drafts[1].feedback.summary,FB2.summary);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('earlier versions open and close on request, stay as left across a re-render, and change no record',async()=>{
 const {ctx,page,errors}=await open([rec(three())]);
 const before=JSON.stringify((await stored(page)).lessons[0]);
 await page.click('#draftOld-1 > summary');assert.equal(await page.evaluate(()=>document.getElementById('draftOld-1').open),true);
 assert.equal(await page.textContent('#draftOld-1 .old'),E1);assert.match(await page.textContent('#draftOld-1 .new'),/출발점은 좋아요/);
 assert.equal(await page.locator('#draftOld-1 #retryFeedback').count(),0,'retry is offered only on the latest explanation');
 await page.evaluate(()=>render());
 assert.deepEqual(await page.$$eval('#earlierExplanations > details',ds=>ds.map(d=>d.open)),[false,true],'kept as the learner left it');
 await page.click('#draftOld-1 > summary');await page.evaluate(()=>render());
 assert.equal(await page.evaluate(()=>document.getElementById('draftOld-1').open),false);
 const after=(await stored(page)).lessons[0];delete after.draftInProgress;
 assert.equal(JSON.stringify(after),before,'opening and closing history changes nothing stored');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('unsaved edits are named as unsaved; feedback stays attributed to the saved version; reload restores the draft',async()=>{
 const {ctx,page,errors}=await open([rec(three())]);
 assert.equal(await page.isVisible('#editState'),false,'the textarea holds the saved text: nothing to warn about');
 const EDIT=E3+' 숫자 칸도 서버에서는 글자로 받을 수 있을 것 같아요.';
 await page.fill('#draft',EDIT);
 assert.equal(await page.textContent('#editState'),'고쳐 쓴 내용은 아직 저장 전이에요. 지금 보이는 피드백은 저장된 설명 3에 대한 거예요.');
 assert.equal(await page.isVisible('#editState'),true);
 assert.equal(await page.textContent('.current-expl .old'),E3,'the saved explanation is shown as saved, not as the edit');
 assert.match(await page.textContent('.current-expl .new'),/바인딩의 원리/);
 await page.fill('#draft',E3);assert.equal(await page.isVisible('#editState'),false,'back to the saved text: the notice goes');
 await page.fill('#draft',EDIT);await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).lessons[0].draftInProgress,KEY);
 const s=(await stored(page)).lessons[0];assert.equal(s.drafts.length,3,'an unsaved edit is never a saved version');assert.equal(s.draftInProgress.text,EDIT);
 await page.reload();await page.waitForSelector('#draft');
 assert.equal(await page.inputValue('#draft'),EDIT);assert.equal(await page.isVisible('#editState'),true,'still named as unsaved after reload');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('typing a revision while feedback arrives: focus, caret, text and scroll position are kept',async()=>{
 const gate=deferred();
 const {ctx,page,errors}=await open([rec()],{ai:async()=>{await gate.p;return FB3}});
 await page.fill('#draft',E3);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('#feedbackPending');
 // Focus and caret placed directly (a Playwright click plus End scrolls the page by itself, with or without this change).
 await page.focus('#draft');await page.evaluate(()=>{const t=document.getElementById('draft');t.setSelectionRange(t.value.length,t.value.length)});await page.keyboard.type(' 그리고');
 const caret=await page.evaluate(()=>document.getElementById('draft').selectionStart),y=await page.evaluate(()=>scrollY);
 gate.ok();await page.waitForSelector('.current-expl .feedback');await page.waitForTimeout(400); // long enough for any smooth scroll to show
 assert.equal(await page.evaluate(()=>document.activeElement.id),'draft','focus is not taken away');
 assert.equal(await page.evaluate(()=>document.getElementById('draft').selectionStart),caret);
 assert.equal(await page.inputValue('#draft'),E3+' 그리고');assert.equal(await page.evaluate(()=>scrollY),y);
 await page.keyboard.type(' 더');assert.equal(await page.inputValue('#draft'),E3+' 그리고 더','typing continues in place');
 assert.equal(await page.isVisible('#editState'),true);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('after feedback, "내 말로 고쳐 쓰기" returns to the learner\'s own text without rewriting it',async()=>{
 const {ctx,page,calls,errors}=await open([rec(three())]);
 await page.click('#reviseDraft');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'draft');
 assert.equal(await page.inputValue('#draft'),E3,'nothing inserted or replaced');
 assert.equal(await page.evaluate(()=>document.getElementById('draft').selectionStart),E3.length,'caret at the end');
 assert.equal(calls.length,0);assert.equal((await stored(page)).lessons[0].drafts.length,3);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('contextual questions: from the latest and an earlier explanation, and from the growth stage — prefilled, never sent automatically',async()=>{
 const {ctx,page,calls,errors}=await open([rec(three(),{maxStage:5})],{ai:b=>({reply:'숫자 칸도 서버는 글자로 받을 수 있어요.',followUp:'',assessment:null,uncertainty:''})});
 await page.click('#draftAskBtn-3');await page.waitForSelector('#helpRegion');
 assert.equal(await page.inputValue('#tutorThread #tin-general'),Q3);
 assert.match(await page.textContent('#helpRegion .help-context'),/내 설명 3/);assert.equal(calls.length,0);
 // From an earlier explanation: open it, ask; the region moves there (still one region).
 await page.click('#draftOld-2 > summary');await page.click('#draftAskBtn-2');
 assert.equal(await page.evaluate(()=>document.getElementById('draftAsk-2').nextElementSibling?.id),'helpRegion');
 assert.equal(await page.locator('.help-region').count(),1);assert.match(await page.textContent('#helpRegion .help-context'),/내 설명 2/);
 await page.evaluate(()=>render());assert.equal(await page.evaluate(()=>document.getElementById('draftOld-2').open),true,'the help region is not hidden by a re-render');
 assert.equal(calls.length,0);
 // Growth stage: the same action under each explanation, without going back a stage.
 await page.keyboard.press('Escape');await page.click('#nav >> text=6. 성장');await page.waitForSelector('#explanationRounds');
 assert.equal(await page.locator('#explanationRounds .draft-ask-btn').count(),3);
 await page.click('#xr-3 #draftAskBtn-3');await page.waitForSelector('#helpRegion');
 assert.equal(await page.evaluate(()=>document.getElementById('draftAsk-3').nextElementSibling?.id),'helpRegion','opened right below that explanation');
 assert.equal(await page.inputValue('#tutorThread #tin-general'),Q3);assert.equal(calls.length,0,'prefilling sends nothing');
 await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.equal(calls.length,1);assert.equal(calls[0].message,Q3);assert.equal(calls[0].intent,'ask');assert.deepEqual(calls[0].focus,{kind:'draft',draft:E3});
 const s=(await stored(page)).lessons[0];assert.equal(s.complete,false,'asking does not complete the lesson');
 assert.deepEqual(s.drafts.map(d=>d.text),[E1,E2,E3]);assert.equal(s.drafts[2].feedback.summary,FB3.summary);
 // Back to the explanation stage: the conversation is in the one general thread there too.
 await page.click('#nav >> text=5. 설명');await page.click('#helpToggle');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('offline: the latest explanation says how to get feedback; a question is kept as a note; online again, both can continue',async()=>{
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons:[rec()],active:'A'}))});`);
 let {page,calls,errors}=await open(null,{online:false,ctx});
 await page.fill('#draft',E3);await page.click('text=내 설명 저장하기');await page.waitForSelector('#currentTitle');
 assert.equal(await page.textContent('.current-expl .feedback-missing'),'설명 1에는 아직 AI 피드백이 없어요. AI를 연결하면 받을 수 있어요.');
 assert.equal(await page.locator('#retryFeedback').count(),0);
 await page.click('#draftAskBtn-1');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-msg.me');
 assert.equal((await stored(page)).lessons[0].dialogue[0].status,'noted');assert.equal(calls.length,0);
 await page.close();
 ({page,calls,errors}=await open(null,{online:true,ctx,ai:b=>b.mode==='feedback'?FB3:{reply:'답',followUp:'',assessment:null,uncertainty:''}}));
 assert.equal(await page.textContent('#retryFeedback'),'AI 피드백 받기');
 await page.click('#retryFeedback');await page.waitForSelector('.current-expl .feedback');assert.equal(calls.length,1);
 await page.click('#helpToggle');await page.click('#tutorThread >> text=AI에게 보내기');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.equal(calls.filter(c=>c.mode==='tutor').length,1);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('phone width and keyboard: history folds and opens with the keyboard, no sideways scrolling, 44px targets',async()=>{
 const {ctx,page,errors}=await open([rec(three())],{viewport:{width:390,height:844}});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal page scroll');
 for(const sel of ['#draftOld-2 > summary','#draftOld-1 > summary','#draftAskBtn-3','#reviseDraft']){
  const h=await page.$eval(sel,el=>el.getBoundingClientRect().height);assert.ok(h>=44,`${sel} is ${h}px tall`)}
 await page.focus('#draftOld-2 > summary');await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>document.getElementById('draftOld-2').open),true);
 await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.getElementById('draftOld-2').open),false);
 // The heading of the latest explanation is a focus target with a visible outline.
 await page.focus('#currentTitle');assert.notEqual(await page.$eval('#currentTitle',el=>getComputedStyle(el).outlineStyle),'none');
 await page.click('#draftOld-1 > summary');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'still no sideways scroll with history open');
 assert.deepEqual(errors,[]);await ctx.close();
});
