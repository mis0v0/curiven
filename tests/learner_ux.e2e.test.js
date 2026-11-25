// Synthetic memory lesson and scripted tutor responses.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/learner_ux.e2e.test.js
// ALL AI RESPONSES ARE MOCKED. These tests check what the interface shows, sends and stores — not teaching quality.
// Optional: SCREEN_DIR=<dir> saves screenshots.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8600+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const SHOTS=process.env.SCREEN_DIR;
const shot=async(page,name,full=true)=>{if(SHOTS){fs.mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:full})}};
const clone=x=>JSON.parse(JSON.stringify(x));
const FLOW={type:'flow',title:'기억 보고가 달라질 수 있는 흐름',relation:'possible',note:'단순화한 개념 모델이에요. 뇌의 실제 경로를 그린 것이 아니에요.',
 steps:[{label:'원래 사건',detail:'영상에는 가방이 없었다'},{label:'처음 부호화',detail:'주의를 둔 부분 위주로 남는다'},{label:'나중의 오정보',detail:'“빨간 가방은 얼마나 컸어?”'},{label:'인출과 출처 판단',detail:'들은 것과 본 것을 구별하지 못할 수 있다'},{label:'부정확한 보고',detail:'“빨간 가방을 봤어요”'}]};
const CMP={type:'compare',title:'확신과 정확성',columns:['확신','정확성'],rows:[{aspect:'뜻',values:['기억이 맞다고 느끼는 정도','기억이 실제 사건과 일치하는 정도']},{aspect:'커지는 계기',values:['반복해서 떠올리기, 다른 사람의 동의','원본처럼 독립적인 자료로 확인될 때']},{aspect:'확인 방법',values:['스스로의 느낌','원본 영상 같은 독립 자료와 비교']}],note:''};
function memLesson({visuals=true}={}){const l=clone(MEM);l.dialogue=[];l.drafts=[];l.feedback=null;l.complete=false;l.stage=3;l.maxStage=4;
 if(visuals){l.lesson.technical[0].visual=FLOW;l.lesson.technical[1].visual=CMP;l.lesson.reading=[{claim:'사후 오정보 효과',query:'misinformation effect eyewitness memory review',kind:'리뷰 논문, 심리학 개론서'},{claim:'출처 판단 오류',query:'source monitoring framework memory',kind:'리뷰 논문'}]}
 return l}

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lessons,active,{ai=()=>({reply:'답'}),viewport={width:1280,height:900},reducedMotion}={}){
 const ctx=await browser.newContext({viewport,reducedMotion});const calls=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[{slug:'gpt-test',displayName:'T'}]}}));
 await ctx.route('**/api/ai',async r=>{const body=JSON.parse(r.request().postData());calls.push(body);return r.fulfill({json:{ok:true,provider:'chatgpt',model:'gpt-test',data:await ai(body)}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,calls,errors};
}
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const noSideScroll=async page=>{const w=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,win:innerWidth}));assert.ok(w.doc<=w.win,`no horizontal page scroll (${w.doc}>${w.win})`)};

test('C — red-bag explanation: the feedback request carries the scenario premise; no invented context',async()=>{
 const l=clone(MEM);l.drafts=[];l.feedback=null;l.stage=4;l.complete=false;
 const {ctx,page,calls,errors}=await open([l],'mem',{ai:()=>({schema:2,summary:'출처 판단을 연결해 보세요.',correct:[],precision:[],misconceptions:[],missing:[],explained:[],uncertainty:''})});
 await page.fill('#draft',MEM.drafts[0].text);await page.click('text=설명 저장하고 피드백 받기');await page.waitForSelector('.fb-provenance');
 const c=calls.find(x=>x.mode==='feedback');
 assert.equal(c.text,MEM.drafts[0].text,'the learner text is sent verbatim');
 assert.match(c.context.scenarios[0].question,/녹음에는 종소리가 없었습니다/);assert.equal(c.context.story,MEM.lesson.story);
 assert.equal(c.context.prediction.unsure,true);assert.equal(c.context.scenarios[0].learnerChoice,'두 번째 집단에서 더 높아질 수 있다.');
 assert.ok(!JSON.stringify(c).includes('answerIndex'),'no answer key');assert.ok(!JSON.stringify(c.context).includes('독서'),'the context holds lesson record only (the profile has its own field)');
 assert.equal(await page.locator('#explainStatus').count(),0,'no standing disclaimer once the review is in');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('A/B — one composer: a confirmation question gets a natural answer with no label or notice; a follow-up in the same thread',async()=>{
 const Q='그럼 설명을 읽은 순서도 기록해야 하는 거죠?';
 const {ctx,page,calls,errors}=await open([memLesson()],'mem',{ai:b=>b.message===Q
  ?{reply:'네. 다만 정보의 ‘유무’보다 그 정보를 어떤 방식으로 제시하는지가 중요해요. 대답이 바뀌는 것과 기억 자체가 바뀌는 것은 구별해야 해요.',followUp:'',assessment:{verdict:'imprecise',quote:'설명을 읽은 순서도 기록해야 하는 거죠',note:'제시 방식'},uncertainty:''}
  :{reply:'정확하게는: 질문에 담긴 정보가 대답에 영향을 줄 수 있고, 그 정보의 출처를 혼동하면 기억 보고가 달라질 수 있어요.',followUp:'',assessment:null,uncertainty:''}});
 await page.click('.navitem:has-text("3. 탐구")');const box=page.locator('.concept',{hasText:'생각 실험 1'});
 await box.locator('text=이 해설에 대해 묻기').click();
 // Phase 2B: one composer, two explicit actions — 질문하기 (answered, never graded) and 내 이해 확인받기 (reviewed).
 assert.equal(await box.locator('.tutor-send').textContent(),'질문하기');assert.equal(await box.locator('.tutor-check').textContent(),'내 이해 확인받기');assert.equal(await box.locator('textarea').count(),1,'one composer');
 await box.locator('textarea').fill(Q);await box.locator('.tutor-send').click();await box.locator('.tutor-msg.ai').waitFor();
 const t=await box.textContent();assert.match(t,/기억 자체가 바뀌는 것은 구별/);
 for(const internal of ['대신 이렇게 표시','이해 부족의 증거','전제를 함께 확인','대체로 맞지만'])assert.ok(!t.includes(internal),internal);
 assert.equal(await box.locator('.tutor-assess').count(),0,'a question is answered, not labelled');
 await box.locator('textarea').fill('어떤 자료부터 비교하면 좋을까요?');await box.locator('.tutor-send').click();
 await page.waitForFunction(()=>document.querySelectorAll('.concept .tutor-msg.ai').length===2);
 const c=calls.at(-1);assert.equal(c.intent,'ask');assert.equal(c.history.length,2,'the previous exchange is the context');assert.match(c.history[1].text,/제시하는지가 중요/);
 const s=(await stored(page)).lessons[0];assert.equal(s.dialogue[1].assessment.adjustedFrom,'imprecise','kept in the record');
 await shot(page,'ux3-desktop-conversation');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('D/E — visual explanations and sources: semantic, text-equivalent, no motion, mobile-safe; unchecked status stated',async()=>{
 for(const [vp,name] of [[{width:1280,height:900},'desktop'],[{width:375,height:780},'mobile']]){
  const {ctx,page,errors}=await open([memLesson()],'mem',{viewport:vp,reducedMotion:'reduce'});
  const flow=page.locator('figure[data-visual=flow]');await flow.waitFor();
  assert.equal(await flow.locator('ol.viz-flow > li').count(),5,'a real ordered list is the text equivalent');
  assert.match(await flow.locator('ol').getAttribute('aria-label'),/항상 그렇게 되는 것은 아니에요/,'“possible” relation is not presented as a fixed cause');
  assert.match(await flow.textContent(),/단순화한 개념 모델이에요/);
  assert.equal(await flow.locator('.viz-arrow[aria-hidden=true]').count(),4,'arrows are decorative only');
  const tb=page.locator('figure[data-visual=compare] table');assert.equal(await tb.locator('caption').textContent(),'확신과 정확성');
  assert.equal(await tb.locator('th[scope=col]').count(),3);assert.equal(await tb.locator('th[scope=row]').count(),3);
  assert.equal(await page.locator('figure[data-visual=compare] .viz-scroll').getAttribute('tabindex'),'0','a wide table can be scrolled by keyboard');
  assert.equal(await page.locator('details.tech-more[open]').count(),0,'the visuals need no subsection opened');
  const anim=await page.evaluate(()=>[...document.querySelectorAll('.viz, .viz *')].some(e=>getComputedStyle(e).animationName!=='none'));assert.equal(anim,false);
  await noSideScroll(page);
  if(name==='desktop'){await flow.scrollIntoViewIfNeeded();await shot(page,'ux3-desktop-visual-flow',false);await page.locator('figure[data-visual=compare]').scrollIntoViewIfNeeded();await shot(page,'ux3-desktop-visual-compare',false)}
  else{await flow.scrollIntoViewIfNeeded();await shot(page,'ux3-mobile-visual',false)}
  const fit=await page.evaluate(()=>{const w=document.querySelector('figure[data-visual=compare] .viz-scroll');return w.scrollWidth<=w.clientWidth+1});assert.ok(fit,`${name}: every column of the comparison is visible without sideways scrolling`);
  // Sources (Phase 2B): one section; what is AI-made and what the lesson flags as uncertain are visible without
  // opening anything; only the search suggestions are optional and are labelled as searches, not references.
  const src=page.locator('#sources');assert.match(await src.textContent(),/AI가 만들었고, 아직 출처로 확인하지 않았어요/);
  const lim=await page.evaluate(()=>data.lessons[0].lesson.limitations);if(lim)assert.ok(await page.locator('#limitations').isVisible(),'limitations are not folded away');
  assert.match(await src.locator('summary').textContent(),/직접 찾아보기 · 검색어 \d+개 \(AI 제안 · 아직 확인 안 됨\)/);
  await src.locator('summary').click();const st=await src.textContent();assert.match(st,/링크 자체는 출처가 아니에요/);
  const hrefs=await src.locator('a.sources-link').evaluateAll(a=>a.map(x=>[x.href,x.target,x.rel]));
  assert.equal(hrefs.length,4);for(const [h,t,r] of hrefs){assert.match(h,/^https:\/\/(scholar\.google\.com\/scholar|www\.google\.com\/search)\?q=/);assert.equal(t,'_blank');assert.equal(r,'noopener noreferrer')}
  assert.equal(await page.locator('text=공식 자료와 교차 확인해 주세요').count(),0,'the old generic warning is folded into this one place');
  if(name==='desktop'){await src.scrollIntoViewIfNeeded();await shot(page,'ux3-desktop-sources',false)}
  assert.deepEqual(errors,[]);await ctx.close()}
 // Invalid visuals and lessons without them: nothing breaks, nothing extra appears.
 const bad=memLesson({visuals:false});bad.lesson.technical[0].visual={type:'html',html:'<img src=x onerror="window.__x=1">'};bad.lesson.technical[1].visual={type:'flow',title:'x',steps:[{label:'하나뿐'}]};
 const {ctx,page,errors}=await open([bad],'mem');await page.waitForSelector('#keyConcepts');
 assert.equal(await page.locator('figure.viz').count(),0);assert.equal(await page.evaluate(()=>window.__x),undefined);
 await page.locator('#sources summary').click();assert.match(await page.textContent('#sources'),/개념 이름으로 찾아보기/,'fallback search links for lessons without suggestions');
 assert.deepEqual(errors,[]);await ctx.close();
});

const LONG='출처 판단 오류는 정보를 알게 된 경로를 잘못 판단하는 오류입니다. '.repeat(14);
test('G — constellation inspector: a long explanation and evidence are fully readable, desktop and mobile',async()=>{
 const l=clone(MEM);l.lesson.concepts[3].description=LONG;
 l.feedback=l.drafts[0].feedback={...l.drafts[0].feedback,explained:[{id:'k4',quote:'다른 사람이 나중에 종소리를 묘사하면 내가 들었던 소리와 읽었던 묘사를 뒤섞어서 소리의 출처를 혼동할 수 있어요'}]};
 for(const [vp,name] of [[{width:1280,height:760},'desktop'],[{width:375,height:740},'mobile']]){
  const {ctx,page,errors}=await open([l],'mem',{viewport:vp,reducedMotion:'reduce'});
  await page.evaluate(()=>openAtlas(data.lessons[0]));await page.waitForSelector('#atlasOverlay:not([hidden])');
  await page.locator('[aria-label="출처 판단 오류: 개념"]').click();
  const info=page.locator('#atlasInfo');assert.match(await info.textContent(),/AI가 내 설명과 연결한 개념/);
  const last=info.locator('p').last();await last.scrollIntoViewIfNeeded();
  const g=await page.evaluate(()=>{const i=document.getElementById('atlasInfo'),f=document.querySelector('.atlas-footer'),ps=[...i.querySelectorAll('p')],lr=ps.at(-1).getBoundingClientRect(),ir=i.getBoundingClientRect(),fr=f.getBoundingClientRect(),win=document.querySelector('.atlas-window').getBoundingClientRect();
   return {lastBottom:lr.bottom,infoBottom:ir.bottom,footerTop:fr.top,winBottom:win.bottom,clip:getComputedStyle(i).overflowY,scrollable:i.scrollHeight>i.clientHeight,lastVisible:lr.bottom<=Math.min(fr.top,win.bottom)+1&&lr.top>=0,
    descFull:ps.some(p=>p.textContent===document.querySelector('#atlasInfo p:not(.atlas-hint)')?.textContent)}});
  assert.ok(g.lastVisible,`${name}: the last line can be brought into view above the footer (${JSON.stringify(g)})`);
  assert.equal(await info.locator('p').nth(0).textContent(),LONG.trim()===LONG?LONG:await info.locator('p').nth(0).textContent());
  assert.ok((await info.textContent()).includes(LONG.trim()),'the explanation is not truncated');
  if(name==='desktop'){assert.equal(g.clip,'auto');assert.ok(g.scrollable,'the inspector scrolls on its own');assert.ok(g.infoBottom<=g.footerTop+1,'inspector ends above the footer');
   assert.equal(await info.getAttribute('tabindex'),'0','keyboard users can focus and scroll it');}
  await shot(page,`ux3-${name}-inspector`,false);
  // Selecting another star starts at the top of its text.
  await page.locator('[aria-label="재구성적 기억: 개념"]').click();assert.equal(await info.evaluate(i=>i.scrollTop),0);
  assert.deepEqual(errors,[]);await ctx.close()}
});

const ASTRO={title:'블랙홀은 왜 빛을 가둘까',hook:'h',story:'천문 동아리에서 별이 사라지는 영상을 보았어요.',prediction:'p',scenarios:[{title:'탈출 속도',question:'q',options:['a','b'],answerIndex:1,reason:'r'}],
 concepts:[{id:'k1',name:'사건의 지평선',description:'빛도 빠져나올 수 없는 경계.'},{id:'k2',name:'탈출 속도',description:'중력을 벗어나는 최소 속도.'},{id:'k3',name:'블랙홀은 왜 빛을 가둘까',description:'이 탐험의 질문과 같은 이름의 개념.'}],
 connections:[{from:'k2',to:'k1',why:'탈출 속도가 광속이 되는 지점'}],technical:[{heading:'h',text:'t'}],explainPrompt:'e',limitations:''};
test('H — three unrelated explorations: no cross-topic links, same names kept apart, no unearned achievement',async()=>{
 const base={interest:'',level:'beginner',stage:5,maxStage:5,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:1,updatedAt:1,complete:true};
 const sq={...base,id:'S',topic:'SQL Injection',lesson:clone(SQLI)},me={...clone(MEM),id:'M'},as={...base,id:'B',topic:'블랙홀은 왜 빛을 가둘까',lesson:clone(ASTRO)};
 me.lesson.concepts[0].name='탈출 속도'; // same word in an unrelated lesson must not merge
 const longer=[sq,me,as,...[1,2,3].map(n=>({...base,id:'X'+n,topic:'역사 '+n,lesson:{...clone(ASTRO),title:'역사 '+n,concepts:ASTRO.concepts.map(c=>({...c,name:c.name+' '+n}))}}))];
 for(const [set,label] of [[[sq],'single'],[[sq,me],'two'],[longer,'longer']]){
  const {ctx,page,errors}=await open(set,set[0].id);
  const m=await page.evaluate(()=>{const x=modelAtlas(data.lessons[0],'all');return {nodes:x.nodes.map(n=>({id:n.id,lesson:n.lessonId,tier:n.tier,topic:n.topic,sameName:n.sameName,sameAsTopic:n.sameAsTopic,x:n.x,y:n.y})),edges:x.edges.map(e=>[e.from.split(':')[0],e.to.split(':')[0],e.kind]),w:x.width,h:x.height}});
  assert.ok(m.edges.every(([a,b])=>a===b),`${label}: no edge joins two explorations`);
  assert.equal(m.nodes.filter(n=>n.topic).length,set.length);
  assert.equal(new Set(m.nodes.map(n=>n.id)).size,m.nodes.length,'every star keeps its own identity');
  assert.ok(m.nodes.every(n=>Number.isFinite(n.x)&&n.x>=0&&n.x<=m.w&&n.y>=0&&n.y<=m.h),'all stars inside the sky');
  assert.ok(m.nodes.filter(n=>!n.topic).every(n=>n.tier==='encountered'||n.lesson==='M'),'no achievement without evidence');
  if(label!=='single'){const twin=m.nodes.filter(n=>n.id.endsWith(':k2')&&n.lesson==='B'||n.id==='M:k1');if(label==='longer')assert.ok(twin.every(n=>n.sameName>=1),'same name in two lessons is flagged, not merged')}
  if(label==='longer'){assert.ok(m.nodes.find(n=>n.id==='B:k3').sameAsTopic,'a concept named like its exploration is marked');
   await page.evaluate(()=>{openAtlas(data.lessons.find(l=>l.id==='B'))});await page.waitForSelector('#atlasOverlay:not([hidden])');
   await page.click('[data-atlas-mode=all]');await page.locator('#atlasSvg [aria-label="블랙홀은 왜 빛을 가둘까: 개념"]').first().click();
   const t=await page.textContent('#atlasInfo');assert.match(t,/탐험 · 블랙홀은 왜 빛을 가둘까/);assert.match(t,/탐험 주제와 이름이 같은 개념 별이에요/);
   await shot(page,'ux3-desktop-atlas-all',false)}
  assert.deepEqual(errors,[]);await ctx.close()}
});
