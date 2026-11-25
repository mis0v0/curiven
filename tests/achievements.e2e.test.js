// Feedback categories and honest constellation achievements in the real UI (AI responses mocked).
//   NODE_PATH=<dir>/node_modules node --test tests/achievements.e2e.test.js
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8400+Math.floor(Math.random()*90));
const URL=`http://127.0.0.1:${PORT}/`;
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['추리 소설'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const TEXT='HTTP는 상태가 없어서 서버는 요청만 보고 사용자를 알 수 없어요. 서버가 세션 ID를 만들어 쿠키로 보내고, 쿠키는 모든 요청에 항상 같이 가요. 세션 데이터는 브라우저에 있어요.';
const V2={schema:2,summary:'흐름은 맞지만 세션 위치가 틀렸어요.',
 correct:[{quote:'서버가 세션 ID를 만들어 쿠키로 보내고',point:'세션 ID 전달 방식이 맞아요.'}],
 precision:[{quote:'쿠키는 모든 요청에 항상 같이 가요',issue:'전송 조건이 빠졌어요.',why:'Domain·Path 등 범위에 맞는 요청에만 실려요.',question:'어떤 요청에는 쿠키가 빠질까요?'}],
 misconceptions:[{quote:'세션 데이터는 브라우저에 있어요',issue:'세션 데이터의 위치',why:'서버 측 세션 방식에서는 서버가 데이터를 보관해요.',question:'서버는 세션 ID로 무엇을 찾을까요?'}],
 missing:[],explained:[{id:'k1',quote:'HTTP는 상태가 없어서 서버는 요청만 보고 사용자를 알 수 없어요'},{id:'k3',quote:'서버가 세션 ID를 만들어'}],uncertainty:''};
const LEGACY={summary:'핵심을 짚었어요',correct:['쿠키에 세션 ID 저장'],misconceptions:[{issue:'세션 위치',question:'세션 데이터는 어디에 있을까?'}],missing:[],demonstrated:['k2','k4'],uncertainty:''};
const rec=(id,topic,feedback,text)=>({id,topic,interest:'',level:'beginner',stage:4,maxStage:5,lesson:SAMPLE,prediction:'p',scenarios:[],drafts:[{text,at:5,feedback}],feedback,feedbackFor:5,events:[],createdAt:1,updatedAt:1,complete:true});

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});

async function open(lessons,active,{reply}={}){
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});
 const seed={lessons,active};
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify(seed))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}}));
 await ctx.route('**/api/ai',r=>r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:reply}}));
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,errors};
}
const tiers=(page,id)=>page.evaluate(id=>Object.fromEntries(modelAtlas(data.lessons.find(x=>x.id===id),'today').nodes.filter(n=>!n.topic).map(n=>[n.name,n.tier])),id);

test('explanation history shows correct / precision / misconception separately, with the learner\'s words',async()=>{
 const {ctx,page,errors}=await open([rec('A','쿠키',V2,TEXT)],'A');
 await page.waitForSelector('#draftHistory');
 assert.match(await page.textContent('.fb-correct'),/서버가 세션 ID를 만들어 쿠키로 보내고/);
 assert.match(await page.textContent('.fb-precision'),/^더 정확하게: “쿠키는 모든 요청에 항상 같이 가요”.*왜: Domain/);
 assert.match(await page.textContent('.fb-misconception'),/^다시 생각하기: “세션 데이터는 브라우저에 있어요”.*왜: /);
 assert.deepEqual(await page.locator('.fb-explained li').allTextContents(),V2.explained.map((x,i)=>['HTTP 무상태성','세션 ID'][i]+' — “'+x.quote+'”'));
 assert.match(await page.textContent('.fb-provenance'),/AI 피드백 · .*참고 의견이에요/);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('new review from the API is quote-checked in the browser and stored with its reviewer model',async()=>{
 const forged={...V2,misconceptions:[...V2.misconceptions,{quote:'쿠키는 서버에 저장돼요',issue:'x',why:'y',question:'z'}]};
 const start={...rec('B','쿠키',null,'이전 설명입니다'),drafts:[],feedback:null,complete:false};
 const {ctx,page}=await open([start],'B',{reply:forged});
 await page.fill('#draft',TEXT);await page.click('text=설명 저장하고 피드백 받기');
 await page.waitForSelector('.fb-provenance');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('curiven-v01-personal')).lessons[0]);
 const fb=saved.drafts[0].feedback;
 assert.equal(fb.schema,2);assert.equal(fb.reviewer.model,'gpt-test');assert.equal(fb.reviewer.provider,'chatgpt');
 assert.equal(fb.misconceptions.length,1,'a misconception quoting words the learner never wrote is withheld');assert.equal(fb.withheld,1);
 assert.equal(saved.feedbackFor,saved.drafts[0].at);
 assert.equal(await page.locator('.fb-misconception').count(),1);
 await ctx.close();
});

test('constellation: legacy gold stars kept but labelled; v2 needs evidence; nothing claims mastery',async()=>{
 const tampered={...V2,explained:[{id:'k2',quote:'쿠키는 HttpOnly로 보호된다는 점을 설명했어요'}]};
 const {ctx,page,errors}=await open([rec('OLD','이전 기록',LEGACY,'예전 설명'),rec('NEW','새 기록',V2,TEXT),rec('BAD','편집된 백업',tampered,TEXT)],'NEW');
 assert.deepEqual(await tiers(page,'OLD'),{'HTTP 무상태성':'encountered','쿠키':'legacy','세션 ID':'encountered','서버 세션 저장소':'legacy'},'historical gold stars are not removed');
 assert.deepEqual(await tiers(page,'NEW'),{'HTTP 무상태성':'explained','쿠키':'encountered','세션 ID':'explained','서버 세션 저장소':'encountered'});
 assert.deepEqual(Object.values(await tiers(page,'BAD')),['encountered','encountered','encountered','encountered'],'unsupported evidence earns no star');
 // Inspector wording for each tier
 await page.evaluate(()=>openAtlas(data.lessons.find(x=>x.id==='NEW')));await page.waitForSelector('#atlasOverlay:not([hidden])');
 await page.locator('[aria-label="HTTP 무상태성: 개념"]').click();
 const info=await page.textContent('#atlasInfo');
 assert.match(info,/AI가 내 설명과 연결한 개념/);assert.match(info,/“HTTP는 상태가 없어서/);assert.match(info,/이해를 확인한 시험 결과는 아니에요/);
 await page.locator('[aria-label="쿠키: 개념"]').click();assert.match(await page.textContent('#atlasInfo'),/이 탐험에서 만난 개념/);
 await page.click('#atlasClose');
 await page.evaluate(()=>openAtlas(data.lessons.find(x=>x.id==='OLD')));await page.waitForSelector('#atlasOverlay:not([hidden])');
 await page.locator('[aria-label="쿠키: 개념"]').click();
 assert.match(await page.textContent('#atlasInfo'),/이전 버전 피드백에서 언급된 개념.*기록되지 않았어요/);
 assert.match(await page.textContent('.atlas-legends'),/AI가 내 설명과 연결한 개념/);
 const html=await page.content();assert.doesNotMatch(html,/마스터|이해 완료|검증된 이해/);
 // The saved records themselves were not rewritten by viewing them.
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('curiven-v01-personal')).lessons.find(x=>x.id==='OLD').feedback);
 assert.deepEqual(after,LEGACY);
 assert.deepEqual(errors,[]);await ctx.close();
});
