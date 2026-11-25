// Every test server is isolated from the real Notion setup, and a server
// started without isolation refuses to run. Negative tests only — nothing here can reach Notion.
//   node --test tests/isolation.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const {isolatedEnv,REAL}=require('./isolation.js');
const ROOT=path.resolve(__dirname,'..');

test('every server.py a test starts goes through isolatedEnv()',()=>{
 const files=fs.readdirSync(__dirname).filter(f=>/\.(js|mjs)$/.test(f)&&f!=='isolation.test.js');
 let spawns=0;
 for(const f of files){const src=fs.readFileSync(path.join(__dirname,f),'utf8');
  for(const m of src.matchAll(/spawn\([^)]*server\.py[^;]*/g)){spawns++;assert.match(m[0],/env:isolatedEnv\(/,`${f}: ${m[0].slice(0,120)}`)}
  assert.ok(!/\.config\/curiven\/notion|curiven\.notion-token/.test(src)||f==='isolation.js',`${f} must not name the real Notion folder or Keychain item`)}
 assert.ok(spawns>=15,'all browser suites were checked ('+spawns+')');
});

test('isolatedEnv: fresh folder, memory token, loopback fake API; inherited or overridden production values are refused',()=>{
 const saved={...process.env};
 try{process.env.CURIVEN_NOTION_DIR=REAL;process.env.CURIVEN_NOTION_SECRETS='keychain';process.env.CURIVEN_NOTION_API='https://api.notion.com';
  const e=isolatedEnv();
  assert.notEqual(path.resolve(e.CURIVEN_NOTION_DIR),REAL);assert.ok(fs.existsSync(e.CURIVEN_NOTION_DIR));assert.equal(fs.readdirSync(e.CURIVEN_NOTION_DIR).length,0);
  assert.equal(e.CURIVEN_NOTION_SECRETS,'memory');assert.match(e.CURIVEN_NOTION_API,/^http:\/\/127\.0\.0\.1:/);assert.equal(e.CURIVEN_TEST,'1')}
 finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved)}
 for(const bad of [{CURIVEN_NOTION_DIR:REAL},{CURIVEN_NOTION_DIR:path.join(REAL,'x')},{CURIVEN_NOTION_DIR:path.dirname(REAL)},{CURIVEN_NOTION_SECRETS:'keychain'},
  {CURIVEN_NOTION_API:'https://api.notion.com'},{CURIVEN_NOTION_API:'http://localhost:9'},{CURIVEN_TEST:''}])
  assert.throws(()=>isolatedEnv(bad),/isolatedEnv/,JSON.stringify(bad));
});

test('a server started by a test without isolation exits before serving (exit 78)',{skip:!process.env.NODE_TEST_CONTEXT&&'only under node --test'},()=>{
 // Port 9 cannot be bound without privileges, so even a broken guard could not serve anything here.
 for(const env of [{},{CURIVEN_NOTION_DIR:REAL,CURIVEN_NOTION_SECRETS:'memory',CURIVEN_NOTION_API:'http://127.0.0.1:9'}]){
  const r=spawnSync('python3',[path.join(ROOT,'server.py')],{env:{...process.env,CURIVEN_PORT:'9',...env},encoding:'utf8',timeout:20000});
  assert.equal(r.status,78,r.stderr);assert.match(r.stderr,/refusing to start/)}
});

test('an isolated server is not connected and its Notion requests go nowhere',async()=>{
 const PORT=String(9600+Math.floor(Math.random()*90)),base=`http://127.0.0.1:${PORT}`,env=isolatedEnv({CURIVEN_PORT:PORT});
 const srv=spawn('python3',[path.join(ROOT,'server.py')],{env,stdio:['ignore','pipe','inherit']});
 try{await new Promise((ok,bad)=>{srv.stdout.once('data',ok);srv.once('exit',c=>bad(Error('server exited '+c)))});
  const st=await (await fetch(base+'/api/notion/status')).json();assert.equal(st.connected,false);
  const html=await (await fetch(base+'/')).text(),csrf=html.match(/name="curiven-csrf" content="([^"]+)"/)?.[1];assert.ok(csrf);
  const post=(p,b)=>fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json','Origin':base,'X-CURIVEN-CSRF':csrf},body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));
  const save=await post('/api/notion/save',{explorationId:'iso',title:'t',markdown:'m'});assert.equal(save.status,409);assert.equal(save.body.code,'not_connected');
  const con=await post('/api/notion/connect',{token:'t'.repeat(40),page:'0'.repeat(32)});
  assert.equal(con.status,503,'the only reachable "Notion" is a loopback port nothing listens on');assert.equal(con.body.connected,undefined);
  assert.equal(fs.readdirSync(env.CURIVEN_NOTION_DIR).length,0,'nothing stored: connect never succeeded');
 }finally{srv.kill()}
});
