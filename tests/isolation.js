// Isolate credentials, storage and transports for each test server.
'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const REAL=path.join(os.homedir(),'.config','curiven','notion');
const CONFIG=path.join(os.homedir(),'.config','curiven');
const SDK=path.join(os.homedir(),'.local','opt');   // where tools/setup-chatgpt-sdk.sh installs the official SDK
const related=(p,root)=>{p=path.resolve(p);root=path.resolve(root);return p===root||p.startsWith(root+path.sep)||root.startsWith(p+path.sep)};
require('./netguard.js');   // this test process: loopback only
/** Also isolates ChatGPT: a fresh credential folder, an SDK folder that does not exist (so the real bridge never
    starts and no sign-in or model call can happen), and no inherited CURIVEN_CHATGPT_*, CURIVEN_SIWC_*, CURIVEN_NODE
    or OPENAI_* values. */
function isolatedEnv(extra={}){
 const env={...process.env};for(const k of Object.keys(env))if(/^(CURIVEN_(NOTION|CHATGPT|SIWC|NODE)|OPENAI_)/.test(k))delete env[k];
 const out={...env,CURIVEN_TEST:'1',CURIVEN_NOTION_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'curiven-notion-test-')),CURIVEN_NOTION_SECRETS:'memory',CURIVEN_NOTION_API:'http://127.0.0.1:9',
  CURIVEN_CHATGPT_DIR:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'curiven-chatgpt-test-')),'chatgpt'),CURIVEN_SIWC_DIR:path.join(os.tmpdir(),'curiven-test-no-sdk'),...extra};
 if(related(out.CURIVEN_CHATGPT_DIR,CONFIG))throw Error('isolatedEnv: the real ChatGPT credential folder is not allowed in tests');
 if(related(out.CURIVEN_SIWC_DIR,SDK))throw Error('isolatedEnv: the installed ChatGPT SDK is not allowed in tests');
 const dir=path.resolve(out.CURIVEN_NOTION_DIR);
 if(dir===REAL||dir.startsWith(REAL+path.sep)||REAL.startsWith(dir+path.sep))throw Error('isolatedEnv: the real Notion folder is not allowed in tests');
 if(out.CURIVEN_NOTION_SECRETS!=='memory')throw Error('isolatedEnv: tests use the in-memory token only');
 if(!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(out.CURIVEN_NOTION_API||''))throw Error('isolatedEnv: tests may only use a 127.0.0.1 fake Notion API');
 if(out.CURIVEN_TEST!=='1')throw Error('isolatedEnv: CURIVEN_TEST must stay on');
 return out}
module.exports={isolatedEnv,REAL,CONFIG,SDK};
