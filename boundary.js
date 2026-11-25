/* CURIVEN boundary activity — topic-independent evidence contract (shared by the browser and Node tests).
   A lesson record may carry one optional, additive `boundary` object. It holds:
     pack       – provenance and the server's fail-closed gate result at the time it was attached
     content    – a snapshot of the learner-facing material (situations, prompt, keyed checks)
     predictions/explanation/answers/skipped – the learner's own actions, exact text and timestamps
   Nothing here is domain-specific: no HTTP/cookie fields, no state vocabularies. Records without
   `boundary` are untouched; older CURIVEN versions ignore the field.

   Evidence tiers (highest reached is shown; none claims mastery or permanent knowledge):
     encountered – the activity was opened (the two concepts were presented together)
     explored    – a prediction was recorded for every situation before its outcome was shown
     explained   – the learner submitted their own written account of the difference (not judged correct)
     keyed       – every keyed check answered correctly AND the pack is eligible to award (reviewed, gate
                   allows it). A draft pack can never reach this tier; it can at most show a labelled preview. */
'use strict';
(function(root){
 const CONTRACT=1,MIN_PREDICTION=3,MIN_EXPLANATION=12,MAX_TEXT=2000;
 const PARTS=['situations','explanation','checks'];
 const str=v=>typeof v==='string'?v:'';
 const meaningful=(s,n)=>typeof s==='string'&&s.trim().length>=n;

 /** Strict structural check of the server's activity (see pilot_packs.py). Throws on anything unexpected. */
 function validateActivity(a){
  const bad=m=>{throw Error('참고 자료 형식이 올바르지 않아요'+(m?` (${m})`:''))};
  if(!a||a.format!=='curiven-boundary-activity'||a.contract!==CONTRACT)bad('format');
  const p=a.pack;if(!p||typeof p.id!=='string'||!['draft-preview','reviewed'].includes(p.mode)||!p.gate||typeof p.gate!=='object')bad('pack');
  if(!Array.isArray(p.gate.awardable)||typeof p.gate.mayAward!=='boolean')bad('gate');
  if(!Array.isArray(a.concepts)||a.concepts.length!==2||!a.concepts.every(c=>c&&typeof c.id==='string'&&typeof c.name==='string'))bad('concepts');
  if(!Array.isArray(a.situations)||a.situations.length<2||!a.situations.every(s=>s&&s.id&&s.title&&s.setup&&s.outcome))bad('situations');
  if(!a.prompt||typeof a.prompt.text!=='string'||!a.prompt.text)bad('prompt');
  if(!Array.isArray(a.checks)||!a.checks.every(q=>q&&q.id&&q.stem&&Array.isArray(q.options)&&q.options.length>=2&&q.options.some(o=>o.id===q.answer)&&q.rationale))bad('checks');
  return a;
 }

 /** New `boundary` record from a validated activity. Option order is shuffled once and stored, so the
     answer is not always in the same position; answers are recorded by option id, never by position. */
 function attach(activity,now=Date.now(),rand=Math.random){
  const a=validateActivity(activity),p=a.pack;
  const shuffle=list=>{const o=list.slice();for(let i=o.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[o[i],o[j]]=[o[j],o[i]]}return o};
  return {contract:CONTRACT,startedAt:now,
   pack:{id:p.id,version:p.version??null,draftRevision:p.draftRevision??null,title:str(p.title),mode:p.mode,
    gate:{reviewStatus:str(p.gate.reviewStatus),coreEligible:p.gate.coreEligible===true,mayAward:p.gate.mayAward===true,awardable:p.gate.awardable.filter(x=>typeof x==='string')}},
   content:{assessmentLabel:str(a.assessmentLabel),concepts:a.concepts.map(c=>({id:c.id,name:c.name,aliases:Array.isArray(c.aliases)?c.aliases.slice(0,12):[]})),
    relationship:a.relationship?{id:a.relationship.id,summary:str(a.relationship.summary)}:null,
    situations:a.situations.map(s=>({id:s.id,title:s.title,setup:s.setup,outcome:s.outcome})),
    prompt:{id:a.prompt.id,text:a.prompt.text,expectedElements:(a.prompt.expectedElements||[]).map(str)},
    checks:a.checks.map(q=>({id:q.id,stem:q.stem,options:shuffle(q.options.map(o=>({id:o.id,text:o.text}))),answer:q.answer,rationale:q.rationale,
     assumptions:(q.assumptions||[]).map(x=>({id:x.id,text:x.text}))}))},
   predictions:[],explanation:null,answers:[],skipped:{}};
 }

 const usable=b=>!!(b&&typeof b==='object'&&b.contract===CONTRACT&&b.content&&Array.isArray(b.content.situations)&&Array.isArray(b.content.checks)&&Array.isArray(b.content.concepts)&&b.content.prompt&&b.pack&&Array.isArray(b.predictions)&&Array.isArray(b.answers)&&b.skipped&&typeof b.skipped==='object');

 /** Exact learner text is stored as typed (no trimming); too-short or too-long input is refused. */
 function recordPrediction(b,situationId,text,now=Date.now()){
  if(!b.content.situations.some(s=>s.id===situationId))return {ok:false,reason:'unknown'};
  if(b.predictions.some(p=>p.situationId===situationId))return {ok:false,reason:'already'};
  if(!meaningful(text,MIN_PREDICTION))return {ok:false,reason:'short'};
  if(text.length>MAX_TEXT)return {ok:false,reason:'long'};
  b.predictions.push({situationId,text,at:now});delete b.skipped.situations;return {ok:true};
 }
 function recordExplanation(b,text,now=Date.now()){
  if(!meaningful(text,MIN_EXPLANATION))return {ok:false,reason:'short'};
  if(text.length>MAX_TEXT)return {ok:false,reason:'long'};
  b.explanation={text,at:now,feedback:null};delete b.skipped.explanation;return {ok:true};
 }
 /** Deterministic answer-key comparison (no AI). Only the first answer to each check is recorded. */
 function answerCheck(b,checkId,optionId,now=Date.now()){
  const q=b.content.checks.find(x=>x.id===checkId);if(!q)return {ok:false,reason:'unknown'};
  if(b.answers.some(x=>x.checkId===checkId))return {ok:false,reason:'already'};
  if(!q.options.some(o=>o.id===optionId))return {ok:false,reason:'option'};
  const correct=optionId===q.answer;b.answers.push({checkId,choice:optionId,correct,at:now});delete b.skipped.checks;return {ok:true,correct};
 }
 function skip(b,part,now=Date.now()){if(PARTS.includes(part))b.skipped[part]=now}
 function unskip(b,part){delete b.skipped[part]}

 /** True only for an eligible, reviewed pack whose gate allowed awarding every keyed check at attach time.
     Fail-closed: any missing or inconsistent field → false. A draft-preview can never be awardable. */
 function awardable(b){
  if(!usable(b))return false;const p=b.pack||{},g=p.gate||{};
  if(p.mode!=='reviewed'||g.reviewStatus!=='reviewed'||g.coreEligible!==true||g.mayAward!==true||!Array.isArray(g.awardable))return false;
  const ids=b.content.checks.map(q=>q.id);
  return ids.length>0&&ids.every(id=>g.awardable.includes(id));
 }

 /** Evidence summary for the UI and constellation. Pure; never throws on old or partial records. */
 function evidence(b){
  if(!usable(b))return null;
  const sits=b.content.situations,checks=b.content.checks;
  const predicted=sits.filter(s=>b.predictions?.some(p=>p.situationId===s.id)).length;
  const explored=predicted===sits.length&&sits.length>0;
  const explained=!!b.explanation&&meaningful(b.explanation.text,MIN_EXPLANATION);
  const answers=checks.map(q=>{const a=(b.answers||[]).find(x=>x.checkId===q.id);return {id:q.id,answered:!!a,correct:!!a&&a.choice===q.answer,choice:a?.choice??null,at:a?.at??null}});
  const allCorrect=answers.length>0&&answers.every(a=>a.correct);
  const eligible=awardable(b);
  const keyed=eligible&&allCorrect;
  const tier=keyed?'keyed':explained?'explained':explored?'explored':'encountered';
  const fb=b.explanation?.feedback||null;
  return {tier,explored,explained,keyed,preview:allCorrect&&!eligible,draft:b.pack?.mode!=='reviewed',
   predicted,situations:sits.length,answers,answered:answers.filter(a=>a.answered).length,correctCount:answers.filter(a=>a.correct).length,
   aiReviewed:!!fb,skipped:Object.keys(b.skipped||{}),label:b.content.assessmentLabel||''};
 }

 const TIER_TEXT={
  encountered:'만남 — 두 개념을 나란히 비교하는 활동을 열었어요.',
  explored:'탐색 — 두 상황에서 결과를 보기 전에 내 예측을 기록했어요.',
  explained:'내 설명 — 두 개념의 차이를 내 말로 쓴 기록이 있어요. 설명이 맞는지에 대한 판정은 아니에요.',
  keyed:'출처 기반 문항 — 검토를 마친 자료의 채점 문항을 모두 맞혔어요. 이 문항들에 대한 결과일 뿐, 완전한 이해를 뜻하지 않아요.'};
 /** Accessible plain-language description of the evidence (also used as the visible inspector text). */
 function describe(ev,concepts){
  if(!ev)return '';
  const names=(concepts||[]).map(c=>c.name).join(' ↔ ');
  const parts=[`${names} 경계: ${TIER_TEXT[ev.tier]}`];
  parts.push(`예측 ${ev.predicted}/${ev.situations}개 기록.`);
  parts.push(ev.explained?(ev.aiReviewed?'내 설명 있음 · AI 검토 의견 있음(참고용).':'내 설명 있음 · AI 검토 없음.'):'내 설명 없음.');
  parts.push(`채점 문항 ${ev.answered}/${ev.answers.length}개 응답, ${ev.correctCount}개 정답 키와 일치.`);
  if(ev.preview)parts.push('성취 미리보기: 검토 중인 학습 자료라 성취로 기록되지 않아요.');
  else if(ev.draft)parts.push('검토 중인 학습 자료라 어떤 결과도 성취로 기록되지 않아요.');
  return parts.join(' ');
 }

 /** The only fields the existing AI feedback coach needs (same shape as learning.js feedbackPayload). */
 function feedbackLesson(b){
  const c=b.content;
  return {title:b.pack.title||c.concepts.map(x=>x.name).join(' · '),explainPrompt:c.prompt.text,
   concepts:c.concepts.map(x=>({id:x.id,name:x.name,description:x.aliases.length?'다른 이름: '+x.aliases.join(', '):x.name})),
   technical:[...(c.relationship?[{heading:'관계',text:c.relationship.summary}]:[]),
    ...c.situations.map(s=>({heading:s.title,text:s.outcome})),
    ...(c.prompt.expectedElements.length?[{heading:'설명에 담길 만한 요소',text:c.prompt.expectedElements.join(' / ')}]:[])]};
 }

 /** Lesson concept that is the same concept as a boundary concept: exact match of name or alias after
     normalisation (letters/digits only, lower case). No fuzzy matching; no match → null. */
 function matchConcept(boundaryConcept,lessonConcepts){
  const n=s=>String(s||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const keys=new Set([boundaryConcept.name,...(boundaryConcept.aliases||[])].map(n).filter(Boolean));
  return (lessonConcepts||[]).find(c=>keys.has(n(c.name)))||null;
 }

 const api={CONTRACT,MIN_PREDICTION,MIN_EXPLANATION,MAX_TEXT,validateActivity,attach,usable,recordPrediction,recordExplanation,answerCheck,skip,unskip,awardable,evidence,describe,feedbackLesson,matchConcept,TIER_TEXT};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriBoundary=api;
})(typeof window!=='undefined'?window:globalThis);
