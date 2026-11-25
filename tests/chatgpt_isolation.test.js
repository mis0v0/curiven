// No test process can use the real ChatGPT sign-in or reach a model backend.
// Negative tests only — every attempt below must be refused locally.
//   node --test tests/chatgpt_isolation.test.js
'use strict';
const {isolatedEnv,CONFIG,SDK}=require('./isolation.js');   // also installs the loopback-only guard for this process
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn,spawnSync,execFileSync}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
const ROOT=path.resolve(__dirname,'..');
const CALL=/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/g;

test('static: every child process that runs the server goes through isolatedEnv(); SDK/bridge/server tests load the network guard',()=>{
 const files=fs.readdirSync(__dirname).filter(f=>/\.(js|mjs)$/.test(f)&&!['isolation.test.js','chatgpt_isolation.test.js'].includes(f));
 let calls=0;
 for(const f of files){const src=fs.readFileSync(path.join(__dirname,f),'utf8');
  for(const m of src.matchAll(CALL)){let depth=0,i=m.index+m[0].length-1,end=i;for(;end<src.length;end++){if(src[end]==='(')depth++;else if(src[end]===')'&&--depth===0)break}
   const call=src.slice(m.index,end+1);if(/server\.py|import server|import json,sys;sys\.path\.insert\(0,'\.'\);import server/.test(call)){calls++;assert.match(call,/isolatedEnv\(/,`${f}: ${call.slice(0,140)}`)}}
  if(/server\.py|chatgpt\/bridge\.mjs|chatgpt\/keychain\.mjs|siwc|createChatGPT/.test(src))assert.match(src,/require\('\.\/isolation\.js'\)|['"]\.\/netguard\.js['"]/,`${f} must load the loopback-only guard`);
  assert.ok(!/\.config\/curiven\/chatgpt|curiven\.chatgpt-credential-key/.test(src),`${f} must not name the real ChatGPT folder or Keychain key`)}
 assert.ok(calls>=16,'server-starting calls checked: '+calls);
});

test('isolatedEnv: inherited ChatGPT/OpenAI settings are dropped; real folders are refused',()=>{
 const saved={...process.env};
 try{Object.assign(process.env,{CURIVEN_CHATGPT_DIR:path.join(CONFIG,'chatgpt'),CURIVEN_SIWC_DIR:path.join(SDK,'siwc-devkit-0a36fef'),CURIVEN_CHATGPT_MODEL:'gpt-x',CURIVEN_NODE:'/x/node',OPENAI_API_KEY:'sk-inherited',OPENAI_BASE_URL:'https://evil'});
  const e=isolatedEnv();
  assert.ok(!e.CURIVEN_CHATGPT_DIR.startsWith(CONFIG));assert.ok(!e.CURIVEN_SIWC_DIR.startsWith(SDK));assert.ok(!fs.existsSync(e.CURIVEN_SIWC_DIR),'no SDK there');
  for(const k of ['CURIVEN_CHATGPT_MODEL','CURIVEN_NODE','OPENAI_API_KEY','OPENAI_BASE_URL'])assert.equal(e[k],undefined,k)}
 finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
 for(const bad of [{CURIVEN_CHATGPT_DIR:path.join(CONFIG,'chatgpt')},{CURIVEN_CHATGPT_DIR:CONFIG},{CURIVEN_CHATGPT_DIR:path.dirname(CONFIG)},{CURIVEN_SIWC_DIR:path.join(SDK,'siwc-devkit-0a36fef')}])
  assert.throws(()=>isolatedEnv(bad),/isolatedEnv/,JSON.stringify(bad));
});

test('this test process cannot reach OpenAI, ChatGPT or Notion; loopback still works',async()=>{
 for(const url of ['https://api.openai.com/v1/models','https://chatgpt.com/','https://auth.openai.com/.well-known/openid-configuration','https://api.notion.com/v1/users/me']){
  await assert.rejects(fetch(url),e=>(e.cause?.code||e.code)==='CURIVEN_BLOCKED',url)}
 await new Promise((ok,bad)=>{const s=net.connect(443,'1.1.1.1');s.on('error',e=>e.code==='CURIVEN_BLOCKED'?ok():bad(e));s.on('connect',()=>bad(Error('connected')))});
 const srv=net.createServer(c=>c.end()).listen(0,'127.0.0.1');await new Promise(r=>srv.once('listening',r));
 await new Promise((ok,bad)=>{const s=net.connect(srv.address().port,'127.0.0.1',()=>{s.end();ok()});s.on('error',bad)});srv.close();
});

test('the Keychain adapter refuses the real Keychain under test (no `security` run)',async()=>{
 const {keychainEncryption}=await import('../chatgpt/keychain.mjs');
 const t0=Date.now();assert.equal(await keychainEncryption({platform:'darwin'}).isAvailable(),false);assert.ok(Date.now()-t0<500);
});

test('a bridge started under test cannot reach OpenAI even through an SDK that tries',async()=>{
 // A stand-in SDK whose client really calls the OpenAI API with fetch; the bridge child must block it.
 const sdk=fs.mkdtempSync(path.join(os.tmpdir(),'curiven-fake-sdk-'));const dist=path.join(sdk,'packages','local','dist');fs.mkdirSync(dist,{recursive:true});
 const seen=path.join(sdk,'seen.txt');
 fs.writeFileSync(path.join(dist,'index.js'),`import {writeFileSync} from 'node:fs';
export function createChatGPT(){return {getSession:async()=>({status:'disconnected'}),listModels:async()=>[],
 streamResponse:async()=>{try{await fetch('https://api.openai.com/v1/responses',{method:'POST'});writeFileSync(${JSON.stringify(seen)},'REACHED')}catch(e){writeFileSync(${JSON.stringify(seen)},String(e.cause?.code||e.code||e.message))}return {text:'x'}}}}`);
 const env={...isolatedEnv({CURIVEN_SIWC_DIR:sdk})};
 const child=spawn(process.execPath,[path.join(ROOT,'chatgpt','bridge.mjs')],{env:{PATH:env.PATH,HOME:env.HOME,CURIVEN_TEST:'1',CURIVEN_SIWC_DIR:sdk,CURIVEN_CHATGPT_DIR:env.CURIVEN_CHATGPT_DIR},stdio:['pipe','pipe','ignore']});
 const reply=await new Promise((ok,bad)=>{child.stdout.once('data',d=>ok(JSON.parse(String(d))));child.once('exit',c=>bad(Error('bridge exited '+c)));
  child.stdin.write(JSON.stringify({id:1,op:'respond',model:'m',instructions:'i',input:'x'})+'\n')});
 child.stdin.end();assert.equal(reply.ok,true);assert.equal(fs.readFileSync(seen,'utf8'),'CURIVEN_BLOCKED','the request never left the machine');
});

test('a test server whose test forgot to mock /api/ai: errors, no bridge process, no model call',async()=>{
 const PORT=String(9500+Math.floor(Math.random()*90)),base=`http://127.0.0.1:${PORT}`;
 const srv=spawn('python3',[path.join(ROOT,'server.py')],{env:isolatedEnv({CURIVEN_PORT:PORT}),stdio:['ignore','pipe','inherit']});
 try{await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
  const st=await (await fetch(base+'/api/status')).json();assert.equal(st.online,false);assert.equal(st.status,'sdk_missing');
  const csrf=(await (await fetch(base+'/')).text()).match(/name="curiven-csrf" content="([^"]+)"/)[1];
  for(const body of [{mode:'lesson',topic:'쿠키'},{mode:'tutor',message:'왜요?',lesson:{title:'t'}},{mode:'note',title:'t',messages:[]}]){
   const r=await fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-CURIVEN-CSRF':csrf},body:JSON.stringify(body)});
   const j=await r.json();assert.ok(!r.ok&&!j.ok);assert.ok(['sdk_missing','test_mode_blocked'].includes(j.code),JSON.stringify(j))}
  const kids=spawnSync('pgrep',['-P',String(srv.pid)],{encoding:'utf8'}).stdout.trim();assert.equal(kids,'','the server started no bridge child');
 }finally{srv.kill()}
});

test('alternative runner: node --test --test-isolation=none (no NODE_TEST_CONTEXT) still isolates servers started through isolatedEnv',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'curiven-runner-'));const f=path.join(dir,'probe.test.js');
 fs.writeFileSync(f,`const {isolatedEnv}=require(${JSON.stringify(path.join(__dirname,'isolation.js'))});const {spawnSync}=require('node:child_process');
require('node:test')('p',()=>{const r=spawnSync('python3',['-c','import sys;sys.path.insert(0,${JSON.stringify(ROOT)});import test_guard,chatgpt_bridge as c,notion_link as n;print(test_guard.test_mode(),c.sdk_installed(),n.NotionLink().base)'],{env:isolatedEnv(),encoding:'utf8'});console.log('PROBE '+process.env.NODE_TEST_CONTEXT+' '+r.stdout.trim())})`);
 const out=execFileSync(process.execPath,['--test','--test-isolation=none',f],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:''}});
 assert.match(out,/PROBE (undefined|) True False (http:\/\/127\.0\.0\.1:9|blocked:\/\/notion-in-tests)/,out);
});
