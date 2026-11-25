// Q3-B: authored (mocked) feedback through learning.js — the browser must agree with the server (test_feedback_pedagogy.py).
// Run: node --test tests/feedback_pedagogy.test.js
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('../learning.js');
const DEV=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','q3b_development.json'),'utf8')).cases;
const run=(c,w)=>L.validateFeedback({...c[w],schema:2},c.lesson.concepts.map(k=>k.id),c.text);
for(const c of DEV){
 test(`${c.id} (${c.cover}): nothing withheld; text unchanged`,()=>{
  for(const w of ['desired','flawed'].filter(w=>c[w])){const f=run(c,w);assert.equal(f.withheld,0,w);assert.equal(f.summary,c[w].summary);
   const texts=x=>[...x.precision,...x.misconceptions,...x.missing].map(i=>[i.issue,i.why||null,i.question].join('|')).sort();
   assert.deepEqual(texts(f),texts(c[w]),w)}})}
test('a hedged guess is refined, not a confirmed misconception',()=>{const f=run(DEV.find(c=>c.id==='D9'),'desired');
 assert.equal(f.misconceptions.length,0);assert.equal(f.precision[0].reclassified,'hypothesis')});
