// UI phase 2A — "Minimal Curiosity" foundation: tokens, home composer, focus layout, monochrome palette, keyboard
// focus, reduced motion and mobile. AI and Notion are MOCKED in the browser; records are isolated test data.
//   NODE_PATH=<dir>/node_modules node --test --test-timeout=180000 tests/design.e2e.test.js
// These checks guard rules from CURIVEN_Minimal_Curiosity_Design_Spec_v1.pdf; visual fidelity itself was judged on
// rendered screenshots, not by these assertions.
'use strict';
const {isolatedEnv}=require('./isolation.js');
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(9500+Math.floor(Math.random()*90));const URL=`http://127.0.0.1:${PORT}/`;
const MEM=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/memory_session.json'),'utf8')).record;
const SAMPLE=JSON.parse(fs.readFileSync(path.join(ROOT,'sample_cookie_lesson.json'),'utf8'));
const KEY='curiven-v01-personal',PKEY='curiven-profile-v1';
const PROFILE={version:1,nickname:'지우',interests:['독서'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};
const clone=x=>JSON.parse(JSON.stringify(x));

let srv,browser;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill()});
async function open({lessons=[],active=null,viewport={width:1440,height:960},reducedMotion}={}){
 const ctx=await browser.newContext({viewport,reducedMotion});const calls=[];
 await ctx.addInitScript(`if(!localStorage.getItem('${PKEY}'))localStorage.setItem('${PKEY}',${JSON.stringify(JSON.stringify(PROFILE))});if(!localStorage.getItem('${KEY}'))localStorage.setItem('${KEY}',${JSON.stringify(JSON.stringify({lessons,active}))});`);
 await ctx.route('**/api/status',r=>r.fulfill({json:{provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-test',models:[]}}));
 await ctx.route('**/api/notion/status',r=>r.fulfill({json:{ok:true,available:true,connected:false,page:null,autoSave:false}}));
 await ctx.route('**/api/ai',async r=>{calls.push(JSON.parse(r.request().postData()));return r.fulfill({json:{ok:true,provider:'chatgpt',model:'m',data:SAMPLE}})});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(URL);await page.waitForFunction(()=>/ChatGPT 연결/.test(document.querySelector('#status').textContent));
 return {ctx,page,calls,errors};
}
const done=()=>{const l=clone(MEM);l.stage=5;l.maxStage=5;l.complete=true;return l};

test('tokens: the spec palette is what the page actually renders',async()=>{
 const {ctx,page,errors}=await open();
 const v=await page.evaluate(()=>{const cs=getComputedStyle(document.documentElement),g=k=>cs.getPropertyValue(k).trim();
  return {page:g('--page'),surface:g('--surface'),text:g('--text'),grey:g('--grey'),line:g('--line'),atlas:g('--atlas'),radiusCard:g('--radius-card'),radiusButton:g('--radius-button'),quick:g('--motion-quick'),reveal:g('--motion-reveal'),
   body:getComputedStyle(document.body).backgroundColor,ink:getComputedStyle(document.querySelector('#home h1')).color}});
 assert.deepEqual([v.page,v.surface,v.text,v.grey,v.line,v.atlas].map(x=>x.toUpperCase()),['#F7F7F5','#FFFFFF','#181818','#757575','#D9D9D6','#111317']);
 assert.deepEqual([v.radiusCard,v.radiusButton,v.quick,v.reveal],['24px','14px','150ms','260ms']);
 assert.equal(v.body,'rgb(247, 247, 245)');assert.equal(v.ink,'rgb(24, 24, 24)');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('monochrome: no element of the home or a learning stage uses a chromatic colour (constellation scenes excluded)',async()=>{
 const {ctx,page,errors}=await open({lessons:[clone(MEM)],active:'mem'});
 const scan=()=>page.evaluate(()=>{const bad=[];const sat=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return 0;const [r,g,b,a=1]=m[1].split(',').map(Number);if(a===0)return 0;return Math.max(r,g,b)-Math.min(r,g,b)};
  for(const el of document.querySelectorAll('body *')){if(el.closest('svg,.mapbox,.atlas-overlay,.constellation-teaser,#atlasMiniBtn,.right .card:first-child'))continue;const cs=getComputedStyle(el);if(cs.display==='none')continue;
   for(const k of ['color','backgroundColor','borderTopColor','borderLeftColor'])if(sat(cs[k])>12)bad.push(`${el.tagName}.${el.className} ${k} ${cs[k]}`)}return bad.slice(0,8)});
 assert.deepEqual(await scan(),[],'learning stage');
 await page.click('#homeLogo');await page.waitForSelector('#home');assert.deepEqual(await scan(),[],'home');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('home: focus layout, one composer, Enter sends, Shift+Enter keeps writing, an empty question gets a quiet prompt',async()=>{
 const {ctx,page,calls,errors}=await open({lessons:[done()],active:null});
 assert.equal(await page.isVisible('aside.side'),false);assert.equal(await page.isVisible('aside.right'),false);
 assert.equal((await page.textContent('#settingsBtn')).trim(),'설정','gear + 설정 in the top bar');assert.ok(await page.isVisible('#topSettingsSlot #settingsBtn'));
 assert.ok(await page.isVisible('#universeBtn'),'나의 우주 appears once an exploration is complete');
 assert.equal(await page.locator('#home h1').count(),1);assert.equal(await page.locator('#home .btn').count(),0,'one primary action: the send button');
 assert.equal(await page.locator('#home .pills, #profileLine, #import-lesson').count(),0,'no suggestion chips, profile line or developer controls');
 await page.press('#topic','Enter');assert.match(await page.textContent('#materialStatus'),/한 줄 적어 주세요/);assert.equal(await page.getAttribute('#topic','aria-invalid'),'true');assert.equal(calls.length,0);
 await page.fill('#topic','블랙홀');await page.press('#topic','Shift+Enter');await page.type('#topic','사건의 지평선');assert.equal(await page.inputValue('#topic'),'블랙홀\n사건의 지평선');
 await page.fill('#topic','블랙홀은 왜 빛을 가둘까?');await page.press('#topic','Enter');await page.waitForSelector('#prediction');
 assert.equal(calls[0].topic,'블랙홀은 왜 빛을 가둘까?');
 assert.ok(await page.isVisible('aside.side #settingsBtn'),'inside a lesson the same entry is back in the sidebar');assert.equal(await page.isVisible('#universeBtn'),false);
 assert.deepEqual(errors,[]);await ctx.close();
});

test('keyboard: the composer and its controls are reachable in order with a visible focus indicator',async()=>{
 const {ctx,page,errors}=await open();
 const order=[];for(let i=0;i<8;i++){await page.keyboard.press('Tab');order.push(await page.evaluate(()=>{const a=document.activeElement;if(a===document.body)return null;
  // The file input is visually hidden: its visible focus is on the label (“＋ 수업 자료 첨부”); the textarea's is the composer edge.
  const shown=a.id==='materialFile'?a.closest('label'):a;const cs=getComputedStyle(shown);
  return {id:a.id||a.className,outline:(cs.outlineStyle!=='none'&&cs.outlineWidth!=='0px')||(a.id==='topic'&&a.closest('.composer').matches(':focus-within'))}}))}
 order.splice(0,order.length,...order.filter(Boolean));
 const ids=order.map(o=>o.id);for(const id of ['topic','materialFile','startExplore'])assert.ok(ids.includes(id),`${id} reachable: ${ids}`);
 assert.ok(ids.indexOf('topic')<ids.indexOf('materialFile')&&ids.indexOf('materialFile')<ids.indexOf('startExplore'),'reading order');
 assert.ok(order.every(o=>o.outline),'every stop shows focus: '+JSON.stringify(order));
 await page.focus('#topic');await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('composer')).borderTopColor),'rgb(24, 24, 24)','the composer edge darkens on focus');
 assert.deepEqual(errors,[]);await ctx.close();
});

test('reduced motion: the motif is static and controls do not transition',async()=>{
 const {ctx,page,errors}=await open({reducedMotion:'reduce'});
 const r=await page.evaluate(()=>[...document.querySelectorAll('.home-motif *')].map(e=>getComputedStyle(e).animationName).filter(n=>n&&n!=='none'));
 assert.deepEqual(r,[]);assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('startExplore')).transitionDuration),'0s');
 await ctx.close();
 const m=await open();assert.ok((await m.page.evaluate(()=>[...document.querySelectorAll('.home-motif .edge')].map(e=>getComputedStyle(e).animationDuration))).every(d=>d==='0.26s'),'reveal uses --motion-reveal');
 assert.deepEqual([...errors,...m.errors],[]);await m.ctx.close();
});

test('mobile 390: no sideways scroll, touch-sized send button, status shrinks to a dot but keeps its name',async()=>{
 const {ctx,page,errors}=await open({viewport:{width:390,height:844}});
 const w=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(w[0]<=w[1],String(w));
 const b=await page.locator('#startExplore').boundingBox();assert.ok(b.width>=44&&b.height>=44);
 assert.match(await page.getAttribute('#status','aria-label'),/ChatGPT 연결/);assert.equal(await page.isVisible('#status .status-text'),true,'in the accessibility tree (visually clipped)');
 const s=await page.locator('#settingsBtn').boundingBox();assert.ok(s.height>=40);
 assert.deepEqual(errors,[]);await ctx.close();
});
