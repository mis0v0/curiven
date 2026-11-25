/* CURIVEN shared learning copy and exploration identity — pure helpers for the browser and Node tests.

   Stage copy: one stable label per stage (the sidebar and the line above each heading) and a calm default heading.
   A stage heading may be topic-specific when the lesson provides one (e.g. explainTitle); the label never changes.
   These are DISPLAY strings only: no stored record or generated lesson text is rewritten by them.

   Exploration identity — the roles a record holds, kept apart:
     id        stable record id (never changes)
     question  what the learner typed to start, or null (a material exploration started without a question)
     title     the display name: the generated lesson title → the learner's question → the file name (before generation)
     short     the short display title for the constellation (see shortTitle rules below)
     lead      the lesson's one-line curiosity hook (its central question), when there is one
     file      {name, kind} of the uploaded class material, or null
   Records saved before `question` existed are read without being rewritten: a material record whose topic is the
   app-made "수업 자료: <file>" placeholder has no learner question; any other topic is the learner's own words. */
'use strict';
(function(root){
 const STAGES=[
  {label:'시작',heading:'오늘은 무엇이 궁금한가요?'},
  {label:'이야기',heading:'어떤 일이 일어나는지 살펴볼까요?'},
  {label:'탐구',heading:'예상과 결과를 비교해 봐요',sub:'생각으로 해 보는 실험이에요. 하나를 고른 뒤 해설과 비교해 보세요.'},
  {label:'개념',heading:'이제 원리를 알아볼까요?',sub:'이야기에서 벗어나, 실제 원리를 정확한 말로 살펴봐요.'},
  {label:'설명',heading:'지금까지 이해한 내용을 정리해요',sub:'이해한 만큼 내 표현으로 적어 보세요. 확실하지 않은 부분은 그렇다고 적어도 괜찮아요.'},
  {label:'성장',heading:'오늘의 발견을 돌아봐요'}];
 const MATERIAL_PREFIX='수업 자료: ';
 const str=v=>typeof v==='string'?v.trim():'';

 /** Stage label and heading; `lesson` may supply a topic-specific heading (explainTitle for stage 4). */
 function stageCopy(stage,lesson){const s=STAGES[stage]||STAGES[0];
  const own=stage===4?str(lesson?.explainTitle):'';
  return {label:s.label,heading:own||s.heading,sub:s.sub||'',topicHeading:!!own}}

 const stem=name=>str(name).replace(/\.(pdf|pptx)$/i,'').trim();
 /* Short display title (constellation, small map, overview). Precedence: the learner's own rename (displayTitle) →
    the lesson's generated shortTitle when it passes these rules → a deterministic shortening of the stored lesson title.
    Rules (mirrored by server.py clean_short_title): 2–20 characters and at most 5 words, letters/numbers and plain
    punctuation only (no ? ! : or decorative marks), no file extension, no chapter prefix such as "01장", no decorative
    prefix or nickname, not a generic word such as "학습 내용", and not a copy of the uploaded file's name.
    Display only: nothing is written; historic titles and questions stay as stored. */
 const SHORT_MAX=20,SHORT_WORDS=5,squash=t=>str(t).replace(/\s+/g,' ').replace(/^["'“‘「『]+|["'”’」』]+$/g,'').trim(),key=t=>String(t||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
 // Names that say nothing about the topic (document forms, app words) are never used as a short title.
 const GENERIC=new Set(['학습내용','학습','수업','수업자료','강의','강의자료','자료','개요','요약','정리','복습','탐험','새탐험','이름없는탐험','오늘의학습','오늘의탐험','기본개념','개념정리','핵심개념','주제','질문','introduction','overview','summary','lesson','chapter'].map(key));
 /** A short title when `v` follows the rules, else null. `fileName`: the uploaded file, whose name must not be copied. */
 function cleanShort(v,fileName){const t=squash(v);
  if(t.length<2||t.length>SHORT_MAX||t.split(' ').length>SHORT_WORDS)return null;
  if(/[^\p{L}\p{N}\p{M} ·&+/().,'’-]/u.test(t))return null;                    // ? ! : emoji, decorative marks, line breaks
  if(/\.(pdf|pptx)\b/i.test(t)||/^(제\s*)?\d+\s*(장|강|주차|과)(\s|_|$)/.test(t))return null; // file names, chapter numbers
  if(/^(오늘의|나만의|나의|우리의|신기한|재미있는|놀라운|궁금한)\s/.test(t)||/님(의|이|과|께)?(\s|$)/.test(t))return null; // decorative prefixes, nicknames
  if(GENERIC.has(key(t))||/(까|까요|나요|니|는가|인가|뭐야|무엇)$/.test(t))return null; // generic words; question-shaped phrases
  const f=key(stem(fileName||''));if(f.length>=4&&(key(t).includes(f)||f.includes(key(t))&&key(t).length>=6))return null;return t}
 /** The learner's own rename: their choice, so only length and plain text are checked (1–20 characters, one line). */
 function cleanManual(v){const t=typeof v==='string'?v.replace(/\s+/g,' ').trim():'';return t&&t.length<=SHORT_MAX&&!/[\u0000-\u001f\u007f]/.test(t)?t:null}
 /* "X는 왜 Y될까" → "X의 Y"; "X란 무엇일까" → "X". Grammar only, never topic-specific; null when the clause has another shape. */
 function nominal(clause){const c=squash(clause).replace(/[?？.!]+$/,'').trim();
  let m=c.match(/^(.+?)(?:이란|란|은|는|이|가)\s*(?:무엇|뭘까|뭐|무엇일까|무엇인가|무엇인가요|무엇일까요)$/);if(m)return m[1].trim();
  m=c.match(/^(.+?)(?:은|는|이|가)\s+(?:왜|어떻게)\s+(?:(\S+?)(?:을|를)\s+)?(\S{2,6}?)(?:될까|할까|되는가|하는가|되나|하나|될까요|할까요|되나요|하나요|되는\s?걸까|하는\s?걸까)$/);
  if(m){const head=m[1].trim().split(' ').pop().replace(/의$/,'');return head+'의 '+(m[2]?m[2]+' ':'')+m[3]}
  return null}
 /** Conservative shortening of stored lesson metadata. → {text, sure}: sure=false means only an identifiable cut. */
 function deriveShort(title,question,fileName){const t=squash(title),ok=v=>v&&cleanShort(v,fileName);
  const head=t.split(/\s*[:：]\s*|\s+[—–-]\s+/)[0].trim();                              // "웹 입문: 서버가…" → "웹 입문"
  if(head!==t&&ok(head))return {text:head,sure:true};
  const clause=head.split(/[?？]/)[0].trim(),n=nominal(clause);if(ok(n))return {text:n,sure:true}; // "기억은 왜 왜곡될까" → "기억의 왜곡"
  if(ok(t))return {text:t,sure:true};
  const nq=nominal(squash(question));if(ok(nq))return {text:nq,sure:true};
  if(clause!==t&&clause.length>=2&&clause.length<=SHORT_MAX&&!/[.](pdf|pptx)/i.test(clause))return {text:clause,sure:false}; // identifiable, not a noun phrase
  if(ok(question))return {text:squash(question),sure:false};
  if(!t)return null;const bare=t.replace(/^(제\s*)?\d+\s*(장|강|주차|과)[\s_]*/,'').replace(/_/g,' ').trim()||t;
  if(bare.length<=SHORT_MAX)return {text:bare,sure:false};const cut=bare.slice(0,SHORT_MAX-1),sp=cut.lastIndexOf(' ');return {text:(sp>=6?cut.slice(0,sp):cut).replace(/[\s,·:?]+$/,'')+'…',sure:false}}
 function identity(l){
  const m=l&&typeof l.material==='object'&&l.material?l.material:null;
  const file=m&&str(m.name)?{name:str(m.name),kind:m.kind==='pptx'?'pptx':'pdf'}:null;
  let question;
  if(typeof l?.question==='string')question=str(l.question)||null; // records made from now on say it explicitly
  else{const t=str(l?.topic);question=!t||(file&&t===MATERIAL_PREFIX+file.name)?null:t}
  const gen=str(l?.lesson?.title);
  const title=gen||question||(file?stem(file.name)||file.name:'')||'이름 없는 탐험';
  // The learner's rename wins whenever it is plain text of at most 20 characters (their choice; AI rules do not apply).
  const manual=cleanManual(l?.displayTitle),ai=gen&&!manual?cleanShort(l.lesson.shortTitle,file?.name):null;
  const d=manual||ai?null:deriveShort(gen||question||'',gen?question:null,file?.name);
  const short=manual||ai||d?.text||(title.length<=SHORT_MAX?title:title.slice(0,SHORT_MAX-1)+'…');
  return {id:l?.id??null,question,title,titleSource:gen?'generated':question?'question':file?'file':'none',short,
   shortSource:manual?'manual':ai?'ai':d?.sure?'derived':'fallback',lead:str(l?.lesson?.hook)||null,file};
 }

 /* Self-explanation: a fill-in-the-blanks template is an optional scaffold, never the default request. */
 const BLANK=/_{2,}|＿{2,}|\(\s{0,3}\)|（\s{0,3}）|\[\s{0,3}\]|□/;
 const isBlankTemplate=t=>BLANK.test(String(t||''));
 /** What the explanation stage asks for by default, and the optional scaffolds (shown on request). */
 function explainInvite(lesson){
  const p=str(lesson?.explainPrompt),blank=isBlankTemplate(p);
  const starters=(Array.isArray(lesson?.explainStarters)?lesson.explainStarters:[]).map(str).filter(x=>x&&!isBlankTemplate(x)).slice(0,3);
  return {question:blank?'':p,template:blank?p:'',starters:starters.length?starters:['내가 이해한 건…','아직 헷갈리는 건…','예를 들면…']};
 }

 const api={STAGES,MATERIAL_PREFIX,SHORT_MAX,stageCopy,identity,cleanShort,cleanManual,deriveShort,nominal,isBlankTemplate,explainInvite};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriCopy=api;
})(typeof window!=='undefined'?window:globalThis);
