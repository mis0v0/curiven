// Explanations linked to their feedback (journey.js chain(), the archive's section 5 and the growth stage):
// original wording, AI feedback by kind, the AI's own rewrite only when it wrote one, the follow-up talk, the next try.
//   node --test tests/explanation_chain.test.js
// Synthetic records only (plus the committed fixtures, read-only). No network, no AI.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const J=require('../journey.js');const C=require('../concept-note.js');const L=require('../learning.js');const N=require('../notes.js');
const fx=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',n),'utf8'));
const FIXTURES=()=>[fx('sqli_time_blind_record.json'),fx('calc_material_record.json'),fx('memory_session.json').record];
const shown=md=>md.replace(/ {2}\n/g,'\n').replace(/\\([\\`*_\[\]<>#|~&$\-+=.)])/g,'$1').replace(/^ +/gm,m=>' '.repeat(m.length));
const sec5=md=>{const i=md.indexOf('\n## 5.'),j=md.indexOf('\n## 6.');assert.ok(i>0&&j>i);return md.slice(i,j)};
const round=(md,n)=>{const s=sec5(md),i=s.indexOf(`\n### 설명 ${n}`),j=s.indexOf('\n### 설명 ',i+5);assert.ok(i>=0,`round ${n}`);return s.slice(i,j<0?s.length:j)};

const T0=Date.parse('2026-11-20T10:00:00+09:00'),min=m=>T0+m*60000;
const D1='열은 온도가 높은 곳에서 낮은 곳으로 흐른다. 차가운 기운이 따뜻한 물체로 들어가서 물체가 식는다.';
const D2='열은 온도가 높은 곳에서 낮은 곳으로 이동한다. 물체가 식는 건 열이 빠져나가기 때문이다.';
const D3='온도 차이가 있으면 에너지가 높은 쪽에서 낮은 쪽으로 이동해요. 차가운 것이 들어오는 게 아니에요.';
const REV='열은 온도가 높은 물체에서 낮은 물체로 이동해요. 물체가 식는 것은 차가운 기운이 들어와서가 아니라 열이 빠져나가기 때문이에요.';
const fbV2=(extra={})=>({schema:2,summary:'높은 곳에서 낮은 곳으로 흐른다는 점은 맞아요. 식는 이유를 다시 생각해 볼 수 있어요.',
 correct:[{quote:'열은 온도가 높은 곳에서 낮은 곳으로 흐른다',point:'열의 이동 방향을 정확히 말했어요.'}],
 precision:[],misconceptions:[{quote:'차가운 기운이 따뜻한 물체로 들어가서 물체가 식는다',issue:'‘차가운 기운’이 들어온다고 보았어요.',why:'열역학에서 이동하는 것은 열(에너지)이에요.',question:'식을 때 무엇이 어디로 이동할까요?'}],
 missing:[{issue:'열평형 조건이 빠졌어요.',question:'언제 이동이 멈출까요?'}],explained:[],uncertainty:'',reviewer:{provider:'chatgpt',model:'gpt-test',at:min(2)},...extra});
function record({rev=REV,draft2Feedback=null,dispute=false,timed=true}={}){
 const dr=[{text:D1,at:timed?min(1):undefined,feedback:fbV2(rev?{revision:rev}:{})},{text:D2,at:timed?min(20):undefined,feedback:draft2Feedback},{text:D3,at:timed?min(40):undefined,feedback:null}];
 const dialogue=[{id:'q1',role:'learner',text:'열이 뭐예요?',at:min(0),status:'answered'},{id:'a1',role:'tutor',replyTo:'q1',text:'에너지의 한 형태예요.',at:min(0.5)}];
 if(timed){dialogue.push({id:'f1',role:'learner',text:dispute?'차가운 기운도 이동한다고 교과서에서 본 것 같은데요? 이 피드백이 틀린 것 아닌가요?':'그럼 식는 건 열이 나가는 건가요?',at:min(5),status:'answered',ref:{kind:'feedback',draftAt:min(1),type:'misconceptions',index:0}},
  {id:'r1',role:'tutor',replyTo:'f1',text:dispute?'좋은 지적이에요. 일상 표현으로는 그렇게 말하지만, 물리에서 이동하는 것은 열이에요. 제 설명이 부족했다면 다시 볼게요.':'맞아요. 열이 빠져나가면서 식어요.',at:min(6)},
  {id:'f2',role:'learner',quick:true,intent:'example',text:'예시 보여 줘',at:min(7),status:'answered',ref:{kind:'feedback',draftAt:min(1),type:'missing',index:0}},
  {id:'r2',role:'tutor',replyTo:'f2',text:'뜨거운 커피가 방에서 식는 경우를 생각해 봐요.',at:min(8)},
  {id:'f3',role:'learner',text:'이건 설명 2에 대한 질문이에요',at:min(25),status:'pending',ref:{kind:'feedback',draftAt:min(20),type:'summary',index:0}})}
 return {id:'heat',topic:'열은 어떻게 이동할까?',createdAt:min(0),updatedAt:min(50),stage:5,complete:true,
  lesson:{title:'열의 이동',concepts:[{id:'c1',name:'열',description:'에너지'}],technical:[],scenarios:[]},dialogue,drafts:dr,scenarios:[]}}

test('a complete AI rewrite is kept verbatim, labelled as the AI’s, and never as the learner’s',()=>{
 const l=record(),before=JSON.stringify(l),r=J.chain(l);
 assert.equal(r[0].revision,REV);assert.equal(r[0].feedback,'ok');assert.equal(JSON.stringify(l),before,'read-only');
 const md=J.markdown(l),r1=round(md,1);
 assert.match(r1,/\*\*AI가 제안한 수정 설명\*\* _\(AI가 쓴 글\)_\n\n> /);assert.ok(shown(r1).includes(REV));
 const mine=r1.slice(r1.indexOf('**내가 작성한 설명**'),r1.indexOf('**AI 피드백**'));assert.ok(!shown(mine).includes(REV),'not in the learner block');
 assert.ok(!shown(md.slice(0,md.indexOf('\n## 5.'))).includes(REV),'nowhere before section 5');
 const order=['**내가 작성한 설명**','**AI 피드백**','**AI가 제안한 수정 설명**','**피드백에 이어진 대화**','**다음에 쓴 설명**: 설명 2 — 이 피드백을 받은 뒤에 썼어요. 피드백을 반영했는지는 기록으로 알 수 없어요.'].map(x=>r1.indexOf(x));
 assert.ok(order.every((v,i)=>v>=0&&(!i||v>order[i-1])),'sequence: '+order);
});

test('feedback without a rewrite: no rewrite section at all, and none is built from the other fields',()=>{
 const l=record({rev:null}),r=J.chain(l);assert.equal(r[0].revision,null);
 const r1=round(J.markdown(l),1);assert.ok(!r1.includes('수정 설명'),'the section is absent, not filled with a placeholder');
 assert.ok(r1.indexOf('**AI 피드백**')<r1.indexOf('**피드백에 이어진 대화**'),'feedback is followed directly by the conversation');
 for(const f of [' ','',null,42,{text:'x'}]){const x=record({rev:null});x.drafts[0].feedback.revision=f;assert.equal(J.chain(x)[0].revision,null,JSON.stringify(f))}
 // no feedback at all: no rewrite row (there was nothing to rewrite from)
 const r3=round(J.markdown(l),3);assert.match(r3,/\*\*AI 피드백\*\*\n\n_AI 피드백 없음_/);assert.ok(!r3.includes('수정 설명'));
});

test('several explanations: each round has its own feedback and conversation, and points to the next explanation',()=>{
 const fb2={schema:2,summary:'이동하는 것이 열이라는 점이 분명해졌어요.',correct:[],precision:[{quote:'열이 빠져나가기 때문이다',issue:'어디로 빠져나가는지 덧붙이면 좋아요.',why:'주변과의 온도 차이가 이동 방향을 정해요.',question:'열은 어디로 갈까요?'}],misconceptions:[],missing:[],explained:[],uncertainty:'',reviewer:{model:'gpt-test',at:min(21)}};
 const l=record({draft2Feedback:fb2}),r=J.chain(l);
 assert.deepEqual(r.map(x=>[x.n,x.feedback,x.next]),[[1,'ok',2],[2,'ok',3],[3,'none',null]]);
 assert.deepEqual(r[0].thread.map(t=>t.text),['그럼 식는 건 열이 나가는 건가요?','예시 보여 줘'],'only messages about explanation 1');
 assert.deepEqual(r[1].thread.map(t=>[t.text,t.about,t.reply]),[['이건 설명 2에 대한 질문이에요','피드백 전체',null]]);
 const md=J.markdown(l);for(const [n,t] of [[1,D1],[2,D2],[3,D3]])assert.ok(shown(round(md,n)).includes(t),`explanation ${n} verbatim in its own round`);
 assert.match(round(md,2),/_AI 튜터의 답이 기록되지 않았어요\._/);assert.match(round(md,2),/\*\*다음에 쓴 설명\*\*: 설명 3 — 이 피드백을 받은 뒤에 썼어요/);
 assert.ok(!round(md,3).includes('다음에 쓴 설명'),'the last explanation points nowhere');
 // the conversation is linked by the explanation's time, never by position: reordering messages changes nothing
 const s=record({draft2Feedback:fb2});s.dialogue.reverse();assert.deepEqual(J.chain(s)[0].thread.map(t=>t.text).sort(),r[0].thread.map(t=>t.text).sort());
});

test('feedback kinds: conceptual correction, clarification, premise check, unclassified — as the record supports',()=>{
 const r=J.chain(record())[0];assert.deepEqual(r.items.map(x=>x.kind),['correct','concept','missing']);
 const l=record();l.drafts[0].feedback={...fbV2(),misconceptions:[],precision:[{quote:'열은 온도가 높은 곳에서 낮은 곳으로 흐른다',issue:'‘흐른다’ 대신 ‘이동한다’가 더 정확해요.',why:'열은 물질이 아니에요.',question:'어떤 말이 더 정확할까요?'}]};
 const c=J.chain(l)[0];assert.deepEqual(c.items.map(x=>x.kind),['correct','clarify','missing'],'wording only: a clarification, not a correction');
 const md=round(J.markdown(l),1);assert.match(md,/표현·조건 다듬기 \(AI 분류\)/);assert.ok(!md.includes('개념 바로잡기'));
 assert.equal(c.thread[0].about,'지금은 찾을 수 없는 피드백 항목','a follow-up about an item that is no longer there is not given a kind');
 // a quoted question the coach called a misconception is reclassified by the validator: shown as a premise check
 const q=record();q.drafts[0].text='열은 차가운 쪽으로 가나요? 잘 모르겠어요.';q.drafts[0].feedback={...fbV2(),correct:[],missing:[],misconceptions:[{quote:'열은 차가운 쪽으로 가나요?',issue:'방향을 확인해 봐요.',why:'질문이에요.',question:'어느 쪽일까요?'}]};
 assert.deepEqual(J.chain(q)[0].items.map(x=>x.kind),['premise']);assert.match(round(J.markdown(q),1),/질문·가설의 전제 확인 \(AI 분류\)/);
 // summary only: no category is made up
 const s=record();s.drafts[0].feedback={schema:2,summary:'잘 정리했어요.',correct:[],precision:[],misconceptions:[],missing:[],explained:[],uncertainty:''};
 assert.deepEqual(J.chain(s)[0].items,[]);assert.match(round(J.markdown(s),1),/세부 항목 없이 요약만 있어요 \(분류 없음\)/);
});

test('a disputed correction is shown as it happened: the learner’s objection and the AI’s answer, no verdict added',()=>{
 const l=record({dispute:true}),md=J.markdown(l),r1=round(md,1);
 assert.match(r1,/내 메시지 #2 \(2026-11-20 10:05\) · ‘개념 바로잡기’ 항목에 대해: 차가운 기운도 이동한다고 교과서에서 본 것 같은데요\? 이 피드백이 틀린 것 아닌가요\?/);
 assert.match(r1,/AI 튜터의 답 _\(AI\)_: 좋은 지적이에요/);
 assert.match(sec5(md),/AI가 쓴 부분은 참고 의견이고, 맞는지 확인된 판단이 아니에요/);
 assert.ok(!/(오개념을 고쳤|이해했어요|올바르게 수정|정답입니다|해결됐)/.test(sec5(md)),'no claim about who was right or that it was resolved');
});

test('missing times and legacy records: nothing invented, nothing linked by guess',()=>{
 const l=record({timed:false}),r=J.chain(l);
 assert.deepEqual(r.map(x=>x.at),[null,null,null]);assert.deepEqual(r.map(x=>x.thread.length),[0,0,0],'no time → no link to a conversation');
 const md=J.markdown(l);assert.match(sec5(md),/\n### 설명 1\n/);
 // v1 feedback (before quotes existed): its 'misconceptions' cannot be checked against the learner's words
 const v1=record();v1.drafts[0].feedback={summary:'예전 형식 피드백',correct:['방향은 맞아요'],misconceptions:[{issue:'차가운 기운',question:'무엇이 이동할까요?'}],missing:[]};
 const c=J.chain(v1)[0];assert.equal(c.schema,1);assert.deepEqual(c.items.map(x=>x.kind),['correct','unclassified']);
 assert.match(round(J.markdown(v1),1),/_\(AI · 이전 형식\)_/);assert.match(round(J.markdown(v1),1),/분류되지 않은 지적 \(AI 분류\)/);
 const e=record();e.drafts[0].feedback=null;e.drafts[0].feedbackError='시간 초과';assert.equal(J.chain(e)[0].feedback,'error');
 assert.match(round(J.markdown(e),1),/_AI 피드백을 받지 못했어요: 시간 초과_/);assert.ok(!round(J.markdown(e),1).includes('수정 설명'));
 const b=record();b.drafts[0].feedback={schema:2,summary:''};assert.equal(J.chain(b)[0].feedback,'invalid');
 assert.match(round(J.markdown(b),1),/형식이 올바르지 않아 싣지 않았어요/);
 for(const odd of [{id:'x'},{id:'y',drafts:[null,{text:5},{text:'설명만'}]}])assert.doesNotThrow(()=>J.chain(odd));
 assert.deepEqual(J.chain({id:'y',drafts:[null,{text:'설명만'}]}).map(x=>[x.n,x.feedback]),[[1,'none']]);
});

test('no hallucinated rewrites in stored-format fixtures: no rewrite section appears',()=>{
 for(const l of FIXTURES()){const r=J.chain(l),md=J.markdown(l);
  assert.ok(r.every(x=>x.revision===null),'no fixture holds an AI rewrite');
  assert.ok(!sec5(md).includes('**AI가 제안한 수정 설명**')&&!sec5(md).includes('수정 설명 없음'),'no rewrite section and no placeholder: none was written');
  for(const x of r)assert.ok(shown(sec5(md)).includes(x.text),'original wording');
  assert.equal(r.length,l.drafts.length)}
});

test('deterministic, read-only, and no network while the archive is made',async()=>{
 const http=require('node:http'),https=require('node:https'),net=require('node:net');const calls=[];
 const trap=(o,k)=>{const f=o[k];o[k]=(...a)=>{calls.push(k);throw Error('network in archive generation')};return ()=>{o[k]=f}};
 const undo=[trap(globalThis,'fetch'),trap(http,'request'),trap(https,'request'),trap(net,'connect')];
 try{for(const l of [record(),record({dispute:true}),...FIXTURES()]){const before=JSON.stringify(l),a=J.markdown(l),b=J.markdown(JSON.parse(before));
   assert.equal(a,b);assert.equal(JSON.stringify(l),before);assert.deepEqual(J.chain(l),J.chain(JSON.parse(before)))}}
 finally{undo.forEach(u=>u())}
 assert.deepEqual(calls,[]);
});

test('Notion stays reference-first: no rewrite, no feedback history added to the note or the note request',()=>{
 const l=record();const notion=C.exportNotion(l,{now:0}),payload=JSON.stringify(C.payload(l));
 assert.ok(!notion.includes(REV),'the AI rewrite is not in the Notion note');assert.ok(!notion.includes('AI가 제안한 수정 설명')&&!notion.includes('AI가 작성한 수정 설명 없음'));
 assert.ok(!payload.includes(REV),'nor sent to the concept-note AI');
 const without=record({rev:null});assert.equal(C.exportNotion(l,{now:0}),C.exportNotion(without,{now:0}),'the Notion note is the same with or without a rewrite');
 assert.equal(N.lessonMarkdown(l,{now:0}),N.lessonMarkdown(without,{now:0}),'and so is the full record export (section 8)');
});

test('validator: a rewrite the AI actually wrote is kept (trimmed, capped); absent otherwise; legacy v1 never has one',()=>{
 const ids=['c1'],ok=L.validateFeedback({...fbV2(),revision:'  '+REV+'  '},ids,D1);assert.equal(ok.revision,REV);
 assert.equal(L.validateFeedback({...fbV2(),revision:'x'.repeat(5000)},ids,D1).revision.length,3000);
 for(const v of [undefined,null,'',' ',7,['a']])assert.ok(!('revision' in L.validateFeedback({...fbV2(),revision:v},ids,D1)),String(v));
 assert.ok(!('revision' in L.validateFeedback({summary:'v1',revision:REV},ids,D1)),'v1 feedback predates rewrites');
});

// 2026-11-24 refinement: the rewrite section exists only for a rewrite the AI actually wrote.
test('conditional rewrite section: shown for a genuine rewrite (current or historical), hidden for anything else',()=>{
 const has=l=>J.chain(l)[0].revision,sec=l=>round(J.markdown(l),1);
 // a genuine rewrite inside valid v2 feedback, as a future AI answer or an imported historical record would carry it
 const ok=record();assert.equal(has(ok),REV);assert.match(sec(ok),/\*\*AI가 제안한 수정 설명\*\* _\(AI가 쓴 글\)_/);
 const cases={
  'no field':l=>{delete l.drafts[0].feedback.revision},'empty':l=>{l.drafts[0].feedback.revision=''},'blank':l=>{l.drafts[0].feedback.revision=' \n '},
  'number':l=>{l.drafts[0].feedback.revision=42},'object':l=>{l.drafts[0].feedback.revision={text:REV}},'array':l=>{l.drafts[0].feedback.revision=[REV]},
  'v1 legacy feedback':l=>{l.drafts[0].feedback={summary:'예전 형식',revision:REV}},
  'malformed feedback':l=>{l.drafts[0].feedback={schema:2,summary:'',revision:REV}},
  'failed review':l=>{l.drafts[0].feedback=null;l.drafts[0].feedbackError='시간 초과';l.drafts[0].revision=REV},
  'rewrite stored outside the feedback':l=>{l.drafts[0].feedback.revision=undefined;l.drafts[0].revision=REV;l.revision=REV}};
 for(const [name,change] of Object.entries(cases)){const l=record();change(l);const before=JSON.stringify(l);
  assert.equal(has(l),null,name);assert.ok(!sec(l).includes('수정 설명'),name);assert.equal(JSON.stringify(l),before,name+': read-only')}
 // never made from the tutor's reply or the learner's next explanation, even when they read like a corrected answer
 const t=record({rev:null});t.dialogue.find(m=>m.id==='r1').text=REV;t.drafts[1].text=REV;
 assert.equal(has(t),null);assert.ok(!sec(t).includes('**AI가 제안한 수정 설명**'));
});

test('the learner’s words and the AI’s rewrite stay apart wherever both appear',()=>{
 const l=record(),md=J.markdown(l),r1=round(md,1);
 const mine=r1.slice(r1.indexOf('**내가 작성한 설명** _(내 글)_'),r1.indexOf('**AI 피드백**')),ai=r1.slice(r1.indexOf('**AI가 제안한 수정 설명** _(AI가 쓴 글)_'),r1.indexOf('**피드백에 이어진 대화**'));
 assert.ok(shown(mine).includes(D1)&&!shown(mine).includes(REV));assert.ok(shown(ai).includes(REV)&&!shown(ai).includes(D1));
 const full=md.slice(md.indexOf('\n## 8.'));assert.ok(!shown(full.slice(0,full.indexOf('\n## 9.'))).includes(REV),'the full-record export (section 8) is unchanged: no rewrite there');
});

// (the follow-up → item resolution is covered in tests/feedback_refs.test.js, shared with the tutor and the explain stage)
