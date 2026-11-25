// Durable feedback references (tutor.js resolveFeedback): a learner follow-up stays tied to the feedback item it
// answered — in the tutor's context, the explain stage, notes/Notion history, the growth stage and the archive — or the
// record says it cannot tell. Never another critique by position.
//   node --test tests/feedback_refs.test.js
// Synthetic records only. No network, no AI.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const T=require('../tutor.js'),L=require('../learning.js'),J=require('../journey.js'),N=require('../notes.js'),C=require('../concept-note.js');

const TEXT='열은 높은 곳에서 낮은 곳으로 흐른다. 차가운 기운이 들어와서 식는다. 열은 차가운 쪽으로 가나요?';
const Q={quote:'열은 차가운 쪽으로 가나요?',issue:'Q-ITEM 질문을 오개념으로 봄',why:'w',question:'Q의 질문'};
const CI={quote:'차가운 기운이 들어와서 식는다',issue:'C-ITEM 차가운 기운',why:'w',question:'C의 질문'};
const M={issue:'M-ITEM 열평형',question:'M의 질문'};
const fb=(mis=[Q,CI],extra={})=>({schema:2,summary:'요약',correct:[],precision:[],missing:[M],explained:[],uncertainty:'',misconceptions:mis.map(x=>({...x})),...extra});
const lesson=(drafts,dialogue)=>({id:'x',topic:'열',stage:4,lesson:{title:'열',concepts:[],technical:[],scenarios:[]},drafts,dialogue});
const msg=(id,text,ref,at=2000)=>({id,role:'learner',text,at,status:'pending',intent:'reply',ref});
const reply=(id,to,text)=>({id,role:'tutor',replyTo:to,text,at:9000});
const legacy=(type,index,draftAt=1000)=>({kind:'feedback',draftAt,type,index});
const focus=(l,m)=>T.payload(l,m).focus;
const ALL_ISSUES=[Q.issue,CI.issue,M.issue];
/** The issue the tutor would be told about, or null; and a check that no OTHER item's words leak into the payload. */
function told(l,m){const p=JSON.stringify(T.payload(l,m)),f=T.payload(l,m).focus;return {issue:f?.issue??null,leaks:ALL_ISSUES.filter(i=>p.includes(i)&&i!==f?.issue)}}

test('stamping: new feedback and each item get an id; ids survive re-validation, reordering and reclassification',()=>{
 let n=0;const f=L.stampFeedback(L.validateFeedback(fb(),[],TEXT),()=>`id-${String(++n).padStart(6,'0')}`);
 assert.equal(f.id,'id-000001');
 // today's validator moves the quoted question (Q) from misconceptions to precision: its id goes with it
 assert.deepEqual([f.misconceptions.map(x=>[x.issue,x.id]),f.precision.map(x=>[x.issue,x.id,x.reclassified]),f.missing.map(x=>[x.issue,x.id])],
  [[[CI.issue,'id-000003']],[[Q.issue,'id-000002','check']],[[M.issue,'id-000004']]]);
 const again=L.validateFeedback(JSON.parse(JSON.stringify(f)),[],TEXT);assert.equal(again.id,f.id);
 assert.deepEqual([...again.misconceptions,...again.precision,...again.missing].map(x=>x.id),['id-000003','id-000002','id-000004']);
 assert.deepEqual(L.stampFeedback(f,()=>'other-id-x'),f,'already stamped: unchanged');
 for(const bad of ['short','has space!!','x'.repeat(65),7])assert.ok(!('id' in L.validateFeedback({...fb(),id:bad},[],TEXT)),String(bad));
 const v1={summary:'예전',correct:['맞아요']};assert.equal(L.stampFeedback(L.validateFeedback(v1,[],TEXT)).id,undefined,'v1 is never stamped');
});

test('F2 reproduced and fixed: a legacy follow-up on drifted feedback never brings another critique to the tutor',()=>{
 // stored by an older validator: Q kept as misconception #0; today Q is a premise check and misconceptions[0] is C
 const l=lesson([{text:TEXT,at:1000,feedback:fb()}],[msg('a','Q에 답했어요',legacy('misconceptions',0)),msg('b','M에 답했어요',legacy('missing',0),2100)]);
 assert.equal(T.validFeedback(l,l.drafts[0]).misconceptions[0].issue,CI.issue,'position 0 now holds a different item');
 assert.deepEqual(told(l,l.dialogue[0]),{issue:null,leaks:[]},'ambiguous: no item at all, and certainly not C');
 assert.equal(T.resolveFeedback(l,l.dialogue[0].ref).status,'ambiguous');
 assert.deepEqual(told(l,l.dialogue[1]),{issue:M.issue,leaks:[]},'an item both readings agree on still resolves');
 // explain stage / notes: C's thread does not contain the reply; it is listed as unplaced instead
 const d=l.drafts[0];assert.deepEqual(T.stream(l,T.itemRef(l,d,'misconceptions',0)).map(m=>m.text),[]);
 assert.deepEqual(T.stream(l,T.itemRef(l,d,'missing',0)).map(m=>m.text),['M에 답했어요']);assert.deepEqual(T.unplaced(l,d).map(m=>m.text),['Q에 답했어요']);
 assert.equal(J.chain(l)[0].thread.find(t=>t.text==='Q에 답했어요').about,'어느 항목인지 확인할 수 없는 피드백');
});

test('new follow-ups (ids + seen) keep their item through reclassification, reordering and reload',()=>{
 let n=0;const stamped=L.stampFeedback(L.validateFeedback(fb([CI,Q]),[],TEXT),()=>`it-${String(++n).padStart(6,'0')}`);
 const l=lesson([{text:TEXT,at:1000,feedback:stamped}],[]);const d=l.drafts[0];
 const refQ=T.cleanRef(T.itemRef(l,d,'precision',0));assert.equal(refQ.seen.issue,Q.issue);assert.ok(refQ.iid&&refQ.fid);
 l.dialogue.push(msg('a','Q에 답함',refQ),reply('r','a','Q에 대한 답'));
 assert.deepEqual(told(l,l.dialogue[0]),{issue:Q.issue,leaks:[]});
 // a later rule change reorders the lists (simulated: the stored lists are rearranged; ids and words unchanged)
 const moved=JSON.parse(JSON.stringify(l));const sf=moved.drafts[0].feedback;sf.misconceptions=[...sf.precision.map(x=>{const {reclassified,...y}=x;return y}),...sf.misconceptions];sf.precision=[];
 const r=T.resolveFeedback(moved,moved.dialogue[0].ref);assert.equal(r.status,'resolved');assert.equal(r.item.issue,Q.issue);
 assert.deepEqual(told(moved,moved.dialogue[0]),{issue:Q.issue,leaks:[]});
 // reload: through JSON, the same answer everywhere
 const back=JSON.parse(JSON.stringify(l));assert.deepEqual(T.stream(back,T.itemRef(back,back.drafts[0],'precision',0)).map(m=>m.text),['Q에 답함','Q에 대한 답']);
 assert.equal(J.chain(back)[0].thread[0].about,'‘질문·가설의 전제 확인’ 항목');
});

test('removed item, replaced feedback, missing feedback: unresolved, nothing injected, the follow-up kept apart',()=>{
 let n=0;const s=L.stampFeedback(L.validateFeedback(fb(),[],TEXT),()=>`rm-${String(++n).padStart(6,'0')}`);
 const l=lesson([{text:TEXT,at:1000,feedback:s}],[]);const ref=T.cleanRef(T.itemRef(l,l.drafts[0],'misconceptions',0));l.dialogue.push(msg('a','C에 답함',ref));
 const gone=JSON.parse(JSON.stringify(l));gone.drafts[0].feedback.misconceptions=[];              // withheld by a later rule
 assert.deepEqual([T.resolveFeedback(gone,ref).reason,told(gone,gone.dialogue[0]).issue],['item_gone',null]);
 const replaced=JSON.parse(JSON.stringify(l));replaced.drafts[0].feedback=L.stampFeedback(L.validateFeedback(fb(),[],TEXT),()=>`nw-${String(++n).padStart(6,'0')}`);
 assert.deepEqual([T.resolveFeedback(replaced,ref).reason,told(replaced,replaced.dialogue[0]).issue],['feedback_replaced',null],'same words, different feedback: not the same item');
 const none=JSON.parse(JSON.stringify(l));none.drafts[0].feedback={schema:2,summary:'',id:s.id};   // same feedback, now unreadable
 assert.deepEqual([T.resolveFeedback(none,ref).reason,told(none,none.dialogue[0]).issue],['no_feedback',null]);
 for(const x of [gone,replaced,none]){assert.deepEqual(T.unplaced(x,x.drafts[0]).map(m=>m.text),['C에 답함']);assert.equal(J.chain(x)[0].thread[0].about,'지금은 찾을 수 없는 피드백 항목')}
});

test('identical items: position and words together decide; words alone that match twice are ambiguous',()=>{
 const twin={...CI};const l=lesson([{text:TEXT,at:1000,feedback:fb([CI,twin])}],[]);
 const v=T.validFeedback(l,l.drafts[0]);assert.equal(v.misconceptions.length,2);
 const r1=T.cleanRef(T.itemRef(l,l.drafts[0],'misconceptions',1));assert.equal(T.resolveFeedback(l,r1).index,1,'position + words agree');
 assert.equal(T.resolveFeedback(l,legacy('misconceptions',1)).index,1,'legacy, no drift: both readings agree');
 const off={...r1,index:5};assert.deepEqual([T.resolveFeedback(l,off).status,T.resolveFeedback(l,off).reason],['ambiguous','duplicate_item']);
});

test('H1 reproduced and fixed: two explanations with one timestamp',()=>{
 const f2={schema:2,summary:'둘째',correct:[],precision:[],misconceptions:[],explained:[],uncertainty:'',missing:[{issue:'SECOND-ITEM',question:'q'}]};
 const l=lesson([{text:TEXT,at:1000,feedback:fb()},{text:'두 번째 설명이에요. 열평형.',at:1000,feedback:f2}],[msg('a','둘째에 답함',legacy('missing',0))]);
 assert.deepEqual([T.resolveFeedback(l,l.dialogue[0].ref).reason,told(l,l.dialogue[0]).issue],['same_time',null],'never the first explanation’s item');
 assert.deepEqual(J.chain(l).map(r=>r.thread.length),[0,0],'attached to neither');assert.deepEqual(J.unlinked(l).map(t=>[t.text,t.about]),[['둘째에 답함','같은 시각의 설명이 여럿이라 어느 설명인지 알 수 없음']]);
 assert.deepEqual(T.unplaced(l,l.drafts[0]),[]);assert.deepEqual(T.unlinked(l).map(m=>m.text),['둘째에 답함']);
 // with a stamped feedback id the explanation is known even at the same time
 l.drafts[1].feedback=L.stampFeedback(L.validateFeedback(f2,[],l.drafts[1].text),()=>'second-fid-000');const ok=T.cleanRef(T.itemRef(l,l.drafts[1],'missing',0));
 l.dialogue.push(msg('b','fid로 답함',ok));assert.deepEqual(told(l,l.dialogue[1]),{issue:'SECOND-ITEM',leaks:[]});
 const md=J.markdown(l);assert.match(md,/\*\*어느 설명의 피드백에 대한 대화인지 확인할 수 없는 기록\*\* _\(1개/);
});

test('F4 reproduced and fixed: follow-ups whose explanation is gone are listed, counted, and kept',()=>{
 const l=lesson([{text:TEXT,at:1000,feedback:fb()}],[msg('o','고아 대화',legacy('summary',0,424242)),reply('ro','o','고아에 대한 답')]);
 const md=J.markdown(l),s5=md.slice(md.indexOf('\n## 5.'),md.indexOf('\n## 6.'));
 assert.match(s5,/확인할 수 없는 기록\*\* _\(1개/);assert.match(s5,/이 시각의 설명이 기록에 없음: 고아 대화/);assert.match(s5,/AI 튜터의 답 _\(AI\)_: 고아에 대한 답/);
 assert.match(N.lessonMarkdown(l,{now:0}),/어느 설명의 피드백에 대한 대화인지 확인할 수 없음[\s\S]*고아 대화/);assert.equal(T.payload(l,l.dialogue[0]).focus,null);
});

test('missing or malformed references are cleaned or rejected, never matched by guess',()=>{
 assert.equal(T.cleanRef({kind:'feedback',draftAt:'x',type:'missing',index:0}),null);assert.equal(T.cleanRef({kind:'feedback',draftAt:1,type:'nope',index:0}),null);
 assert.equal(T.cleanRef({kind:'feedback',draftAt:1,type:'missing',index:-1}),null);
 assert.deepEqual(T.cleanRef({kind:'feedback',draftAt:1,type:'missing',index:0,fid:'bad id!',iid:'<script>',seen:{issue:'  ',quote:5}}),{kind:'feedback',draftAt:1,type:'missing',index:0});
 assert.deepEqual(T.cleanRef({kind:'feedback',draftAt:1,type:'summary',index:0,iid:'abcdefgh1',seen:{issue:'x'}}),{kind:'feedback',draftAt:1,type:'summary',index:0},'summary carries no item');
 const l=lesson([{text:TEXT,at:1000,feedback:fb()}],[]);
 for(const ref of [null,{kind:'term',term:'열'},legacy('missing',9),legacy('precision',0)])assert.notEqual(T.resolveFeedback(l,ref).status,'resolved',JSON.stringify(ref));
});

test('H2: the next explanation is described by order only — after, before, or unknown — never as a revision',()=>{
 const base=(fbAt,nextAt)=>lesson([{text:TEXT,at:1000,feedback:{...fb(),reviewer:{at:fbAt}}},{text:'다음 설명',at:nextAt,feedback:null}],[]);
 for(const [fbAt,nextAt,want,line] of [[1500,3000,true,'이 피드백을 받은 뒤에 썼어요. 피드백을 반영했는지는 기록으로 알 수 없어요.'],[5000,3000,false,'이 피드백이 오기 전에 썼어요.'],[null,3000,null,'이 피드백과의 순서는 기록으로 알 수 없어요.'],[1500,undefined,null,'이 피드백과의 순서는 기록으로 알 수 없어요.']]){
  const l=base(fbAt,nextAt);assert.equal(J.chain(l)[0].afterFeedback,want);const md=J.markdown(l);
  assert.ok(md.includes(`**다음에 쓴 설명**: 설명 2 — ${line}`),line);assert.ok(!md.includes('다시 설명한 내용'))}
});

test('one answer everywhere: tutor context, explain-stage threads, notes, chain and archive agree for every follow-up',()=>{
 let n=0;const s=L.stampFeedback(L.validateFeedback(fb([CI]),[],TEXT),()=>`ev-${String(++n).padStart(6,'0')}`);
 const l=lesson([{text:TEXT,at:1000,feedback:fb()},{text:TEXT+' 다시',at:3000,feedback:s}],[]);
 l.dialogue.push(msg('a','legacy drifted',legacy('misconceptions',0)),msg('b','legacy ok',legacy('missing',0),2100),msg('c','new ok',T.cleanRef(T.itemRef(l,l.drafts[1],'misconceptions',0)),3100),
  msg('d','summary',legacy('summary',0,3000),3200),msg('e','orphan',legacy('missing',0,7777),3300));
 const rounds=J.chain(l);
 for(const m of l.dialogue){const r=T.resolveFeedback(l,m.ref),f=T.payload(l,m).focus;
  if(r.status==='resolved'){assert.equal(f.issue,r.type==='summary'?r.feedback.summary:r.item.issue,m.text);
   assert.ok(T.stream(l,T.itemRef(l,r.draft,r.type,r.index)).includes(m),'explain-stage thread: '+m.text);
   const n=l.drafts.indexOf(r.draft);assert.ok(rounds[n].thread.some(t=>t.text===m.text&&!/확인할 수 없|찾을 수 없/.test(t.about)),'chain: '+m.text)}
  else{assert.equal(f,null,m.text);
   for(const d of l.drafts){const v=T.validFeedback(l,d);if(!v)continue;for(const t of ['misconceptions','precision','missing'])v[t].forEach((x,i)=>assert.ok(!T.stream(l,T.itemRef(l,d,t,i)).includes(m),`${m.text} is under no item`))}
   assert.ok(r.draft?T.unplaced(l,r.draft).includes(m):T.unlinked(l).includes(m),'listed apart: '+m.text)}}
 const hist=N.lessonMarkdown(l,{now:0});assert.match(hist,/어느 항목에 대한 대화인지 확인할 수 없음[\s\S]*legacy drifted/);
});

test('read-only and deterministic: resolving, threads, payloads and the archive never change the record',()=>{
 const l=lesson([{text:TEXT,at:1000,feedback:fb()}],[msg('a','x',legacy('misconceptions',0)),msg('b','y',legacy('missing',0))]);const before=JSON.stringify(l);
 for(const m of l.dialogue){T.resolveFeedback(l,m.ref);T.payload(l,m);T.stream(l,m.ref)}T.unplaced(l,l.drafts[0]);T.unlinked(l);
 const a=J.markdown(l),b=J.markdown(JSON.parse(before));assert.equal(a,b);N.lessonMarkdown(l,{now:0});C.exportNotion(l,{now:0});
 assert.equal(JSON.stringify(l),before);
 // the validation cache follows the inputs: a changed explanation text is re-validated
 const w=JSON.parse(before);assert.equal(T.validFeedback(w,w.drafts[0]).misconceptions.length,1);w.drafts[0].text='전혀 다른 글';
 assert.equal(T.validFeedback(w,w.drafts[0]).misconceptions.length,0,'quotes no longer found: not served from a stale cache');
});

// 2026-11-25 acceptance review: contradictory or explicit-but-invalid identity never succeeds; an unresolved thread never
// pulls another conversation into the view or the tutor's history.
test('contradictory identity fails closed: bad ids, words that disagree with the id, duplicated ids',()=>{
 let n=0;const f=L.stampFeedback(L.validateFeedback(fb([CI]),[],TEXT),()=>`cx-${String(++n).padStart(6,'0')}`);
 const l=lesson([{text:TEXT,at:1000,feedback:f}],[]),ok=T.cleanRef(T.itemRef(l,l.drafts[0],'misconceptions',0));
 const why=ref=>{const r=T.resolveFeedback(l,ref);return `${r.status}:${r.reason}`};
 assert.equal(T.resolveFeedback(l,ok).status,'resolved');
 for(const [name,ref,want] of [['iid empty',{...ok,iid:''},'unresolved:bad_identity'],['iid number',{...ok,iid:5},'unresolved:bad_identity'],['fid object',{...ok,fid:{}},'unresolved:bad_identity'],
  ['wrong iid, same words elsewhere',{...ok,iid:'cx-WRONG00'},'unresolved:item_gone'],['words disagree with the id',{...ok,seen:{issue:M.issue,quote:null}},'ambiguous:conflicting_evidence'],
  ['wrong fid',{...ok,fid:'cx-WRONGF0'},'unresolved:feedback_replaced']]){
  assert.equal(why(ref),want,name);const m=msg('z','x',ref);l.dialogue=[m];assert.equal(T.payload(l,m).focus,null,name+': nothing sent to the tutor')}
 const dupe=JSON.parse(JSON.stringify(l));dupe.drafts[0].feedback.missing[0].id=dupe.drafts[0].feedback.misconceptions[0].id;
 assert.equal(T.resolveFeedback(dupe,ok).reason,'duplicate_id');
 assert.equal(T.resolveFeedback(l,{...ok,iid:undefined}).status,'resolved','an absent field is not a bad one (words still decide)');
});

test('an unresolved thread keeps only its own evidence: no mixing across explanations, no foreign tutor history',()=>{
 const g=(issue)=>({schema:2,summary:'s',correct:[],precision:[],misconceptions:[],explained:[],uncertainty:'',missing:[{issue,question:'q'}]});
 const l=lesson([{text:TEXT,at:1000,feedback:g('DRAFT1-M')},{text:TEXT,at:1000,feedback:g('DRAFT2-M')}],
  [msg('h1','reply meant for draft 1',legacy('missing',0)),reply('h1r','h1','tutor answer about DRAFT1-M')]);
 const under2=T.itemRef(l,l.drafts[1],'missing',0);assert.deepEqual(T.stream(l,under2).map(m=>m.text),[],'the other explanation’s talk is not shown here');
 const m2=msg('h2','typed under draft 2',T.cleanRef(under2),3000);l.dialogue.push(m2);
 const p=T.payload(l,m2);assert.equal(p.focus,null);assert.deepEqual(p.history,[],'and is not sent as history');
 const m3=msg('h3','second message under draft 2',T.cleanRef(under2),4000);l.dialogue.push(reply('h2r','h2','answer under 2'),m3);m2.status='answered';
 assert.deepEqual(T.payload(l,m3).history.map(h=>h.text),['typed under draft 2','answer under 2'],'its own earlier turns still are');
});
