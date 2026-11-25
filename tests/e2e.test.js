// Browser end-to-end test against the real server.py (AI endpoints mocked in the browser).
// Optional dev dependency, not shipped with the app:
//   npm i --prefix /some/dir playwright-core
//   NODE_PATH=/some/dir/node_modules CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node --test tests/e2e.test.js
'use strict';
const {isolatedEnv}=require('./isolation.js');
const {openSettings,closeSettings,importFile,clickExport}=require('./ui_helpers.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8700+Math.floor(Math.random()*90));
const URL=`http://127.0.0.1:${PORT}/`;
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const LESSONS_KEY='curiven-v01-personal',PROFILE_KEY='curiven-profile-v1';
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'curiven-e2e-'));

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});

/** New isolated browser profile + page with mocked AI and error capture. */
async function open({online=true,init,viewport}={}){
 const ctx=await browser.newContext({viewport:viewport||{width:1280,height:900},acceptDownloads:true});
 if(init)await ctx.addInitScript(init);
 const page=await ctx.newPage();
 const t={ctx,page,ai:[],errors:[],dialogs:[],answers:[]};
 page.on('pageerror',e=>t.errors.push(e.message));
 page.on('dialog',async d=>{t.dialogs.push(d.message());const yes=t.answers.length?t.answers.shift():true;yes?await d.accept():await d.dismiss()});
 await page.route('**/api/status',r=>r.fulfill({json:{online,model:'mock-model',installed:[]}}));
 await page.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());t.ai.push(body);
  const data=body.mode==='lesson'?SAMPLE:{summary:'핵심을 잘 짚었어요.',correct:['쿠키는 브라우저가 저장'],misconceptions:[],missing:[],demonstrated:['k1'],uncertainty:''};
  await r.fulfill({json:{ok:true,data}})});
 return t;
}
const ls=(page,k)=>page.evaluate(k=>localStorage.getItem(k),k);
const json=async(page,k)=>JSON.parse(await ls(page,k));
async function goto(t){await t.page.goto(URL);if(t.online!==false)await t.page.waitForFunction(()=>/로컬 AI|연결 안 됨/.test(document.querySelector('#status').textContent))}
async function addInterest(page,v){await page.fill('#interestInput',v);await page.press('#interestInput','Enter')}
async function startTopic(page,topic){await page.fill('#topic',topic);await page.click('#startExplore');await page.waitForSelector('text=예상 남기고 계속하기 →')}
// On the home screen the composer IS the new exploration (focus layout, no sidebar); inside a lesson use the sidebar.
async function newExploration(page){if(!await page.isVisible('#home'))await page.click('#newLesson');await page.waitForSelector('#topic')}
async function completeLesson(page){
 await page.fill('#prediction','쿠키에 든 번호로 서버가 기억할 것 같아요.');await page.click('text=예상 남기고 계속하기 →');
 const n=SAMPLE.scenarios.length;
 for(let i=0;i<n;i++){const box=page.locator('.concept').nth(i);await box.locator('.opt').first().click();await box.locator('text=예상 확인하기').click()}
 await page.click('text=원리 알아보기 →');await page.click('text=이해한 내용 정리하기 →');
 await page.fill('#draft','브라우저는 서버가 준 세션 ID를 쿠키로 저장하고 매 요청마다 다시 보내요.');
 await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('text=내 설명 1개 기록');
 await page.click('text=학습 마무리하기 →');
}
async function backupFile(name,obj){const f=path.join(TMP,name);fs.writeFileSync(f,JSON.stringify(obj));return f}

let exported; // shared between tests 1–8 (sequential within this file)

test('1–6,10: onboarding once, persistence across reloads, multiple topics, edits reach AI, reset keeps profile, constellation intact',async()=>{
 const t=await open(),{page}=t;
 // 1. First launch → onboarding, no topic field.
 await goto(t);
 assert.ok(await page.isVisible('#onboarding'));assert.equal(await page.$('#topic'),null);
 assert.equal(await ls(page,PROFILE_KEY),null);
 // 2. Create profile.
 await addInterest(page,'추리 소설');await addInterest(page,'등산, 홈베이킹');
 await page.fill('#meaning','단서를 모아 답을 좁혀 가는 과정이 즐거워요.');
 await page.selectOption('#approach','experiment');await page.selectOption('#depth','some');await page.fill('#nickname','새봄');
 await page.click('text=저장하고 시작하기 →');
 await page.waitForSelector('text=오늘은 무엇이 궁금한가요?');
 assert.equal(await page.$('#interestInput'),null,'dashboard does not ask for interests');
 const saved=await json(page,PROFILE_KEY);
 assert.deepEqual(saved.interests,['추리 소설','등산','홈베이킹']);assert.equal(saved.depth,'some');assert.equal(saved.nickname,'새봄');
 // 3. Reload → straight to dashboard.
 await page.reload();await goto(t);
 assert.equal(await page.$('#onboarding'),null);assert.ok(await page.isVisible('#topic'));
 await openSettings(page,'profile');assert.match(await page.textContent('#interestChips'),/추리 소설.*등산.*홈베이킹/s,'the saved profile is where the learner edits it');await closeSettings(page);
 // 4. Several topics, never re-onboarded; full lesson incl. feedback + constellation.
 await startTopic(page,'HTTP 쿠키와 세션');
 await completeLesson(page);
 await page.waitForSelector('#atlasOverlay:not([hidden])');
 assert.ok(await page.locator('#atlasSvg .atlas-star').count()>=5,'atlas stars rendered');
 await page.click('#atlasClose');
 await newExploration(page);assert.equal(await page.$('#onboarding'),null);
 await startTopic(page,'블랙홀');
 await newExploration(page);await startTopic(page,'미분의 원리');
 assert.equal(t.ai.filter(b=>b.mode==='lesson').length,3);
 for(const b of t.ai)assert.deepEqual(b.profile.interests,['추리 소설','등산','홈베이킹']);
 assert.equal(t.ai.find(b=>b.mode==='feedback').profile.depth,'some','feedback gets profile');
 // 5. Edit profile: remove one interest, add one, change depth → next request uses new values.
 await openSettings(page,'profile');
 await page.click('button[aria-label="등산 삭제"]');await addInterest(page,'천체 관측');await page.selectOption('#depth','deep');
 await page.click('text=변경 사항 저장');await page.waitForSelector('text=저장했어요');
 await page.reload();await goto(t);
 assert.deepEqual((await json(page,PROFILE_KEY)).interests,['추리 소설','홈베이킹','천체 관측']);
 await newExploration(page);await startTopic(page,'SQL Injection');
 const last=t.ai.at(-1);
 assert.deepEqual(last.profile.interests,['추리 소설','홈베이킹','천체 관측']);assert.equal(last.profile.depth,'deep');assert.equal(last.level,'deep');
 const recs=(await json(page,LESSONS_KEY)).lessons;
 assert.equal(recs[0].interest,'추리 소설, 등산, 홈베이킹','earlier evidence unchanged by profile edit');
 assert.deepEqual(recs[0].profileUsed.interests,['추리 소설','등산','홈베이킹']);
 assert.deepEqual(recs.at(-1).profileUsed.interests,['추리 소설','홈베이킹','천체 관측']);
 // Unsaved edits are not persisted.
 await openSettings(page,'profile');await addInterest(page,'임시 관심사');t.answers.push(true);await page.click('#settingsBack');
 assert.match(t.dialogs.at(-1),/저장하지 않은 프로필 변경/);assert.ok(!(await ls(page,PROFILE_KEY)).includes('임시 관심사'));
 // 6. Reset/leave a session (logo + new exploration) → profile intact.
 const before=await ls(page,PROFILE_KEY);
 await page.click('#homeLogo');await newExploration(page);await page.reload();await goto(t);
 assert.equal(await ls(page,PROFILE_KEY),before);assert.equal(await page.$('#onboarding'),null);
 // 10. Constellation + history intact after all of the above.
 assert.ok(await page.locator('#map .mini-star').count()>=5,'mini constellation draws the knowledge stars (background dots are separate decoration)');
 assert.match(await page.textContent('#map-caption'),/개념 4/);
 await page.click('#universeBtn');await page.click('[data-atlas-mode=all]');  // home: “나의 우주” in the top bar
 assert.match(await page.textContent('#atlasCount'),/탐험 1 · 개념 4/);await page.click('#atlasClose');
 // 8a. Export includes profile + lessons.
 const [dl]=await Promise.all([page.waitForEvent('download'),clickExport(page)]);
 exported=JSON.parse(fs.readFileSync(await dl.path(),'utf8'));
 assert.equal(exported.format,'curiven-v01');assert.equal(exported.profileVersion,1);
 assert.deepEqual(exported.profile.interests,['추리 소설','홈베이킹','천체 관측']);assert.equal(exported.lessons.length,4);
 // Desktop screenshot for the report.
 await page.screenshot({path:path.join(TMP,'dashboard-desktop.png')});
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('7: legacy v0.1/v0.2 data — records kept, interests suggested, old backup import keeps profile',async()=>{
 const legacy={lessons:[{id:'old-1',topic:'HTTP 쿠키와 세션',interest:'범죄 수사, 추리 소설',level:'some',stage:5,maxStage:5,lesson:SAMPLE,prediction:'x',scenarios:[],drafts:[{text:'예전 설명',at:1,feedback:null}],feedback:null,events:[{at:'2026-01-01T00:00:00Z',what:'탐험 완료'}],createdAt:1,updatedAt:1,complete:true}],active:'old-1'};
 const t=await open({init:`if(!sessionStorage.seeded){localStorage.setItem('${LESSONS_KEY}',${JSON.stringify(JSON.stringify(legacy))});sessionStorage.seeded=1}`}),{page}=t;
 await goto(t);
 assert.ok(await page.isVisible('#onboarding'),'existing user without profile gets onboarding once');
 assert.match(await page.textContent('#interestChips'),/범죄 수사.*추리 소설/);
 assert.equal(await page.inputValue('#depth'),'some');
 await page.click('text=저장하고 시작하기 →');await page.waitForSelector('text=오늘의 발견을 돌아봐요');
 const stored=await json(page,LESSONS_KEY);
 assert.deepEqual(stored,legacy,'legacy records byte-for-byte unchanged');
 assert.match(await page.textContent('#map-caption'),/개념 4/);
 assert.match(await page.textContent('#journal'),/탐험 완료/);
 // Import an old-format backup (no profile): lessons replaced only after confirm, profile untouched.
 const prof=await ls(page,PROFILE_KEY);
 const f=await backupFile('old.json',{format:'curiven-v01',...legacy,lessons:[...legacy.lessons,{...legacy.lessons[0],id:'old-2'}]});
 await importFile(page,f);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('curiven-v01-personal'))?.lessons.length===2);
 assert.match(t.dialogs.at(-1),/현재 개인 프로필은 그대로 유지돼요/);
 assert.equal(await ls(page,PROFILE_KEY),prof);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('8: restore profile from backup; conflicting profile requires explicit approval',async()=>{
 assert.ok(exported,'export from test 1');
 const f=await backupFile('new.json',exported);
 // a) Fresh browser, no profile → restore (with one confirm) skips onboarding.
 let t=await open();await goto(t);
 await importFile(t.page,f);await t.page.waitForSelector('#topic');
 assert.match(t.dialogs[0],/개인 프로필도 함께 복원/);
 assert.deepEqual((await json(t.page,PROFILE_KEY)).interests,['추리 소설','홈베이킹','천체 관측']);
 assert.equal((await json(t.page,LESSONS_KEY)).lessons.length,4);
 await t.page.reload();await goto(t);assert.equal(await t.page.$('#onboarding'),null);await t.ctx.close();
 // b) Existing different profile; decline overwrite → lessons imported, profile kept.
 t=await open();await goto(t);await addInterest(t.page,'뜨개질');await t.page.click('text=저장하고 시작하기 →');await t.page.waitForSelector('#topic');
 const mine=await ls(t.page,PROFILE_KEY);
 t.answers.push(true,false);
 await importFile(t.page,f);await t.page.waitForFunction(()=>JSON.parse(localStorage.getItem('curiven-v01-personal'))?.lessons.length===4);
 assert.match(t.dialogs.at(-1),/현재: 뜨개질/);assert.equal(await ls(t.page,PROFILE_KEY),mine,'declined → profile untouched');
 // c) Same import, approve overwrite.
 t.answers.push(true,true);await importFile(t.page,await backupFile('new2.json',exported));
 await t.page.waitForFunction(()=>JSON.parse(localStorage.getItem('curiven-profile-v1'))?.interests.includes('천체 관측'));
 // d) Cancelling the first confirm changes nothing.
 const snap=[await ls(t.page,PROFILE_KEY),await ls(t.page,LESSONS_KEY)];t.answers.push(false);
 await importFile(t.page,await backupFile('new3.json',{...exported,lessons:[]}));await t.page.waitForTimeout(300);
 assert.deepEqual([await ls(t.page,PROFILE_KEY),await ls(t.page,LESSONS_KEY)],snap);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('9: storage unavailable or corrupt — transparent warning, app still usable, no silent loss',async()=>{
 // a) localStorage throws on every access.
 let t=await open({init:`for(const m of ['getItem','setItem','removeItem'])Storage.prototype[m]=function(){throw new DOMException('blocked','SecurityError')}`});
 await goto(t);
 assert.match(await t.page.textContent('.notice'),/브라우저 저장소를 사용할 수 없어/);
 await addInterest(t.page,'요리');await t.page.click('text=저장하고 시작하기 →');await t.page.waitForSelector('#topic');
 await startTopic(t.page,'블랙홀');assert.deepEqual(t.ai.at(-1).profile.interests,['요리'],'in-memory profile still used');
 assert.deepEqual(t.errors,[]);await t.ctx.close();
 // b) Quota failure on write after a successful load.
 t=await open({init:`const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='curiven-profile-v1')throw new DOMException('full','QuotaExceededError');return o.call(this,k,v)}`});
 await goto(t);await t.page.click('text=저장하고 시작하기 →');await t.page.waitForSelector('#topic');
 assert.match(await t.page.textContent('.notice'),/이 창에만 유지돼요/);await t.ctx.close();
 // c) Corrupt stored profile + lessons are quarantined, not overwritten.
 t=await open({init:`if(!sessionStorage.s){localStorage.setItem('curiven-profile-v1','{broken');localStorage.setItem('curiven-v01-personal','not json');sessionStorage.s=1}`});
 await goto(t);
 const keys=await t.page.evaluate(()=>Object.keys(localStorage));
 const pq=keys.find(k=>k.startsWith('curiven-profile-v1.corrupt-')),lq=keys.find(k=>k.startsWith('curiven-v01-personal.corrupt-'));
 assert.ok(pq&&lq,'both quarantined: '+keys);
 assert.equal(await ls(t.page,pq),'{broken');assert.equal(await ls(t.page,lq),'not json');
 assert.equal(await t.page.locator('.notice').count(),2);assert.ok(await t.page.isVisible('#onboarding'));
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('responsive: onboarding, dashboard and settings fit a phone without horizontal scroll',async()=>{
 const t=await open({viewport:{width:375,height:812}}),{page}=t;await goto(t);
 const noHScroll=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
 assert.ok(await noHScroll(),'onboarding');await page.screenshot({path:path.join(TMP,'onboarding-mobile.png'),fullPage:true});
 for(const x of ['아주 긴 관심사 이름이 들어가도 레이아웃이 깨지지 않아야 해요','사진'])await addInterest(page,x);
 await page.click('text=저장하고 시작하기 →');await page.waitForSelector('#topic');assert.ok(await noHScroll(),'dashboard');
 await page.screenshot({path:path.join(TMP,'dashboard-mobile.png'),fullPage:true});
 await openSettings(page,'profile');assert.ok(await noHScroll(),'settings');
 await page.screenshot({path:path.join(TMP,'settings-mobile.png'),fullPage:true});
 console.log('screenshots in',TMP);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});
