// Phase 2D-B — audit corrections: unfinished explorations can be resumed, answered options stay readable, constellation
// labels sit on plates, explanation feedback shows one focused question by default, records without `events` are read
// safely, decorative English copy is gone.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/phase2db.e2e.test.js
// Isolated fixture records only; AI requests are recorded and refused; Notion is mocked as disconnected (no writes).
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9800+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:[],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const clone=x=>JSON.parse(JSON.stringify(x));
const LESSON={title:'미분: 한 순간의 변화율',shortTitle:'미분의 원리',hook:'속도계는 지금 이 순간의 속도를 어떻게 알까요?',story:'하준은 속도계를 보았어요.',prediction:'지금 이 순간의 속도는 어떻게 정할까요?',
 scenarios:[{title:'구간을 줄이면',question:'시간 구간을 짧게 하면 평균 속도는?',options:['한 값에 가까워질 수 있다','항상 0이 된다','항상 커진다'],answerIndex:0,reason:'구간을 0에 가깝게 하면 한 값에 가까워질 수 있어요.'}],
 concepts:[{id:'k1',name:'평균변화율',description:'두 점 사이 변화의 비율'},{id:'k2',name:'극한',description:'한없이 가까워지는 값'},{id:'k3',name:'미분계수',description:'평균변화율의 극한'}],
 connections:[{from:'k1',to:'k3',why:'극한을 취함'},{from:'k2',to:'k3',why:'정의에 쓰임'}],
 technical:[{heading:'정의',text:'미분계수는 평균변화율의 극한이에요.'}],explainPrompt:'미분계수를 설명해 볼까요?'};
const rec=(id,extra={})=>({id,topic:'미분이 뭐야?',question:'미분이 뭐야?',interest:'',level:'beginner',stage:5,maxStage:5,complete:true,lesson:clone(LESSON),prediction:'',scenarios:[],drafts:[],feedback:null,dialogue:[],
 events:[{at:'2026-11-20T01:00:00.000Z',what:'새로운 주제: 미분이 뭐야?'}],createdAt:1763600000000,updatedAt:1763600000000,...extra});
const sq=()=>({id:'sq',topic:'SQL Injection',stage:5,maxStage:5,complete:true,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:3,updatedAt:3,lesson:{...clone(SQLI),shortTitle:'SQL 인젝션'}});
const mem=()=>{const l=clone(MEM);l.complete=true;l.stage=5;l.maxStage=5;return l};

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lessons,active,{viewport={width:1440,height:960},profile=PROFILE}={}){
 const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});
 await ctx.addInitScript(`${profile?`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(profile))});`:''}if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 const ai=[];await ctx.route('**/api/ai',r=>{ai.push(r.request().postData());r.fulfill({status:500,json:{ok:false,error:'not in this test'}})});
 const notion=[];await ctx.route('**/api/notion/**',r=>{if(r.request().method()!=='GET')notion.push(r.request().url());r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,errors,ai,notion};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const without=(l,...keys)=>{const c=clone(l);for(const k of keys)delete c[k];return c};

test('unfinished explorations are listed on home and reopen at their saved stage, with no AI request and no record change',async()=>{
 const mid=rec('mid',{complete:false,stage:3,maxStage:3,question:'극한이 왜 필요해?',updatedAt:1763900000000,drafts:[],prediction:'잘 모르겠어요',
  dialogue:[{id:'d1',role:'learner',text:'극한이 뭐예요?',intent:'ask',ref:null,stage:3,at:1763900000001,status:'answered'},{id:'d2',role:'tutor',replyTo:'d1',text:'한없이 가까워지는 값이에요.',followUp:'',assessment:null,uncertainty:'',withheld:0,reviewer:{provider:'chatgpt',model:'m',at:1},at:1763900000002}]});
 mid.lesson.title='극한으로 정의하는 미분계수';mid.lesson.shortTitle='미분계수의 정의';
 const prep={id:'prep',topic:'광합성은 어떻게 일어날까',question:'광합성은 어떻게 일어날까',interest:'',level:'beginner',stage:0,maxStage:0,lesson:null,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:1763700000000,updatedAt:1763700000000,complete:false};
 const done=rec('done');
 const {ctx,page,errors,ai,notion}=await open([done,mid,prep],null);
 const items=await page.$$eval('#unfinished .home-resume-item',b=>b.map(x=>({id:x.dataset.id,text:x.innerText.replace(/\s+/g,' ').trim(),label:x.getAttribute('aria-label'),tag:x.tagName})));
 assert.deepEqual(items.map(x=>x.id),['mid','prep'],'unfinished only, most recent first; a completed exploration is not listed');
 assert.match(items[0].text,/미분계수의 정의.*개념 단계/);assert.match(items[1].text,/광합성은 어떻게 일어날까.*자료 준비 전/);
 assert.ok(items.every(x=>x.tag==='BUTTON'),'keyboard reachable');assert.match(items[0].label,/극한으로 정의하는 미분계수/,'the full title is announced');
 assert.equal(await page.locator('#unfinished h2').innerText(),'이어서 할 탐험');
 const before=clone(await stored(page));
 await page.click('#unfinished [data-id="mid"]');await page.waitForSelector('#keyConcepts');
 assert.equal(await page.locator('main h2').first().innerText(),'이제 원리를 알아볼까요?');
 assert.match(await page.locator('#helpToggle').innerText(),/대화 1개/,'the conversation comes back with it');
 const after=await stored(page);assert.equal(after.active,'mid');
 assert.deepEqual(after.lessons.map(l=>without(l,'updatedAt')),before.lessons.map(l=>without(l,'updatedAt')),'reopening changes nothing in the records');
 // a record that never got its lesson reopens on the preparation screen; nothing is generated until the learner asks
 await page.click('#homeLogo');await page.click('#unfinished [data-id="prep"]');await page.waitForSelector('text=탐험 만들기');
 assert.equal(ai.length,0,'no AI request from listing or reopening');
 // the constellation still shows completed explorations only
 await page.evaluate(()=>openAtlas(data.lessons.find(l=>l.id==='done')));await page.click('[data-atlas-mode=all]').catch(()=>{});
 const topics=await page.$$eval('#atlasSvg .atlas-topic',g=>g.map(x=>x.dataset.id.split(':')[0]));assert.deepEqual(topics,['done']);
 assert.deepEqual(errors,[]);assert.deepEqual(notion,[]);await ctx.close();
});
test('more than three unfinished explorations: three shown, the rest behind “더 보기”; none when everything is complete',async()=>{
 const many=Array.from({length:5},(_,i)=>rec('u'+i,{complete:false,stage:2,maxStage:2,updatedAt:1763800000000+i}));
 let {ctx,page}=await open(many,null);
 assert.equal(await page.locator('#unfinished > .home-resume-list .home-resume-item').count(),3);
 assert.equal(await page.locator('#unfinished details summary').innerText(),'더 보기 (2)');
 assert.deepEqual(await page.$$eval('#unfinished > .home-resume-list .home-resume-item',b=>b.map(x=>x.dataset.id)),['u4','u3','u2']);await ctx.close();
 ({ctx,page}=await open([rec('a'),rec('b')],null));assert.equal(await page.locator('#unfinished').count(),0);await ctx.close();
});
test('answered thought-experiment options are not faded: text contrast is at least 4.5:1',async()=>{
 const l=rec('x',{complete:false,stage:2,maxStage:2,scenarios:[{i:0,choice:1,at:1}]});
 const {ctx,page}=await open([l],'x');await page.waitForSelector('button.opt');
 const ratios=await page.$$eval('button.opt',bs=>bs.map(b=>{const cs=getComputedStyle(b),op=+cs.opacity;
  const rgb=s=>s.match(/\d+(\.\d+)?/g).slice(0,3).map(Number);const fg=rgb(cs.color),bg=rgb(cs.backgroundColor);
  const mix=fg.map((c,i)=>c*op+bg[i]*(1-op));const lum=a=>{const [r,g,b]=a.map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
  const [h,lo]=[lum(mix),lum(bg)].sort((a,b)=>b-a);return {disabled:b.disabled,ratio:(h+.05)/(lo+.05)}}));
 assert.ok(ratios.length===3&&ratios.every(r=>r.disabled),'answered');
 for(const r of ratios)assert.ok(r.ratio>=4.5,'contrast '+r.ratio.toFixed(2));await ctx.close();
});
test('constellation: every visible label has a plate above the lines, and no line pixels show inside any label (1440 and 390)',async()=>{
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const c=rec('c'),{ctx,page,errors}=await open([mem(),sq(),c],null,{viewport});
  await page.evaluate(()=>openAtlas(data.lessons.find(l=>l.id==='c')));await page.click('[data-atlas-mode=all]');await page.waitForTimeout(150);
  const plates=await page.$$eval('#atlasSvg .atlas-node-label',ts=>ts.filter(t=>getComputedStyle(t).display!=='none').map(t=>{const p=t.previousElementSibling;
   return {label:t.textContent,plate:!!p?.classList.contains('atlas-label-plate'),hidden:p?.getAttribute('aria-hidden'),inStars:!!t.closest('g.atlas-star')}}));
  assert.ok(plates.length>=10);for(const p of plates)assert.ok(p.plate&&p.hidden==='true'&&p.inStars,JSON.stringify(p));
  await page.addStyleTag({content:'#atlasSvg text{fill:transparent!important;stroke:none!important}'});await page.waitForTimeout(80);
  const boxes=await page.evaluate(()=>{const v=document.querySelector('.atlas-sky').getBoundingClientRect();return [...document.querySelectorAll('#atlasSvg text')].filter(t=>getComputedStyle(t).display!=='none').map(t=>{const r=t.getBoundingClientRect();return {t:t.textContent,x:r.left,y:r.top,w:r.width,h:r.height}}).filter(b=>b.w>0&&b.x>=v.left&&b.y>=v.top&&b.x+b.w<=v.right&&b.y+b.h<=v.bottom)});
  const buf=await page.screenshot();
  const hits=await page.evaluate(async({b64,boxes})=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const g=cv.getContext('2d');g.drawImage(img,0,0);const sc=img.width/innerWidth;
   return boxes.map(b=>{const d=g.getImageData(Math.round(b.x*sc)+2,Math.round(b.y*sc)+2,Math.max(1,Math.round(b.w*sc)-4),Math.max(1,Math.round(b.h*sc)-4)).data;let n=0;for(let i=0;i<d.length;i+=4)if((d[i]+d[i+1]+d[i+2])/3>40)n++;return {t:b.t,n}}).filter(x=>x.n>3)},{b64:buf.toString('base64'),boxes});
  assert.ok(boxes.length>=5,'labels measured: '+boxes.length);assert.deepEqual(hits,[],`line pixels inside labels at ${viewport.width}px`);
  assert.deepEqual(errors,[]);await ctx.close()}
 // overview (“한눈에 보기”, needs a tall map): concept labels are hidden, and so are their plates; exploration names keep theirs
 const many=Array.from({length:12},(_,i)=>rec('s'+i,{updatedAt:1763600000000+i}));
 const {ctx,page,errors}=await open(many,null);await page.evaluate(()=>openAtlas(data.lessons[0]));await page.click('[data-atlas-mode=all]');await page.click('#atlasFit');await page.waitForTimeout(150);
 assert.match(await page.getAttribute('#atlasSvg','class'),/overview/);
 const vis=sel=>page.$$eval(sel,ps=>ps.filter(p=>getComputedStyle(p).display!=='none').length);
 assert.equal(await vis('#atlasSvg .atlas-star:not(.atlas-topic) .atlas-label-plate'),0);assert.equal(await vis('#atlasSvg .atlas-topic .atlas-label-plate'),12);
 assert.deepEqual(errors,[]);await ctx.close();
});
const AT=1763900000500,TEXT='평균변화율은 두 점 사이의 차이를 나눈 값이고, 간격을 0으로 두면 미분계수가 돼요. 극한이 있으면 미분가능해요.';
const FB={schema:2,summary:'흐름은 잘 짚었어요.',correct:[{quote:'극한이 있으면 미분가능해요',point:'필요조건을 짚었어요.'}],
 precision:[{quote:'두 점 사이의 차이를 나눈 값',issue:'무엇을 무엇으로 나누는지',why:'분자와 분모가 다른 변화량이에요.',question:'분자와 분모에는 각각 무엇이 들어갈까요?'},
  {quote:'극한이 있으면 미분가능해요',issue:'극한의 조건',why:'유한한 값이어야 해요.',question:'극한이 무한대면 어떨까요?'}],
 misconceptions:[{quote:'간격을 0으로 두면 미분계수가 돼요',issue:'0을 대입하는 것과 0에 가까워지는 것은 달라요.',why:'h=0이면 나눌 수 없어요.',question:'h를 0으로 두면 식에서 무슨 일이 생길까요?'}],
 missing:[{issue:'어느 점에서의 변화율인지',question:'어느 입력을 고정해야 할까요?'}],
 explained:[{id:'k1',quote:'두 점 사이의 차이를 나눈 값'}],demonstrated:['k1'],uncertainty:'',withheld:0,reviewer:{provider:'chatgpt',model:'gpt-test',at:1}};
test('explanation feedback: one focused question by default (a misconception first); the rest only on request; answered items stay; records unchanged',async()=>{
 const reply={id:'r1',role:'learner',text:'유한한 값이어야 해요.',intent:'reply',ref:{kind:'feedback',draftAt:AT,type:'precision',index:1},stage:4,at:AT+10,status:'answered'};
 const l=rec('f',{complete:false,stage:4,maxStage:4,drafts:[{text:TEXT,at:AT,feedback:clone(FB)}],feedback:clone(FB),feedbackFor:AT,dialogue:[reply]});
 const {ctx,page,errors,ai}=await open([l],'f');await page.waitForSelector('#draftHistory');
 const shown=()=>page.$$eval('#draftHistory .feedback > p[data-fb]',ps=>ps.map(p=>({fb:p.dataset.fb,q:/ — [^—]*\?$/.test(p.textContent)})));
 const replyButtons=()=>page.locator('#draftHistory .feedback .tutor-open',{hasText:'이 질문에 답하기'}).count();
 let s=await shown();
 assert.deepEqual(s.map(x=>x.fb).sort(),['misconceptions:0','missing:0','precision:0','precision:1'],'every point stays visible');
 assert.deepEqual(s.filter(x=>x.q).map(x=>x.fb).sort(),['misconceptions:0','precision:1'],'the primary question, plus the item the learner already answered');
 assert.equal(await replyButtons(),1,'one new reply box (the answered item shows its thread instead)');
 assert.match(await page.locator('#draftHistory .feedback').innerText(),/h를 0으로 두면 식에서 무슨 일이 생길까요\?/);
 assert.ok(!(await page.locator('#draftHistory .feedback').innerText()).includes('분자와 분모에는 각각 무엇이 들어갈까요?'));
 const more=page.locator('#draftHistory .fb-more');assert.equal(await more.innerText(),'다른 질문도 보기 (2)');
 await more.focus();await page.keyboard.press('Enter');
 s=await shown();assert.ok(s.every(x=>x.q),'all questions after the learner asks');assert.equal(await page.locator('#draftHistory .fb-more').count(),0);
 assert.equal(await replyButtons(),3);
 assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'이 질문에 답하기','focus moves to the first revealed question');
 const st=await stored(page);assert.deepEqual(st.lessons[0].drafts[0].feedback,FB,'stored feedback untouched');assert.deepEqual(st.lessons[0].feedback,FB);
 assert.equal(ai.length,0);assert.deepEqual(errors,[]);await ctx.close();
});
test('a record without a usable events list: rendered without errors, not rewritten on read, no history invented; a real action starts the list',async()=>{
 const missing=rec('m',{complete:false,stage:1,maxStage:1});delete missing.events;
 const garbage=rec('g',{events:'2026-11-20 탐험 완료'});const holey=rec('h',{events:[null,{what:'탐험 완료',at:'2026-11-20T01:00:00.000Z'},7]});
 const {ctx,page,errors,ai}=await open([missing,garbage,holey],'m');await page.waitForSelector('#prediction');
 let st=await stored(page);
 assert.ok(!('events' in st.lessons[0]),'reading does not add a field');assert.equal(st.lessons[1].events,'2026-11-20 탐험 완료');assert.deepEqual(st.lessons[2].events,holey.events);
 assert.deepEqual(st.lessons[0].drafts,[]);assert.equal(st.lessons[0].feedback,null,'no evidence appears');
 // other records with odd events render too
 for(const id of ['g','h']){await page.evaluate(id=>{data.active=id;render()},id);await page.waitForTimeout(80)}
 assert.match(await page.locator('#journal').innerText(),/탐험 완료/,'readable items of a partly broken list are still shown');
 await page.evaluate(()=>{data.active='m';render()});await page.waitForSelector('#prediction');
 await page.fill('#prediction','짧은 구간의 평균일 것 같아요.');await page.click('text=예상 남기고 계속하기 →');await page.waitForSelector('button.opt');
 st=await stored(page);const m=st.lessons.find(l=>l.id==='m');
 assert.deepEqual(m.events.map(e=>e.what),['나의 예상 기록'],'only the action that happened is recorded');assert.ok(!('eventsUnreadable' in m));
 await page.evaluate(()=>{const g=data.lessons.find(l=>l.id==='g');track(g,'다시 열어 봄')});
 st=await stored(page);const g=st.lessons.find(l=>l.id==='g');
 assert.equal(g.eventsUnreadable,'2026-11-20 탐험 완료','an unreadable value is kept aside, never discarded');assert.deepEqual(g.events.map(e=>e.what),['다시 열어 봄']);
 assert.equal(ai.length,0);assert.deepEqual(errors,[]);await ctx.close();
});
test('no decorative English copy on home, onboarding or the learning sidebar',async()=>{
 const banned=/A LITTLE UNIVERSE|little universe|Explore your curiosity|YOUR JOURNEY|CURIVEN \/ /i;
 let {ctx,page}=await open([rec('a'),rec('u',{complete:false,stage:2,maxStage:2})],null);assert.doesNotMatch(await page.locator('body').innerText(),banned);
 await page.click('#unfinished [data-id="u"]');await page.waitForSelector('button.opt');assert.doesNotMatch(await page.locator('body').innerText(),banned);
 assert.equal(await page.locator('#nav[aria-label="학습 단계"]').count(),1,'the step list keeps its accessible name');await ctx.close();
 ({ctx,page}=await open([],null,{profile:null}));await page.waitForSelector('h2');assert.doesNotMatch(await page.locator('body').innerText(),banned);await ctx.close();
});
test('Q3-B (mocked feedback): a completed explanation shows no question and can be finished; a required gap is asked first only without optional precision',async()=>{
 const DEV=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures','q3b_development.json'),'utf8')).cases;
 const show=async(id,which)=>{const c=DEV.find(x=>x.id===id),f={...clone(c[which]),schema:2,demonstrated:[],withheld:0,reviewer:{provider:'chatgpt',model:'gpt-test',at:1}};
  const o=await open([rec('p',{complete:false,stage:4,maxStage:4,drafts:[{text:c.text,at:AT,feedback:clone(f)}],feedback:clone(f),feedbackFor:AT,dialogue:[]})],'p');await o.page.waitForSelector('#draftHistory .feedback');return o};
 const asked=page=>page.locator('#draftHistory .feedback .tutor-open',{hasText:'이 질문에 답하기'}).count();
 {const {ctx,page,errors,ai}=await show('D8','desired');assert.equal(await page.locator('#draftHistory .feedback p[data-fb]').count(),0);assert.equal(await asked(page),0);assert.equal(await page.locator('.fb-more').count(),0);
  await page.locator('button',{hasText:'학습 마무리하기'}).first().click();assert.equal((await stored(page)).lessons[0].complete,true,'the learner can finish');assert.equal(ai.length,0);assert.deepEqual(errors,[]);await ctx.close()}
 for(const [which,first] of [['desired','missing:0'],['flawed','precision:0']]){const {ctx,page,errors}=await show('D6',which);
  assert.deepEqual(await page.$$eval('#draftHistory .feedback > p[data-fb]',ps=>ps.filter(p=>/ — [^—]*\?$/.test(p.textContent)).map(p=>p.dataset.fb)),[first],which);assert.deepEqual(errors,[]);await ctx.close()}
});

test('Linked quotation is visible and a learner can finish with its question unanswered',async()=>{
 for(const id of ['linked','optional']){
  const c={lesson:{title:'소리의 전달',concepts:[{id:'k1',name:'진동',description:'물체가 떨리는 움직임'}]},
           text:id==='linked'?'북을 치면 막이 떨려요.':'북의 막이 떨려요. 공기를 통해 소리가 전해져요.'};
  const f={schema:2,summary:'설명에 대한 AI 의견이에요.',explained:[],precision:[]};
  const quote='북을 치면 막이 떨려요.';
  if(id==='linked')f.explained=[{id:'k1',quote}];
  else f.precision=[{quote:c.text.split('. ')[0],issue:'추가로 생각할 조건',why:'다른 조건도 있을 수 있어요.',question:'막의 크기를 바꾸면 어떨까요?'}];
  const l=rec('q3c',{complete:false,stage:4,maxStage:4,lesson:{...clone(LESSON),...c.lesson},
                    drafts:[{at:1,text:c.text,feedback:f}],feedback:f,feedbackFor:1});
  const {ctx,page,errors,ai,notion}=await open([l],l.id);
  await page.waitForSelector('#draftHistory .feedback');
  if(id==='linked'){
   const credit=page.locator('#draftHistory .fb-explained');
   assert.match(await credit.innerText(),/AI가 내 설명과 연결한 개념/);
   assert.ok((await credit.innerText()).includes(quote));
   assert.match(await credit.innerText(),/이해를 확인한 시험 결과는 아니에요/);
   assert.deepEqual((await stored(page)).lessons[0].drafts[0].feedback,l.drafts[0].feedback);
  }else{
   assert.match(await page.locator('#draftHistory .fb-precision').innerText(),/막의 크기를 바꾸면 어떨까요\?/);
   await page.locator('button',{hasText:'학습 마무리하기'}).first().click();
   assert.equal((await stored(page)).lessons[0].complete,true);
  }
  assert.equal(ai.length,0);
  assert.equal(notion.filter(url=>url.endsWith('/save')).length,0);
  assert.deepEqual(errors,[]);
  await ctx.close();
 }
});

test('altered quotations are never shown as the learner’s words (feedback fields, growth stage, star); the record is unchanged',async()=>{
 const text='HTTP는 상태가 없어서 서버는 같은 사용자인지 알 수 없어요.',flip='HTTP는 상태가 없어서 서버는 같은 사용자인지 알 수 있다';
 const it={quote:flip,issue:'i',why:'w',question:'q?'};
 const f={schema:2,summary:'s',correct:[{quote:flip,point:'p'}],precision:[clone(it)],misconceptions:[clone(it)],missing:[],explained:[],uncertainty:'',withheld:0,demonstrated:[]};
 for(const credited of [false,true]){
  const fb=credited?{...clone(f),precision:[],misconceptions:[],explained:[{id:'k1',quote:flip}],demonstrated:['k1']}:clone(f);
  const l=rec('v',{complete:true,stage:4,maxStage:5,drafts:[{at:AT,text,feedback:fb}],feedback:clone(fb),feedbackFor:AT});
  const {ctx,page,errors,ai}=await open([l],'v');await page.waitForSelector('#draftHistory .feedback');
  const shown=await page.locator('#draftHistory .feedback').innerText();
  assert.ok(!shown.includes('알 수 있다'));assert.equal(shown.split('“'+text+'”').length-1,credited?2:3);
  if(credited)assert.equal(await page.evaluate(()=>modelAtlas(data.lessons[0],'today').nodes.find(n=>n.id==='v:k1').quote),text);
  await page.evaluate(()=>{data.lessons[0].stage=5;render()});await page.waitForSelector('#explanationRounds',{state:'attached'});
  assert.ok(!(await page.locator('#explanationRounds').textContent()).includes('알 수 있다'));
  assert.deepEqual((await stored(page)).lessons[0].drafts[0].feedback,fb,'stored quotation unchanged');
  assert.equal(ai.length,0);assert.deepEqual(errors,[]);await ctx.close();
 }
});
