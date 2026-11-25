/* CURIVEN lesson-scoped tutoring and beginner scaffolding — pure helpers shared by the browser and Node tests.

   Dialogue record: a lesson may carry one optional, additive `dialogue` array. Each entry is either
     learner: {id, role:'learner', text, intent, ref, stage, at, status:'pending'|'answered'|'failed'|'noted', error?, inReplyTo?}
     tutor:   {id, role:'tutor', replyTo, text, followUp, assessment, uncertainty, withheld, reviewer, at}
   Learner text is stored exactly as typed. `ref` says what the message is about:
     null (general) | {kind:'term', term} | {kind:'scenario', i} | {kind:'feedback', draftAt, type, index}
   Feedback-item conversations are separate threads; everything else is one lesson conversation.
   Nothing here changes achievement state: AI agreement never marks a concept as learned.

   Scaffolding: optional lesson fields (prerequisites, technical plain/example/steps/misread/conditions,
   scenario hint) are sanitised here for lessons imported by hand; a glossary is built from prerequisites
   and concepts, and `termsIn` finds glossary terms that appear in a piece of lesson text. */
'use strict';
(function(root){
 const L=root.CuriLearning||(typeof require==='function'?require('./learning.js'):null);
 const M=root.CuriMaterial||(typeof require==='function'?require('./material.js'):null);
 const MAX_MESSAGE=2000,MAX_MESSAGES=400,HISTORY=12;
 const s=v=>typeof v==='string'&&v.trim()?v.trim():null;

 /** Button labels; quick intents can be sent without typing (the label becomes the learner's message). */
 // Two explicit actions in one composer: 'ask' (질문하기 — answered, never graded) and 'check' (내 이해 확인받기 — the
 // learner's own statement compared with evidence). 'reply' answers a feedback item or a tutor question.
 const INTENTS={
  ask:{label:'질문하기',needsText:true},
  meaning:{label:'이게 무슨 뜻이야?',needsText:false},
  simpler:{label:'더 쉽게 설명해 줘',needsText:false},
  example:{label:'예시 보여 줘',needsText:false},
  hint:{label:'힌트만 줘',needsText:false},
  direct:{label:'바로 설명해 줘',needsText:false},
  another:{label:'다르게 설명해 줘',needsText:false},
  unsure:{label:'잘 모르겠어요',needsText:false},
  check:{label:'내 이해 확인받기',needsText:true},
  reply:{label:'답 보내기',needsText:true}};
 const VERDICT_TEXT={correct:'정확한 이해',imprecise:'대체로 맞지만 표현·조건 보완 필요',misconception:'사실과 어긋난 이해',assumption:'질문에 담긴 전제를 함께 확인했어요',unclear:'판단 보류'};
 const VERDICTS=Object.keys(VERDICT_TEXT);
 /** The one learner-facing name for the prerequisite-terms feature (story stage and thought experiments alike). */
 const prereqLabel=n=>`먼저 알아볼 개념 ${n}개`;

 /* ---------- scaffolding ---------- */
 /** Sanitises the optional beginner-first fields in place (mirrors server.py validate_lesson). Old lessons pass unchanged. */
 function normalizeExtras(v){
  const pre=Array.isArray(v.prerequisites)?v.prerequisites:[];
  v.prerequisites=pre.filter(p=>p&&s(p.term)&&s(p.plain)).slice(0,5).map(p=>({term:s(p.term).slice(0,60),plain:s(p.plain).slice(0,400),...(s(p.example)?{example:s(p.example).slice(0,400)}:{})}));
  let visuals=0;
  for(const t of v.technical||[]){if(!t||typeof t!=='object')continue;
   for(const [k,n] of [['plain',600],['example',900],['misread',600],['conditions',600]]){if(s(t[k]))t[k]=s(t[k]).slice(0,n);else delete t[k]}
   const st=Array.isArray(t.steps)?t.steps.map(s).filter(Boolean).map(x=>x.slice(0,300)).slice(0,6):[];if(st.length)t.steps=st;else delete t.steps;
   const vis=visuals<2?cleanVisual(t.visual):null;if(vis){t.visual=vis;visuals++}else delete t.visual}
  for(const sc of v.scenarios||[]){if(sc&&typeof sc==='object'){if(s(sc.hint))sc.hint=s(sc.hint).slice(0,300);else delete sc.hint}}
  const rd=cleanReading(v.reading);if(rd.length)v.reading=rd;else delete v.reading;
  // Short constellation name (rules in copy.js cleanShort, mirrored by server.py clean_short_title; checked again at display).
  const C=root.CuriCopy||(typeof require==='function'?require('./copy.js'):null),st=C?C.cleanShort(v.shortTitle,null):null;if(st&&st!==s(v.title))v.shortTitle=st;else delete v.shortTitle;
  // Optional explanation-stage copy (mirrors server.py validate_lesson): plain text only.
  if(s(v.explainTitle))v.explainTitle=s(v.explainTitle).slice(0,40);else delete v.explainTitle;
  const es=Array.isArray(v.explainStarters)?v.explainStarters.map(s).filter(Boolean).map(x=>x.slice(0,60)).slice(0,3):[];if(es.length)v.explainStarters=es;else delete v.explainStarters;
  return v;
 }
 /** Constrained explanatory visual (mirrors server.py clean_visual): plain text in two fixed shapes, or null. */
 const RELATIONS=['sequence','cause','possible'];
 function cleanVisual(v){
  if(!v||typeof v!=='object'||!s(v.title))return null;
  const base={title:s(v.title).slice(0,80),...(s(v.note)?{note:s(v.note).slice(0,200)}:{})};
  if(v.type==='flow'){const steps=(Array.isArray(v.steps)?v.steps:[]).filter(x=>x&&typeof x==='object'&&s(x.label)).map(x=>({label:s(x.label).slice(0,40),...(s(x.detail)?{detail:s(x.detail).slice(0,160)}:{})}));
   if(steps.length<2||steps.length>6)return null;return {type:'flow',...base,relation:RELATIONS.includes(v.relation)?v.relation:'sequence',steps}}
  if(v.type==='compare'){const cols=(Array.isArray(v.columns)?v.columns:[]).map(s).filter(Boolean).map(x=>x.slice(0,30));if(cols.length<2||cols.length>3)return null;
   const rows=[];for(const r of Array.isArray(v.rows)?v.rows:[]){const vals=r&&typeof r==='object'?r.values:null;
    if(!s(r?.aspect)||!Array.isArray(vals)||vals.length!==cols.length||!vals.every(x=>s(x)))return null;rows.push({aspect:s(r.aspect).slice(0,40),values:vals.map(x=>s(x).slice(0,120))})}
   if(rows.length<2||rows.length>6)return null;return {type:'compare',...base,columns:cols,rows}}
  return null;
 }
 /** '더 알아보기' search suggestions (mirrors server.py clean_reading): what to check and a search query; no titles,
     authors, dates or URLs are accepted from the model, so none can be fabricated. */
 function cleanReading(items){const out=[];
  for(const r of Array.isArray(items)?items:[]){if(!r||typeof r!=='object'||!s(r.claim)||!s(r.query))continue;
   if(/(https?:|www\.|:\/\/)/i.test(r.query+r.claim+String(r.kind||'')))continue;
   out.push({claim:s(r.claim).slice(0,160),query:s(r.query).slice(0,120),...(s(r.kind)?{kind:s(r.kind).slice(0,60)}:{})});if(out.length>=4)break}
  return out}
 /** Where to look things up for this lesson, each with an explicit verification status. CURIVEN has no permitted
     live retrieval, so no source here is 'checked': the statuses that can occur on the normal route are
       'ai-suggested' – a search the AI proposed (what to check), not a citation;
       'app-search'   – a search the app built from the lesson's own concept names (lessons without suggestions).
     ('reviewed-pack' exists only in the development Boundary activity and is shown there with its review state.)
     Links are search pages, opened only when the learner clicks. */
 const SEARCH=[['학술 검색','https://scholar.google.com/scholar?q='],['웹 검색','https://www.google.com/search?q=']];
 function readingList(l){const d=l?.lesson||{},C=root.CuriCopy||(typeof require==='function'?require('./copy.js'):null),topic=String((C?C.identity(l).title:d.title||l?.topic)||'').slice(0,60); // never the file name
  const links=q=>SEARCH.map(([label,base])=>({label,url:base+encodeURIComponent(q)}));
  if(Array.isArray(d.reading)&&d.reading.length)return d.reading.map(r=>({claim:r.claim,kind:r.kind||null,query:r.query,status:'ai-suggested',links:links(r.query)}));
  return (d.concepts||[]).slice(0,4).map(c=>{const q=(c.name.length<4?`${c.name} ${topic}`:c.name).trim();/* a short name alone is ambiguous */return {claim:c.name,kind:null,query:q,status:'app-search',links:links(q)}});
 }
 const norm=x=>String(x||'').normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim();
 /** Terms the learner may need: prerequisites first (plain words), then lesson concepts. Same name kept once. */
 function glossary(lesson){
  const out=[],seen=new Set();
  for(const p of lesson?.prerequisites||[]){const k=norm(p.term);if(!k||seen.has(k))continue;seen.add(k);out.push({term:p.term,plain:p.plain,example:p.example||null,source:'prerequisite'})}
  for(const c of lesson?.concepts||[]){const k=norm(c.name);if(!k||seen.has(k))continue;seen.add(k);out.push({term:c.name,plain:c.description,example:null,source:'concept',id:c.id})}
  return out;
 }
 /** Glossary entries whose term (or the part before a parenthesis) appears in `text`. Exact substring only. */
 function termsIn(text,gloss){
  const t=norm(text);if(!t)return [];
  return gloss.filter(g=>{const full=norm(g.term),short=norm(g.term.split(/[(（]/)[0]);return (full.length>=2&&t.includes(full))||(short.length>=2&&t.includes(short))});
 }

 /* ---------- dialogue ---------- */
 // Feedback items and thought experiments each get their own thread; general and term questions share one.
 const isFeedbackRef=ref=>!!ref&&(ref.kind==='feedback'||ref.kind==='scenario');
 function refKey(ref){
  if(!ref)return 'general';
  if(ref.kind==='feedback')return `fb:${ref.draftAt}:${ref.type}:${ref.index}`;
  if(ref.kind==='scenario')return `sc:${ref.i}`;
  if(ref.kind==='term')return `term:${ref.term}`;
  if(ref.kind==='section')return `sec:${ref.i}`;
  if(ref.kind==='page')return `pg:${ref.n}`;
  return 'general';
 }
 function cleanRef(ref){
  if(!ref||typeof ref!=='object')return null;
  if(ref.kind==='feedback'&&Number.isFinite(ref.draftAt)&&['summary','precision','misconceptions','missing'].includes(ref.type)&&Number.isInteger(ref.index)&&ref.index>=0){
   // draftAt/type/index stay for older versions; fid/iid (stampFeedback ids) and `seen` (the item as the learner saw it)
   // are the durable evidence a later reader resolves with (resolveFeedback).
   const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(v)?v:null,fid=id(ref.fid),iid=ref.type==='summary'?null:id(ref.iid);
   const seen=ref.type!=='summary'&&ref.seen&&typeof ref.seen==='object'&&s(ref.seen.issue)?{issue:s(ref.seen.issue).slice(0,400),quote:s(ref.seen.quote)?s(ref.seen.quote).slice(0,300):null}:null;
   return {kind:'feedback',draftAt:ref.draftAt,type:ref.type,index:ref.index,...(fid?{fid}:{}),...(iid?{iid}:{}),...(seen?{seen}:{})}}
  if(ref.kind==='scenario'&&Number.isInteger(ref.i)&&ref.i>=0)return {kind:'scenario',i:ref.i};
  if(ref.kind==='term'&&s(ref.term))return {kind:'term',term:s(ref.term).slice(0,80)};
  if(ref.kind==='section'&&Number.isInteger(ref.i)&&ref.i>=0)return {kind:'section',i:ref.i};
  if(ref.kind==='page'&&Number.isInteger(ref.n)&&ref.n>0)return {kind:'page',n:ref.n};
  return null;
 }
 const dialogue=l=>Array.isArray(l?.dialogue)?l.dialogue:[];

 /* ---------- feedback references (2026-11-24) ----------
    A follow-up names a feedback item. Positions alone are not identity: feedback is re-validated with today's rules
    every time it is read, and a rule change can reorder, withhold or reclassify items, so a stored position may now
    point at a different critique. Every consumer (thread grouping, tutor context, explain stage, notes/Notion, the
    archive) resolves a reference here, once, the same way:
      1. the explanation: drafts with ref.draftAt (narrowed by the feedback id when the ref has one). None → unresolved;
         more than one (same timestamp) → ambiguous;
      2. the feedback: validated today; a ref naming another feedback id (the feedback was replaced) → unresolved;
      3. the item: by its id (new refs) → by `seen`, the item as the learner saw it (position and words agreeing, or
         one unique match) → for legacy refs with neither, only if the stored item and today's item at that position
         are the same words (both readings agree). Anything else is ambiguous or unresolved — never a guess.
       Contradictions fail closed (2026-11-25 review): an id field that is present but not a valid id is unresolved
       (never treated as absent); an item found by id whose `seen` words disagree is ambiguous; a duplicated id is
       ambiguous.
       Limit (documented, not solvable from the record): a legacy reference resolves on word agreement between the
       feedback as STORED and as validated TODAY; the learner saw whatever the rules of the day of the reply produced,
       which, if a rule existed only in between, may have differed. Identical twin items are told apart only by ids.
    Result: {status:'resolved'|'ambiguous'|'unresolved', reason, draft, feedback, type, index, item}. */
 const ITEM_TYPES=['misconceptions','precision','missing'];
 const norm2=x=>({issue:typeof x?.issue==='string'?x.issue.trim().slice(0,400):null,quote:typeof x?.quote==='string'&&x.quote.trim()?x.quote.trim().slice(0,300):null});
 const sameItem=(a,b)=>{const x=norm2(a),y=norm2(b);return !!x.issue&&x.issue===y.issue&&x.quote===y.quote};
 function resolveFeedback(l,ref){
  const no=(status,reason,extra={})=>({status,reason,draft:null,feedback:null,type:null,index:null,item:null,...extra});
  if(!ref||ref.kind!=='feedback')return no('unresolved','not_feedback');
  const present=k=>ref[k]!==undefined&&ref[k]!==null,validId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{8,64}$/.test(v);
  if((present('fid')&&!validId(ref.fid))||(present('iid')&&!validId(ref.iid)))return no('unresolved','bad_identity');
  let ds=(Array.isArray(l?.drafts)?l.drafts:[]).filter(d=>d&&typeof d.text==='string'&&d.at===ref.draftAt);
  if(!ds.length)return no('unresolved','no_draft');
  if(ref.fid){const by=ds.filter(d=>d.feedback?.id===ref.fid);if(!by.length)return no('unresolved',ds.length>1?'same_time':'feedback_replaced',ds.length===1?{draft:ds[0]}:{});ds=by}
  if(ds.length>1)return no('ambiguous','same_time');
  const draft=ds[0],f=validFeedback(l,draft);if(!f)return no('unresolved','no_feedback',{draft});
  if(ref.type==='summary')return {status:'resolved',reason:null,draft,feedback:f,type:'summary',index:0,item:{issue:f.summary,question:''}};
  const at=(type,index)=>({status:'resolved',reason:null,draft,feedback:f,type,index,item:f[type][index]});
  const where=pred=>{const out=[];for(const t of ITEM_TYPES)f[t].forEach((x,i)=>{if(pred(x))out.push([t,i])});return out};
  if(ref.iid){const hit=where(x=>x.id===ref.iid);
   if(hit.length>1)return no('ambiguous','duplicate_id',{draft,feedback:f});if(!hit.length)return no('unresolved','item_gone',{draft,feedback:f});
   if(ref.seen&&!sameItem(f[hit[0][0]][hit[0][1]],ref.seen))return no('ambiguous','conflicting_evidence',{draft,feedback:f});
   return at(...hit[0])}
  if(ref.seen){if(f[ref.type]?.[ref.index]&&sameItem(f[ref.type][ref.index],ref.seen))return at(ref.type,ref.index);
   const hit=where(x=>sameItem(x,ref.seen));return hit.length===1?at(...hit[0]):no(hit.length?'ambiguous':'unresolved',hit.length?'duplicate_item':'item_gone',{draft,feedback:f})}
  const now=f[ref.type]?.[ref.index],then=draft.feedback?.[ref.type]?.[ref.index];
  if(now&&then&&sameItem(now,then))return at(ref.type,ref.index);
  return no(now||then?'ambiguous':'unresolved',now||then?'validator_changed':'item_gone',{draft,feedback:f});
 }
 /** A reference to an item AS SHOWN NOW (today's validated feedback): used when a follow-up is created and when a
     consumer asks for an item's thread. Carries the ids and the words, so it resolves to exactly this item. */
 function itemRef(l,draft,type,index){const f=validFeedback(l,draft),base={kind:'feedback',draftAt:draft.at,type,index};if(!f)return base;
  if(type==='summary')return {...base,...(f.id?{fid:f.id}:{})};const x=f[type]?.[index];if(!x)return base;
  return {...base,...(f.id?{fid:f.id}:{}),...(x.id?{iid:x.id}:{}),seen:norm2(x)}}
 // Two unresolved references belong to one conversation only if they carry exactly the same evidence: a reference
 // with words (`seen`) never joins one without, or with other words — so an unresolved thread can never pull another
 // conversation into the view or into the tutor's history (2026-11-25 review).
 const sameEvidence=(a,b)=>refKey(a)===refKey(b)&&(a.fid??null)===(b.fid??null)&&(a.iid??null)===(b.iid??null)&&JSON.stringify(a.seen?norm2(a.seen):null)===JSON.stringify(b.seen?norm2(b.seen):null);
 const sameTarget=(a,b)=>a.status==='resolved'&&b.status==='resolved'&&a.draft===b.draft&&a.type===b.type&&a.index===b.index;
 const withReplies=(l,learners)=>{const ids=new Set(learners.map(m=>m.id));return dialogue(l).filter(m=>m&&(ids.has(m.id)||(m.role==='tutor'&&ids.has(m.replyTo))))};
 /** Learner follow-ups on this explanation's feedback that do not resolve to one item (with their replies). */
 function unplaced(l,draft){return withReplies(l,dialogue(l).filter(m=>{if(m?.role!=='learner'||m.ref?.kind!=='feedback'||m.ref.draftAt!==draft.at)return false;const r=resolveFeedback(l,m.ref);return r.status!=='resolved'&&r.draft===draft}))}
 /** Follow-ups whose explanation itself cannot be determined (no explanation with that time, or several): listed once. */
 function unlinked(l){return withReplies(l,dialogue(l).filter(m=>m?.role==='learner'&&m.ref?.kind==='feedback'&&!resolveFeedback(l,m.ref).draft))}
 /** The conversation a message belongs to: one thread per feedback item (by resolved identity, see resolveFeedback),
     otherwise the lesson conversation. A feedback reference that does not resolve keeps only the messages with the
     very same reference, attached to no item. */
 function stream(l,ref){
  if(ref?.kind==='feedback'){const target=resolveFeedback(l,ref);
   const mine=dialogue(l).filter(m=>m?.role==='learner'&&m.ref?.kind==='feedback'&&(target.status==='resolved'?sameTarget(resolveFeedback(l,m.ref),target):resolveFeedback(l,m.ref).status!=='resolved'&&sameEvidence(m.ref,ref)));
   return withReplies(l,mine)}
  const k=refKey(ref);
  return dialogue(l).filter(m=>{const r=m.role==='tutor'?(dialogue(l).find(x=>x.id===m.replyTo)?.ref??null):m.ref;
   return isFeedbackRef(ref)?refKey(r)===k:!isFeedbackRef(r)});
 }
 const uid=()=>(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():'m-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);

 /** Adds a learner message, exactly as typed. Quick intents without text use their label as the message.
     `noted` = saved as the learner's own question without asking the AI. */
 function addLearner(l,{text,intent='ask',ref=null,stage=null,inReplyTo=null,noted=false,quickText=null},now=Date.now(),id=uid()){
  if(!INTENTS[intent])return {ok:false,reason:'intent'};
  const typed=typeof text==='string'&&text.trim()?text:null;
  if(!typed&&INTENTS[intent].needsText)return {ok:false,reason:'empty'};
  const body=typed??(typeof quickText==='string'&&quickText.trim()?quickText:INTENTS[intent].label);
  if(body.length>MAX_MESSAGE)return {ok:false,reason:'long'};
  if(!Array.isArray(l.dialogue))l.dialogue=[];
  if(l.dialogue.length>=MAX_MESSAGES)return {ok:false,reason:'full'};
  const m={id,role:'learner',text:body,intent,ref:cleanRef(ref),stage:Number.isInteger(stage)?stage:null,at:now,status:noted?'noted':'pending',...(typed?{}:{quick:true}),...(inReplyTo?{inReplyTo}:{})};
  l.dialogue.push(m);return {ok:true,msg:m};
 }
 /** Earlier turns of the same conversation (answered learner messages and tutor replies), oldest first. */
 function history(l,msg){
  const all=stream(l,msg.ref),idx=all.findIndex(m=>m.id===msg.id),before=(idx<0?all:all.slice(0,idx));
  return before.filter(m=>m.role==='tutor'||m.status==='answered').slice(-HISTORY)
   .map(m=>({role:m.role,text:m.role==='tutor'&&m.followUp?`${m.text}\n(튜터의 질문) ${m.followUp}`:m.text}));
 }
 /** What the learner is looking at, resolved from the message's ref at send time. */
 function focusFor(l,ref){
  const d=l.lesson;if(!ref||!d)return null;
  if(ref.kind==='term'){const g=glossary(d).find(x=>norm(x.term)===norm(ref.term));return {kind:'term',term:ref.term,description:g?.plain||''}}
  if(ref.kind==='scenario'){const sc=d.scenarios?.[ref.i];if(!sc)return null;const rec=(l.scenarios||[]).find(x=>x.i===ref.i);
   return {kind:'scenario',question:sc.question,options:sc.options,answered:!!rec,...(rec?{reason:sc.reason}:{})}}
  if(ref.kind==='section'){const t=d.technical?.[ref.i];return t?{kind:'section',heading:t.heading,text:[t.plain,t.text].filter(Boolean).join('\n')}:null}
  if(ref.kind==='page'&&l.material&&M)return {kind:'page',n:ref.n,label:M.label(l.material,ref.n)};
  // Only a reference that resolves to one item gives the tutor that item; otherwise no feedback item is sent at all.
  if(ref.kind==='feedback'){const r=resolveFeedback(l,ref);if(r.status!=='resolved')return null;
   const it=r.type==='summary'?{issue:r.feedback.summary,question:''}:{quote:r.item.quote||'',issue:r.item.issue,why:r.item.why||'',question:r.item.question};
   return {kind:'feedback',type:r.type,draft:r.draft.text,...it}}
  return null;
 }
 // Validated once per stored feedback object and inputs (resolveFeedback runs for every follow-up on every render).
 const VF=typeof WeakMap==='function'?new WeakMap():null;
 function validFeedback(l,draft){if(!draft?.feedback||!L)return null;const ids=(l.lesson?.concepts||[]).map(c=>c.id),key=JSON.stringify([draft.text,ids]);
  const hit=VF&&typeof draft.feedback==='object'?VF.get(draft.feedback):null;if(hit&&hit.key===key)return hit.value;
  let value;try{value=L.validateFeedback(draft.feedback,ids,draft.text)}catch{value=null}
  if(VF&&typeof draft.feedback==='object')VF.set(draft.feedback,{key,value});return value}
 function feedbackItem(l,draft,ref){const r=resolveFeedback(l,{...ref,draftAt:draft.at});if(r.status!=='resolved'||r.draft!==draft)return null;
  if(r.type==='summary')return {issue:r.feedback.summary,question:''};
  return {quote:r.item.quote||'',issue:r.item.issue,why:r.item.why||'',question:r.item.question}}
 /** Request body for /api/ai mode 'tutor'. Only lesson material, this conversation and the new message. */
 function payload(l,msg,profile){
  const d=l.lesson||{};
  return {mode:'tutor',message:msg.text,intent:msg.intent,stage:Number.isInteger(msg.stage)?msg.stage:l.stage,
   lesson:{title:(root.CuriCopy||(typeof require==='function'?require('./copy.js'):null))?.identity(l).title||d.title||l.topic,prerequisites:(d.prerequisites||[]).map(p=>({term:p.term,plain:p.plain})),concepts:(d.concepts||[]).map(c=>({name:c.name,description:c.description})),
    technical:(d.technical||[]).map(t=>({heading:t.heading,text:t.text})),limitations:d.limitations||''},
   context:L?L.learningContext(l):null,focus:focusFor(l,msg.ref),history:history(l,msg),...(profile?{profile}:{}),
   // A lesson made from class material: the page asked about, the pages cited where the learner is, then keyword matches.
   ...(l.material&&M?{material:M.tutorPayload(l.material,msg.text,{page:msg.ref?.kind==='page'?msg.ref.n:null,cited:msg.ref?.kind==='section'?(d.technical?.[msg.ref.i]?.sources||[]).map(x=>x.page):[]})}:{})};
 }
 /** Client-side re-check of the server's tutor reply (same rules as server.py review_tutor). Throws on bad structure. */
 /** Client-side re-check of the server's tutor reply (same rules as server.py review_tutor, including the
     utterance guard). Idempotent on already-checked replies. Throws on bad structure. */
 function validateReply(d,learnerText,intent='ask'){
  if(!d||typeof d!=='object'||Array.isArray(d))throw Error('튜터 응답 형식이 올바르지 않아요.');
  const reply=s(d.reply);if(!reply)throw Error('튜터 응답이 비어 있어요.');
  for(const k of ['followUp','uncertainty'])if(d[k]!=null&&typeof d[k]!=='string')throw Error(`튜터 응답 ${k} 형식이 올바르지 않아요.`);
  const textOnly=d.format==='text-only';
  let assessment=null,withheld=0;const a=textOnly?null:d.assessment; // a text-only (format-slip) reply never carries a judgement
  if(a!=null){if(typeof a!=='object'||!VERDICTS.includes(a.verdict))throw Error('튜터 응답 assessment 형식이 올바르지 않아요.');
   const q=s(a.quote);
   if((['imprecise','misconception','assumption'].includes(a.verdict)&&!q)||(q&&!(L&&L.quoteFound(q,learnerText))))withheld=1;
   else{const kind=q?L.quoteKind(q,learnerText):L.utteranceKind(learnerText),v=L.guardVerdict(a.verdict,kind,intent);
    if(v){assessment={verdict:v,quote:q?q.slice(0,300):null,note:(s(a.note)||'').slice(0,400),utterance:kind};
     const from=VERDICTS.includes(a.adjustedFrom)?a.adjustedFrom:v!==a.verdict?a.verdict:null;if(from&&from!==v)assessment.adjustedFrom=from}}}
  const unc=(d.uncertainty||'').trim(); // withheld / capped / dropped judgements are recorded below, not narrated
  const dropped=VERDICTS.includes(d.assessmentDropped)?d.assessmentDropped:a!=null&&!assessment&&!withheld?a.verdict:null;
  return {...(Array.isArray(d.sources)?{sources:d.sources.slice(0,6)}:{}),reply:reply.slice(0,3000),followUp:textOnly?'':(d.followUp||'').trim().slice(0,300),assessment,uncertainty:unc.slice(0,600),withheld:Math.max(withheld,d.withheld?1:0),
   ...(dropped?{assessmentDropped:dropped}:{}),...(['recovered','text-only'].includes(d.format)?{format:d.format}:{})};
 }
 /** Short learner-facing wording of an AI opinion in the conversation, or null when none is shown. A judgement is
     shown only on something the learner asserted (a claim, explanation, hedged idea or answer): never on a
     question, a confirmation question, a premise check or an undecided case. The full assessment stays in the record. */
 const OPINION={correct:'AI 의견: 맞게 이해했어요',imprecise:'AI 의견: 대체로 맞아요 · 다듬을 점이 있어요',misconception:'AI 의견: 사실과 다른 부분이 있어요'};
 function opinionText(a){if(!a||!OPINION[a.verdict]||['question','check'].includes(a.utterance))return null;return OPINION[a.verdict]}
 function attachReply(l,learnerId,reply,reviewer,now=Date.now(),id=uid()){
  const m=dialogue(l).find(x=>x.id===learnerId&&x.role==='learner');if(!m)return null;
  m.status='answered';delete m.error;
  const t={id,role:'tutor',replyTo:learnerId,text:reply.reply,followUp:reply.followUp,assessment:reply.assessment,uncertainty:reply.uncertainty,withheld:reply.withheld,...(reply.format?{format:reply.format}:{}),...(reply.assessmentDropped?{assessmentDropped:reply.assessmentDropped}:{}),...(l.material&&M?{sources:M.verify(reply.sources,l.material)}:{}),
   reviewer:{provider:String(reviewer?.provider||''),model:String(reviewer?.model||''),at:now},at:now};
  // Keep the reply directly after its question even if other messages were added meanwhile.
  const i=l.dialogue.indexOf(m);let j=i+1;while(j<l.dialogue.length&&l.dialogue[j].role==='tutor')j++;l.dialogue.splice(j,0,t);return t;
 }
 function markFailed(l,learnerId,error,cancelled=false){const m=dialogue(l).find(x=>x.id===learnerId);if(!m)return;m.status='failed';m.error=String(error||'').slice(0,300);if(cancelled)m.cancelled=true;else delete m.cancelled}
 /** Display state; a 'pending' message with no request in flight was interrupted (page closed, tab lost the lock). */
 const state=(m,inFlight)=>m.status==='pending'&&!inFlight?'interrupted':m.status;
 const replyOf=(l,m)=>dialogue(l).find(x=>x.role==='tutor'&&x.replyTo===m.id)||null;

 const api={INTENTS,VERDICT_TEXT,prereqLabel,opinionText,MAX_MESSAGE,MAX_MESSAGES,normalizeExtras,cleanVisual,cleanReading,readingList,glossary,termsIn,refKey,cleanRef,stream,addLearner,history,focusFor,payload,validateReply,attachReply,markFailed,state,replyOf,validFeedback,resolveFeedback,itemRef,unplaced,unlinked};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriTutor=api;
})(typeof window!=='undefined'?window:globalThis);
