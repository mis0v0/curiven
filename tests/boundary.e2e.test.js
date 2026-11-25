// Stage B1 Boundary Constellation prototype in the real UI. The pack and its gates are REAL (served by
// server.py from reference-packs/); AI responses are MOCKED, so nothing here measures model or learning quality.
//   NODE_PATH=<dir>/node_modules node --test tests/boundary.e2e.test.js
//   Optional: SCREEN_DIR=<dir> saves desktop/mobile screenshots; TIMING_OUT=<file> saves step timings.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const {openSettings,closeSettings,importFile,clickExport}=require('./ui_helpers.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=8300+Math.floor(Math.random()*80),PORT_PLAIN=PORT+90,PORT_BAD=PORT+180;
const DEV=`http://127.0.0.1:${PORT}/dev/boundary`,HOME=`http://127.0.0.1:${PORT}/`;
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['추리 소설'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const MAIN_TEXT='HTTP는 상태가 없어서 서버는 세션 ID로 사용자를 알아봐요. 세션 ID는 쿠키로 오가요.';
const B_TEXT='쿠키는 브라우저에 있고 세션 식별자를 운반할 뿐이에요.\n세션 상태는 서버에 있어서, 쿠키를 지워도 서버 세션은 남을 수 있어요.';
const B_FB={schema:2,summary:'두 쪽의 역할을 나눠 설명했어요.',correct:[{quote:'세션 식별자를 운반할 뿐이에요',point:'쿠키의 역할을 정확히 짚었어요.'}],precision:[],misconceptions:[],
 missing:[{issue:'서버에서만 세션이 끝난 경우',question:'쿠키가 남아 있는데 서버 세션이 끝났다면 어떻게 될까요?'}],
 explained:[{id:'cookie',quote:'쿠키는 브라우저에 있고 세션 식별자를 운반할 뿐이에요'},{id:'server-session',quote:'세션 상태는 서버에 있어서'}],uncertainty:'짧은 설명이라 판단이 제한적이에요.'};
const MAIN_FB={schema:2,summary:'좋아요',correct:[],precision:[],misconceptions:[],missing:[],explained:[{id:'k3',quote:'세션 ID로 사용자를 알아봐요'}],uncertainty:''};
const SCREENS=process.env.SCREEN_DIR||'';const timings={};

const servers=[];let browser,badDir;
function boot(port,env){const s=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:String(port),...env}),stdio:['ignore','pipe','inherit']});servers.push(s);
 return new Promise((ok,bad)=>{s.stdout.once('data',ok);s.once('exit',c=>bad(Error('server exited '+c)))})}
test.before(async()=>{
 badDir=fs.mkdtempSync(path.join(os.tmpdir(),'curiven-badpack-'));
 const pack=JSON.parse(fs.readFileSync(path.join(ROOT,'reference-packs','http-cookie-vs-server-session.v1.json'),'utf8'));
 pack.applicationChecks[0].rationaleClaims.push('F99');  // unresolved dependency → validator rejects the pack
 fs.writeFileSync(path.join(badDir,'http-cookie-vs-server-session.v1.json'),JSON.stringify(pack));
 await Promise.all([boot(PORT,{CURIVEN_DEV_PILOT:'1'}),boot(PORT_PLAIN,{CURIVEN_DEV_PILOT:''}),boot(PORT_BAD,{CURIVEN_DEV_PILOT:'1',CURIVEN_PACK_DIR:badDir})]);
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();for(const s of servers)s.kill();if(badDir)fs.rmSync(badDir,{recursive:true,force:true});
 if(process.env.TIMING_OUT)fs.writeFileSync(process.env.TIMING_OUT,JSON.stringify(timings,null,1))});

async function open(url=DEV,{viewport,reducedMotion,seed,boundaryFeedback=()=>({ok:true,provider:'chatgpt',model:'gpt-test',data:B_FB})}={}){
 const ctx=await browser.newContext({viewport:viewport||{width:1280,height:900},reducedMotion,acceptDownloads:true});
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});`+(seed?`if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify(seed))});`:''));
 const t={ctx,ai:[],errors:[]};
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}}));
 await ctx.route('**/api/ai',r=>{const body=JSON.parse(r.request().postData());t.ai.push(body);
  if(body.mode==='lesson')return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:{...SAMPLE,title:'자료: '+body.topic}}});
  if(body.lesson.concepts.some(c=>c.id==='cookie')){const res=boundaryFeedback(body);return r.fulfill({status:res.ok?200:500,json:res})}
  return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:MAIN_FB}})});
 t.page=async(u=url)=>{const p=await ctx.newPage();p.on('pageerror',e=>t.errors.push(e.message));await p.goto(u);await p.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent)||document.querySelector('#readerCard'));return p};
 return t;
}
const stored=p=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const shot=async(loc,name)=>{if(SCREENS){fs.mkdirSync(SCREENS,{recursive:true});await loc.screenshot({path:path.join(SCREENS,name+'.png')})}};
const noOverflow=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);

/** Story stage + the lesson's own thought experiments (unchanged CURIVEN flow). */
async function storyAndScenarios(p){
 await p.waitForSelector('#prediction');await p.fill('#prediction','쿠키를 지우면 로그아웃될 것 같아요.');await p.click('text=예상 남기고 계속하기 →');
 for(let i=1;i<=SAMPLE.scenarios.length;i++){const box=p.locator('.concept',{hasText:`생각 실험 ${i}`});await box.locator('.opt').first().click();await box.locator('text=예상 확인하기').click();await p.waitForSelector(`.concept:has-text("생각 실험 ${i}") .info`)}
}
async function startPilot(p){await p.click('text=미리보기 탐험 시작 →');await storyAndScenarios(p)}
async function predictions(p,texts){for(const [sid,text] of texts){await p.fill(`#b-pred-${sid}`,text);await p.locator(`#bSit-${sid}`).locator('text=예측 기록하고 결과 보기').click();await p.waitForSelector(`#bSit-${sid} .boundary-compare`)}}
async function toExplain(p){await p.click('text=원리 알아보기 →');await p.click('text=이해한 내용 정리하기 →');await p.waitForSelector('#draft');
 await p.fill('#draft',MAIN_TEXT);await p.click('text=설명 저장하고 피드백 받기');await p.waitForSelector('#draftHistory .fb-provenance')}
async function answer(p,id,option){const f=p.locator(`#bCheck-${id}`);await f.locator(`button[data-opt="${option}"]`).click();await f.locator('text=답 확인하기').click();await p.waitForSelector(`#bCheck-${id} .info`)}

test('dev pilot journey: predict → compare → explain → two keyed checks → non-awarding preview in the constellation',async()=>{
 const t=await open(),p=await t.page(),T0=Date.now();
 assert.match(await p.textContent('#boundaryEntry'),/검토 중인 학습 자료/);
 await startPilot(p);
 assert.equal(t.ai[0].topic,'HTTP 쿠키와 서버 측 세션','the lesson itself is the ordinary AI lesson for the topic');
 const B0=Date.now();
 const box=p.locator('#boundarySituations');
 assert.match(await box.textContent(),/검토 중인 학습 자료 · 개발용 미리보기 · 성취로 기록되지 않아요/);
 assert.equal(await p.locator('#bSit-S1 .new').count(),0,'the outcome is hidden until a prediction is recorded');
 const wrong='  쿠키를 지워도 서버가\n  나를 알아볼 거예요  ';  // a mistaken prediction, with spacing and a line break
 await predictions(p,[['S1',wrong]]);
 assert.equal(await p.evaluate(()=>document.querySelector('#bSit-S1 .boundary-text').textContent),wrong,'exact learner text is shown');
 assert.match(await p.textContent('#bSit-S1 .new'),/서버는 이 요청을 이전 세션과 연결할 수 없습니다/);
 assert.doesNotMatch(await box.textContent(),/틀렸|오답|정답/,'predictions are compared, not scored');
 await predictions(p,[['S2','쿠키가 남아 있으니 로그인 상태가 유지될 것 같아요.']]);
 timings.situations=Date.now()-B0;await shot(box,'desktop-stage2-compare');
 await toExplain(p);
 const B1=Date.now();
 const ap=p.locator('#boundaryApply');assert.match(await ap.textContent(),/검토 중인 학습 자료/);
 assert.doesNotMatch(await ap.textContent(),/서버는 이 요청을 이전 세션과 연결할 수 없습니다/,'outcomes are not shown again while explaining');
 await p.fill('#b-explain',B_TEXT);await p.locator('#bExplain').locator('text=설명 저장 + AI 검토').click();await p.waitForSelector('#bExplain .fb-provenance');
 assert.match(await p.textContent('#bExplain'),/AI 검토 의견 · 참고용/);
 assert.match(await p.textContent('#bExplain .fb-uncertainty'),/AI가 판단하지 못한 점: 짧은 설명이라/);
 assert.match(await p.textContent('#bChecks'),/정답 키와 비교 \(AI 아님\)/);
 await p.locator('#bCheck-K1 summary').click();assert.match(await p.textContent('#bCheck-K1 details'),/다른 식별 수단 없음/);
 await answer(p,'K1','a');await answer(p,'K3','a');
 assert.match(await p.textContent('#bCheck-K3 .info'),/정답 키와 일치했어요/);
 assert.match(await p.textContent('#bCheck-K3'),/— 정답 키 — 내 선택/);
 timings.applyAndExplain=Date.now()-B1;await shot(ap,'desktop-stage4-apply');
 await p.click('text=학습 마무리하기 →');await p.waitForSelector('#atlasOverlay:not([hidden])');
 const edge=p.locator('#atlasSvg .atlas-boundary[role=button]');assert.equal(await edge.count(),1);
 const label=await edge.getAttribute('aria-label');
 assert.match(label,/HTTP 쿠키 ↔ 서버 측 세션 경계: 내 설명/);assert.match(label,/성취 미리보기: 검토 중인 학습 자료라 성취로 기록되지 않아요/);
 assert.match(await p.textContent('#atlasSvg'),/미리보기 · 성취 아님/);
 await edge.focus();await p.keyboard.press('Enter');assert.match(await p.textContent('#atlasInfo'),/경계[\s\S]*어느 단계도 영구적인 지식이나 완전한 이해를 뜻하지 않아요/);
 await p.click('#atlasGuide summary');assert.equal(await p.locator('#atlasBoundaryKey').isVisible(),true,'boundary key listed in 표시 안내');
 const focusStroke=await p.evaluate(()=>getComputedStyle(document.querySelector('#atlasSvg .atlas-boundary .bnd-focus')).stroke);
 assert.doesNotMatch(focusStroke,/255, 214|255, 216/,'focus ring must not use the achievement gold');
 if(SCREENS)await p.waitForTimeout(4500);await shot(p.locator('.atlas-window'),'desktop-atlas');
 await p.keyboard.press('Escape');
 assert.match(await p.textContent('#boundarySummary'),/예측 2\/2개 기록[\s\S]*채점 문항 2\/2개 응답, 2개 정답 키와 일치[\s\S]*성취로 기록되지 않아요/);
 assert.match(await p.getAttribute('#map','aria-label'),/경계/);
 timings.total=Date.now()-T0;
 const l=(await stored(p)).lessons[0],b=l.boundary;
 assert.equal(b.pack.mode,'draft-preview');assert.deepEqual(b.pack.gate,{reviewStatus:'draft',coreEligible:false,mayAward:false,awardable:[]});
 assert.equal(b.pack.draftRevision,5);
 assert.deepEqual(b.predictions.map(x=>[x.situationId,x.text]),[['S1',wrong],['S2','쿠키가 남아 있으니 로그인 상태가 유지될 것 같아요.']]);
 assert.ok(b.predictions.every(x=>Number.isInteger(x.at)));
 assert.deepEqual(b.answers.map(a=>[a.checkId,a.choice,a.correct]),[['K1','a',true],['K3','a',true]]);assert.ok(b.answers.every(a=>a.at>=B1));
 assert.equal(b.explanation.text,B_TEXT);assert.equal(b.explanation.feedback.schema,2);assert.equal(b.explanation.feedback.reviewer.model,'gpt-test');
 const ev=await p.evaluate(()=>CuriBoundary.evidence(data.lessons[0].boundary));
 assert.equal(ev.tier,'explained');assert.equal(ev.keyed,false);assert.equal(ev.preview,true);
 assert.equal(JSON.stringify(l).includes('V1'),false);assert.equal(JSON.stringify(l).includes('"state"'),false);
 assert.equal(t.ai.filter(x=>x.mode==='feedback').length,2,'one review for the lesson explanation, one for the boundary explanation');
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('skipping every boundary part is allowed and unpunished; the lesson still completes',async()=>{
 const t=await open(),p=await t.page();await startPilot(p);
 await p.click('text=이 비교 건너뛰기');assert.match(await p.textContent('#boundarySituations'),/건너뛰었어요/);
 await toExplain(p);
 await p.locator('#bExplain').locator('text=건너뛰기').click();await p.click('text=적용 문항 건너뛰기');
 assert.match(await p.textContent('#bChecks'),/적용 문항은 건너뛰었어요/);
 await p.click('text=학습 마무리하기 →');await p.waitForSelector('#atlasOverlay:not([hidden])');
 assert.match(await p.locator('#atlasSvg .atlas-boundary').getAttribute('aria-label'),/만남 — /);await p.keyboard.press('Escape');
 const s=await p.textContent('#boundarySummary');assert.match(s,/예측 0\/2개[\s\S]*내 설명 없음[\s\S]*0\/2개 응답/);assert.doesNotMatch(s,/실패|틀렸|감점/);
 const b=(await stored(p)).lessons[0].boundary;assert.deepEqual(Object.keys(b.skipped).sort(),['checks','explanation','situations']);
 assert.equal((await stored(p)).lessons[0].complete,true);
 // Coming back later: skipped parts can still be done.
 await p.click('text=내 설명 다시 보기');await p.click('text=지금 풀어 보기');await answer(p,'K1','b');
 assert.match(await p.textContent('#bCheck-K1 .info'),/정답 키와 달랐어요/);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('free exploration on the dev page is unchanged; the normal route never shows the prototype',async()=>{
 const t=await open(),p=await t.page();
 await p.fill('#topic','블랙홀은 왜 빛을 가둘까?');await p.click('#startExplore');await storyAndScenarios(p);
 assert.equal(await p.locator('#boundarySituations').count(),0);
 assert.equal((await stored(p)).lessons[0].boundary,undefined);
 // Normal route on the dev server, and a server without the flag.
 const q=await open(`http://127.0.0.1:${PORT_PLAIN}/`),n=await q.page();
 assert.equal(await n.locator('#boundaryEntry').count(),0);
 const r=await n.evaluate(async()=>[(await fetch('/dev/boundary')).status,(await fetch('/api/pilot/http-cookie-vs-server-session')).status]);
 assert.deepEqual(r,[404,404]);
 assert.deepEqual([...t.errors,...q.errors],[]);await t.ctx.close();await q.ctx.close();
});

test('invalid pack: the activity is refused with a message and free exploration still works',async()=>{
 const t=await open(`http://127.0.0.1:${PORT_BAD}/dev/boundary`),p=await t.page();
 await p.click('text=미리보기 탐험 시작 →');await p.waitForFunction(()=>/불러오지 못했어요/.test(document.querySelector('#boundaryEntryMsg').textContent));
 assert.match(await p.textContent('#boundaryEntryMsg'),/검사를 통과하지 못해[\s\S]*일반 탐험은 그대로/);
 assert.equal((await stored(p))?.lessons?.length??0,0,'no lesson is created from a refused pack');
 await p.fill('#topic','미분의 원리');await p.click('#startExplore');await p.waitForSelector('#prediction');
 assert.equal((await stored(p)).lessons[0].boundary,undefined);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('AI feedback failure on the boundary explanation keeps the text and offers a retry',async()=>{
 let fail=true;
 const t=await open(DEV,{boundaryFeedback:()=>fail?{ok:false,error:'모델 응답 형식 오류'}:{ok:true,provider:'chatgpt',model:'gpt-test',data:B_FB}}),p=await t.page();
 await startPilot(p);await predictions(p,[['S1','다시 연결 안 될 것 같아요'],['S2','이것도 안 될 것 같아요']]);await toExplain(p);
 await p.fill('#b-explain',B_TEXT);await p.locator('#bExplain').locator('text=설명 저장 + AI 검토').click();
 await p.waitForFunction(()=>/받지 못했어요/.test(document.querySelector('#bFeedbackState')?.textContent||''));
 assert.equal((await stored(p)).lessons[0].boundary.explanation.text,B_TEXT);
 assert.match((await stored(p)).lessons[0].boundary.explanation.feedbackError,/모델 응답 형식 오류/);
 fail=false;await p.click('#bFeedbackRetry');await p.waitForSelector('#bExplain .fb-provenance');
 assert.equal((await stored(p)).lessons[0].boundary.explanation.feedbackError,undefined);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('cross-tab takeover while typing a prediction: the other tab gets the lock, typed text is not lost',async()=>{
 const t=await open(),a=await t.page();await startPilot(a);
 await a.fill('#b-pred-S1','아직 저장하지 않은 내 예측이에요');
 const b=await t.page();await b.waitForSelector('#readerCard');await b.click('text=이 탭에서 계속하기');await b.waitForSelector('#boundarySituations');
 await a.waitForSelector('#orphanInputs');assert.match(await a.textContent('#orphanInputs'),/아직 저장하지 않은 내 예측이에요/);
 await predictions(b,[['S1','두 번째 탭에서 기록한 예측']]);
 const s=await stored(b);assert.deepEqual(s.lessons[0].boundary.predictions.map(x=>x.text),['두 번째 탭에서 기록한 예측']);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});

test('export/import keeps boundary evidence; historical and normal-route records stay compatible',async()=>{
 const t=await open(),p=await t.page();await startPilot(p);await predictions(p,[['S1','연결이 끊길 거예요'],['S2','그래도 안 될 거예요']]);
 const before=(await stored(p)).lessons[0].boundary;
 const [dl]=await Promise.all([p.waitForEvent('download'),clickExport(p)]);const file=await dl.path();
 const exported=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(exported.format,'curiven-v01');assert.deepEqual(exported.lessons[0].boundary,before);
 // Import into a fresh browser profile on the dev page.
 const u=await open(),q=await u.page();q.on('dialog',d=>d.accept());await importFile(q,file);
 await q.waitForFunction(()=>JSON.parse(localStorage.getItem('curiven-v01-personal'))?.lessons?.length===1);
 assert.deepEqual((await stored(q)).lessons[0].boundary,before);
 await q.goto(DEV);await q.waitForSelector('#bSit-S2 .boundary-compare');
 // The same record on the normal route: ordinary lesson, no prototype UI, boundary data preserved on write.
 await q.close();const n=await u.page(HOME);await n.waitForSelector('.concept:has-text("생각 실험 1")');
 assert.equal(await n.locator('#boundarySituations').count(),0);
 assert.equal(await n.evaluate(()=>modelAtlas(data.lessons[0],'today').edges.some(e=>e.kind==='boundary')),false);
 await n.click('text=원리 알아보기 →');
 assert.deepEqual((await stored(n)).lessons[0].boundary,before,'the normal route keeps boundary data untouched');
 // Historical records without boundary render as before alongside the pilot record.
 const old={id:'OLD',topic:'옛 기록',interest:'',level:'beginner',stage:5,maxStage:5,lesson:SAMPLE,prediction:'p',scenarios:[],drafts:[{text:'예전 설명입니다 아주 길게',at:5,feedback:null}],feedback:null,events:[],createdAt:1,updatedAt:1,complete:true};
 const h=await open(DEV,{seed:{lessons:[old],active:'OLD'}}),hp=await h.page();
 await hp.evaluate(()=>openAtlas(data.lessons[0]));await hp.waitForSelector('#atlasOverlay:not([hidden])');
 assert.equal(await hp.locator('#atlasSvg .atlas-boundary').count(),0);assert.equal(await hp.locator('#atlasBoundaryKey').isVisible(),false);
 assert.equal(await hp.locator('.atlas-star').count(),5);
 assert.deepEqual([...t.errors,...u.errors,...h.errors],[]);await t.ctx.close();await u.ctx.close();await h.ctx.close();
});

test('mobile and reduced motion: readable, no horizontal scroll, static constellation',async()=>{
 const t=await open(DEV,{viewport:{width:390,height:844},reducedMotion:'reduce'}),p=await t.page();
 assert.ok(await noOverflow(p),'home');
 await startPilot(p);await predictions(p,[['S1','서버가 못 알아볼 것 같아요'],['S2','쿠키가 있으니 될 것 같아요']]);
 assert.ok(await noOverflow(p),'stage 2');
 const cols=await p.evaluate(()=>getComputedStyle(document.querySelector('#bSit-S1 .boundary-compare')).gridTemplateColumns.split(' ').length);assert.equal(cols,1,'prediction and outcome stack on phones');
 await shot(p.locator('#bSit-S1'),'mobile-stage2-compare');
 await toExplain(p);await p.fill('#b-explain',B_TEXT);await p.locator('#bExplain').locator('text=설명 저장 + AI 검토').click();await p.waitForSelector('#bExplain .fb-provenance');
 await answer(p,'K1','a');await answer(p,'K3','b');
 assert.ok(await noOverflow(p),'stage 4');await shot(p.locator('#bChecks'),'mobile-stage4-checks');
 await p.click('text=학습 마무리하기 →');await p.waitForSelector('#atlasOverlay:not([hidden])');
 const st=await p.evaluate(()=>{const g=document.querySelector('#atlasSvg .atlas-boundary');const cs=getComputedStyle(g);return [cs.animationName,cs.opacity]});
 assert.deepEqual(st,['none','1']);
 assert.doesNotMatch(await p.textContent('#atlasSvg'),/미리보기 · 성취 아님/,'one wrong keyed answer → no achievement preview');
 await shot(p.locator('.atlas-window'),'mobile-atlas');
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});
