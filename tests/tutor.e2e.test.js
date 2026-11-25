// Beginner scaffolding, lesson-scoped tutoring, feedback replies and the Markdown note in the real UI.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/tutor.e2e.test.js
// ALL AI RESPONSES ARE MOCKED (scripted). These tests show that the interface lets a learner ask, answer,
// revise and resume, and that data is kept intact. They are NOT evidence of real teaching quality.
// Optional: SCREEN_DIR=<dir> saves screenshots; TIMING_OUT=<file> writes scripted timings.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const {openSettings,closeSettings,importFile,clickExport}=require('./ui_helpers.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8500+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.SCREEN_DIR,timings={};
const shot=async(page,name)=>{if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:true})}};
const shown=md=>md.replace(/ {2}\n/g,'\n').replace(/\\([\\`*_\[\]<>#|~&\-+=.)])/g,'$1');
const BLACKHOLE={title:'블랙홀은 왜 빛을 가둘까',hook:'빛보다 빠른 것은 없는데, 왜 빛도 빠져나오지 못할까요?',
 prerequisites:[{term:'탈출 속도',plain:'어떤 천체의 중력을 벗어나려면 필요한 최소 속도예요.',example:'지구의 탈출 속도는 초속 약 11.2km예요.'}],
 story:'천문 동아리에서 별이 사라지는 영상을 보았어요.',prediction:'빛이 블랙홀 가까이 가면 어떻게 될까요?',
 scenarios:[{title:'탈출 속도 비교',question:'탈출 속도가 빛의 속도보다 크면 빛은 어떻게 될까요?',options:['빠져나온다','빠져나오지 못한다'],answerIndex:1,hint:'탈출 속도의 뜻을 다시 떠올려 보세요.',reason:'고전적 설명으로는 빛도 그 경계 안쪽에서 빠져나오지 못해요. 실제 블랙홀은 일반 상대성 이론으로 설명해요.'}],
 concepts:[{id:'k1',name:'사건의 지평선',description:'빛도 빠져나올 수 없는 경계.'},{id:'k2',name:'탈출 속도',description:'중력을 벗어나는 데 필요한 최소 속도.'},{id:'k3',name:'일반 상대성 이론',description:'중력을 시공간의 휘어짐으로 설명하는 이론.'}],
 connections:[{from:'k2',to:'k1',why:'탈출 속도가 광속이 되는 지점'}],technical:[{heading:'사건의 지평선',plain:'돌아올 수 없는 경계예요.',steps:['질량이 작은 공간에 모인다','탈출 속도가 커진다','광속과 같아지는 경계가 생긴다'],text:'사건의 지평선은 그 안쪽의 사건이 바깥 관찰자에게 영향을 줄 수 없는 경계다.'}],
 explainPrompt:'블랙홀이 빛을 가두는 이유를 설명해 보세요.',limitations:'고전적 탈출 속도 비유는 근사예요.'};

const rec=(id,lesson,stage,extra={})=>({id,topic:extra.topic||'SQL Injection',interest:'',level:'beginner',stage,maxStage:Math.max(stage,extra.maxStage??stage),lesson,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:1700000000000,updatedAt:1700000000000,complete:stage===5,...extra});

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill();if(process.env.TIMING_OUT)fs.writeFileSync(process.env.TIMING_OUT,JSON.stringify(timings,null,1))});

/** ai(body,calls) → data | {status,json} | 'abort' | {delay,data}. Every /api/ai request body is recorded in `calls`. */
async function open(lessons,active,{ai=()=>({reply:'답'}),online=true,viewport={width:1280,height:900},reducedMotion}={}){
 const ctx=await browser.newContext({viewport,reducedMotion});const calls=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:online?{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}:{provider:'chatgpt',online:false,status:'disconnected',sharing:false}}));
 const state={ai};
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());calls.push(body);let res=await state.ai(body,calls);
  if(res&&res.delay){await new Promise(z=>setTimeout(z,res.delay));res=res.data}
  if(res==='abort')return r.abort('internetdisconnected').catch(()=>{});
  if(res&&res.status)return r.fulfill({status:res.status,json:res.json}).catch(()=>{});
  return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:res}}).catch(()=>{})});
 const page=await ctx.newPage();const errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.accept()});
 await page.goto(URL);await page.waitForFunction(o=>new RegExp(o?'ChatGPT 연결':'연결 안 됨').test(document.querySelector('#status').textContent),online);
 return {ctx,page,calls,errors,dialogs,state};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const tutorCalls=calls=>calls.filter(c=>c.mode==='tutor');
const reply=(text,extra={})=>({reply:text,followUp:'',assessment:null,uncertainty:'',...extra});
/** Open the one help region from the stage's entry bar (no-op when it is already open). */
const help=async page=>{if(!(await page.locator('#tutorThread').count()))await page.click('#helpToggle');await page.waitForSelector('#tutorThread')};

test('1 beginner: prerequisites before guessing, terms and hint at the question, glossary → ask the tutor',async()=>{
 const t0=Date.now();
 const {ctx,page,calls,errors}=await open([rec('A',SQLI,1)],'A',{ai:b=>reply(`“${b.focus?.term}”은 쿼리 모양을 고정하고 입력을 값으로만 넘기는 방법이에요.\n예: WHERE title = ?`)});
 const pre=page.locator('#prereqs');assert.equal(await pre.getAttribute('open'),'','beginner profile: prerequisites shown open before the story');
 assert.match(await pre.textContent(),/값 바인딩.*질문의 틀을 먼저 정해 두고/s);
 await shot(page,'desktop-1-prerequisites');
 assert.equal(calls.length,0,'no AI request without a learner action');
 await page.click('text=예상 없이 둘러보기');await page.waitForSelector('text=예상과 결과를 비교해 봐요');
 let s=await stored(page);assert.equal(s.lessons[0].predictionUnsure,true);assert.equal(s.lessons[0].prediction,'');
 const box=page.locator('.concept',{hasText:'생각 실험 2'});
 await box.locator('summary',{hasText:'먼저 알아볼 개념 2개'}).click();
 assert.match(await box.locator('.tutor-terms').textContent(),/쿼리.*값 바인딩/s);
 await box.locator('text=힌트 보기').click();assert.match(await box.textContent(),/힌트: 물음표 자리에/);
 await shot(page,'desktop-2-scenario-help');
 assert.equal(calls.length,0,'terms and hints need no AI');
 await help(page);await page.locator('#glossary summary').click();
 await page.locator('#glossary .tutor-term',{hasText:'값 바인딩'}).first().locator('text=AI에게 더 물어보기').click();
 await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.equal(tutorCalls(calls).length,1);const c=calls[0];
 assert.equal(c.intent,'meaning');assert.deepEqual(c.focus,{kind:'term',term:'값 바인딩',description:'질문의 틀을 먼저 정해 두고, 사용자가 적은 글자는 빈자리에 값으로만 넣는 방법이에요.'});
 assert.match(await page.textContent('#tutorThread'),/“값 바인딩”이\(가\) 무슨 뜻인지 쉽게 설명해 줘\..*쿼리 모양을 고정하고/s);
 s=await stored(page);assert.deepEqual(s.lessons[0].dialogue.map(m=>[m.role,m.status??null]),[['learner','answered'],['tutor',null]]);
 timings.beginnerPrereqToAnswerMs=Date.now()-t0;
 assert.deepEqual(errors,[]);await ctx.close();
});

test('2–3 "잘 모르겠어요" without penalty, then "더 쉽게" about that thought experiment; layered explanations',async()=>{
 const {ctx,page,calls,errors}=await open([rec('A',SQLI,2,{maxStage:2})],'A',{ai:b=>reply(b.intent==='simpler'?'쉽게 말하면, 따옴표 때문에 검색어가 명령의 일부가 됐어요.':'x')});
 const s1=page.locator('.concept',{hasText:'생각 실험 1'});
 await s1.locator('text=잘 모르겠어요 — 해설 보기').click();
 await page.waitForSelector('text=괜찮아요. 해설을 천천히 읽어 보세요.');
 assert.equal(await s1.locator('.opt.wrong').count(),0,'no "wrong" mark for an honest "I don\'t know"');
 assert.match(await s1.textContent(),/조건이 모든 행에서 참이에요/);
 let s=await stored(page);assert.deepEqual(s.lessons[0].scenarios.map(x=>({i:x.i,choice:x.choice,unsure:x.unsure})),[{i:0,choice:null,unsure:true}]);
 await s1.locator('text=이 해설에 대해 묻기').click();
 await s1.locator('.tutor-chip[data-intent=simpler]').click();
 await s1.locator('.tutor-msg.ai').waitFor();
 const c=tutorCalls(calls)[0];assert.equal(c.intent,'simpler');assert.equal(c.focus.kind,'scenario');assert.equal(c.focus.answered,true);assert.match(c.focus.reason,/조건이 모든 행에서 참/);
 assert.match(await s1.textContent(),/더 쉽게 설명해 줘.*쉽게 말하면, 따옴표 때문에/s);
 const s2=page.locator('.concept',{hasText:'생각 실험 2'});await s2.locator('.opt').filter({hasText:'똑같은 제목'}).click();await s2.locator('text=예상 확인하기').click();
 await page.waitForSelector('#predictionCompare');assert.match(await page.textContent('#predictionCompare'),/사고 실험 1: 잘 모르겠다고 기록.*사고 실험 2: 내 선택/s);
 await page.click('text=원리 알아보기 →');await page.waitForSelector('#keyConcepts');
 assert.match(await page.textContent('#keyConcepts'),/값 바인딩 — 쿼리의 틀을 정해 두고/);
 const first=page.locator('.concept',{hasText:'입력과 명령의 구분'});
 assert.match(await first.locator('.tech-plain').textContent(),/입력이 ‘명령의 일부’로 읽히는/);
 // Phase 2B: the process is shown as a visible sequence (no visual in this section); example, misreading and conditions
 // sit behind ONE "더 보기" per section (was four toggles plus a page-wide toggle).
 assert.equal(await first.locator('.tech-sequence .tech-steps li').count(),4);assert.ok(await first.locator('.tech-sequence').isVisible());
 const more=first.locator('details.tech-more');assert.equal(await more.count(),1);assert.equal(await more.evaluate(d=>d.open),false,'essential first; deeper layers on demand');
 assert.deepEqual(await more.locator('[data-layer]').evaluateAll(d=>d.map(x=>x.dataset.layer)),['example','misread','conditions']);
 assert.ok(await first.locator('.tech-plain').isVisible()&&await first.locator('.tech-precise').isVisible(),'plain words and the precise explanation are always shown');
 await more.locator('summary').click();assert.match(await first.locator('[data-layer=example] pre code').textContent(),/^SELECT title FROM books WHERE title = '' OR '1'='1'$/);
 assert.equal(await page.locator('text=자세한 내용 모두 펼치기').count(),0);
 await shot(page,'desktop-3-layered-concepts');
 assert.equal(tutorCalls(calls).length,1);assert.deepEqual(errors,[]);await ctx.close();
});

const D1='바인딩은 사용자 입력을 문자열로 처리해서 쿼리에 넣는 것이라 SQL Injection을 막아요.';
const FB={schema:2,summary:'핵심을 짚었어요. 바인딩이 무엇을 따로 전달하는지 다시 설명해 볼까요?',correct:[],precision:[{quote:'사용자 입력을 문자열로 처리해서',issue:'바인딩과 문자열 처리를 구분하기',why:'바인딩하는 값은 문자열에 한정되지 않고, 문자열을 조립하는 것과 다른 방식이에요.',question:'바인딩은 쿼리와 무엇을 따로 전달할까요?'}],misconceptions:[],missing:[],explained:[],uncertainty:''};
const R1='값을 쿼리 구조와 따로 전달한다는 뜻인 것 같아요',R2='열 이름은 구조라서 값으로는 못 넘길 것 같아요';
function tutorScript(b,calls){
 if(b.mode==='feedback')return FB;
 if(b.message===R1)return reply('네, 핵심이에요. 다만 “문자열”이 아니라 “값”이라고 하는 편이 정확해요.',{followUp:'그렇다면 열 이름도 같은 방식으로 넘길 수 있을까요?',assessment:{verdict:'imprecise',quote:'쿼리 구조와 따로 전달',note:'방향은 맞고 용어를 다듬으면 돼요.'}});
 if(b.message===R2)return reply('맞아요. 열 이름은 식별자라서 허용 목록으로 골라야 해요.',{assessment:{verdict:'correct',quote:'열 이름은 구조라서',note:''}});
 return reply('예시는 이래요:\n```sql\nSELECT title FROM books WHERE title = ?\n```\n입력은 ? 자리에 값으로만 들어가요.');
}

test('4–5 answer a feedback question, answer the tutor\'s follow-up, then revise — every version kept verbatim',async()=>{
 const t0=Date.now();
 const {ctx,page,calls,errors}=await open([rec('A',SQLI,4,{scenarios:[{i:0,choice:0,at:1},{i:1,choice:1,at:2}]})],'A',{ai:tutorScript});
 await page.fill('#draft',D1);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('.fb-precision');
 const fb=page.locator('.feedback').first();
 await fb.locator('.tutor-open',{hasText:'이 질문에 답하기'}).click();
 const th=fb.locator('.tutor-thread').first();await th.locator('textarea').fill(R1);await th.locator('.tutor-send').click();
 await th.locator('.tutor-assess').waitFor();
 let c=tutorCalls(calls).at(-1);assert.equal(c.intent,'reply');assert.equal(c.focus.kind,'feedback');assert.equal(c.focus.type,'precision');assert.equal(c.focus.question,FB.precision[0].question);assert.equal(c.focus.draft,D1);assert.deepEqual(c.history,[]);
 assert.equal(c.context.story,SQLI.story,'the story and thought experiments travel with the request (UX-12)');assert.equal(c.context.scenarios[1].learnerChoice,SQLI.scenarios[1].options[1]);
 const fbCall=calls.find(x=>x.mode==='feedback');assert.equal(fbCall.context.story,SQLI.story);assert.equal(fbCall.context.scenarios[0].learnerChoice,SQLI.scenarios[0].options[0]);
 assert.match(await th.locator('.tutor-assess').textContent(),/AI 의견: 대체로 맞아요 · 다듬을 점이 있어요 — “쿼리 구조와 따로 전달”/);
 assert.match(await th.locator('.tutor-follow').textContent(),/그렇다면 열 이름도/);
 await shot(page,'desktop-4-feedback-reply');
 await th.locator('.tutor-answer').click();assert.match(await th.locator('.tutor-replying').textContent(),/답하는 질문: 그렇다면 열 이름도/);
 await th.locator('textarea').fill(R2);await th.locator('.tutor-send').click();
 await page.waitForFunction(()=>document.querySelectorAll('.feedback .tutor-thread .tutor-msg.ai').length===2);
 c=tutorCalls(calls).at(-1);assert.equal(c.message,R2);assert.equal(c.history.length,2);assert.match(c.history[1].text,/\(튜터의 질문\) 그렇다면 열 이름도/);
 assert.match(await th.locator('.tutor-follow').first().textContent(),/답했어요/);
 // Revise: a new version; the first explanation and its feedback stay.
 const D2='바인딩은 쿼리 구조를 먼저 고정하고, 입력은 값으로만 따로 전달해서 문법으로 해석되지 않게 해요. 열 이름은 허용 목록으로 골라요.';
 await page.fill('#draft',D2);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('text=내 설명 2개 기록');
 assert.match(await page.textContent('#draftHistory'),/설명 2 · 고쳐 쓴 설명.*설명 1 · 처음 쓴 설명/s);
 const s=(await stored(page)).lessons[0];
 assert.deepEqual(s.drafts.map(d=>d.text),[D1,D2]);
 const learner=s.dialogue.filter(m=>m.role==='learner');assert.deepEqual(learner.map(m=>m.text),[R1,R2]);
 assert.equal(learner[1].inReplyTo,s.dialogue.find(m=>m.role==='tutor').id);
 assert.equal(tutorCalls(calls).length,2);assert.equal(calls.filter(x=>x.mode==='feedback').length,2);
 timings.feedbackTwoRoundsAndRevisionMs=Date.now()-t0;
 assert.deepEqual(errors,[]);await ctx.close();
});

test('6 navigate away while waiting; typing elsewhere is not disturbed; reload mid-request → resend',async()=>{
 const {ctx,page,state,errors}=await open([rec('A',SQLI,4,{maxStage:4})],'A',{ai:()=>({delay:1200,data:reply('늦게 온 답이에요.')})});
 await page.click('.navitem:has-text("3. 탐구")');await help(page);
 await page.fill('#tutorThread textarea','값 바인딩이 왜 안전한가요?');await page.click('#tutorThread .tutor-send');
 await page.waitForSelector('text=답을 쓰는 중');
 await page.click('.navitem:has-text("4. 개념")');await page.waitForSelector('#keyConcepts');
 await page.waitForSelector('#tutorThread .tutor-msg.ai');assert.match(await page.textContent('#tutorThread'),/늦게 온 답이에요/,'reply landed while the learner was on another stage');
 // A reply arriving while the learner types their explanation must not wipe or blur it.
 await page.click('.navitem:has-text("5. 설명")');await help(page);await page.fill('#tutorThread textarea','하나 더 물어볼게요');await page.click('#tutorThread .tutor-send');
 await page.click('#draft');await page.keyboard.type('지금 쓰는 중인 설명');
 await page.waitForFunction(()=>document.querySelectorAll('#tutorThread .tutor-msg.ai').length===2);
 assert.equal(await page.inputValue('#draft'),'지금 쓰는 중인 설명');assert.equal(await page.evaluate(()=>document.activeElement.id),'draft');
 // Reload while a request is in flight: the question is kept and can be sent again.
 state.ai=()=>({delay:60000,data:reply('x')});
 await page.fill('#tutorThread textarea','페이지를 떠나기 직전 질문');await page.click('#tutorThread .tutor-send');await page.waitForSelector('text=답을 쓰는 중');
 await page.reload();await page.waitForSelector('#tutorThread .tutor-retry');
 // Depending on timing the browser either aborts the fetch (→ "connection lost") or closes first (→ "interrupted").
 assert.match(await page.textContent('#tutorThread'),/페이지를 떠나기 직전 질문.*(요청이 중간에 끊겼어요|연결이 끊겨 답을 받지 못했어요)/s);
 state.ai=()=>reply('다시 보낸 질문의 답');await page.click('#tutorThread .tutor-retry');await page.waitForSelector('text=다시 보낸 질문의 답');
 const s=(await stored(page)).lessons[0];assert.deepEqual(s.dialogue.filter(m=>m.role==='learner').map(m=>[m.text,m.status]),[['값 바인딩이 왜 안전한가요?','answered'],['하나 더 물어볼게요','answered'],['페이지를 떠나기 직전 질문','answered']]);
 assert.equal(s.dialogue.filter(m=>m.role==='tutor').length,3,'no duplicate question was created by resending');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('7 quota, connection loss, malformed reply, cancel, and offline memo — the question is never lost',async()=>{
 const {ctx,page,state,calls,errors}=await open([rec('A',SQLI,3,{maxStage:3})],'A',{ai:()=>({status:429,json:{ok:false,code:'subscription_sharing_usage_limit_exceeded',error:'ChatGPT 사용 한도에 도달했어요. https://chatgpt.com/settings/usage 에서 사용량을 확인해 주세요.'}})});
 const ask=async q=>{await help(page);await page.fill('#tutorThread textarea',q);await page.click('#tutorThread .tutor-send')};
 await ask('한도 질문');await page.waitForSelector('.tutor-error');assert.match(await page.textContent('.tutor-error'),/사용 한도에 도달/);
 state.ai=()=> 'abort';await page.click('.tutor-retry');await page.waitForFunction(()=>/연결이 끊겨 답을 받지 못했어요/.test(document.querySelector('.tutor-error')?.textContent||''));
 state.ai=()=>({reply:''});await page.click('.tutor-retry');await page.waitForFunction(()=>/튜터 응답이 비어 있어요/.test(document.querySelector('.tutor-error')?.textContent||''));
 state.ai=()=>({delay:5000,data:reply('취소 후 답')});await page.click('.tutor-retry');await page.click('.tutor-msg.me button:has-text("취소")');await page.waitForSelector('text=요청을 취소했어요.');
 state.ai=()=>reply('드디어 답');await page.click('.tutor-retry');await page.waitForSelector('text=드디어 답');
 let s=(await stored(page)).lessons[0];assert.deepEqual(s.dialogue.filter(m=>m.role==='learner').map(m=>[m.text,m.status]),[['한도 질문','answered']]);
 assert.ok(tutorCalls(calls).length>=4);assert.deepEqual(errors,[]);await ctx.close();
 // Offline: AI buttons are disabled; the learner can still keep their question as a memo and continue.
 const off=await open([rec('B',SQLI,3,{maxStage:3,dialogue:[{id:'p1',role:'learner',text:'창을 닫기 전 질문',intent:'ask',ref:null,stage:3,at:1,status:'pending'}]})],'B',{online:false});
 await off.page.waitForSelector('#tutorThread',{timeout:3000}).catch(()=>{});assert.ok(await off.page.locator('#helpRegion').count(),'an unfinished question re-opens the help region by itself');
 assert.match(await off.page.textContent('#tutorThread'),/창을 닫기 전 질문.*요청이 중간에 끊겼어요/s,'a request that never finished shows as interrupted, never as still waiting');
 assert.equal(await off.page.textContent('#tutorThread .tutor-send'),'메모로 남기기','offline, the one button keeps the question as a memo');assert.equal(await off.page.locator('#tutorThread .tutor-chip').count(),0);
 await off.page.fill('#tutorThread textarea','연결되면 물어볼 질문');await off.page.click('#tutorThread .tutor-send');
 await off.page.waitForSelector('text=메모로 남긴 질문이에요.');
 s=(await stored(off.page)).lessons[0];assert.deepEqual(s.dialogue.map(m=>[m.text,m.status]),[['창을 닫기 전 질문','pending'],['연결되면 물어볼 질문','noted']]);
 assert.equal(off.calls.length,0);await off.page.click('text=이해한 내용 정리하기 →');await off.page.waitForSelector('#draft');
 assert.deepEqual(off.errors,[]);await off.ctx.close();
});

test('8–9 Markdown note (Korean, code blocks, verbatim learner text) next to an unchanged JSON backup',async()=>{
 const {ctx,page,errors}=await open([rec('A',SQLI,4,{scenarios:[{i:0,choice:null,unsure:true,at:1},{i:1,choice:1,at:2}],reflection:'따옴표가 *핵심*이었어요 <정말>'})],'A',{ai:tutorScript});
 await help(page);await page.fill('#tutorThread textarea','바인딩 예시를 # 하나만 보여 줄래요?\n두 번째 줄');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-code');
 assert.equal(await page.textContent('#tutorThread .tutor-code'),'SELECT title FROM books WHERE title = ?');
 await page.fill('#draft',D1);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('.fb-precision');
 await page.click('text=학습 마무리하기 →');await page.waitForSelector('text=오늘의 발견을 돌아봐요');
 await page.evaluate(()=>closeAtlas());
 await page.click('#notionSaveBtn');await page.waitForSelector('#noteDialog[open]');
 const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#noteFileDownload')]);
 assert.match(dl.suggestedFilename(),/^curiven-note-SQL-Injection-\d{8}\.md$/);
 const md=fs.readFileSync(await dl.path(),'utf8');
 assert.ok(md.includes('```sql\nSELECT title FROM books WHERE title = ?\n```'));
 const s=(await stored(page)).lessons[0];
 for(const own of [s.reflection,D1,'바인딩 예시를 # 하나만 보여 줄래요?\n두 번째 줄'])assert.ok(shown(md).includes(own),own);
 assert.match(md,/## 내가 던진 질문\n\n- 바인딩 예시를 \\# 하나만 보여 줄래요\?  \n두 번째 줄 _\(답을 받음\)_/);
 assert.match(md,/\*\*AI 피드백 \(gpt-test\):\*\*/);
 for(const leak of ['독서','curiven-csrf','gpt-test@'])assert.ok(!md.includes(leak),leak);
 await page.keyboard.press('Escape');await page.waitForSelector('#noteDialog',{state:'detached'});
 const [jd]=await Promise.all([page.waitForEvent('download'),clickExport(page)]);
 const backup=JSON.parse(fs.readFileSync(await jd.path(),'utf8'));
 assert.deepEqual(Object.keys(backup),['format','profileVersion','profile','lessons','active','rev']);assert.equal(backup.format,'curiven-v01');
 assert.deepEqual(backup.lessons[0].dialogue,s.dialogue,'JSON keeps the whole conversation losslessly');assert.deepEqual(backup.lessons[0].drafts,s.drafts);
 // Re-import the JSON: the conversation comes back exactly.
 const file=path.join(require('node:os').tmpdir(),`curiven-tutor-${PORT}.json`);fs.writeFileSync(file,JSON.stringify({...backup,lessons:[{...backup.lessons[0],id:'Z'}],active:'Z'}));
 await importFile(page,file);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('curiven-v01-personal')).active==='Z');
 const after=(await stored(page)).lessons[0];assert.deepEqual(after.dialogue,s.dialogue);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('10 historical records render unchanged and are not modified by viewing',async()=>{
 const old={...rec('OLD',SAMPLE,4,{topic:'HTTP 쿠키와 세션',maxStage:5,complete:true}),prediction:'예전 예상',scenarios:[{i:0,choice:1,at:1}],drafts:[{text:'예전 설명입니다',at:5,feedback:{summary:'핵심을 짚었어요',correct:['세션 ID'],misconceptions:[{issue:'세션 위치',question:'세션은 어디에?'}],missing:[],demonstrated:['k1'],uncertainty:''}}],feedback:null};
 const {ctx,page,calls,errors}=await open([old],'OLD');
 const before=JSON.stringify((await stored(page)).lessons);
 for(const n of ['1. 시작','2. 이야기','3. 탐구','4. 개념','5. 설명','6. 성장']){await page.click(`.navitem:has-text("${n}")`);await page.waitForTimeout(50)}
 await page.evaluate(()=>closeAtlas());
 await page.click('.navitem:has-text("4. 개념")');
 assert.equal(await page.locator('.tech-precise').count(),0,'old technical paragraphs render as before (plain text)');
 assert.equal(await page.locator('#prereqs').count(),0);
 await help(page);await page.locator('#glossary summary').click();assert.equal(await page.locator('#glossary .tutor-term').count(),SAMPLE.concepts.length,'glossary from the old concepts');
 await page.click('.navitem:has-text("5. 설명")');assert.match(await page.textContent('#draftHistory'),/예전 설명입니다.*피드백에 대해 말하기/s,'old (v1) feedback can be replied to');
 const s=await stored(page);assert.equal(JSON.stringify(s.lessons.map(l=>({...l,stage:4}))),JSON.stringify(JSON.parse(before).map(l=>({...l,stage:4}))),'viewing changes nothing but the current stage');
 assert.equal(calls.length,0);assert.deepEqual(errors,[]);await ctx.close();
});

test('11 non-security topic: the same scaffolding and tutoring work for astronomy',async()=>{
 const {ctx,page,calls,errors}=await open([rec('S',BLACKHOLE,1,{topic:'블랙홀은 왜 빛을 가둘까?'})],'S',{ai:()=>reply('탈출 속도는 던진 공이 다시 떨어지지 않으려면 필요한 속도예요.',{followUp:'빛의 속도와 비교하면 어떨까요?'})});
 assert.match(await page.textContent('#prereqs'),/탈출 속도.*11\.2km/s);
 await page.fill('#prediction','빛이 휘어서 돌아 나올 것 같아요');await page.click('text=예상 남기고 계속하기 →');
 const box=page.locator('.concept',{hasText:'생각 실험 1'});assert.match(await box.locator('summary').first().textContent(),/먼저 알아볼 개념 1개/);
 await box.locator('text=이 문제에 대해 묻기').click();await box.locator('.tutor-chip[data-intent=simpler]').click();await box.locator('.tutor-msg.ai').waitFor();
 const c=calls[0];assert.equal(c.lesson.title,BLACKHOLE.title);assert.equal(c.focus.answered,false);assert.equal(c.focus.reason,undefined);
 assert.ok(!JSON.stringify(c).match(/SQL|쿠키|보안/),'nothing security-specific in a general request');
 await shot(page,'desktop-5-astronomy-ask');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('12 no achievement from AI agreement; dev-only boundary stays off the normal route',async()=>{
 const {ctx,page,errors}=await open([rec('A',SQLI,4,{maxStage:5})],'A',{ai:b=>reply('정확해요.',{assessment:{verdict:'correct',quote:b.message.slice(0,12),note:''}})});
 const tiers=()=>page.evaluate(()=>modelAtlas(data.lessons[0],'today').nodes.filter(n=>!n.topic).map(n=>n.tier));
 const before=await tiers();
 await help(page);let n=0;for(const q of ['SQL Injection은 입력이 문법으로 해석되는 문제예요','값 바인딩은 입력을 값으로만 전달해요']){n++;await page.fill('#tutorThread textarea',q);await page.click('#tutorThread .tutor-check');await page.waitForFunction(k=>document.querySelectorAll('#tutorThread .tutor-assess').length===k,n)}
 assert.match(await page.textContent('#tutorThread'),/AI 의견: 맞게 이해했어요/,'“내 이해 확인받기” reviews the statement');
 assert.deepEqual(await tiers(),before);assert.ok(before.every(t=>t==='encountered'));
 assert.match(await page.textContent('#helpRegion'),/답이 틀릴 수 있어요/);assert.equal(await page.locator('#tutorThread .tutor-send').count(),1,'one question button');assert.equal(await page.locator('#tutorThread .tutor-check').count(),1,'one review button');
 assert.equal(await page.locator('#boundaryEntry, .boundary').count(),0);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('mobile + reduced motion: conversation, feedback reply and glossary fit a phone without horizontal scroll',async()=>{
 const {ctx,page,errors}=await open([rec('A',SQLI,4,{maxStage:4})],'A',{ai:tutorScript,viewport:{width:375,height:780},reducedMotion:'reduce'});
 await page.fill('#draft',D1);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('.fb-precision');
 const fb=page.locator('.feedback').first();await fb.locator('.tutor-open',{hasText:'이 질문에 답하기'}).click();
 await fb.locator('.tutor-thread textarea').first().fill(R1);await fb.locator('.tutor-thread .tutor-send').first().click();await fb.locator('.tutor-assess').waitFor();
 await help(page);await page.fill('#tutorThread textarea','예시 보여 줘');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-code');
 await page.locator('#glossary summary').click();
 const w=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth}));assert.ok(w.doc<=w.win,`no horizontal page scroll (${w.doc} > ${w.win})`);
 await fb.scrollIntoViewIfNeeded();await shot(page,'mobile-1-feedback-reply');
 await page.locator('#helpRegion').scrollIntoViewIfNeeded();await shot(page,'mobile-2-tutor-panel');
 // Keyboard: the reply composer and quick chips are reachable and labelled.
 assert.equal(await page.getAttribute('#tutorThread textarea','aria-label'),'AI 튜터에게 보낼 메시지');
 assert.equal(await page.getAttribute('#tutorThread .tutor-chips','role'),'group');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('13 help where the learner is: entry at the top, one region, section context, keyboard, unfinished answers kept',async()=>{
 const {ctx,page,calls,errors}=await open([rec('A',SQLI,1,{maxStage:3})],'A',{ai:b=>reply(`(${b.focus?.kind||'general'}) 쉽게 말하면 이래요.`)});
 const order=await page.evaluate(()=>{const bar=document.getElementById('helpBar'),story=document.querySelector('.story');return !!(bar.compareDocumentPosition(story)&Node.DOCUMENT_POSITION_FOLLOWING)});
 assert.ok(order,'the help entry comes before the long story, not after the whole stage');
 assert.equal(await page.getAttribute('#helpToggle','aria-expanded'),'false');assert.equal(await page.locator('#helpRegion').count(),0,'collapsed by default: nothing competes for attention');
 await page.fill('#prediction','아직 쓰는 중인 예상');
 await page.focus('#helpToggle');await page.keyboard.press('Enter');await page.waitForSelector('#helpRegion');
 assert.equal(await page.getAttribute('#helpToggle','aria-expanded'),'true');
 assert.equal(await page.evaluate(()=>document.activeElement.closest('#helpRegion')!==null&&document.activeElement.tagName),'TEXTAREA','keyboard focus goes into the question box');
 await page.keyboard.type('이야기에 나온 쿼리가 뭐예요?');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.equal(await page.inputValue('#prediction'),'아직 쓰는 중인 예상','an unfinished answer survives asking for help and receiving the reply');
 await page.focus('#tutorThread textarea');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('helpRegion'));
 assert.equal(await page.evaluate(()=>document.activeElement.id),'helpToggle','focus returns to where the learner was');
 assert.match(await page.textContent('#helpToggle'),/대화 1개/);
 // Stage 3: "이 부분 묻기" opens the same region right under that section, with that section as context.
 await page.click('.navitem:has-text("4. 개념")');await page.waitForSelector('#keyConcepts');
 await page.click('#ask-sec-1');await page.waitForSelector('#helpRegion');
 assert.equal(await page.evaluate(()=>document.getElementById('sec-1').nextElementSibling.id),'helpRegion');
 assert.match(await page.textContent('.help-context'),/지금 묻는 부분: 값 바인딩의 범위/);
 await page.click('#tutorThread .tutor-chip[data-intent=simpler]');await page.waitForFunction(()=>document.querySelectorAll('#tutorThread .tutor-msg.ai').length===2);
 const c=calls.at(-1);assert.equal(c.focus.kind,'section');assert.equal(c.focus.heading,'값 바인딩의 범위');assert.equal(c.intent,'simpler');
 await shot(page,'desktop-6-section-help');
 await page.click('#ask-sec-0');assert.equal(await page.locator('#helpRegion').count(),1,'still exactly one help region');
 assert.equal(await page.evaluate(()=>document.getElementById('sec-0').nextElementSibling.id),'helpRegion');
 const s=(await stored(page)).lessons[0];assert.deepEqual(s.dialogue.filter(m=>m.role==='learner').map(m=>m.ref),[null,{kind:'section',i:1}]);
 assert.equal(calls.length,2,'only explicit actions send requests');assert.deepEqual(errors,[]);await ctx.close();
});

test('14 a question with a false premise: answered naturally, no label, no internal notice — the cap is kept in the record',async()=>{
 const Q='그럼 쿠키만 지우면 로그아웃되는 거 아닌가요?';
 const {ctx,page,errors}=await open([rec('C',SAMPLE,3,{topic:'HTTP 쿠키와 세션',maxStage:5})],'C',{ai:()=>reply('쿠키를 지우면 이 브라우저는 세션 ID를 더 보내지 않아요. 다만 서버 쪽 세션은 만료되거나 로그아웃 요청이 있을 때 정리돼요.',{assessment:{verdict:'misconception',quote:'쿠키만 지우면 로그아웃되는',note:'로그아웃과 쿠키 삭제는 같지 않아요.'}})});
 await help(page);await page.fill('#tutorThread textarea',Q);await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 const box=await page.textContent('#tutorThread');
 assert.match(box,/서버 쪽 세션은 만료되거나/);assert.equal(await page.locator('#tutorThread .tutor-assess').count(),0,'no verdict label on a question');
 for(const internal of ['사실과 어긋난','오개념','이렇게 표시했어요','이해 부족의 증거','전제를 함께 확인'])assert.ok(!box.includes(internal),internal);
 const s=(await stored(page)).lessons[0],t=s.dialogue.find(m=>m.role==='tutor');assert.deepEqual([t.assessment.verdict,t.assessment.adjustedFrom,t.assessment.utterance],['assumption','misconception','check']);
 assert.equal(s.dialogue[0].text,Q,'the learner question is stored exactly');
 const md=await page.evaluate(()=>CuriNotes.lessonMarkdown(data.lessons[0]));
 for(const internal of ['앱의 조정','사실과 어긋난','전제를 함께 확인'])assert.ok(!md.includes(internal),internal);assert.match(md,/쿠키만 지우면 로그아웃되는 거 아닌가요\? _\(답을 받음\)_/);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('15 mobile: the help region opens in page flow — no overlay, primary button still reachable, no sideways scroll',async()=>{
 const {ctx,page,errors}=await open([rec('A',SQLI,3,{maxStage:3})],'A',{viewport:{width:375,height:740},reducedMotion:'reduce',ai:()=>reply('짧은 답')});
 await page.click('#ask-sec-0');await page.waitForSelector('#helpRegion');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('helpRegion')).position),'static');
 await page.fill('#tutorThread textarea','이 부분이 어려워요');await page.click('#tutorThread .tutor-send');await page.waitForSelector('#tutorThread .tutor-msg.ai');
 assert.equal(await page.inputValue('#tutorThread textarea'),'','a sent question leaves the box (it is in the conversation now)');
 const w=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth}));assert.ok(w.doc<=w.win,`no horizontal scroll (${w.doc}>${w.win})`);
 await page.locator('#helpRegion').scrollIntoViewIfNeeded();await shot(page,'mobile-3-section-help');
 const primary=page.locator('text=이해한 내용 정리하기 →');await primary.scrollIntoViewIfNeeded();
 const hit=await primary.evaluate(b=>{const r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b});assert.ok(hit,'nothing covers the primary button');
 assert.deepEqual(errors,[]);await ctx.close();
});
