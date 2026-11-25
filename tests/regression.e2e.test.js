// Browser regression tests for acceptance defects D1–D8 and the learning-design fixes.
// AI responses are MOCKED in the browser: these verify CURIVEN's handling, not model quality.
// Run (playwright-core is an optional dev tool, not an app dependency):
//   NODE_PATH=<dir>/node_modules node --test tests/regression.e2e.test.js
'use strict';
const {isolatedEnv}=require('./isolation.js');
const {openSettings,closeSettings,importFile,clickExport}=require('./ui_helpers.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8600+Math.floor(Math.random()*90));
const URL=`http://127.0.0.1:${PORT}/`;
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['추리 소설'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const GOOD_FB={summary:'핵심을 짚었어요',correct:['쿠키에 세션 ID 저장'],misconceptions:[{issue:'세션 위치',question:'세션 데이터는 어디에 있을까?'}],missing:[],demonstrated:['k1','k3'],uncertainty:''};

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});

/** One browser context = one browser profile (shared localStorage + Web Locks across its pages). */
async function context({init='',viewport,reducedMotion,lessonDelay=0,feedback=GOOD_FB}={}){
 const ctx=await browser.newContext({viewport:viewport||{width:1280,height:900},reducedMotion});
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});${init}`);
 const t={ctx,ai:[],errors:[],dialogs:[],lessonDelay,feedback};
 await ctx.route('**/api/status',r=>r.fulfill({json:{online:true,model:'mock',installed:[]}}));
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());t.ai.push({body,size:Buffer.byteLength(r.request().postData())});
  if(body.mode==='lesson'){await new Promise(z=>setTimeout(z,t.lessonDelay));return r.fulfill({json:{ok:true,data:{...SAMPLE,title:'자료: '+body.topic}}}).catch(()=>{})}
  r.fulfill({json:{ok:true,data:typeof t.feedback==='function'?t.feedback():t.feedback}})});
 t.page=async()=>{const p=await ctx.newPage();p.on('pageerror',e=>t.errors.push(e.message));p.on('dialog',d=>{t.dialogs.push(d.message());d.accept()});await p.goto(URL);await p.waitForFunction(()=>/로컬 AI/.test(document.querySelector('#status').textContent)||document.querySelector('#readerCard'));return p};
 return t;
}
const stored=(p,k=KEY)=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),k);
const topics=async p=>(await stored(p)).lessons.map(l=>l.topic);
async function startTopic(p,topic){await p.fill('#topic',topic);await p.click('#startExplore');await p.waitForSelector('#prediction')}
async function toExplain(p,topic){await startTopic(p,topic);await p.fill('#prediction','번호표만 있으면 계속 기억할 것 같아요');await p.click('text=예상 남기고 계속하기 →');
 for(let i=0;i<SAMPLE.scenarios.length;i++){const b=p.locator('.concept').nth(i);await b.locator('.opt').first().click();await b.locator('text=예상 확인하기').click()}
 await p.click('text=원리 알아보기 →');await p.click('text=이해한 내용 정리하기 →');await p.waitForSelector('#draft')}
const seedLesson=(stage=1,extra={})=>`if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons:[{id:'L1',topic:'쿠키',interest:'',level:'beginner',stage,maxStage:stage,lesson:SAMPLE,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:1,updatedAt:1,complete:false,...extra}],active:'L1'}))});`;
const NO_LOCKS=`Object.defineProperty(Navigator.prototype,'locks',{get:()=>undefined});`;

test('D1: two real tabs — single writer, explicit takeover, lessons from both tabs survive',async()=>{
 const t=await context();const a=await t.page();await startTopic(a,'탭A 주제');
 const b=await t.page();await b.waitForSelector('#readerCard');
 assert.match(await b.textContent('#readerCard'),/저장된 탐험 기록 1개/);
 await b.click('text=이 탭에서 계속하기');await b.waitForSelector('#topic, #prediction');
 await a.waitForSelector('#readerCard');                                    // A lost the lock and is now read-only
 await b.click('#newLesson');await startTopic(b,'탭B 주제');
 await a.waitForFunction(()=>/기록 2개/.test(document.querySelector('#readerCard')?.textContent||''));
 await a.click('text=이 탭에서 계속하기');await a.waitForSelector('#prediction, #topic');await b.waitForSelector('#readerCard');
 await a.click('#newLesson');await startTopic(a,'탭A 두번째');
 assert.deepEqual(await topics(a),['탭A 주제','탭B 주제','탭A 두번째']);
 // Closing the writer hands the lock to the waiting tab automatically.
 await a.close();await b.waitForSelector('#readerCard',{state:'detached'});
 assert.deepEqual(await topics(b),['탭A 주제','탭B 주제','탭A 두번째']);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('D1: same lesson edited concurrently without Web Locks — conflict is detected, never overwritten',async()=>{
 // Block storage events in tab B so its write goes through the revision check itself (worst case).
 const t=await context({init:NO_LOCKS+seedLesson(1)+`if(location.hash==='#mute')addEventListener('storage',e=>e.stopImmediatePropagation(),true);`});
 const a=await t.page();const b=await t.ctx.newPage();b.on('dialog',d=>d.accept());await b.goto(URL+'#mute');await b.waitForSelector('#prediction');
 await a.waitForSelector('#prediction');
 await a.fill('#prediction','A의 예상');await a.click('text=예상 남기고 계속하기 →');
 await b.fill('#prediction','B의 예상(오래된 상태에서)');await b.click('text=예상 남기고 계속하기 →');
 await b.waitForSelector('#conflictCard');
 assert.equal((await stored(a)).lessons[0].prediction,'A의 예상','A’s committed update kept');
 await b.click('text=최신 기록 불러오기');await b.waitForSelector('.concept .opt');      // B now shows A’s state (stage 2)
 assert.equal((await stored(b)).lessons[0].prediction,'A의 예상');
 // With events delivered (normal case) the stale tab is told immediately.
 const c=await t.page();await a.click('#nav button:nth-child(2)');await a.fill('#prediction','A 수정');await a.click('text=예상 남기고 계속하기 →');
 await c.waitForSelector('#conflictCard');assert.equal((await stored(a)).lessons[0].prediction,'A 수정');
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('D1: older-version tab writing (no rev) is detected; interrupted writes keep committed data',async()=>{
 const t=await context({init:seedLesson(1)+`window.__fail=false;const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(window.__fail&&k==='${KEY}')throw new DOMException('full','QuotaExceededError');return o.call(this,k,v)}`});
 const a=await t.page();await a.waitForSelector('#prediction');
 await a.fill('#prediction','커밋된 예상');await a.click('text=예상 남기고 계속하기 →');await a.waitForSelector('.concept .opt');
 const committed=await a.evaluate(k=>localStorage.getItem(k),KEY);
 await a.evaluate(()=>{window.__fail=true});
 const box=a.locator('.concept').first();await box.locator('.opt').first().click();await box.locator('text=예상 확인하기').click();
 assert.match(t.dialogs.at(-1),/저장에 실패/);assert.equal(await a.evaluate(k=>localStorage.getItem(k),KEY),committed);
 assert.match(await a.textContent('.notice'),/이 창에만 유지돼요/);
 await a.reload();await a.waitForSelector('.concept .opt');
 const s=await stored(a);assert.equal(s.lessons[0].prediction,'커밋된 예상');assert.equal(s.lessons[0].scenarios.length,0);
 // An old v0.2 tab (same profile) rewrites the blob without `rev` → this tab refuses to overwrite it.
 const old=JSON.stringify({lessons:[{...s.lessons[0],topic:'구버전 탭의 변경'}],active:'L1'});
 const other=await t.ctx.newPage();await other.goto(URL+'nonexistent').catch(()=>{});
 await a.evaluate(()=>{window.__fail=false});
 await other.evaluate(([k,v])=>localStorage.setItem(k,v),[KEY,old]);
 await a.waitForSelector('#conflictCard');assert.equal(await a.evaluate(k=>localStorage.getItem(k),KEY),old);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('D1: a tab that has not written yet still detects a write from an older-version tab',async()=>{
 const t=await context({init:seedLesson(1)});const a=await t.page();await a.waitForSelector('#prediction');
 const other=await t.ctx.newPage();await other.goto(URL+'nonexistent').catch(()=>{});
 const legacy=JSON.stringify({lessons:[{id:'L1',topic:'구버전 탭이 바꾼 주제',lesson:SAMPLE,stage:1,maxStage:1,prediction:'',scenarios:[],drafts:[],events:[]}],active:'L1'});
 await other.evaluate(([k,v])=>localStorage.setItem(k,v),[KEY,legacy]);   // no `rev`, same as before → rev-only check passes
 await a.waitForSelector('#conflictCard');
 assert.equal(await a.evaluate(k=>localStorage.getItem(k),KEY),legacy,'older tab’s change kept');
 await a.click('text=최신 기록 불러오기');await a.waitForSelector('#prediction');
 await a.fill('#prediction','최신 기록 위에 쓰기');await a.click('text=예상 남기고 계속하기 →');
 const s=await stored(a);assert.equal(s.lessons[0].topic,'구버전 탭이 바꾼 주제');assert.equal(s.lessons[0].prediction,'최신 기록 위에 쓰기');
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('D8: profile edits reach other tabs; open forms keep unsaved input; AI uses latest committed profile',async()=>{
 // (a) normal: reader tab mirrors the change; after takeover its AI request uses it.
 let t=await context();const a=await t.page();const b=await t.page();await b.waitForSelector('#readerCard');
 await openSettings(a,'profile');await a.click('button[aria-label="추리 소설 삭제"]');await a.fill('#interestInput','요리');await a.press('#interestInput','Enter');await a.click('text=변경 사항 저장');
 await b.waitForFunction(()=>/요리/.test(document.querySelector('#readerProfile')?.textContent||''));
 await b.click('text=이 탭에서 계속하기');await b.waitForSelector('#topic');await startTopic(b,'블랙홀');
 assert.deepEqual(t.ai.at(-1).body.profile.interests,['요리']);
 // (b) losing the lock while typing: unsaved text stays visible on the read-only card.
 await b.fill('#prediction','아직 저장 안 한 예상');await a.click('text=이 탭에서 계속하기');
 await b.waitForSelector('#readerCard');assert.match(await b.textContent('#orphanInputs'),/아직 저장 안 한 예상/);
 await t.ctx.close();
 // (c) no Web Locks: an open settings form is not replaced; the next request still uses the committed profile.
 t=await context({init:NO_LOCKS});const x=await t.page();const y=await t.page();
 await openSettings(y,'profile');await y.fill('#nickname','입력 중인 별명');
 await openSettings(x,'profile');await x.fill('#interestInput','천체 관측');await x.press('#interestInput','Enter');await x.click('text=변경 사항 저장');
 await y.waitForFunction(()=>/다른 탭에서 프로필이 바뀌었어요/.test(document.querySelector('#profileStatus').textContent));
 assert.equal(await y.inputValue('#nickname'),'입력 중인 별명','unsaved input kept');
 await y.click('#settingsBack');await startTopic(y,'미분');
 assert.deepEqual(t.ai.at(-1).body.profile.interests,['추리 소설','천체 관측']);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('D2: malformed feedback is rejected, explanation kept, retry works; stored malformed feedback is not rendered as garbage',async()=>{
 let bad=true;const t=await context({feedback:()=>bad?{summary:'좋아요',correct:'쿠키 저장을 정확히 말함',misconceptions:['문자열']}:GOOD_FB});
 const p=await t.page();await toExplain(p,'쿠키');
 await p.fill('#draft','세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.');await p.click('text=설명 저장하고 피드백 받기');
 await p.waitForSelector('#retryFeedback');
 const txt=await p.textContent('#draftHistory');
 assert.match(txt,/세션 ID를 쿠키로/);assert.match(txt,/AI 피드백을 받지 못했어요/);assert.doesNotMatch(txt,/✓ 쿠|undefined/);
 assert.equal((await stored(p)).lessons[0].drafts[0].feedback,null);
 bad=false;await p.click('#retryFeedback');await p.waitForFunction(()=>/핵심을 짚었어요/.test(document.querySelector('#draftHistory').textContent));
 const s=await stored(p);assert.deepEqual(s.lessons[0].drafts[0].feedback.demonstrated,['k1','k3']);assert.equal(s.lessons[0].drafts[0].feedbackError,undefined);
 await t.ctx.close();
 // Legacy record already holding malformed feedback.
 const seeded=seedLesson(4,{drafts:[{text:'예전 설명입니다 충분히 길게',at:5,feedback:{summary:'s',correct:'문자열'}}]});
 const t2=await context({init:seeded});const q=await t2.page();await q.waitForSelector('#draftHistory');
 const h=await q.textContent('#draftHistory');assert.match(h,/형식이 올바르지 않아 표시하지 않았어요/);assert.match(h,/예전 설명입니다/);assert.doesNotMatch(h,/✓ 문/);
 assert.deepEqual([...t.errors,...t2.errors],[]);await t2.ctx.close();
});

test('D3: unsent explanation survives navigation, re-render and reload, and is not counted as submitted',async()=>{
 const t=await context();const p=await t.page();await toExplain(p,'쿠키');
 await p.fill('#draft','쓰는 중인 설명 초안');await p.click('#nav button:nth-child(4)');await p.click('#nav button:nth-child(5)');
 assert.equal(await p.inputValue('#draft'),'쓰는 중인 설명 초안');assert.ok(await p.isVisible('#draftRestored'));
 await p.fill('#draft','쓰는 중인 설명 초안 — 조금 더');await p.waitForTimeout(700);await p.reload();await p.waitForSelector('#draft');
 assert.equal(await p.inputValue('#draft'),'쓰는 중인 설명 초안 — 조금 더');
 await p.fill('#draft','즉시 새로고침 전 마지막 글자');await p.reload();await p.waitForSelector('#draft');   // pagehide flush, no debounce wait
 assert.equal(await p.inputValue('#draft'),'즉시 새로고침 전 마지막 글자');
 let l=(await stored(p)).lessons[0];assert.equal(l.drafts.length,0);assert.equal(l.complete,false);
 await p.click('text=학습 마무리하기 →');assert.match(t.dialogs.at(-1),/먼저 자신의 설명/);
 await p.fill('#draft','세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.');await p.click('text=설명 저장하고 피드백 받기');await p.waitForSelector('text=핵심을 짚었어요');
 l=(await stored(p)).lessons[0];assert.equal(l.drafts.length,1);assert.equal(l.draftInProgress,undefined);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('D4: one generation per lesson; navigation, cancellation and late responses are safe',async()=>{
 const t=await context({lessonDelay:1200});const p=await t.page();
 await p.fill('#topic','블랙홀');await p.click('#startExplore');await p.waitForSelector('text=준비 취소');
 assert.equal(await p.isVisible('#nav'),false,'preparation uses the quiet focus layout (no stage navigation yet)');
 await p.evaluate(()=>render());                                              // re-render while generating
 assert.equal(await p.locator('text=탐험 만들기').count(),0,'no second trigger while generating');
 assert.ok(await p.isVisible('text=준비 취소'));await p.click('#homeLogo');
 await p.fill('#topic','미분');await p.click('#startExplore');
 await p.click('#homeLogo');await p.waitForTimeout(1600);
 assert.equal(await p.locator('#topic').count(),1,'late result did not navigate away from the dashboard');
 let s=await stored(p);assert.ok(s.lessons.every(l=>l.lesson),'both lessons received material');
 assert.equal(t.ai.filter(x=>x.body.mode==='lesson').length,2,'exactly one request per lesson');
 // Cancel → late response ignored → retry works.
 await p.fill('#topic','쿠키');await p.click('#startExplore');await p.click('text=준비 취소');await p.waitForSelector('#preparePanel button:has-text("탐험 만들기")');
 await p.waitForTimeout(1500);s=await stored(p);assert.equal(s.lessons[2].lesson,null,'cancelled result ignored');
 await p.click('#preparePanel button:has-text("탐험 만들기")');await p.waitForSelector('#prediction',{timeout:5000});
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('D5: feedback request carries only the evaluation fields',async()=>{
 const t=await context();const p=await t.page();await toExplain(p,'쿠키');
 await p.fill('#draft','세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.');await p.click('text=설명 저장하고 피드백 받기');await p.waitForSelector('text=핵심을 짚었어요');
 const fb=t.ai.find(x=>x.body.mode==='feedback');
 assert.deepEqual(Object.keys(fb.body.lesson).sort(),['concepts','explainPrompt','technical','title']);
 assert.ok(fb.size<20000,`body ${fb.size} bytes`);await t.ctx.close();
});

test('learning design: answer positions shuffled with correct mapping; prediction compared with outcomes',async()=>{
 const t=await context();const p=await t.page();await startTopic(p,'쿠키');
 const l=(await stored(p)).lessons[0].lesson;
 l.scenarios.forEach((s,i)=>assert.equal(s.options[s.answerIndex],SAMPLE.scenarios[i].options[SAMPLE.scenarios[i].answerIndex]));
 await p.fill('#prediction','장부가 지워져도 번호표로 다시 들어갈 수 있을 것');await p.click('text=예상 남기고 계속하기 →');
 for(let i=0;i<SAMPLE.scenarios.length;i++){const b=p.locator('.concept').nth(i);await b.locator('.opt').first().click();await b.locator('text=예상 확인하기').click()}
 const cmp=await p.textContent('#predictionCompare');assert.match(cmp,/처음의 내 예상: 장부가 지워져도/);assert.match(cmp,/사고 실험 1: 내 선택/);
 await p.fill('#reflection','서버 쪽 기록이 사라지면 번호표만으로는 소용없다는 걸 놓쳤어요.');await p.click('text=원리 알아보기 →');
 assert.match((await stored(p)).lessons[0].reflection,/놓쳤어요/);assert.equal((await stored(p)).lessons[0].prediction,'장부가 지워져도 번호표로 다시 들어갈 수 있을 것');
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

const overlapCount=p=>p.evaluate(()=>{const r=[...document.querySelectorAll('#atlasSvg .atlas-node-label')].map(e=>e.getBoundingClientRect());let o=0;for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)o++}return o});
test('D7: constellation labels do not overlap at narrow widths / zoom; reduced motion still static',async()=>{
 const results={};
 for(const [name,vp,rm] of [['320',{width:320,height:700}],['390',{width:390,height:844}],['640 (=1280 @200% zoom)',{width:640,height:450}],['1280',{width:1280,height:900}],['390 reduced',{width:390,height:844},'reduce']]){
  const t=await context({viewport:vp,reducedMotion:rm});const p=await t.page();
  for(const topic of ['HTTP 쿠키와 세션','블랙홀의 사건의 지평선']){await toExplain(p,topic);await p.fill('#draft','세션 ID를 쿠키로 보내면 서버가 저장소에서 찾아요.');await p.click('text=설명 저장하고 피드백 받기');await p.waitForSelector('text=핵심을 짚었어요');await p.click('text=학습 마무리하기 →');await p.waitForSelector('#atlasOverlay:not([hidden])');if(topic.startsWith('HTTP')){await p.click('#atlasClose');await p.click('#newLesson')}}
  await p.waitForTimeout(rm?50:4200);
  const today=await overlapCount(p);await p.screenshot({path:path.join(require('os').tmpdir(),`curiven-atlas-${name.split(' ')[0]}${rm?'-rm':''}.png`)});
  await p.click('[data-atlas-mode=all]');await p.waitForTimeout(rm?50:5000);const all=await overlapCount(p);
  const star=await p.evaluate(()=>{const s=document.querySelector('#atlasSvg .atlas-star');const cs=getComputedStyle(s);return {opacity:cs.opacity,anim:cs.animationName}});
  const hScroll=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  results[name]={today,all,star,hScroll};assert.deepEqual(t.errors,[]);await t.ctx.close();
 }
 console.log(JSON.stringify(results));
 for(const [n,r] of Object.entries(results)){assert.equal(r.today,0,n+' today');assert.equal(r.all,0,n+' all');assert.equal(r.hScroll,false,n);assert.equal(r.star.opacity,'1',n)}
 assert.equal(results['390 reduced'].star.anim,'none');assert.notEqual(results['390'].star.anim,'none','animation preserved');
});
