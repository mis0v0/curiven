// Continuing a question the learner raised in their own explanation (Q3-C2), in the real UI.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/question_continuity.e2e.test.js
// ALL AI RESPONSES ARE MOCKED (scripted). These tests show what the interface suggests, sends and keeps; they are NOT
// evidence that a tutor answer is right or that the interaction helps anyone learn.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(7500+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
// Synthetic learner writing (not recorded from anyone).
const Q='그런데 숫자만 받는 칸이면 바인딩 없이도 안전한 건가요?';
const EXPL='SQL 인젝션은 입력값이 쿼리 문장에 그대로 이어 붙어서 명령처럼 실행되는 문제예요. 바인딩을 쓰면 값이 따로 전달돼요. '+Q;
const Q1='세션은 서버가 기억하는 건가요?',Q2='그럼 쿠키를 지우면 로그인도 풀릴까요?';
const TWO='쿠키는 브라우저에 저장되는 작은 데이터예요. '+Q1+' '+Q2,NONE='쿠키는 브라우저에 저장되고, 요청할 때마다 서버로 같이 가요.';

const rec=(drafts=[],extra={})=>({id:'A',topic:'SQL Injection',interest:'',level:'beginner',stage:4,maxStage:4,lesson:SQLI,prediction:'',scenarios:[],drafts,feedback:null,events:[],createdAt:1700000000000,updatedAt:1700000000000,complete:false,...extra});

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});

/** ai(body) → data | {status,json}. Every /api/ai request body is recorded in `calls`. */
async function open(lessons,{ai=()=>({reply:'답'}),online=true,viewport={width:1280,height:900}}={}){
 const ctx=await browser.newContext({viewport});const calls=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active:'A'}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:online?{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}:{provider:'chatgpt',online:false,status:'disconnected',sharing:false}}));
 const state={ai};
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());calls.push(body);const res=await state.ai(body);
  if(res&&res.status)return r.fulfill({status:res.status,json:res.json}).catch(()=>{});
  return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:res}}).catch(()=>{})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(URL);await page.waitForFunction(o=>new RegExp(o?'ChatGPT 연결':'연결 안 됨').test(document.querySelector('#status').textContent),online);
 await page.waitForSelector('#draft');
 return {ctx,page,calls,errors,state};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const reply=(text,extra={})=>({reply:text,followUp:'',assessment:null,uncertainty:'',...extra});
const composer='#tutorThread #tin-general';

test('a question in a saved explanation: offered verbatim, edited by the learner, answered with the explanation as context; nothing else changes',async()=>{
 // The coach (wrongly) calls the learner's question a misconception; the validator keeps it out of misconceptions.
 // Shaped like the server's normalized output (server.py review_feedback sets schema 2 and demonstrated).
 const feedback={schema:2,demonstrated:[],summary:'입력과 명령이 섞이는 원리를 잘 짚었어요.',correct:[{quote:'입력값이 쿼리 문장에 그대로 이어 붙어서',point:'원인을 정확히 짚었어요.'}],precision:[],
  misconceptions:[{quote:'숫자만 받는 칸이면 바인딩 없이도 안전한 건가요',issue:'숫자 칸도 검증 없이는 위험해요.',why:'서버가 받는 값은 문자열일 수 있어요.',question:'숫자 칸에 글자가 들어오면 어떻게 될까요?'}],missing:[],explained:[],uncertainty:''};
 const {ctx,page,calls,errors}=await open([rec()],{ai:b=>b.mode==='feedback'?feedback
  :reply('숫자 칸이라도 서버는 값을 글자로 받을 수 있어서, 바인딩을 쓰는 편이 안전해요.',{assessment:{verdict:'misconception',quote:'바인딩이 필요한가요',note:'n'}})});
 await page.fill('#draft',EXPL);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('#draftHistory .feedback');
 assert.equal(await page.locator('.fb-misconception').count(),0,'a question is not shown as a misconception');
 assert.match(await page.textContent('.fb-precision'),/^질문·가설의 전제 확인: “숫자만 받는 칸이면 바인딩 없이도 안전한 건가요” — /,'labelled as a premise check, not "더 정확하게"');
 const before=(await stored(page)).lessons[0];assert.equal(calls.length,1);

 const ask=page.locator('#draftAskBtn-1');assert.equal(await ask.textContent(),'설명 속 질문 이어서 묻기');
 await ask.click();await page.waitForSelector('#helpRegion');
 assert.equal(await page.evaluate(()=>document.getElementById('draftAsk-1').nextElementSibling?.id),'helpRegion','opened right below that explanation');
 assert.match(await page.textContent('#helpRegion .help-context'),/지금 묻는 부분: 내 설명 1/);
 assert.match(await page.textContent('#helpNote'),/그대로 옮겨 두었어요.*보내기 전에는 AI에게 전달되지 않아요/);
 assert.equal(await page.inputValue(composer),Q,'the learner\'s exact words');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'tin-general');
 assert.equal(calls.length,1,'opening and prefilling sends nothing');
 assert.equal(await page.locator('.help-region').count(),1,'the one help region, no second chat panel');
 assert.equal(await page.locator('#draftHistory [data-tutor-thread]').count(),1,'the help region holds the only open conversation (feedback threads stay collapsed)');

 // The learner rewrites the question before sending it.
 const EDITED='숫자만 받는 칸이라도 바인딩이 필요한가요? 예를 들어 나이 입력 칸이요.';
 await page.fill(composer,EDITED);await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 const t=calls.filter(c=>c.mode==='tutor');assert.equal(t.length,1);
 assert.equal(t[0].message,EDITED);assert.equal(t[0].intent,'ask');assert.deepEqual(t[0].focus,{kind:'draft',draft:EXPL});
 assert.equal(await page.locator('#helpNote').count(),0,'the "not sent yet" note is gone once the question is sent');
 const view=await page.textContent('#tutorThread');assert.match(view,/AI 튜터/);assert.match(view,/바인딩을 쓰는 편이 안전해요/);
 assert.equal(await page.locator('#tutorThread .tutor-assess').count(),0,'a question is answered, not labelled');

 const after=(await stored(page)).lessons[0];
 assert.deepEqual(after.drafts,before.drafts,'explanation and its feedback unchanged');assert.deepEqual(after.feedback,before.feedback);
 assert.equal(after.complete,false);
 const mine=after.dialogue.filter(m=>m.role==='learner');assert.equal(mine.length,1);
 assert.equal(mine[0].text,EDITED);assert.deepEqual(mine[0].ref,{kind:'draft',at:before.drafts[0].at});assert.equal(mine[0].status,'answered');
 assert.equal(await page.inputValue('#draft'),EXPL,'the explanation editor still holds the explanation');
 // An answered (or unanswered) question does not gate completion.
 await page.click('text=학습 마무리하기 →');await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).lessons[0].complete===true,KEY);
 assert.deepEqual((await stored(page)).lessons[0].drafts,before.drafts);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('several questions, no question, cancelling, and text the learner already typed',async()=>{
 const {ctx,page,calls,errors}=await open([rec([{text:NONE,at:1000,feedback:null},{text:TWO,at:2000,feedback:null}])]);
 assert.equal(await page.textContent('#draftAskBtn-2'),'설명 속 질문 이어서 묻기');assert.equal(await page.textContent('#draftAskBtn-1'),'이 설명에 대해 묻기');
 await page.click('#draftAskBtn-2');assert.equal(await page.inputValue(composer),Q1+'\n'+Q2,'both questions, in order, each as written');
 // Cancel: nothing is sent or stored, the untouched suggestion is removed, focus goes back to where the learner was.
 await page.keyboard.press('Escape');await page.waitForSelector('#helpRegion',{state:'detached'});
 assert.equal(await page.evaluate(()=>document.activeElement.id),'draftAskBtn-2');
 assert.equal(calls.length,0);assert.equal((await stored(page)).lessons[0].dialogue,undefined);
 // An explanation without a question: the same region, empty, with that explanation as context (manual fallback).
 await page.click('#draftAskBtn-1');assert.equal(await page.inputValue(composer),'','not carried over from the cancelled suggestion');
 assert.match(await page.textContent('#helpRegion .help-context'),/내 설명 1/);assert.equal(await page.locator('#helpNote').count(),0);
 // Text the learner typed is never replaced by a suggestion, and survives closing.
 await page.fill(composer,'내가 쓰던 질문');await page.click('#draftAskBtn-2');
 assert.equal(await page.inputValue(composer),'내가 쓰던 질문');assert.match(await page.textContent('#helpNote'),/쓰던 글이 있어서 그대로 두었어요/);
 assert.match(await page.textContent('#helpRegion .help-context'),/내 설명 2/);
 await page.click('#helpRegion .help-close');await page.click('#helpToggle');assert.equal(await page.inputValue(composer),'내가 쓰던 질문');
 assert.equal(calls.length,0);
 assert.deepEqual((await stored(page)).lessons[0].drafts.map(d=>d.text),[NONE,TWO]);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('no AI connection keeps the question as a note; a tutor failure keeps the question and the explanation',async()=>{
 let {ctx,page,calls,errors}=await open([rec([{text:EXPL,at:1000,feedback:null}])],{online:false});
 await page.click('#draftAskBtn-1');assert.equal(await page.inputValue(composer),Q);
 assert.equal(await page.textContent('#tutorThread .tutor-send'),'메모로 남기기');
 await page.click('#tutorThread .tutor-send');await page.waitForSelector('text=메모로 남긴 질문이에요.');
 let s=(await stored(page)).lessons[0];
 assert.deepEqual(s.dialogue.map(m=>[m.text,m.status,m.ref]),[[Q,'noted',{kind:'draft',at:1000}]]);assert.equal(calls.length,0);
 assert.deepEqual(s.drafts,[{text:EXPL,at:1000,feedback:null}]);assert.deepEqual(errors,[]);await ctx.close();

 let state;({ctx,page,calls,errors,state}=await open([rec([{text:EXPL,at:1000,feedback:null}])],{ai:()=>({status:502,json:{ok:false,error:'AI 응답을 받지 못했어요.'}})}));
 await page.click('#draftAskBtn-1');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-retry');
 assert.match(await page.textContent('#tutorThread'),/답을 받지 못했어요/);
 s=(await stored(page)).lessons[0];assert.deepEqual(s.dialogue.map(m=>[m.text,m.status]),[[Q,'failed']]);
 assert.deepEqual(s.drafts,[{text:EXPL,at:1000,feedback:null}]);assert.equal(await page.inputValue('#draft'),EXPL);
 state.ai=()=>reply('다시 보낸 질문의 답이에요.');await page.click('#tutorThread .tutor-retry');await page.waitForSelector('text=다시 보낸 질문의 답이에요.');
 s=(await stored(page)).lessons[0];assert.deepEqual(s.dialogue.filter(m=>m.role==='learner').map(m=>[m.text,m.status]),[[Q,'answered']]);
 assert.equal(calls.filter(c=>c.mode==='tutor').at(-1).focus.draft,EXPL);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('phone width and keyboard only: reachable, no sideways scrolling, sends only on request, focus returns',async()=>{
 const {ctx,page,calls,errors}=await open([rec([{text:EXPL,at:1000,feedback:null}])],{viewport:{width:390,height:844},ai:()=>reply('짧은 답이에요.')});
 const btn=page.locator('#draftAskBtn-1');const box=await btn.boundingBox();assert.ok(box.height>=44,'touch target at least 44px');
 await btn.focus();await page.keyboard.press('Enter');await page.waitForSelector('#helpRegion');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'tin-general');assert.equal(await page.inputValue(composer),Q);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'no horizontal overflow');
 const r=await page.locator('#helpRegion').boundingBox();assert.ok(r.x>=0&&r.x+r.width<=390,'help region fits the screen');
 assert.equal(calls.length,0);
 await page.keyboard.press('Control+Enter');await page.waitForSelector('#tutorThread .tutor-msg.ai');assert.equal(calls.filter(c=>c.mode==='tutor').length,1);
 await page.keyboard.press('Escape');await page.waitForSelector('#helpRegion',{state:'detached'});
 assert.equal(await page.evaluate(()=>document.activeElement.id),'draftAskBtn-1');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('a tutor opinion quotes only what the learner actually wrote',async()=>{
 const SAID='SQL 인젝션은 입력값을 쿼리에 그대로 이어 붙여서 생겨요. 바인딩을 쓰면 입력값이 명령으로 해석되지 않아요.';
 // The model quotes a paraphrase that flips the meaning; the 80% quote check accepts it, the display must not.
 const {ctx,page,errors}=await open([rec()],{ai:()=>reply('바인딩의 효과를 다시 봐요.',{assessment:{verdict:'misconception',quote:'입력값이 명령으로 해석돼요',note:'n'}})});
 await page.click('#helpToggle');await page.fill(composer,SAID);await page.click('#tutorThread .tutor-check');await page.waitForSelector('#tutorThread .tutor-assess');
 const shown=await page.textContent('#tutorThread .tutor-assess');
 assert.equal(shown,'AI 의견: 사실과 다른 부분이 있어요 — “바인딩을 쓰면 입력값이 명령으로 해석되지 않아요.”');
 assert.ok(!shown.includes('“입력값이 명령으로 해석돼요”'));
 assert.equal((await stored(page)).lessons[0].dialogue.find(m=>m.role==='tutor').assessment.quote,'입력값이 명령으로 해석돼요','the record keeps what the model returned');
 assert.deepEqual(errors,[]);await ctx.close();
});
