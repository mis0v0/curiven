// Run: node --test tests/records_learning.test.js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../records.js');
const L=require('../learning.js');

class Mem{constructor(i={}){this.m=new Map(Object.entries(i))}getItem(k){return this.m.has(k)?this.m.get(k):null}setItem(k,v){this.m.set(k,String(v))}removeItem(k){this.m.delete(k)}}
const legacyBlob=JSON.stringify({lessons:[{id:'a',topic:'old'}],active:'a'});

test('legacy blob (no rev) reads as rev 0 and first write migrates additively',()=>{
 const s=new Mem({[R.KEY]:legacyBlob});
 const r=R.readRecords(s);assert.equal(r.status,'ok');assert.equal(r.rev,0);assert.equal(r.raw,legacyBlob);
 const w=R.writeRecords(s,r.data,r.raw);assert.equal(w.ok,true);assert.equal(w.rev,1);assert.equal(w.raw,s.getItem(R.KEY));
 const after=JSON.parse(s.getItem(R.KEY));assert.equal(after.rev,1);assert.deepEqual(after.lessons,[{id:'a',topic:'old'}]);assert.equal(after.active,'a');
});

test('D1: a stale writer cannot overwrite lessons written by another tab',()=>{
 const s=new Mem();
 const a=R.readRecords(s),b=R.readRecords(s);                 // two tabs load the same (empty) state
 assert.ok(R.writeRecords(s,{lessons:[{id:'A'}],active:'A'},a.raw).ok);
 const w=R.writeRecords(s,{lessons:[{id:'B'}],active:'B'},b.raw);
 assert.equal(w.ok,false);assert.equal(w.reason,'conflict');
 assert.deepEqual(JSON.parse(s.getItem(R.KEY)).lessons,[{id:'A'}],'A survives');
});

test('D1: writers unaware of rev (older versions) are detected even before this tab ever wrote',()=>{
 const s=new Mem({[R.KEY]:legacyBlob});const mine=R.readRecords(s);          // rev 0, never written by us
 const other=JSON.stringify({lessons:[{id:'a',topic:'changed by v0.2 tab'}],active:'a'});  // still no rev → rev 0
 s.setItem(R.KEY,other);
 assert.equal(R.readRecords(s).rev,mine.rev,'a rev-only check would miss this');
 assert.equal(R.writeRecords(s,mine.data,mine.raw).reason,'conflict');assert.equal(s.getItem(R.KEY),other);
 const w=R.writeRecords(s,{lessons:[],active:null},R.readRecords(s).raw);assert.ok(w.ok,'after re-reading, writing works');
});

test('corrupt or unavailable storage is never overwritten and never throws',()=>{
 const s=new Mem({[R.KEY]:'{bad'});
 assert.equal(R.readRecords(s).status,'corrupt');
 assert.equal(R.writeRecords(s,{lessons:[]},null).reason,'conflict');assert.equal(s.getItem(R.KEY),'{bad');
 const broken={getItem(){throw Error('x')},setItem(){throw Error('x')}};
 assert.equal(R.readRecords(broken).status,'unavailable');assert.equal(R.readRecords(null).status,'unavailable');
 assert.equal(R.writeRecords(broken,{lessons:[]},null).reason,'unavailable');
});

test('interrupted write (setItem throws) leaves committed data intact',()=>{
 const s=new Mem();const w=R.writeRecords(s,{lessons:[{id:'kept'}]},null);assert.ok(w.ok);
 const before=s.getItem(R.KEY);s.setItem=()=>{throw Error('QuotaExceededError')};
 assert.equal(R.writeRecords(s,{lessons:[]},w.raw).reason,'write-failed');assert.equal(s.getItem(R.KEY),before);
});

const SAMPLE=require('../sample_cookie_lesson.json');
const ids=SAMPLE.concepts.map(c=>c.id);
test('D2: validateFeedback rejects malformed structures instead of coercing',()=>{
 const ok={summary:'좋아요',correct:['a'],misconceptions:[{issue:'i',question:'q'}],missing:[],demonstrated:['k1','k9','k1'],uncertainty:''};
 assert.deepEqual(L.validateFeedback(ok,ids).demonstrated,['k1']);
 // Saved before schema 2 (no `schema` field): still read, marked as legacy, nothing invented.
 assert.deepEqual(L.validateFeedback({summary:'s'},ids),{schema:1,summary:'s',correct:[],precision:[],misconceptions:[],missing:[],explained:[],demonstrated:[],uncertainty:'',withheld:0,reviewer:null});
 for(const bad of [null,[],'x',{},{summary:''},{summary:'s',correct:'쿠키 저장'},{summary:'s',correct:[1]},{summary:'s',misconceptions:['문자열']},
  {summary:'s',missing:[{issue:'i'}]},{summary:'s',demonstrated:'k1'},{summary:'s',uncertainty:3}])
  assert.throws(()=>L.validateFeedback(bad,ids),undefined,JSON.stringify(bad));
});

test('D5: feedbackPayload carries only what evaluation needs and stays small',()=>{
 const big={...SAMPLE,story:'가'.repeat(7000),hook:'나'.repeat(7000)};
 const p=L.feedbackPayload(big);
 assert.deepEqual(Object.keys(p).sort(),['concepts','explainPrompt','technical','title']);
 assert.equal(p.explainPrompt,SAMPLE.explainPrompt);assert.deepEqual(p.concepts.map(c=>c.id),ids);
 assert.ok(Buffer.byteLength(JSON.stringify(p))<20000);
});

test('answer-position bias removed: shuffle keeps the correct option text and varies its position',()=>{
 let seed=7;const rand=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
 const positions=new Set();
 for(let k=0;k<40;k++){
  const out=L.shuffleScenarios(SAMPLE,rand);
  out.scenarios.forEach((s,i)=>{const o=SAMPLE.scenarios[i];
   assert.equal(s.options[s.answerIndex],o.options[o.answerIndex]);assert.deepEqual([...s.options].sort(),[...o.options].sort());positions.add(s.answerIndex)});
 }
 assert.ok(positions.size>=3,'correct answer appears in several positions');
 assert.equal(SAMPLE.scenarios[0].answerIndex,1,'input not mutated');
});
