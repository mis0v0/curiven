// Phase 2C — Minimal Curiosity constellation: titles, layout at scale, navigation, keyboard, motion, evidence semantics.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/constellation.e2e.test.js
// Isolated fixture records and synthetic datasets only; no AI, no Notion.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9800+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'',interests:[],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const clone=x=>JSON.parse(JSON.stringify(x));
const FILE='01장_웹프로그래밍과_HTML5개요.pdf',WEB_TITLE='웹 입문: 서버가 보내고 브라우저가 보여 주는 과정과 HTML·CSS·JavaScript';
const LONG_DESC='출처 판단 오류는 어떤 정보를 언제, 어디서 알게 되었는지를 잘못 판단하는 오류예요. '.repeat(12).trim();
const LONG_QUOTE='다른 사람이 나중에 종소리를 묘사하면 내가 들었던 소리와 읽었던 묘사를 뒤섞어서 소리의 출처를 혼동할 수 있어요';
function web(){return {id:'legacy-web-1',topic:'수업 자료: '+FILE,interest:'',level:'beginner',stage:5,maxStage:5,complete:true,prediction:'',scenarios:[],drafts:[],feedback:null,
 material:{name:FILE,kind:'pdf',pageCount:1,pages:[{n:1,text:'x'}],unreadable:[]},events:[],createdAt:1,updatedAt:2,
 lesson:{title:WEB_TITLE,hook:'h',story:'s',prediction:'p',explainPrompt:'e',scenarios:[],technical:[],concepts:[{id:'k1',name:'웹 서버',description:'요청에 응답해 문서를 보내는 프로그램'},{id:'k2',name:'웹 브라우저',description:'문서를 받아 화면에 그리는 프로그램'},{id:'k3',name:'HTML·CSS·JavaScript',description:'구조·표현·동작'}],connections:[{from:'k2',to:'k1',why:'요청과 응답'}]}}}
function mem(){const l=clone(MEM);l.complete=true;l.stage=5;l.maxStage=5;l.lesson.concepts[3].description=LONG_DESC;
 l.feedback=l.drafts[0].feedback={...l.drafts[0].feedback,explained:[{id:'k4',quote:LONG_QUOTE}]};return l}
const WORDS=['광합성','엽록체','미분계수','평균변화율','사건의 지평선','탈출 속도','값 바인딩','HTTP 쿠키','세션 저장소','브라우저 렌더링','공급과 수요','한계 효용','자연 선택','유전적 부동 개념의 긴 이름'];
function synth(i){const n=3+(i*7)%6,concepts=Array.from({length:n},(_,k)=>({id:'k'+(k+1),name:WORDS[(i*3+k)%WORDS.length],description:'설명 '+k}));
 return {id:'syn-'+i,topic:'주제 '+i,question:'주제 '+i,stage:5,maxStage:5,complete:true,prediction:'',scenarios:[],drafts:[],feedback:null,events:[],createdAt:i,updatedAt:i,
  lesson:{title:`합성 탐험 ${i+1}: 조금 긴 한국어 제목이 어떻게 보이는지 확인하기`,hook:'h',story:'s',prediction:'p',explainPrompt:'e',scenarios:[],technical:[],concepts,connections:[{from:'k1',to:'k2',why:'연결'}]}}}

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open(lessons,active,{viewport={width:1440,height:960},reducedMotion='reduce'}={}){
 const ctx=await browser.newContext({viewport,reducedMotion});
 await ctx.addInitScript(`localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 await ctx.route('**/api/notion/**',r=>r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}}));
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,errors};
}
const atlas=async(page,i=0)=>{await page.evaluate(k=>openAtlas(data.lessons[k]),i);await page.waitForSelector('#atlasOverlay:not([hidden])')};
const stored=page=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)),KEY);
const labelOverlaps=page=>page.evaluate(()=>{const r=[...document.querySelectorAll('#atlasSvg .atlas-node-label')].map(e=>e.getBoundingClientRect()).filter(b=>b.width);let o=0;
 for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++){const a=r[i],b=r[j];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)o++}return o});

test('palette: the atlas is monochrome — no chromatic fill or stroke anywhere in the scene or the small map',async()=>{
 const {ctx,page,errors}=await open([mem(),web()],'mem');await atlas(page);await page.click('[data-atlas-mode=all]');
 const bad=await page.evaluate(()=>{const sat=c=>{const m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return 0;const [r,g,b,a=1]=m[1].split(',').map(Number);return a===0?0:Math.max(r,g,b)-Math.min(r,g,b)};const out=[];
  for(const el of document.querySelectorAll('.atlas-window *, #map *, .mapbox')){const cs=getComputedStyle(el);for(const k of ['color','backgroundColor','borderTopColor','fill','stroke'])if(sat(cs[k])>10)out.push(`${el.tagName}.${el.getAttribute('class')} ${k} ${cs[k]}`)}return out.slice(0,6)});
 assert.deepEqual(bad,[]);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.atlas-window')).backgroundColor),'rgb(17, 19, 23)','atlas black #111317');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('titles: the PDF exploration is named by its short title; full title and file stay in its details; record untouched',async()=>{
 const w=web(),before=JSON.stringify(w);const {ctx,page,errors}=await open([w],w.id);
 assert.ok(!(await page.textContent('#map')).includes('.pdf'),'small map');assert.match(await page.getAttribute('#map','aria-label'),/^웹 입문/);
 await atlas(page);
 const visible=await page.textContent('#atlasSvg');assert.ok(!visible.includes('.pdf')&&!visible.includes('수업 자료'),'no file name on the map');
 assert.equal(await page.textContent('#atlasInfoTitle'),'웹 입문','the short title heads the panel');
 assert.equal(await page.textContent('.atlas-about .atlas-full-title'),WEB_TITLE,'the complete title in the details');
 assert.equal(await page.textContent('.atlas-about .atlas-file'),FILE,'the original file name in the details');
 assert.equal(await page.getAttribute('#atlasSvg [data-id="legacy-web-1:topic"]','aria-description'),WEB_TITLE,'full title for assistive tech');
 assert.equal(await page.locator('.atlas-question').count(),0,'no learner question inferred from a file name');
 const s=(await stored(page)).lessons[0];assert.equal(JSON.stringify(s),before,'record unchanged');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('detail panel: long description and quoted evidence wrap and scroll in their own region, desktop and mobile',async()=>{
 for(const vp of [{width:1440,height:800},{width:1024,height:700},{width:390,height:844}]){
  const {ctx,page,errors}=await open([mem()],'mem',{viewport:vp});await atlas(page);
  await page.locator('#atlasSvg [aria-label="출처 판단 오류: 개념"]').click();
  const t=await page.textContent('#atlasInfo');assert.ok(t.includes(LONG_DESC),'description complete');assert.ok(t.includes(LONG_QUOTE),'evidence complete');
  const g=await page.evaluate(()=>{const i=document.getElementById('atlasInfo'),last=i.lastElementChild;last.scrollIntoView({block:'end'});const lr=last.getBoundingClientRect(),f=document.querySelector('.atlas-footer').getBoundingClientRect();
   const wide=[...i.querySelectorAll('*')].some(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflowX!=='auto');return {visible:lr.bottom<=Math.max(f.top,innerHeight)+1&&lr.bottom<=innerHeight+1,wide,font:parseFloat(getComputedStyle(i.querySelector('.atlas-desc')).fontSize),pageX:document.documentElement.scrollWidth>innerWidth}});
  assert.ok(g.visible,`${vp.width}: the end of the panel can be read`);assert.equal(g.wide,false,`${vp.width}: no clipped line`);assert.ok(g.font>=14,`${vp.width}: readable size`);assert.equal(g.pageX,false);
  assert.deepEqual(errors,[]);await ctx.close()}
});

test('scale: 1, 3, 10, 30 and 60 explorations — no overlapping labels, no clipped stars, no sideways scroll; navigation by list',async()=>{
 const results=[];
 for(const vp of [{width:1440,height:960},{width:390,height:844}])for(const n of [1,3,10,30,60]){
  const lessons=[mem(),web(),...Array.from({length:Math.max(0,n-2)},(_,i)=>synth(i))].slice(0,n);
  const {ctx,page,errors}=await open(lessons,lessons[0].id,{viewport:vp});await atlas(page);
  const t0=Date.now();if(n>1)await page.click('[data-atlas-mode=all]');const ms=Date.now()-t0;
  const m=await page.evaluate(()=>{const svg=document.getElementById('atlasSvg'),sr=svg.getBoundingClientRect();const cores=[...svg.querySelectorAll('.star-core')].map(e=>e.getBoundingClientRect());
   return {stars:svg.querySelectorAll('.atlas-star').length,clipped:cores.filter(r=>r.left<sr.left-1||r.right>sr.right+1||r.top<sr.top-1||r.bottom>sr.bottom+1).length,pageX:document.documentElement.scrollWidth>innerWidth,
    minFont:Math.min(...[...svg.querySelectorAll('.atlas-node-label')].map(e=>e.getBoundingClientRect().height).filter(Boolean))}});
  const o=await labelOverlaps(page);results.push({w:vp.width,n,ms,...m,overlaps:o});
  assert.equal(o,0,`${vp.width}/${n}: overlapping labels`);assert.equal(m.clipped,0);assert.equal(m.pageX,false);assert.ok(m.minFont>=12,`${vp.width}/${n}: label height ${m.minFont}`);
  if(n>=10){const last=lessons.at(-1);await page.selectOption('#atlasJump select',last.id);
   assert.equal(await page.textContent('#atlasInfoTitle'),last.lesson.title.split(':')[0],'jump selects that exploration (its short title)');
   assert.equal(await page.evaluate(id=>document.querySelector(`#atlasSvg .atlas-cluster[data-lesson="${id}"]`).classList.contains('dim'),last.id),false);
   const vis=await page.evaluate(id=>{const s=document.querySelector(`#atlasSvg [data-id="${id}:topic"]`).getBoundingClientRect(),k=document.querySelector('.atlas-sky').getBoundingClientRect();return s.top>=k.top-1&&s.bottom<=k.bottom+1},last.id);assert.ok(vis,'and brings it into view');
   // Overview: its own compact layout; exploration names readable, concept names hidden; choosing one returns to detail.
   await page.click('#atlasFit');assert.equal(await page.getAttribute('#atlasFit','aria-pressed'),'true');
   assert.equal(await page.locator('#atlasSvg .atlas-star:not(.atlas-topic) .atlas-node-label tspan').count(),0);assert.equal(await labelOverlaps(page),0,'overview labels');
   await page.locator(`#atlasSvg [data-id="${lessons[2].id}:topic"]`).click();assert.equal(await page.getAttribute('#atlasFit','aria-pressed'),'false');assert.equal(await page.textContent('#atlasInfoTitle'),lessons[2].lesson.title.split(':')[0])}
  assert.deepEqual(errors,[]);await ctx.close()}
 console.log(JSON.stringify(results));
});

test('keyboard: exploration stars and the focused exploration are reachable; arrows move within it; Enter selects; the record opens',async()=>{
 const lessons=[mem(),web(),synth(0)];const {ctx,page,errors}=await open(lessons,'mem');await atlas(page);await page.click('[data-atlas-mode=all]');
 const stops=await page.evaluate(()=>[...document.querySelectorAll('#atlasSvg [tabindex="0"]')].map(e=>e.getAttribute('data-id')||e.getAttribute('aria-label')));
 assert.ok(stops.includes('legacy-web-1:topic')&&stops.includes('syn-0:topic'),'every exploration star');assert.ok(!stops.some(s=>s?.startsWith('syn-0:k')),'other explorations’ concepts are not tab stops');
 await page.focus('#atlasSvg [data-id="legacy-web-1:topic"]');await page.keyboard.press('Enter');assert.equal(await page.textContent('#atlasInfoTitle'),'웹 입문');
 await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-id')),'legacy-web-1:k1');assert.equal(await page.textContent('#atlasInfoTitle'),'웹 서버');
 assert.ok(await page.evaluate(()=>{const cs=getComputedStyle(document.activeElement.querySelector('.hit'));return cs.strokeOpacity!=='0'&&cs.stroke!=='none'}),'visible focus');
 await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('data-id')),'legacy-web-1:k3');
 // The concept list in the panel is the non-graphical way to the same stars.
 await page.focus('#atlasSvg [data-id="mem:topic"]');await page.keyboard.press('Enter');await page.click('.atlas-member:has-text("출처 판단 오류")');
 assert.equal(await page.textContent('#atlasInfoTitle'),'출처 판단 오류');assert.match(await page.textContent('#atlasInfo'),/AI가 내 설명과 연결한 개념/);
 await page.click('#atlasOpenRecord');await page.waitForSelector('#atlasOverlay',{state:'hidden'});
 const s=await stored(page);assert.equal(s.active,'mem');assert.equal(s.lessons[0].stage,4,'explained concept → the learner’s explanation');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('motion: reveal plays once, not on redraws; nothing animates continuously; reduced motion shows everything at once',async()=>{
 const {ctx,page,errors}=await open([mem(),web()],'mem',{reducedMotion:'no-preference'});await atlas(page);
 const anims=()=>page.evaluate(()=>({star:getComputedStyle(document.querySelector('#atlasSvg .atlas-star')).animationName,infinite:[...document.querySelectorAll('.atlas-window *, #map *')].filter(e=>getComputedStyle(e).animationIterationCount==='infinite').length,noAnim:document.getElementById('atlasSvg').classList.contains('no-anim')}));
 let a=await anims();assert.equal(a.star,'atlas-appear');assert.equal(a.infinite,0,'no continuous animation');assert.equal(a.noAnim,false);
 await page.click('[data-atlas-mode=all]');await page.click('[data-atlas-mode=today]');a=await anims();assert.equal(a.noAnim,true,'seen view is not replayed');
 assert.equal(await page.locator('#atlasReplay').count(),0,'no permanent replay control');
 await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#atlasSvg .atlas-star')).opacity),'1');
 await ctx.close();
 const r=await open([mem()],'mem');await atlas(r.page);
 assert.deepEqual(await r.page.evaluate(()=>[...new Set([...document.querySelectorAll('#atlasSvg *')].map(e=>getComputedStyle(e).animationName))]),['none']);
 assert.deepEqual([...errors,...r.errors],[]);await r.ctx.close();
});

test('evidence: encountered, explained and legacy stay distinct (shape + text), legend matches, nothing is called mastery',async()=>{
 const old=web();old.id='OLD';old.lesson.concepts[0].name='세션';old.feedback={summary:'예전 피드백',correct:['x'],demonstrated:['k1']};old.drafts=[{text:'세션은 서버 쪽 기록이에요',at:5,feedback:old.feedback}];old.feedbackFor=5;
 const {ctx,page,errors}=await open([mem(),old],'mem');await atlas(page);
 const shape=id=>page.evaluate(i=>{const g=document.querySelector(`#atlasSvg [data-id="${i}"]`);const ring=g.querySelector('.star-ring');return {ring:!!ring,dash:ring?.getAttribute('stroke-dasharray')||null,r:+g.querySelector('.star-core').getAttribute('r'),desc:g.getAttribute('aria-description')}},id);
 assert.deepEqual(await shape('mem:k4'),{ring:true,dash:null,r:4,desc:'AI가 내 설명과 연결한 개념'});
 assert.deepEqual(await shape('mem:k1'),{ring:false,dash:null,r:3.4,desc:'이 탐험에서 만난 개념'});
 assert.equal(await page.isVisible('.atlas-legends'),false,'legend folded into 표시 안내');await page.click('#atlasGuide summary');
 assert.match(await page.textContent('.atlas-legends'),/만난 개념.*AI가 내 설명과 연결한 개념.*기록된 연결.*같은 탐험/);assert.equal(await page.isVisible('#atlasLegacyKey'),false);
 await page.click('[data-atlas-mode=all]');assert.deepEqual(await shape('OLD:k1'),{ring:true,dash:'1.5 2.5',r:4,desc:'이전 버전 피드백에서 언급된 개념'});assert.equal(await page.isVisible('#atlasLegacyKey'),true);
 // Only recorded relations are drawn: no line crosses between explorations.
 const cross=await page.evaluate(()=>modelAtlas(data.lessons[0],'all').edges.filter(e=>e.from.split(':')[0]!==e.to.split(':')[0]).length);assert.equal(cross,0);
 const text=await page.textContent('.atlas-window');for(const w of ['숙달했','마스터','완벽히 이해','mastered'])assert.ok(!text.includes(w),w);assert.match(text,/숙달을 판정하지 않아요/);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('responsive: 1440 / 1024 / 390 — sky and panel never overflow the window; small map shows an overview without every label',async()=>{
 for(const vp of [{width:1440,height:900},{width:1024,height:768},{width:390,height:844}]){
  const {ctx,page,errors}=await open([mem(),web(),synth(0),synth(1)],'mem',{viewport:vp});
  if(vp.width>=1050){assert.equal(await page.locator('#map .atlas-node-label, #map text:not(.mini-title)').count(),0,'small map: no concept labels');assert.equal(await page.locator('#map .mini-star').count(),6)}
  await atlas(page);await page.click('[data-atlas-mode=all]');
  const g=await page.evaluate(()=>{const w=document.querySelector('.atlas-window').getBoundingClientRect(),s=document.querySelector('.atlas-sky').getBoundingClientRect(),i=document.getElementById('atlasInfo').getBoundingClientRect();
   return {pageX:document.documentElement.scrollWidth>innerWidth,sky:s.right<=w.right+1&&s.left>=w.left-1,panel:i.right<=w.right+1,tools:[...document.querySelectorAll('.atlas-toolbar *')].every(e=>{const r=e.getBoundingClientRect();return !r.width||r.right<=w.right+1})}});
  assert.deepEqual(g,{pageX:false,sky:true,panel:true,tools:true},String(vp.width));
  assert.deepEqual(errors,[]);await ctx.close()}
});
