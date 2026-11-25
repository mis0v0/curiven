// Browser tests for the ChatGPT provider UI and for local security against the real server.py.
// The UI tests mock /api/status and /api/chatgpt/* in the browser; the security tests hit the real
// server with the official SDK path deliberately pointed at a missing directory, so no OAuth or
// inference can happen. NOT evidence that real ChatGPT sign-in or inference works.
//   NODE_PATH=/dir/node_modules node --test tests/chatgpt.e2e.test.js
'use strict';
const {isolatedEnv}=require('./isolation.js');
const {openSettings,closeSettings,importFile,clickExport}=require('./ui_helpers.js');
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const http=require('node:http');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {chromium}=require('playwright-core');

const ROOT=path.resolve(__dirname,'..');
const PORT=String(8500+Math.floor(Math.random()*90));
const BASE=`http://127.0.0.1:${PORT}`;
const TMP=fs.mkdtempSync(path.join(os.tmpdir(),'curiven-chatgpt-e2e-'));
const PROFILE={version:1,nickname:'',interests:['추리소설'],meaning:'',approach:'mixed',depth:'beginner',createdAt:1,updatedAt:1};

let srv,browser,evil,evilPort;
test.before(async()=>{
 srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT,CURIVEN_PROVIDER:'chatgpt',CURIVEN_CHATGPT_DIR:path.join(TMP,'store'),CURIVEN_SIWC_DIR:path.join(TMP,'no-sdk')}),stdio:['ignore','pipe','inherit']});
 await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
 // A hostile page on a different local origin.
 evil=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end('<!doctype html><title>evil</title><form id=f method=POST action="'+BASE+'/api/chatgpt/connect" enctype="text/plain"><input name=a value=b></form>')});
 await new Promise(ok=>evil.listen(0,'127.0.0.1',ok));evilPort=evil.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
});
test.after(async()=>{await browser?.close();srv?.kill();evil?.close()});

async function mockedPage(){
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});
 await ctx.addInitScript(p=>{if(!localStorage.getItem('curiven-profile-v1'))localStorage.setItem('curiven-profile-v1',JSON.stringify(p))},PROFILE);
 const page=await ctx.newPage();
 const t={ctx,page,state:{provider:'chatgpt',online:false,model:null,status:'disconnected',sharing:false},posts:[],errors:[],dialogs:[]};
 page.on('pageerror',e=>t.errors.push(e.message));
 page.on('dialog',d=>{t.dialogs.push(d.message());d.accept()});
 await page.route('**/api/status',r=>r.fulfill({json:t.state}));
 await page.route('**/api/chatgpt/*',r=>{const q=r.request();t.posts.push({path:new URL(q.url()).pathname,body:JSON.parse(q.postData()||'{}'),csrf:q.headers()['x-curiven-csrf'],ctype:q.headers()['content-type']});r.fulfill({json:{ok:true,revoked:true}})});
 return t;
}

test('AI panel: user-initiated connect, status polling, model choice, disconnect', async()=>{
 const t=await mockedPage(),{page}=t;
 await page.goto(BASE+'/');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('AI 연결 안 됨'));
 assert.equal(t.posts.length,0,'nothing is started automatically');
 await openSettings(page,'ai');
 const csrf=await page.getAttribute('meta[name="curiven-csrf"]','content');
 assert.ok(csrf&&csrf.length>=40);
 t.state={...t.state,status:'connecting'};
 await page.click('text=ChatGPT로 계속하기');
 await page.waitForSelector('text=로그인 취소');
 assert.deepEqual(t.posts.map(p=>p.path),['/api/chatgpt/connect']);
 assert.equal(t.posts[0].csrf,csrf);assert.equal(t.posts[0].ctype,'application/json');
 t.state={provider:'chatgpt',online:true,status:'connected',sharing:true,account:'learner@example.com',models:[{slug:'gpt-a',displayName:'A'},{slug:'gpt-b',displayName:'B'}],model:'gpt-a'};
 await page.waitForSelector('#aiModel',{timeout:6000});           // picked up by polling, no reload
 assert.match(await page.textContent('#status'),/ChatGPT 연결 · gpt-a/);
 assert.match(await page.textContent('#aiState'),/learner@example.com/);
 await page.selectOption('#aiModel','gpt-b');
 await page.waitForFunction(()=>true);await page.waitForTimeout(200);
 assert.deepEqual(t.posts.at(-1),{path:'/api/chatgpt/model',body:{model:'gpt-b'},csrf,ctype:'application/json'});
 await page.click('text=연결 해제');await page.waitForTimeout(200);
 assert.equal(t.posts.at(-1).path,'/api/chatgpt/disconnect');assert.match(t.dialogs.at(-1),/연결을 해제할까요/);
 const keys=await page.evaluate(()=>Object.keys(localStorage));
 assert.deepEqual(keys.filter(k=>!k.startsWith('curiven-')),[],'nothing ChatGPT-related stored in the browser');
 assert.deepEqual(t.errors,[]);
 await t.ctx.close();
});

test('status polling during sign-in never rebuilds a form the learner is typing in', async()=>{
 const t=await mockedPage(),{page}=t;t.state={...t.state,status:'connecting'};
 await page.goto(BASE+'/');await page.waitForSelector('#topic');
 await page.click('#topic');await page.keyboard.type('쿠키와 세');
 await page.waitForTimeout(4500);                                   // two poll cycles
 assert.equal(await page.inputValue('#topic'),'쿠키와 세');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'topic');
 await page.keyboard.type('션');assert.equal(await page.inputValue('#topic'),'쿠키와 세션');
 await t.ctx.close();
});

test('lesson preparation without a connection offers AI 연결 only — no prompt copy or JSON paste, never Ollama', async()=>{
 const t=await mockedPage(),{page}=t;
 await page.goto(BASE+'/');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('AI 연결 안 됨'));
 await page.fill('#topic','쿠키와 세션');await page.click('#startExplore');
 await page.waitForSelector('#preparePanel');
 const msg=await page.textContent('#prepareStatus');
 assert.match(msg,/AI가 연결되지 않았어요/);assert.doesNotMatch(msg,/Ollama|프롬프트|JSON/);
 assert.ok(await page.isVisible('#preparePanel >> text=AI 연결하기'));
 for(const s of ['text=AI 생성 프롬프트 복사','#import-lesson','text=학습 자료 가져오기','#devTools'])assert.equal(await page.locator(s).count(),0,s);
 await page.click('#preparePanel >> text=AI 연결하기');await page.waitForSelector('#aiSettings');
 assert.ok(await page.evaluate(()=>document.getElementById('settings').open),'opens the AI settings, not a new page');
 await t.ctx.close();
 // Development mode only (server started with CURIVEN_DEV_TOOLS=1 reports devTools): the manual path is behind a labelled toggle.
 const d=await mockedPage();d.state={...d.state,devTools:true};
 await d.page.goto(BASE+'/');await d.page.waitForFunction(()=>document.querySelector('#status').textContent.includes('AI 연결 안 됨'));
 await d.page.fill('#topic','쿠키와 세션');await d.page.click('#startExplore');await d.page.waitForSelector('#devTools');
 assert.match(await d.page.textContent('#devTools summary'),/개발자 도구/);assert.equal(await d.page.isVisible('#import-lesson'),false,'collapsed');
 await d.ctx.close();
});

test('real server: the page itself passes the checks (gets a provider error, not 403)', async()=>{
 const ctx=await browser.newContext();const page=await ctx.newPage();
 await page.goto(BASE+'/');
 const r=await page.evaluate(async()=>{const csrf=document.querySelector('meta[name="curiven-csrf"]').content;
  const x=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json','X-CURIVEN-CSRF':csrf},body:JSON.stringify({mode:'lesson',topic:'쿠키'})});return {status:x.status,body:await x.json()}});
 assert.equal(r.status,503);assert.equal(r.body.code,'sdk_missing');
 const s=await page.evaluate(async()=>(await fetch('/api/status')).json());
 assert.equal(s.status,'sdk_missing');assert.equal(s.online,false);
 await ctx.close();
});

test('real server: a hostile page on another origin cannot use or read CURIVEN', async()=>{
 const ctx=await browser.newContext();const page=await ctx.newPage();
 // Chrome withholds blocked cross-origin responses from the page and from Playwright's response
 // events, so the server's real status codes are read from DevTools' extra-info events.
 const cdp=await ctx.newCDPSession(page);await cdp.send('Network.enable');
 const reqs=new Map(),seen=[];
 cdp.on('Network.requestWillBeSent',e=>{if(e.request.url.startsWith(BASE))reqs.set(e.requestId,[e.request.method,new URL(e.request.url).pathname])});
 cdp.on('Network.responseReceivedExtraInfo',e=>{const r=reqs.get(e.requestId);if(r)seen.push([...r,e.statusCode])});
 await page.goto(`http://127.0.0.1:${evilPort}/`);
 const out=await page.evaluate(async base=>{const res={};
  const t=async(k,f)=>{try{const r=await f();res[k]=r.type==='opaque'?'opaque':r.status}catch(e){res[k]='blocked:'+e.name}};
  await t('simplePost',()=>fetch(base+'/api/ai',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:'{"mode":"lesson","topic":"x"}'}));
  await t('jsonWithGuess',()=>fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json','X-CURIVEN-CSRF':'guess'},body:'{"mode":"lesson","topic":"x"}'}));
  await t('readStatus',()=>fetch(base+'/api/status'));
  await t('readPage',()=>fetch(base+'/'));
  return res},BASE);
 // A "simple" request is sent without preflight; the server refuses it (status checked below), and
 // Cross-Origin-Resource-Policy additionally makes the browser withhold even the opaque response.
 assert.match(String(out.simplePost),/^(opaque|blocked:TypeError)$/);
 assert.match(out.jsonWithGuess,/^blocked:/);           // CORS preflight refused: the POST is never sent
 assert.match(out.readStatus,/^blocked:/);              // no CORS: cannot read status
 assert.match(out.readPage,/^blocked:/);                // cannot read index.html (and its CSRF token)
 await page.evaluate(()=>document.getElementById('f').submit());await page.waitForLoadState();await page.waitForTimeout(300);
 const posts=seen.filter(([m])=>m==='POST');
 assert.ok(posts.length>=2,JSON.stringify(seen));
 for(const [,p,code] of posts)assert.ok(code===403||code===415,`${p} → ${code}`);
 assert.ok(seen.some(([m,p,c])=>m==='POST'&&p==='/api/ai'&&c===403),'simple cross-origin POST reached the server and was refused');
 assert.ok(seen.some(([m,p,c])=>m==='POST'&&p==='/api/chatgpt/connect'&&c===403),'cross-site form cannot start sign-in');
 assert.equal(seen.filter(([m,p])=>m==='POST'&&p==='/api/ai').length,1,'the CSRF-guessing JSON POST was never sent');
 const framed=await browser.newContext();const fp=await framed.newPage();
 await fp.goto(`http://127.0.0.1:${evilPort}/`);
 await fp.evaluate(base=>{const f=document.createElement('iframe');f.src=base+'/';f.id='x';document.body.append(f)},BASE);await fp.waitForTimeout(800);
 const inner=fp.frames().find(f=>f.url().startsWith(BASE));
 const html=inner?await inner.content().catch(()=>''):'';
 assert.ok(!html.includes('curiven-csrf'),'CURIVEN cannot be framed by another origin');
 await framed.close();await ctx.close();
});

test('expired sign-in and quota errors: honest messages; expiry flips the app to "reconnect"', async()=>{
 const t=await mockedPage(),{page}=t;
 t.state={provider:'chatgpt',online:true,status:'connected',sharing:true,model:'gpt-a',models:[{slug:'gpt-a',displayName:'A'}]};
 let reply={status:429,json:{ok:false,code:'subscription_sharing_usage_limit_exceeded',error:'ChatGPT 사용 한도에 도달했어요. https://chatgpt.com/settings/usage 에서 사용량을 확인해 주세요.',usageUrl:'https://chatgpt.com/settings/usage'}};
 await page.route('**/api/ai',r=>r.fulfill(reply));
 await page.goto(BASE+'/');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('ChatGPT 연결'));
 await page.fill('#topic','쿠키와 세션');await page.click('#startExplore');
 await page.waitForFunction(()=>document.querySelector('#prepareStatus')?.textContent.includes('사용 한도'));
 assert.match(await page.textContent('#prepareStatus'),/chatgpt\.com\/settings\/usage/);
 assert.match(await page.textContent('#status'),/ChatGPT 연결/,'quota keeps the connection');
 // Token can no longer be refreshed → server answers 401 and reports reauth_required.
 reply={status:401,json:{ok:false,code:'invalid_grant',error:'ChatGPT 연결을 다시 확인해야 해요.'}};
 t.state={provider:'chatgpt',online:false,status:'reauth_required',sharing:false,error:{code:'invalid_grant',message:'ChatGPT 연결을 다시 확인해야 해요. ‘AI 연결’에서 다시 로그인해 주세요.'}};
 await page.click('#preparePanel >> text=다시 시도');
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('연결 안 됨'));
 await page.waitForSelector('#preparePanel >> text=AI 연결하기');
 assert.equal(t.posts.filter(p=>p.path==='/api/chatgpt/connect').length,0,'no automatic re-sign-in');
 await page.click('#preparePanel >> text=AI 연결하기');await page.waitForSelector('#aiSettings');
 assert.match(await page.textContent('#aiState'),/다시 로그인/);
 assert.deepEqual(t.errors,[]);await t.ctx.close();
});
