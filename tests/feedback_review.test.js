// Run: node --test tests/feedback_review.test.js
// Same fixture as tests/test_feedback_review.py, through learning.js — the browser must agree with the server.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const L=require('../learning.js');
const FIX=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','feedback_cases.json'),'utf8'));

for(const c of FIX.cases){
 test(`feedback case: ${c.name}`,()=>{
  const out=L.validateFeedback({...c.model,schema:2},FIX.concepts,c.text);
  for(const k of ['correct','precision','misconceptions'])assert.equal(out[k].length,c.expect[k],k);
  assert.deepEqual(out.explained.map(e=>e.id),c.expect.explained);
  assert.equal(out.withheld,c.expect.withheld);
  for(const x of [...out.precision,...out.misconceptions]){assert.ok(L.quoteFound(x.quote,c.text));assert.ok(x.why)}
 });
}

test('stored v2 feedback is re-checked against the saved explanation (e.g. an edited backup)',()=>{
 const c=FIX.cases.find(x=>x.name==='correct');
 const once=L.validateFeedback({...c.model,schema:2},FIX.concepts,c.text);
 assert.deepEqual(L.validateFeedback(once,FIX.concepts,c.text).explained,once.explained,'idempotent');
 const other=L.validateFeedback(once,FIX.concepts,'전혀 다른 설명을 적었어요. 쿠키 이야기는 없어요.');
 assert.deepEqual([other.explained.length,other.precision.length],[0,0],'evidence that is not in this explanation does not count');
 const unknownText=L.validateFeedback(once,FIX.concepts);
 assert.equal(unknownText.explained.length,0,'without the explanation nothing can be verified, so nothing is credited');
});

test('legacy (v1) feedback still renders; concept ids become an unverified legacy mention',()=>{
 const v1={summary:'핵심을 짚었어요.',correct:['쿠키는 브라우저가 저장'],misconceptions:[{issue:'i',question:'q'}],missing:[],demonstrated:['k1','zz'],uncertainty:''};
 const f=L.validateFeedback(v1,FIX.concepts,'아무 설명');
 assert.equal(f.schema,1);assert.deepEqual(f.correct,[{quote:null,point:'쿠키는 브라우저가 저장'}]);
 assert.deepEqual(f.demonstrated,['k1']);assert.deepEqual(f.explained,[]);
 assert.deepEqual(L.validateFeedback(f,FIX.concepts,'x').demonstrated,['k1'],'re-reading normalised legacy feedback is stable');
});

const lesson=(feedback,drafts)=>({lesson:{concepts:FIX.concepts.map(id=>({id,name:id,description:'d'}))},feedback,drafts,feedbackFor:drafts.at(-1)?.at});
test('conceptStatus: encountered / explained (with evidence) / legacy — never "mastered"',()=>{
 const c=FIX.cases.find(x=>x.name==='correct');
 const v2=L.validateFeedback({...c.model,schema:2},FIX.concepts,c.text);
 let s=L.conceptStatus(lesson(v2,[{text:c.text,at:1,feedback:v2}]));
 assert.deepEqual([...s].map(([k,v])=>[k,v.tier]),[['k1','explained'],['k2','encountered'],['k3','encountered'],['k4','explained']]);
 assert.ok(s.get('k1').quote);
 s=L.conceptStatus(lesson({summary:'s',demonstrated:['k2']},[{text:'x',at:1}]));
 assert.equal(s.get('k2').tier,'legacy','historical gold star kept, provenance marked');
 s=L.conceptStatus(lesson(v2,[{text:'다른 설명입니다. 근거가 없어요.',at:1,feedback:v2}]));
 assert.ok([...s.values()].every(v=>v.tier==='encountered'),'v2 evidence not found in the saved explanation earns nothing');
 assert.ok([...L.conceptStatus(lesson(null,[])).values()].every(v=>v.tier==='encountered'));
 const tiers=new Set([...L.conceptStatus(lesson(v2,[{text:c.text,at:1}])).values()].map(v=>v.tier));
 assert.ok(!tiers.has('mastered')&&!tiers.has('verified'));
});

test('speech acts and critiques anchored to partial quotes',()=>{
 const cases=require('./fixtures/q3a_speech_acts.json');
 for(const [text,kind,reason] of [...cases.development,...cases.reserve])
  assert.equal(L.utteranceKind(text),kind,text+' — '+reason);
 for(const [text,quote,kind,reason] of cases.partialQuotes){
  const item={quote,issue:'i',why:'w',question:'q'};
  const f=L.validateFeedback({schema:2,summary:'s',misconceptions:[item]},[],text);
  assert.equal(L.quoteKind(quote,text),kind,reason);
  if(kind==='claim')assert.deepEqual(f.misconceptions,[item]);
  else assert.deepEqual(f.precision,[{...item,reclassified:kind}]);
 }
});

test('evidence integrity and revalidation match the server fixture',()=>{
 for(const [text,quote,eligible,critique] of require('./fixtures/evidence_integrity.json')){
  const item={id:'k1',quote};
  const raw={schema:2,summary:'s',explained:[item,item,{...item,id:'unknown'}]};
  if(critique)raw.misconceptions=[{quote:critique,issue:'i',why:'w',question:'q'}];
  const f=L.validateFeedback(raw,['k1'],text);
  assert.deepEqual(f.explained,eligible?[item]:[],text);
  assert.deepEqual(L.validateFeedback(f,['k1'],text),f);
 }
});

test('ordinary precision is not a contested claim; a full reclassified list survives re-reading',()=>{
 const text='물은 높은 데서 낮은 데로 흘러요. 물이 거꾸로 흐를 것 같아요.',at=(quote,n=1)=>Array.from({length:n},()=>({quote,issue:'i',why:'w',question:'q'}));
 const own='물은 높은 데서 낮은 데로 흘러요.',guess='물이 거꾸로 흐를 것 같아요.';
 const f=L.validateFeedback({schema:2,summary:'s',explained:[{id:'k1',quote:own}],precision:at(own,8),misconceptions:at(guess,8)},['k1'],text);
 assert.deepEqual([f.explained.length,f.precision.length,f.misconceptions.length],[1,16,0]);
 assert.deepEqual(L.validateFeedback(f,['k1'],text),f);
});

test('a displayed quotation is always the learner’s own words; the recorded quotation is kept for matching',()=>{
 const V=L.verbatimQuote,neg='HTTP는 상태가 없어서 서버는 같은 사용자인지 알 수 없어요.',flip='HTTP는 상태가 없어서 서버는 같은 사용자인지 알 수 있다';
 for(const [text,quote,shown] of [
  [neg,flip,neg],
  ['저항이 커지면 전류가 줄어들지 않아요.','저항이 커지면 전류가 줄어들어요.','저항이 커지면 전류가 줄어들지 않아요.'],
  ['먼저 말해요.\n'+neg+' 끝이에요.',flip,neg],
  ['물은 흘러요. 물은 흘러가요.','물은 흘러가요.','물은 흘러가요.'],
  ['줄이 짧으면 소리가 높아져요. 길면 낮아져요.','줄이 짧으면 소리가 높아져요, 길면 낮아져요','줄이 짧으면 소리가 높아져요. 길면 낮아져요'],
  ['HTTP는 상태가  없어요','http는 상태가 없어요','HTTP는 상태가  없어요'],
  // An altered quotation that fits two places: both are shown, neither is picked.
  ['저항이 커지면 전류가 줄어들지 않아요. 저항이 커지면 전류가 줄어들어요.','저항이 커지면 전류가 줄어든다','저항이 커지면 전류가 줄어들지 않아요. 저항이 커지면 전류가 줄어들어요.'],
  [neg,'전혀 쓰지 않은 문장이에요',null],[neg,null,null]]){
  assert.equal(V(quote,text),shown,quote);
  if(shown){assert.ok(text.includes(shown));assert.equal(V(shown,text),shown,'stable')}
 }
 assert.equal(V('가나다라마바'.normalize('NFD'),'가나다라마바'),'가나다라마바');
 const it={quote:flip,issue:'i',why:'w',question:'q'},raw={schema:2,summary:'s',correct:[{quote:flip,point:'p'}],precision:[it],misconceptions:[],missing:[],explained:[{id:'k1',quote:flip}]};
 const f=L.stampFeedback(L.validateFeedback(raw,['k1'],neg));
 assert.deepEqual([f.correct[0].quote,f.precision[0].quote,f.explained[0].quote],[flip,flip,flip],'recorded quotations and follow-up identity are unchanged');
 const l={topic:'t',lesson:{title:'t',concepts:[{id:'k1',name:'n',description:'d'}]},drafts:[{at:1,text:neg,feedback:f}],feedback:f,feedbackFor:1,dialogue:[]};
 assert.equal(L.conceptStatus(l).get('k1').quote,neg);
 const T=require('../tutor.js');assert.equal(T.resolveFeedback(l,{kind:'feedback',draftAt:1,type:'precision',index:0,seen:{issue:'i',quote:flip}}).status,'resolved');
 assert.deepEqual(require('../journey.js').chain(l)[0].items.map(x=>x.quote),[neg,neg]);
 const md=require('../notes.js').lessonMarkdown(l);assert.ok(md.includes('“'+neg+'”'));assert.ok(!md.includes('알 수 있다'));
});

test('the latest concept projection can omit an older retained draft link',()=>{
 const text='대회에 나가려면 등록해야 해요.',f={schema:2,summary:'s',explained:[{id:'k1',quote:text}]};
 const lesson={lesson:{concepts:[{id:'k1'}]},drafts:[{at:1,text,feedback:f},{at:2,text,feedback:{schema:2,summary:'s'}}],
  feedback:f,feedbackFor:1};
 assert.equal(L.conceptStatus(lesson).get('k1').tier,'explained');
 lesson.feedback=lesson.drafts[1].feedback;
 lesson.feedbackFor=2;
 assert.equal(L.conceptStatus(lesson).get('k1').tier,'encountered');
 assert.equal(lesson.drafts[0].feedback.explained[0].quote,text);
});
