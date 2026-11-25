// Loaded by every test that starts a server, a bridge or the ChatGPT SDK: this test process may only connect to
// loopback. See chatgpt/netguard.mjs (same rule, used by the bridge child in test mode).
'use strict';
const net=require('node:net');
const loop=h=>{if(h==null)return true;h=String(h).replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();return h===''||h==='localhost'||h==='::1'||/^127\.\d+\.\d+\.\d+$/.test(h)||/^::ffff:127\./.test(h)};
function guardNetwork(){if(net.Socket.prototype.connect.__curivenGuard)return;const real=net.Socket.prototype.connect;
 const guarded=function(...args){const o=args[0],opts=Array.isArray(o)?o[0]:o;
  const host=typeof opts==='object'&&opts?(opts.path?null:(opts.host??'localhost')):(typeof opts==='number'||/^\d+$/.test(String(opts))?(typeof args[1]==='string'?args[1]:'localhost'):null);
  if(!loop(host)){const e=new Error(`CURIVEN test mode: network access to ${host} is blocked`);e.code='CURIVEN_BLOCKED';process.nextTick(()=>this.destroy(e));return this}
  return real.apply(this,args)};
 guarded.__curivenGuard=true;net.Socket.prototype.connect=guarded}
guardNetwork();
module.exports={guardNetwork,loop};
