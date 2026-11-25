/* CURIVEN learning-journey archive (learning-journey-v2) — a Markdown record of HOW one exploration went, for later
   reflection, portfolios and interviews. Pure and deterministic: no AI, no network, no clock (the same record always
   gives the same bytes), and the record is never modified. Shared by the browser and Node tests.

   Rules:
   - Learner-written text is reproduced exactly (notes.js `esc`: Markdown characters are escaped so they render as
     typed). In the timeline a message is shown on one line; its full text is in the original record and the JSON.
   - Only facts the record holds are stated. Nothing is inferred about mastery, ability, traits or improvement.
     Untimed actions are listed without a time, never placed in the timeline by guess.
   - Anything an AI wrote (lesson material, scenario answers, feedback, tutor replies, the concept-note synthesis) is
     labelled as AI output. AI classifications (e.g. feedback "다듬을 점" vs "다시 생각할 점") are shown as the AI's
     own labels; links between questions and concept-note sections come from the AI synthesis and are marked inferred.
   - The complete original record follows: notes.js `lessonMarkdown` (the existing full export, byte-tested against
     a real learner export) and the record itself as JSON, with a SHA-256 to match it against the header.
   Sections: 기록 정보 · 1 처음 질문과 처음 이해 · 2 학습 활동의 순서 · 3 질문과 막힌 곳 · 4 시도, 예상, 선택 ·
   5 내 설명과 AI 피드백 · 6 기록으로 보이는 학습 과정 · 7 아직 풀리지 않은 질문 · 8 원래 학습 기록 전체 ·
   9 원본 데이터(JSON).
   v2 (2026-11-24): section 5 links each explanation to its feedback, the AI's own rewrite (a section that appears only
   when the AI actually wrote one — never made from the feedback, the tutor's replies or the learner's text), the
   conversation that followed that feedback, and the learner's next explanation (chain(), shared with the growth stage).
   Section 4 no longer repeats the explanations. */
'use strict';
(function(root){
 const req=n=>typeof require==='function'?require(n):null;
 const L=root.CuriLearning||req('./learning.js');
 const N=root.CuriNotes||req('./notes.js');
 const T=root.CuriTutor||req('./tutor.js');
 const M=root.CuriMaterial||req('./material.js');
 const CP=root.CuriCopy||req('./copy.js');
 const CN=root.CuriConcept||req('./concept-note.js');

 const FORMAT='learning-journey-v2';
 // AI feedback items, by what the record supports: a v2 misconception quotes the learner's words and says why (the AI's
 // conceptual correction); a v2 point to refine is a clarification, or — when the app reclassified a quoted question or
 // guess — a check of its premise; a v1 misconception has no quotation, so it is left unclassified.
 const KIND={concept:'개념 바로잡기',clarify:'표현·조건 다듬기',premise:'질문·가설의 전제 확인',missing:'빠진 연결',correct:'맞게 본 점',unclassified:'분류되지 않은 지적'};
 const {esc,when,fence}=N;
 const dlg=l=>Array.isArray(l?.dialogue)?l.dialogue:[];
 const arr=v=>Array.isArray(v)?v:[];
 const num=v=>Number.isFinite(v)?v:null;
 const one=t=>esc(String(t??'').replace(/\s+/g,' ').trim());             // a learner text on one line (timeline, lists)
 const quote=t=>esc(String(t??'').replace(/\r\n?/g,'\n').replace(/\n+$/,'')).split('\n').map(x=>x?'> '+x:'>').join('\n');
 const cell=one;                                                        // esc() already escapes |
 const dur=ms=>{if(!(ms>=0))return '';const m=Math.round(ms/60000);return m>=60?`${Math.floor(m/60)}시간 ${m%60}분`:`${m}분`};
 const tz=ms=>{if(!Number.isFinite(ms))return '';const o=-new Date(ms).getTimezoneOffset(),s=o>=0?'+':'-',a=Math.abs(o);return `UTC${s}${String(Math.floor(a/60)).padStart(2,'0')}:${String(a%60).padStart(2,'0')}`};
 // Explicit statements of not understanding (narrow on purpose: fewer false positives). Marked as automatic.
 const STUCK=/모르겠|잘\s?모르|이해\s?못|이해가\s?안|헷갈/;
 const INTENT={meaning:'뜻 물어보기',simpler:'더 쉽게',example:'예시 요청',direct:'바로 설명 요청',check:'이해 확인 요청',deeper:'더 깊이'};

 /** SHA-256 (hex) of a string's UTF-8 bytes — synchronous, so the archive stays a pure function in the browser too. */
 function sha256(str){const b=new TextEncoder().encode(String(str)),K=[],H=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225];
  for(let i=0,n=2;i<64;n++){let p=true;for(let d=2;d*d<=n;d++)if(n%d===0){p=false;break}if(p)K[i++]=(Math.pow(n,1/3)%1)*4294967296|0}
  const L=b.length,w=new Uint8Array(((L+9+63)>>6)<<6);w.set(b);w[L]=0x80;const bits=L*8,dv=new DataView(w.buffer);dv.setUint32(w.length-8,Math.floor(bits/4294967296));dv.setUint32(w.length-4,bits>>>0);
  const W=new Uint32Array(64),r=(x,n)=>(x>>>n)|(x<<(32-n));
  for(let o=0;o<w.length;o+=64){for(let i=0;i<16;i++)W[i]=dv.getUint32(o+i*4);
   for(let i=16;i<64;i++){const a=W[i-15],c=W[i-2];W[i]=(W[i-16]+(r(a,7)^r(a,18)^(a>>>3))+W[i-7]+(r(c,17)^r(c,19)^(c>>>10)))|0}
   let [a,bb,c,d,e,f,g,h]=H;
   for(let i=0;i<64;i++){const t1=(h+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+W[i])|0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&bb)^(a&c)^(bb&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=bb;bb=a;a=(t1+t2)|0}
   H[0]=(H[0]+a)|0;H[1]=(H[1]+bb)|0;H[2]=(H[2]+c)|0;H[3]=(H[3]+d)|0;H[4]=(H[4]+e)|0;H[5]=(H[5]+f)|0;H[6]=(H[6]+g)|0;H[7]=(H[7]+h)|0}
  return H.map(x=>(x>>>0).toString(16).padStart(8,'0')).join('')}

 /** The record as stored, as JSON (2-space indent, key order as stored). Its SHA-256 identifies the exact source. */
 const recordJson=l=>JSON.stringify(l,null,2);

 /** Everything the archive says, computed from the record only. */
 function facts(l){
  // Numbered exactly like concept-note.js learnerMessages (same predicate, record order), by position — not by id.
  const d=l?.lesson||{},msgs=dlg(l),typed=[],buttons=msgs.filter(m=>m?.role==='learner'&&m.quick);
  for(const m of msgs)if(m&&m.role==='learner'&&!m.quick&&typeof m.text==='string'&&m.text.trim())typed.push({n:typed.length+1,m,text:m.text});
  const drafts=arr(l?.drafts).filter(x=>x&&typeof x.text==='string'),scen=arr(l?.scenarios).filter(x=>x&&Number.isInteger(x.i));
  const note=CN&&l?.conceptNote?CN.clean(l.conceptNote,l):null;
  const times=[num(l?.createdAt),...msgs.map(m=>num(m?.at)),...drafts.map(x=>num(x.at)),...scen.map(x=>num(x.at))].filter(x=>x!==null);
  return {d,msgs,typed,buttons,drafts,scen,note,start:times.length?Math.min(...times):null,end:times.length?Math.max(...times):null}}

 /** Each explanation with what the record links to it, in record order. Pure; nothing is inferred or invented:
     - feedback: 'ok' | 'invalid' (stored but malformed) | 'error' (the request failed) | 'none';
     - items: the validated feedback, each with its kind (KIND) — AI classifications, not verified judgements;
     - revision: the AI's own rewritten explanation, verbatim, only if the stored feedback has one; otherwise null;
     - thread: the learner's follow-ups that resolve to THIS explanation (tutor.js resolveFeedback, shared with the tutor
       and the explain stage), each with the item it is about — or, when the record cannot tell, said so;
     - next: the number of the learner's next explanation (record order) and afterFeedback: whether it was written after
       this feedback arrived (true/false, null when a time is missing). Order only: not evidence that the feedback was used. */
 function chain(l){
  const msgs=dlg(l),numOf=new Map();let k=0;
  for(const m of msgs)if(m&&m.role==='learner'&&!m.quick&&typeof m.text==='string'&&m.text.trim())numOf.set(m,++k);
  const drafts=arr(l?.drafts).filter(x=>x&&typeof x.text==='string');
  return drafts.map((x,i)=>{
   const fb=x.feedback&&T?T.validFeedback(l,x):null;
   const feedback=fb?'ok':x.feedback?'invalid':typeof x.feedbackError==='string'&&x.feedbackError?'error':'none';
   const kindOf=(type,j)=>type==='misconceptions'?(fb?.schema===2?'concept':'unclassified'):type==='precision'?(fb?.precision?.[j]?.reclassified?'premise':'clarify'):type==='missing'?'missing':null;
   const said=y=>L?L.verbatimQuote(y.quote,x.text):null;
   const items=fb?[...fb.correct.map(y=>({kind:'correct',quote:said(y),text:y.point,why:null})),
    ...fb.misconceptions.map((y,j)=>({kind:kindOf('misconceptions',j),quote:said(y),text:y.issue,why:y.why||null})),
    ...fb.precision.map((y,j)=>({kind:kindOf('precision',j),quote:said(y),text:y.issue,why:y.why||null})),
    ...fb.missing.map(y=>({kind:'missing',quote:null,text:y.issue,why:null}))]:[];
   // Which item a follow-up answered: resolved once, the same way for every consumer (tutor.js resolveFeedback).
   const about=r=>r.status!=='resolved'?(r.status==='ambiguous'?'어느 항목인지 확인할 수 없는 피드백':'지금은 찾을 수 없는 피드백 항목'):r.type==='summary'?'피드백 전체':`‘${KIND[kindOf(r.type,r.index)]}’ 항목`;
   const thread=T&&Number.isFinite(x.at)?msgs.filter(m=>m&&m.role==='learner'&&m.ref?.kind==='feedback'&&m.ref.draftAt===x.at&&typeof m.text==='string').map(m=>[m,T.resolveFeedback(l,m.ref)])
    .filter(([,r])=>r.draft===x).map(([m,r])=>follow(l,m,numOf,about(r))):[];
   const next=i+1<drafts.length?drafts[i+1]:null,fbAt=fb?num(fb.reviewer?.at):null,nextAt=next?num(next.at):null;
   return {n:i+1,at:num(x.at),text:x.text,feedback,error:feedback==='error'?x.feedbackError:null,schema:fb?fb.schema:null,model:fb?.reviewer?.model||null,
    feedbackAt:fb?num(fb.reviewer?.at):null,summary:fb?fb.summary:null,items,uncertainty:fb?.uncertainty||null,
    revision:fb&&typeof fb.revision==='string'&&fb.revision.trim()?fb.revision:null,thread,next:next?i+2:null,
    afterFeedback:next&&fbAt!==null&&nextAt!==null?fbAt<=nextAt:null}})}
 /** One follow-up as shown in the chain (record text exactly; the tutor's reply if recorded). */
 function follow(l,m,numOf,about){const r=T?T.replyOf(l,m):null;
  return {n:numOf.get(m)??null,quick:!!m.quick,intent:m.quick?(INTENT[m.intent]||'요청'):null,text:m.text,at:num(m.at),about,reply:r&&typeof r.text==='string'?{text:r.text,at:num(r.at)}:null}}
 /** Follow-ups on feedback whose explanation cannot be determined (none, or several with the same time): never
     attached to an explanation by guess, listed once. */
 function unlinked(l){if(!T)return [];const numOf=new Map();let k=0;
  for(const m of dlg(l))if(m&&m.role==='learner'&&!m.quick&&typeof m.text==='string'&&m.text.trim())numOf.set(m,++k);
  return T.unlinked(l).filter(m=>m.role==='learner'&&typeof m.text==='string').map(m=>follow(l,m,numOf,T.resolveFeedback(l,m.ref).reason==='same_time'?'같은 시각의 설명이 여럿이라 어느 설명인지 알 수 없음':'이 시각의 설명이 기록에 없음'))}

 /** Learner actions with a recorded time, in time order (record order for equal times). Untimed ones separately. */
 function timeline(l,f){const timed=[],untimed=[];let k=0;const add=(at,what,text)=>{(Number.isFinite(at)?timed:untimed).push({at,what,text,k:k++})};
  if(Number.isFinite(l.createdAt))add(l.createdAt,'탐험 시작','');
  if(l.material&&typeof l.material==='object')add(num(l.material.at),'수업 자료 올림',esc(l.material.name||''));
  if(l.prediction||l.predictionUnsure)add(null,'처음 예상',l.prediction?one(l.prediction):'“아직 잘 모르겠어요”라고 하고 넘어감');
  for(const r of f.scen){const sc=f.d.scenarios?.[r.i];const res=r.unsure||r.choice==null?'잘 모르겠다고 함':sc&&r.choice===sc.answerIndex?'해설과 같은 선택':'해설과 다른 선택';
   add(num(r.at),`사고 실험 ${r.i+1} 응답`,`${sc?.title?esc(sc.title)+': ':''}${res}`)}
  f.drafts.forEach((x,i)=>{add(num(x.at),`설명 ${i+1} 작성`,`‘5. 내 설명과 AI 피드백’에 원문${STUCK.test(x.text)?' · 이해하지 못했다는 표현 있음':''}`);
   const fb=T?T.validFeedback(l,x):null;if(fb)add(num(fb.reviewer?.at),`설명 ${i+1}에 AI 피드백`,'‘5. 내 설명과 AI 피드백’에 내용')});
  if(l.reflection)add(null,'예상과 비교한 내 생각',one(l.reflection));
  for(const m of f.msgs){if(m?.role!=='learner')continue;const n=f.typed.find(x=>x.m===m)?.n;
   const status=m.status==='failed'?' · 답을 받지 못함':m.status==='noted'?' · 메모로만 남김':m.status==='pending'?' · 답을 기다리던 중':'';
   add(num(m.at),m.quick?`버튼: ${INTENT[m.intent]||'요청'}`:`내 메시지 #${n}`,one(m.text)+status)}
  for(const e of arr(l.events)){const t=Date.parse(e?.at);add(Number.isFinite(t)?t:null,'기록된 이벤트',esc(String(e?.type||e?.kind||e?.name||'이벤트')))}
  timed.sort((a,b)=>a.at-b.at||a.k-b.k);return {timed,untimed}}

 /** A read-only view for the readable sections: list entries that are not objects (only possible in a hand-edited
     backup) are left out and counted, never guessed at. The JSON appendix always holds the record exactly. */
 function view(src){const skipped={},v={...src};
  for(const [k,ok] of [['dialogue',m=>m&&typeof m==='object'],['drafts',x=>x&&typeof x==='object'&&typeof x.text==='string'],['scenarios',x=>x&&typeof x==='object'&&Number.isInteger(x.i)],['events',e=>e&&typeof e==='object']]){
   if(!Array.isArray(src[k]))continue;const keep=src[k].filter(ok);if(keep.length!==src[k].length){skipped[k]=src[k].length-keep.length;v[k]=keep}}
  return {l:v,skipped}}
 const SKIP={dialogue:'대화',drafts:'설명',scenarios:'사고 실험 응답',events:'이벤트'};

 /** The archive as Markdown. Deterministic: depends only on the record. */
 function markdown(src){
  if(!src||typeof src!=='object')throw Error('기록이 없어요.');
  const {l,skipped}=view(src);
  const f=facts(l),{d,typed,buttons,drafts,scen,note}=f,o=[],idn=CP?CP.identity(l):{title:d.title||l.topic||'학습',question:l.topic};
  const json=recordJson(src),hash=sha256(json),mat=l.material&&typeof l.material==='object'?l.material:null;
  const gen=[l.generatedBy?.provider,l.generatedBy?.model].filter(Boolean).join(' · ');
  const fbOf=x=>T?T.validFeedback(l,x):null,answered=x=>!!(T&&T.replyOf(l,x.m));

  o.push(`# ${esc(idn.title||'학습')} — 학습 과정 기록`,
   '_이 문서는 이 탐험의 기록에서 그대로 만들었어요. AI가 요약하거나 해석하지 않았어요. 내가 쓴 글은 쓴 그대로 옮겼고, AI가 쓴 내용은 따로 표시했어요. 이해나 실력을 판정하지 않아요._',
   '_내가 쓴 생각과 AI와 나눈 대화 전체가 들어 있어요. 다른 사람과 나누기 전에 내용을 확인해 주세요._');

  // 기록 정보
  const kinds=[`직접 쓴 메시지 ${typed.length}개`,`버튼 요청 ${buttons.length}개`,`사고 실험 응답 ${scen.length}개`,`내 설명 ${drafts.length}개`];
  o.push('## 기록 정보',[
   `- **처음 궁금했던 것**: ${idn.question?esc(idn.question):mat?'_질문 없이 수업 자료에서 시작했어요._':'_기록 없음_'}`,
   `- **기간**: ${f.start!==null?`${when(f.start)} ~ ${when(f.end)} (${tz(f.start)}, 기록된 활동 사이 ${dur(f.end-f.start)})`:'_시각 기록 없음_'}`,
   `- **진행**: ${l.complete?'탐험 완료':'진행 중'}${Number.isFinite(l.maxStage??l.stage)?` · ${l.maxStage??l.stage}단계까지`:''}`,
   `- **학습 자료와 AI 답변**: ${gen?`AI가 만든 내용이에요 (${esc(gen)}).`:'_만든 AI 기록 없음._'} 외부 자료로 확인한 내용이 아니에요.`,
   ...(mat?[`- **수업 자료**: ${esc(mat.name||'')} (${M?M.kindName(mat):''}, ${mat.pageCount??'?'}${mat.kind==='pptx'?'장':'쪽'}${arr(mat.unreadable).length&&M?`; 읽지 못한 곳 ${mat.unreadable.map(n=>M.label(mat,n)).join(', ')}`:''})`]:[]),
   `- **기록된 활동**: ${kinds.join(', ')}`,
   ...(Object.keys(skipped).length?[`- **읽지 못한 항목**: 형식이 맞지 않는 ${Object.entries(skipped).map(([k,n])=>`${SKIP[k]} ${n}개`).join(', ')}는 이 정리에서 빠졌어요. ‘9. 원본 데이터’의 JSON에는 그대로 있어요.`]:[]),
   ...(note?[`- **개념 노트**: ‘${esc(note.title)}’ (AI가 이 기록으로 정리한 노트${note.editedAt?', 그 뒤 내가 고침':''})`]:[]),
   `- **원본**: 기록 ID \`${String(l.id||'').replace(/`/g,'')}\` · SHA-256 \`${hash}\` (‘9. 원본 데이터’의 JSON과 같은 값이면 원본 그대로예요)`,
   `- **형식**: ${FORMAT} · 이 문서는 같은 기록이면 언제 내려받아도 같아요.`].join('\n'));

  // 1. 처음 질문과 처음 이해
  o.push('## 1. 처음 질문과 처음 이해');
  if(idn.question)o.push('**처음 궁금했던 것** _(내 글)_',quote(idn.question));
  if(d.prediction)o.push(`**예상해 볼 질문** _(AI가 낸 질문)_: ${esc(d.prediction)}`);
  o.push('**처음 예상** _(내 글)_',l.prediction?quote(l.prediction):l.predictionUnsure?'_“아직 잘 모르겠어요”라고 하고 넘어갔어요._':'_기록 없음._');
  const firstDraft=drafts.length?Math.min(...drafts.map(x=>num(x.at)??Infinity)):Infinity;
  const early=buttons.filter(m=>m.ref?.kind==='term'&&num(m.at)!==null&&m.at<firstDraft);
  if(early.length)o.push(`**설명을 쓰기 전에 뜻을 물어본 용어**: ${early.map(m=>`‘${esc(m.ref.term)}’ (${when(m.at)})`).join(', ')}`);

  // 2. 학습 활동의 순서
  const tl=timeline(l,f);o.push('## 2. 학습 활동의 순서','_시각이 기록된 내 활동을 순서대로 모았어요. 메시지는 한 줄로 줄였고, 전체 글은 ‘8. 원래 학습 기록 전체’에 있어요._');
  if(tl.timed.length)o.push(['| 시각 | 한 일 | 내용 |','| --- | --- | --- |',...tl.timed.map(x=>`| ${when(x.at)} | ${x.what} | ${x.text||' '} |`)].join('\n'));
  else o.push('_시각이 기록된 활동이 없어요._');
  if(tl.untimed.length)o.push('**시각이 남지 않은 기록** _(순서를 알 수 없어 표에 넣지 않았어요)_',tl.untimed.map(x=>`- ${x.what}${x.text?': '+x.text:''}`).join('\n'));

  // 3. 질문과 막힌 곳
  o.push('## 3. 질문과 막힌 곳');
  const stat=m=>{const msg=m.m;return answered(m)?'답을 받음':msg?.status==='noted'?'메모로만 남김':msg?.status==='failed'?'답을 받지 못함':'답 기록 없음'};
  o.push('**내가 직접 쓴 메시지** _(내 글, 쓴 순서대로)_',typed.length?typed.map(m=>`- #${m.n} ${one(m.text)} — ${stat(m)}`).join('\n'):'_직접 쓴 메시지가 없어요._');
  if(buttons.length){const by={};for(const m of buttons){const k=INTENT[m.intent]||'기타 요청';by[k]=(by[k]||0)+1}
   o.push(`**버튼으로 한 요청**: ${Object.entries(by).map(([k,v])=>`${k} ${v}번`).join(', ')}`)}
  const stuck=[...drafts.map((x,i)=>({t:x.text,w:`설명 ${i+1}`})),...typed.map(m=>({t:m.text,w:`내 메시지 #${m.n}`}))].filter(x=>STUCK.test(x.t));
  if(stuck.length)o.push('**이해하지 못했다고 쓴 곳** _(‘모르겠’, ‘이해 못’ 같은 표현을 기준으로 자동으로 찾았어요. 빠지거나 잘못 찾은 곳이 있을 수 있어요)_',
   stuck.map(x=>{const s=String(x.t).replace(/\s+/g,' ').split(/(?<=[.?!])\s+/).filter(y=>STUCK.test(y));return `- ${x.w}: “${esc(s.join(' '))}”`}).join('\n'));

  // 4. 시도, 예상, 선택
  o.push('## 4. 시도, 예상, 선택');
  if(scen.length){o.push('**사고 실험에서 고른 답** _(사고 실험과 해설은 AI가 만든 가상 상황이에요)_',scen.map(r=>{const sc=d.scenarios?.[r.i];
   const mine=r.unsure||r.choice==null?'_잘 모르겠다고 함_':esc(sc?.options?.[r.choice]??'(선택지 기록 없음)');
   return `- 사고 실험 ${r.i+1}${sc?.title?` · ${esc(sc.title)}`:''}${num(r.at)!==null?` (${when(r.at)})`:''}: 내 선택 — ${mine}${sc&&!(r.unsure||r.choice==null)?r.choice===sc.answerIndex?' · 해설과 같음':' · 해설과 다름':''}`}).join('\n'))}
  if(drafts.length)o.push(`**내 설명 ${drafts.length}개** — 원문은 피드백과 함께 ‘5. 내 설명과 AI 피드백’에 있어요.`);
  else o.push('_내 설명을 쓴 기록이 없어요._');
  if(l.reflection)o.push('**예상과 비교한 내 생각** _(내 글)_',quote(l.reflection));

  // 5. 내 설명과 AI 피드백 — each explanation with what is linked to it (chain()); the learner's words in full, AI parts labelled
  o.push('## 5. 내 설명과 AI 피드백','_설명마다 내가 쓴 글 → AI 피드백 → 피드백에 이어진 대화 → 다시 쓴 설명 순서예요. AI가 직접 쓴 수정 설명이 기록에 있을 때만 그것도 함께 실어요. AI가 쓴 부분은 참고 의견이고, 맞는지 확인된 판단이 아니에요._');
  const rounds=chain(l),clip=t=>{const x=one(t);return x.length>160?x.slice(0,160)+'…':x};
  if(!rounds.length)o.push('_내 설명을 쓴 기록이 없어요._');
  for(const r of rounds){
   o.push(`### 설명 ${r.n}${r.at!==null?` · ${when(r.at)}`:''}`,'**내가 작성한 설명** _(내 글)_',quote(r.text));
   if(r.feedback==='ok'){
    const meta=['AI',r.model&&esc(r.model),r.feedbackAt!==null&&when(r.feedbackAt),r.schema===1&&'이전 형식'].filter(Boolean).join(' · ');
    o.push(`**AI 피드백** _(${meta})_`,[`- 요약: ${esc(r.summary)}`,...r.items.map(y=>`- ${KIND[y.kind]} (AI 분류): ${y.quote?`“${esc(y.quote)}” — `:''}${esc(y.text)}${y.why?` · 왜: ${esc(y.why)}`:''}`),
     ...(r.items.length?[]:['- _세부 항목 없이 요약만 있어요 (분류 없음)._']),...(r.uncertainty?[`- AI가 판단하지 못한 점: ${esc(r.uncertainty)}`]:[])].join('\n'));
    if(r.revision)o.push('**AI가 제안한 수정 설명** _(AI가 쓴 글)_',quote(r.revision))}
   else o.push('**AI 피드백**',r.feedback==='error'?`_AI 피드백을 받지 못했어요: ${one(r.error)}_`:r.feedback==='invalid'?'_저장된 AI 피드백의 형식이 올바르지 않아 싣지 않았어요. 원본은 ‘9. 원본 데이터’의 JSON에 있어요._':'_AI 피드백 없음_');
   if(r.thread.length)o.push('**피드백에 이어진 대화** _(한 줄로 줄였어요. 전체 글은 ‘8. 원래 학습 기록 전체’에 있어요)_',r.thread.map(t=>[
    `- ${t.quick?`버튼: ${t.intent}`:`내 메시지${t.n?` #${t.n}`:''}`}${t.at!==null?` (${when(t.at)})`:''} · ${t.about}에 대해: ${one(t.text)}`,
    t.reply?`  - AI 튜터의 답 _(AI)_: ${clip(t.reply.text)}`:'  - _AI 튜터의 답이 기록되지 않았어요._'].join('\n')).join('\n'));
   if(r.next)o.push(`**다음에 쓴 설명**: 설명 ${r.next}${r.feedback!=='ok'?'':r.afterFeedback===true?' — 이 피드백을 받은 뒤에 썼어요. 피드백을 반영했는지는 기록으로 알 수 없어요.':r.afterFeedback===false?' — 이 피드백이 오기 전에 썼어요.':' — 이 피드백과의 순서는 기록으로 알 수 없어요.'}`)}
  const lost=unlinked(l);
  if(lost.length)o.push(`**어느 설명의 피드백에 대한 대화인지 확인할 수 없는 기록** _(${lost.length}개 · 한 줄로 줄였어요. 전체 글은 ‘8. 원래 학습 기록 전체’에 있어요)_`,lost.map(t=>[
   `- ${t.quick?`버튼: ${t.intent}`:`내 메시지${t.n?` #${t.n}`:''}`}${t.at!==null?` (${when(t.at)})`:''} · ${t.about}: ${one(t.text)}`,
   t.reply?`  - AI 튜터의 답 _(AI)_: ${clip(t.reply.text)}`:'  - _AI 튜터의 답이 기록되지 않았어요._'].join('\n')).join('\n'));
  const judged=dlg(l).filter(m=>m?.role==='tutor'&&m.assessment&&T&&T.opinionText(m.assessment));
  if(judged.length)o.push(`**튜터가 내 메시지에 남긴 의견**: ${judged.length}개 (내용은 ‘8. 원래 학습 기록 전체’의 대화에 있어요)`);
  if(note?.corrections?.length)o.push('**대화 중에 바로잡혔다고 AI가 정리한 설명** _(개념 노트를 만든 AI의 정리예요. 사실을 바로잡은 것인지 표현을 다듬은 것인지는 따로 확인되지 않았어요. 원래 대화는 ‘8. 원래 학습 기록 전체’에 있어요)_',note.corrections.map(c=>`- ${esc(c.text)}`).join('\n'));
  if(note?.conflicts?.length)o.push('**정리되지 않은 설명 차이** _(AI 정리)_',note.conflicts.map(c=>`- ${esc(c.text)}`).join('\n'));

  // 6. 기록으로 보이는 학습 과정
  o.push('## 6. 기록으로 보이는 학습 과정','_기록끼리 이어 놓은 사실이에요. 해석이나 평가는 넣지 않았어요._');
  const obs=[];
  if(typed.length)obs.push(`- 직접 쓴 메시지 ${typed.length}개 중 튜터의 답이 기록된 것은 ${typed.filter(answered).length}개예요.`);
  drafts.forEach((x,i)=>{const after=typed.filter(m=>m.m.ref?.kind==='feedback'&&m.m.ref.draftAt===x.at);
   if(after.length){const ts=after.map(m=>m.m.at).filter(Number.isFinite);
    obs.push(`- 설명 ${i+1}의 AI 피드백 항목에서 이어서 쓴 메시지가 ${after.length}개 있어요 (#${after.map(m=>m.n).join(', #')}${ts.length?`, ${when(Math.min(...ts))} ~ ${when(Math.max(...ts))}`:''}).`)}});
  if(scen.length){const same=scen.filter(r=>{const sc=d.scenarios?.[r.i];return sc&&!(r.unsure||r.choice==null)&&r.choice===sc.answerIndex}).length,unsure=scen.filter(r=>r.unsure||r.choice==null).length;
   obs.push(`- 사고 실험 ${scen.length}개 중 해설과 같은 선택이 ${same}개${unsure?`, 잘 모르겠다고 한 것이 ${unsure}개`:''}예요.`)}
  if(drafts.length>=2)obs.push(`- 설명을 ${drafts.length}번 썼어요. 무엇이 달라졌는지는 ‘5. 내 설명과 AI 피드백’에서 글을 직접 비교해 보세요. 이 문서는 변화를 판정하지 않아요.`);
  else if(drafts.length===1)obs.push('- 고쳐 쓴 설명이 없어서, 이해가 달라졌는지는 이 기록만으로 알 수 없어요.');
  else obs.push('- 내 설명이 없어서, 생각의 변화를 기록으로 볼 수는 없어요.');
  if(l.prediction&&l.reflection)obs.push('- 처음 예상과 ‘예상과 비교한 내 생각’이 모두 남아 있어요 (‘1’과 ‘4’에 원문).');
  o.push(obs.join('\n'));
  const asks=note?note.sections.filter(s=>arr(s.asks).length):[];
  if(asks.length){o.push('**개념 노트에서 내 메시지를 다룬 곳** _(AI가 정리하며 표시한 연결이에요. 직접 확인된 대응이 아니에요)_',
   ['| 내 메시지 | 시각 | 원문 | 다룬 섹션 (AI 표시) |','| --- | --- | --- | --- |',...typed.map(m=>{const s=note.sections.filter(x=>arr(x.asks).includes(m.n)).map(x=>`‘${esc(x.heading)}’`).join(', ');
    return `| #${m.n} | ${Number.isFinite(m.m.at)?when(m.m.at):'(시각 기록 없음)'} | ${cell(m.text)} | ${s||'_표시 없음_'} |`})].join('\n'))}
  o.push('**나중에 직접 채워 볼 칸**','- 처음에 무엇이 가장 막혔나요?\n- 어떤 질문이나 시도가 도움이 됐나요?\n- 지금 다시 설명한다면 무엇을 다르게 말할까요?');

  // 7. 아직 풀리지 않은 질문
  o.push('## 7. 아직 풀리지 않은 질문');
  const un=typed.filter(m=>!answered(m)),aq=N.aiQuestions(l).filter(x=>x.status!=='answered'),open=arr(note?.open);
  if(un.length)o.push('**답을 받지 못한 내 메시지** _(내 글)_',un.map(m=>`- #${m.n} ${one(m.text)}`).join('\n'));
  if(aq.length)o.push('**AI가 던졌지만 답한 기록이 없는 질문** _(AI가 쓴 질문)_',aq.map(x=>`- ${esc(x.question)}${x.status==='continued'?' _(대화는 이어 갔지만 답했다는 기록은 없어요)_':''}`).join('\n'));
  if(open.length)o.push('**개념 노트가 남은 질문으로 정리한 것** _(AI 정리)_',open.map(x=>`- ${x.n?`#${x.n} `:''}${esc(x.text||x.why||'')}`).join('\n'));
  if(!un.length&&!aq.length&&!open.length)o.push('_이 목록에 따로 모은 질문이 없어요. 설명에 적은 질문은 설명 원문에서 볼 수 있어요._');

  // 8. 원래 학습 기록 전체
  o.push('## 8. 원래 학습 기록 전체','_CURIVEN의 기존 학습 노트 내보내기 형식 그대로예요. 학습 자료, 해설, 피드백, 튜터 답변은 AI가 만든 내용이에요._');
  if(d.hook||d.story)o.push('### 처음 받은 이야기 (AI 생성)',[d.hook?`**${esc(d.hook)}**`:'',d.story?esc(d.story):''].filter(Boolean).join('\n\n'));
  o.push(N.lessonMarkdown(l,{now:num(l.updatedAt)??f.end??0,shift:2}).replace(/\n+$/,''));

  // 9. 원본 데이터
  o.push('## 9. 원본 데이터 (JSON)',`_이 탐험의 기록 그대로예요. 백업 파일(curiven-learning-backup.json)의 \`lessons\` 항목 하나와 같은 형식이에요. SHA-256 \`${hash}\`._`,fence(json,'json'));
  return o.join('\n\n')+'\n'}

 /** Download name: topic + date of the record's last change (so it does not depend on when it is downloaded). */
 function fileName(l){const idn=CP?CP.identity(l):{question:l?.topic};const t=String(idn.question||idn.title||l?.topic||'learning').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').trim().replace(/\s+/g,'-').slice(0,40)||'learning';
  const ms=num(l?.updatedAt)??num(l?.createdAt);const d=ms!==null?new Date(ms):null;const p=n=>String(n).padStart(2,'0');
  return `curiven-journey-${t}${d?`-${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`:''}.md`}

 const api={FORMAT,KIND,markdown,fileName,sha256,recordJson,chain,unlinked,timeline:l=>timeline(l,facts(l))};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriJourney=api;
})(typeof window!=='undefined'?window:globalThis);
