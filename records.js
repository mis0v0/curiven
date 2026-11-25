/* CURIVEN learning-record storage with conflict-checked writes.
   The whole record set stays in one localStorage value ('curiven-v01-personal', unchanged format plus
   an additive integer `rev` counter). A write succeeds only if the stored value is still exactly the
   string this tab last read or wrote (compare-and-swap on the raw snapshot). Comparing the snapshot,
   not just `rev`, also catches writers that know nothing about `rev` (older CURIVEN versions, manual
   edits). Cross-tab mutual exclusion is provided separately by a Web Lock in index.html; this check is
   the second line of defence. Never throws. */
'use strict';
(function(root){
 const KEY='curiven-v01-personal';

 function parse(raw){
  if(raw==null)return {status:'empty',data:{lessons:[],active:null},rev:0,raw:null};
  try{const p=JSON.parse(raw);if(p&&typeof p==='object'&&Array.isArray(p.lessons))return {status:'ok',data:p,rev:Number.isInteger(p.rev)?p.rev:0,raw}}catch{}
  return {status:'corrupt',raw};
 }

 /** {status:'ok'|'empty'|'corrupt'|'unavailable', data?, rev?, raw?} — `raw` is the snapshot to pass to writeRecords. */
 function readRecords(storage){
  let raw;
  try{if(!storage)throw Error('no storage');raw=storage.getItem(KEY)}catch{return {status:'unavailable'}}
  return parse(raw);
 }

 /** Compare-and-swap write against `baseRaw` (the snapshot this tab last read/wrote; null = slot was empty).
     Returns {ok:true,raw,rev} or {ok:false,reason:'conflict'|'unavailable'|'write-failed'}.
     'conflict' means the stored value changed (or is unreadable) since baseRaw — nothing was written. */
 function writeRecords(storage,data,baseRaw){
  let cur;
  try{if(!storage)throw Error('no storage');cur=storage.getItem(KEY)}catch{return {ok:false,reason:'unavailable'}}
  if(cur!==baseRaw)return {ok:false,reason:'conflict'};
  const prev=parse(cur),rev=(prev.status==='ok'?prev.rev:0)+1,raw=JSON.stringify({...data,rev});
  try{storage.setItem(KEY,raw)}catch{return {ok:false,reason:'write-failed'}}
  return {ok:true,raw,rev};
 }

 const api={KEY,readRecords,writeRecords};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriRecords=api;
})(typeof window!=='undefined'?window:globalThis);
