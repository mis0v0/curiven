// Pure tutoring/scaffolding helpers (no browser, no AI).  node --test tests/tutor.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const L=require('../learning.js');const T=require('../tutor.js');
const SQLI=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/scaffold_sqli_lesson.json'),'utf8'));
const SAMPLE=JSON.parse(fs.readFileSync(path.join(__dirname,'..','sample_cookie_lesson.json'),'utf8'));
const lesson=(extra={})=>({id:'A',topic:'SQL Injection',stage:2,lesson:JSON.parse(JSON.stringify(SQLI)),scenarios:[],drafts:[],...extra});
let n=0;const id=()=>'id'+(++n);

test('learner text is stored exactly as typed; quick requests use the button label',()=>{
 const l=lesson(),typed='  바인딩이 뭔지\n\n잘 모르겠어요 **진짜**  ';
 const r=T.addLearner(l,{text:typed,intent:'meaning'},1,id());assert.ok(r.ok);assert.equal(r.msg.text,typed);assert.equal(r.msg.quick,undefined);
 const q=T.addLearner(l,{text:'',intent:'simpler'},2,id());assert.equal(q.msg.text,'더 쉽게 설명해 줘');assert.equal(q.msg.quick,true);
 const qt=T.addLearner(l,{intent:'meaning',ref:{kind:'term',term:'쿼리'},quickText:'“쿼리”이(가) 무슨 뜻이야?'},3,id());assert.equal(qt.msg.text,'“쿼리”이(가) 무슨 뜻이야?');
 assert.deepEqual(T.addLearner(l,{text:'   ',intent:'ask'}),{ok:false,reason:'empty'},'a question needs words');
 assert.deepEqual(T.addLearner(l,{text:'가'.repeat(2001)}),{ok:false,reason:'long'});
 assert.deepEqual(T.addLearner(l,{text:'x',intent:'hack'}),{ok:false,reason:'intent'});
 const noted=T.addLearner(l,{text:'나중에 볼 질문',noted:true},4,id());assert.equal(noted.msg.status,'noted');
 assert.equal(T.addLearner(l,{text:'x',ref:{kind:'feedback',draftAt:'bad'}}).msg.ref,null,'malformed refs are dropped');
});

test('threads: each feedback item and each thought experiment is separate; general and term questions share one',()=>{
 const l=lesson();
 const g=T.addLearner(l,{text:'일반 질문'},1,id()).msg,t=T.addLearner(l,{text:'',intent:'meaning',ref:{kind:'term',term:'SQL'}},2,id()).msg;
 const f1=T.addLearner(l,{text:'답1',intent:'reply',ref:{kind:'feedback',draftAt:5,type:'precision',index:0}},3,id()).msg;
 const f2=T.addLearner(l,{text:'답2',intent:'reply',ref:{kind:'feedback',draftAt:5,type:'precision',index:1}},4,id()).msg;
 const s0=T.addLearner(l,{text:'문제 질문',ref:{kind:'scenario',i:0}},5,id()).msg;
 T.attachReply(l,f1.id,{reply:'r1',followUp:'',assessment:null,uncertainty:'',withheld:0},{provider:'chatgpt',model:'m'},6,id());
 assert.deepEqual(T.stream(l,null).map(m=>m.id),[g.id,t.id]);
 assert.deepEqual(T.stream(l,f1.ref).map(m=>m.text),['답1','r1']);
 assert.deepEqual(T.stream(l,f2.ref).map(m=>m.text),['답2']);
 assert.deepEqual(T.stream(l,{kind:'scenario',i:0}).map(m=>m.id),[s0.id]);
});

test('history: only answered turns of the same thread, follow-up questions included, at most 12',()=>{
 const l=lesson();
 for(let i=0;i<10;i++){const m=T.addLearner(l,{text:'q'+i},i*2,id()).msg;T.attachReply(l,m.id,{reply:'a'+i,followUp:i===9?'왜 그럴까요?':'',assessment:null,uncertainty:'',withheld:0},{},i*2+1,id())}
 const failed=T.addLearner(l,{text:'실패한 질문'},100,id()).msg;T.markFailed(l,failed.id,'network');
 T.addLearner(l,{text:'메모',noted:true},101,id());
 const cur=T.addLearner(l,{text:'새 질문'},102,id()).msg;
 const h=T.history(l,cur);
 assert.equal(h.length,12);assert.deepEqual(h.at(-1),{role:'tutor',text:'a9\n(튜터의 질문) 왜 그럴까요?'});
 assert.ok(!h.some(x=>/실패한 질문|메모|새 질문/.test(x.text)));
});

test('payload: lesson material, labelled learning context, focus and this conversation — no answers before choosing, records or profile secrets',()=>{
 const l=lesson({prediction:'내 예상',events:[{at:'x',what:'y'}]});
 const m=T.addLearner(l,{text:'',intent:'hint',ref:{kind:'scenario',i:0}},1,id()).msg;
 const p=T.payload(l,m,{nickname:'닉',interests:[]});
 assert.deepEqual(Object.keys(p).sort(),['context','focus','history','intent','lesson','message','mode','profile','stage']);
 assert.equal(p.mode,'tutor');assert.equal(p.intent,'hint');assert.equal(p.focus.answered,false);assert.equal(p.focus.reason,undefined,'explanation not sent before the learner answers');
 // The story and the learner's own prediction are context now (UX-12), so references to them can be understood.
 assert.equal(p.context.story,SQLI.story);assert.equal(p.context.prediction.learner,'내 예상');
 assert.equal(p.context.scenarios[0].reason,undefined);assert.equal(p.context.scenarios[0].statedOutcome,undefined,'no outcome through the context either');
 const s=JSON.stringify(p);for(const leak of ['answerIndex','"hint":','"events"',SQLI.scenarios[0].reason])assert.ok(!s.includes(leak),leak);
 l.scenarios.push({i:0,choice:null,unsure:true,at:2});
 assert.equal(T.payload(l,m).focus.reason,SQLI.scenarios[0].reason,'after answering, the explanation is context');
 assert.equal(T.payload(l,m).context.scenarios[0].unsure,true);
});

test('feedback focus resolves the quoted item and the original explanation',()=>{
 const text='바인딩은 입력을 문자열로 처리해서 쿼리에 넣는 것이다. 그래서 안전하다고 생각해요.';
 const fb={schema:2,summary:'핵심은 맞아요',correct:[],precision:[{quote:'입력을 문자열로 처리해서',issue:'바인딩과 문자열 처리 구분',why:'값은 문자열만이 아님',question:'바인딩은 무엇을 따로 전달할까요?'}],misconceptions:[],missing:[],explained:[],uncertainty:''};
 const l=lesson({drafts:[{text,at:7,feedback:fb}]});
 const m=T.addLearner(l,{text:'값을 쿼리와 따로 보내요',intent:'reply',ref:{kind:'feedback',draftAt:7,type:'precision',index:0}},1,id()).msg;
 const f=T.payload(l,m).focus;assert.equal(f.kind,'feedback');assert.equal(f.question,'바인딩은 무엇을 따로 전달할까요?');assert.equal(f.draft,text);
 const sum=T.addLearner(l,{text:'다시 설명해 볼게요',intent:'reply',ref:{kind:'feedback',draftAt:7,type:'summary',index:0}},2,id()).msg;
 assert.equal(T.payload(l,sum).focus.issue,'핵심은 맞아요');
});

test('reply validation mirrors the server: criticisms must quote the learner, verdicts are a closed set',()=>{
 const msg='바인딩은 입력을 문자열로 처리해서 쿼리에 넣는 거예요';
 assert.equal(T.validateReply({reply:'r',assessment:{verdict:'imprecise',quote:'문자열로 처리해서',note:'n'}},msg,'check').assessment.verdict,'imprecise');
 const w=T.validateReply({reply:'r',assessment:{verdict:'misconception',quote:'바인딩은 위험해요'}},msg);assert.equal(w.assessment,null);assert.equal(w.withheld,1);assert.equal(w.uncertainty,'','counted, not narrated');
 const q=T.validateReply({reply:'r',assessment:{verdict:'correct',quote:'바인딩이 뭐예요'}},'바인딩이 뭐예요?');assert.equal(q.assessment,null);assert.equal(q.assessmentDropped,'correct','dropped judgement kept in the record');
 assert.equal(T.validateReply(q,'바인딩이 뭐예요?').assessmentDropped,'correct','idempotent');
 assert.equal(T.validateReply({reply:'r',assessment:{verdict:'imprecise'}},msg).assessment,null);
 for(const bad of [null,[],{reply:''},{reply:'r',assessment:{verdict:'mastered'}},{reply:'r',followUp:1}])assert.throws(()=>T.validateReply(bad,msg));
});

test('replies stay next to their question; failures and interruptions are visible states',()=>{
 const l=lesson();const a=T.addLearner(l,{text:'첫 질문'},1,id()).msg,b=T.addLearner(l,{text:'둘째',noted:true},2,id()).msg;
 T.attachReply(l,a.id,{reply:'답',followUp:'',assessment:null,uncertainty:'',withheld:0},{provider:'chatgpt',model:'m'},3,id());
 assert.deepEqual(l.dialogue.map(m=>m.text),['첫 질문','답','둘째']);
 assert.equal(T.state(a,false),'answered');
 const c=T.addLearner(l,{text:'셋째'},4,id()).msg;assert.equal(T.state(c,true),'pending');assert.equal(T.state(c,false),'interrupted');
 T.markFailed(l,c.id,'요청을 취소했어요.',true);assert.equal(c.status,'failed');assert.equal(c.cancelled,true);assert.equal(c.text,'셋째');
 assert.equal(b.status,'noted');
});

test('glossary and termsIn: prerequisites first, deduplicated, exact substring only',()=>{
 const g=T.glossary(SQLI);assert.deepEqual(g.slice(0,3).map(x=>x.source),['prerequisite','prerequisite','prerequisite']);
 assert.equal(g.filter(x=>x.term==='값 바인딩').length,1,'same term from prerequisites and concepts appears once');
 assert.deepEqual(T.termsIn(SQLI.scenarios[1].question,g).map(x=>x.term),['쿼리','값 바인딩']);
 assert.deepEqual(T.termsIn('sql 문장',g).map(x=>x.term),['SQL'],'case-insensitive');
 assert.deepEqual(T.termsIn('블랙홀의 사건의 지평선',g),[]);
 assert.deepEqual(T.glossary(SAMPLE).map(x=>x.source),SAMPLE.concepts.map(()=>'concept'),'old lessons: glossary from concepts');
});

test('normalizeExtras sanitises hand-imported optional fields and leaves old lessons as they were',()=>{
 const old=JSON.parse(JSON.stringify(SAMPLE)),before=JSON.stringify({...old,prerequisites:[]});
 assert.equal(JSON.stringify(T.normalizeExtras(old)),before);
 const v=JSON.parse(JSON.stringify(SQLI));v.prerequisites.push({term:'',plain:'x'},'bad');v.technical[0].steps=[1,'',' 단계 '];v.scenarios[0].hint=3;
 T.normalizeExtras(v);assert.equal(v.prerequisites.length,3);assert.deepEqual(v.technical[0].steps,['단계']);assert.equal('hint' in v.scenarios[0],false);
});

test('AI agreement never changes achievement state',()=>{
 const l={...lesson(),lesson:SAMPLE,drafts:[{text:'세션 ID를 쿠키로 보내요',at:1,feedback:null}],feedback:null};
 const before=[...L.conceptStatus(l)];
 for(const c of SAMPLE.concepts){const m=T.addLearner(l,{text:`${c.name}은 ${c.description}`,intent:'check'},2,id()).msg;
  T.attachReply(l,m.id,{reply:'정확해요',followUp:'',assessment:{verdict:'correct',quote:c.name,note:''},uncertainty:'',withheld:0},{},3,id())}
 assert.deepEqual([...L.conceptStatus(l)],before);
 assert.ok([...L.conceptStatus(l).values()].every(s=>s.tier==='encountered'));
});

// ---- Acceptance refinement (mirrors tests/test_tutor.py) ----
const UTTER=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/utterance_cases.json'),'utf8')).cases;
test('utterance kinds agree with the server on the shared fixture',()=>{for(const [t,k] of UTTER)assert.equal(L.utteranceKind(t),k,t)});

test('client guard: a question is never a misconception; adjustments are recorded, never silent; idempotent',()=>{
 const a=(msg,verdict,quote,intent='check')=>T.validateReply({reply:'r',assessment:{verdict,quote,note:'n'}},msg,intent).assessment;
 assert.deepEqual(a('조선 사람들은 다 족보가 있었던 거죠?','misconception','다 족보가 있었던'),{verdict:'assumption',quote:'다 족보가 있었던',note:'n',utterance:'check',adjustedFrom:'misconception'});
 assert.equal(a('바인딩이 뭐예요?','correct','바인딩이 뭐예요'),null);
 assert.equal(a('바인딩이 뭐예요?','misconception','바인딩이 뭐예요','meaning'),null);
 assert.equal(a('조선 시대에는 모든 사람이 족보를 가지고 있었어요.','misconception','모든 사람이 족보를').verdict,'misconception');
 const server={reply:'r',assessment:{verdict:'assumption',quote:'쿠키만 지우면 로그아웃되는',note:'n',adjustedFrom:'misconception'}};
 const once=T.validateReply(server,'그럼 쿠키만 지우면 로그아웃되는 거 아닌가요?');assert.equal(once.assessment.adjustedFrom,'misconception','server adjustment kept');
 assert.deepEqual(T.validateReply(once.assessment?{...server}:server,'그럼 쿠키만 지우면 로그아웃되는 거 아닌가요?').assessment,once.assessment);
});

test('text-only replies never carry a judgement or a follow-up, even if the data says otherwise',()=>{
 const r=T.validateReply({reply:'본문',format:'text-only',followUp:'질문?',assessment:{verdict:'correct'}},'아무 말');
 assert.deepEqual([r.assessment,r.followUp,r.format],[null,'','text-only']);
 assert.equal(T.validateReply({reply:'x',format:'hacked'},'m').format,undefined);
});

test('explanation feedback: a quoted question moves out of misconceptions (same as server), and stays moved after reload',()=>{
 const text='세션 ID는 쿠키로 전달돼요. 그럼 쿠키만 지우면 로그아웃되는 거 아닌가요? 서버는 쿠키를 저장해요.';
 const raw={schema:2,summary:'s',misconceptions:[{quote:'쿠키만 지우면 로그아웃되는 거 아닌가요',issue:'i',why:'w',question:'q'},{quote:'서버는 쿠키를 저장해요',issue:'i2',why:'w2',question:'q2'}]};
 const f=L.validateFeedback(raw,[],text);
 assert.deepEqual(f.misconceptions.map(m=>m.quote),['서버는 쿠키를 저장해요']);assert.equal(f.precision.at(-1).reclassified,'check');
 assert.deepEqual(L.validateFeedback(f,[],text),f,'re-validating stored feedback changes nothing');
});
