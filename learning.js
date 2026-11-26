/* CURIVEN learning-content helpers shared by the browser and Node tests.
   - validateFeedback: strict AI-feedback schema (mirrors server.py review_feedback). Version 2 separates
     correct / precision / misconception, requires criticisms to quote the learner and explain why, and
     re-checks every quotation against the learner's actual text. Version 1 (saved before this change)
     is still read and shown, marked as legacy.
   - quoteFound: the deterministic quotation check (identical algorithm in server.py).
   - conceptStatus: honest per-concept achievement tiers for the constellation.
   - feedbackPayload: the only lesson fields the feedback request needs.
   - shuffleScenarios: removes answer-position bias while keeping answerIndex correct. */
'use strict';
(function(root){
 const text=v=>typeof v==='string'&&v.trim()?v.trim():null;
 const FEEDBACK_SCHEMA=2;
 const MIN_QUOTE=5,QUOTE_RATIO=0.8;

 /** Letters and digits only (any script), lower-cased, NFC. Whitespace and punctuation never decide a match. */
 function normQuote(s){return String(s||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'')}
 /** Longest common substring length (dynamic programming over two rows). */
 function longestCommon(a,b){let best=0,prev=new Uint16Array(b.length+1),cur=new Uint16Array(b.length+1);
  for(let i=1;i<=a.length;i++){for(let j=1;j<=b.length;j++){cur[j]=a[i-1]===b[j-1]?prev[j-1]+1:0;if(cur[j]>best)best=cur[j]}[prev,cur]=[cur,prev];cur.fill(0)}
  return best}
 /** True when `quote` is actually in the learner's text: verbatim after normalisation, or one contiguous
     stretch covering at least 80% of it (tolerates a changed sentence ending such as 없다/없어요). */
 function quoteFound(quote,learnerText){
  const q=normQuote(quote),t=normQuote(learnerText);
  if(q.length<MIN_QUOTE||!t)return false;
  if(t.includes(q))return true;
  return longestCommon(q,t)>=Math.ceil(q.length*QUOTE_RATIO);
 }
 /** What to show between quotation marks: always the learner's own words. A stored quotation may differ slightly from
     the text (quoteFound tolerates a changed ending, which in Korean can flip the meaning: 없어요 → 있다), so it is only
     ever displayed as written here. Same letters → that span; an altered quotation → the whole sentence(s) it came from.
     Display only: matching, stored quotations and follow-up identity (tutor.js sameItem) keep the recorded quotation. */
 function verbatimQuote(quote,learnerText){
  const t=String(learnerText||'').normalize('NFC'),q=String(quote||'').normalize('NFC').trim();
  if(!q||!quoteFound(q,t))return null;
  if(t.includes(q))return q;
  let hay='';const at=[];let i=0;for(const ch of t){const k=normQuote(ch);for(let j=0;j<k.length;j++)at.push([i,i+ch.length]);hay+=k;i+=ch.length}
  const needle=normQuote(q),n=longestCommon(needle,hay);if(!n)return null;
  const hits=[];for(let a=0;a+n<=needle.length;a++)for(let p=hay.indexOf(needle.slice(a,a+n));p!==-1;p=hay.indexOf(needle.slice(a,a+n),p+1))hits.push([at[p][0],at[p+n-1][1]]);
  if(n===needle.length)return t.slice(...hits[0]);
  const start=Math.min(...hits.map(h=>h[0])),end=Math.max(...hits.map(h=>h[1]));let from=0,to=t.length;
  for(const m of t.matchAll(/(?<=[.!?？。])\s+|\n+/g)){if(m.index+m[0].length<=start)from=m.index+m[0].length;else if(m.index>=end){to=m.index;break}}
  return t.slice(from,to).trim()}
 /* What kind of utterance the learner wrote (mirrors server.py utterance_kind). Rule-based and conservative: it
    only caps how strong a judgement the AI may attach. question · check (confirmation, may carry an assumption) ·
    hypothesis (hedged) · claim · explanation (asserted reasoning) · ambiguous · mixed. */
 const Q_END=/(\?|？|까요|까|나요|(?<=[가-힣])가요|니까|냐|죠|지요|건가요|는가|인가요|맞나요|아닌가요|않나요|거죠|이죠)$/,WH=/(뭐|무엇|무슨|왜(?!냐하면)|어떻게|어떤|언제|어디|누가|누구|몇|어느|얼마)/,
  UNKNOWN=/(모르겠|몰라요|모르는데|헷갈려|헷갈리|이해가 안|이해 안|처음 들어|처음 듣|처음 봐)/,HEDGE=/((?:것|거) ?같|듯해|듯하|듯싶|아닐까|일까|라고 생각|지 않을까|아마(?!추어))/,CAUSE=/(때문|그래서|따라서|므로|기에|으니|해서)/;
 const sentences=t=>String(t||'').split(/(?<=[.!?？。])\s+|\n+/).map(p=>p.trim()).filter(p=>normQuote(p));
 function sentenceKind(s){const t=s.trim().replace(/[.~!。… ]+$/,'');if(normQuote(t).length<4)return 'ambiguous';
  // Classify the reporting clause, then look beyond indirect-question complements for a WH cue.
  const outer=t.replace(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/g,' ').trim()||t;
  const main=outer.split(/(?:는|은|인|한|운|을|할)지(?:를|는|도)?\s+/).pop();
  const wh=WH.test(main),unknown=UNKNOWN.test(main);
  if(/(?:알려\s*주세요|궁금해요|궁금합니다)[?？]?$/.test(main))return 'question';
  if(/[?？]$/.test(outer)||Q_END.test(outer)||unknown||(wh&&outer.endsWith('요')))return wh||unknown?'question':'check';
  return HEDGE.test(outer)?'hypothesis':'claim'}
 function utteranceKind(text){const k=sentences(text).map(sentenceKind);if(!k.length||normQuote(text).length<4)return 'ambiguous';
  if(new Set(k).size>1)return 'mixed';if(k[0]==='claim'&&(k.length>=2||CAUSE.test(text)))return 'explanation';return k[0]}
 function quoteKind(quote,text){for(const s of sentences(text))if(quote&&quoteFound(quote,s))return sentenceKind(s);
  // A quote spanning a sentence boundary: its own words still show a question or a hedge (mirrors server.py).
  const q=String(quote||'');if(/[?？]/.test(q))return 'check';if(HEDGE.test(q))return 'hypothesis';const k=utteranceKind(text);return k==='mixed'?'ambiguous':k}
 const CLARIFY=new Set(['meaning','simpler','example','hint','direct','another','unsure']);
 /** Strongest judgement allowed for this utterance kind; a question is never a confirmed misconception. null = none. */
 function guardVerdict(verdict,kind,intent){
  if(CLARIFY.has(intent))return null;
  // Ask mode answers; it never grades. Only a doubtful premise inside a question is noted (shown as a clarification, not a verdict).
  if(intent==='ask')return ['question','check'].includes(kind)&&['misconception','imprecise','assumption'].includes(verdict)?'assumption':null;
  if(kind==='question')return ['misconception','imprecise','assumption'].includes(verdict)?'assumption':null;
  if(kind==='check')return ['misconception','imprecise'].includes(verdict)?'assumption':verdict; // a question is not an 'imprecise understanding'
  if(kind==='hypothesis')return verdict==='misconception'?'assumption':verdict;
  if(kind==='ambiguous')return ['misconception','imprecise'].includes(verdict)?'unclear':verdict;
  return verdict}
 const TENTATIVE=['question','check','hypothesis'];

 const overlaps=(a,b)=>{const x=normQuote(a),y=normQuote(b);return !!x&&!!y&&(x.includes(y)||y.includes(x)||longestCommon(x,y)>=Math.ceil(Math.min(x.length,y.length)*QUOTE_RATIO))};

 // Concept-evidence eligibility (mirrors server.py). Deliberately not sentenceKind: that one is tuned to avoid
 // over-strong criticism and reads many 해요체 assertions (일어나요, 올라가요, …니까요, 누구나 …해요) as questions.
 // Without a question mark, only endings that are interrogative by form count.
 const EV_ENGLISH=/^(?:(?:who|what|when|where|why|how|which)\s+)?(?:is|are|am|was|were|do|does|did|can|could|would|should|will|has|have|may)\s+(?:i|you|he|she|it|we|they|there|this|that|the|a|an|my|your)\b|^(?:who|what|which)\s+(?:is|are|was|were)\s+|,\s*(?:right|correct)$/i,
  EV_SPLIT=/(?<=[?？])(?=[^\s?？!"'”’)\]])/, // "…나요?ㅠㅠ", "…나요?그래서"
  EV_INDIRECT=/(?:[가-힣]지(?:는|를|가|도|에)?(?!\s+(?:않|못|말))|냐(?:면|하면|가|에|는|를))\s+/,
  EV_INDEFINITE=/(?:누구(?:에게)?|언제|어디(?:에서|에|서|로)?|무엇(?:이)?)(?:나|든지|든|라도|도|보다)(?![가-힣])|어느 정도|어느 [가-힣]+(?:이든|든|도)(?=\s)|어떤 [가-힣]+(?:은|는|도)(?=\s)|몇몇|얼마든지|어떻게든|왜냐면/g,
  EV_VERB_NA=/(?:[가-힣][어아]|나타|끝|겨|드러|물러|빛|넘쳐)나요$|(?:^|\s)(?:지|만|떠|자라)?나요$/;
 const final=ch=>ch>='가'&&ch<='힣'?(ch.charCodeAt(0)-0xAC00)%28:-1;
 function asks(sentence){let t=sentence.trim().replace(/[.~!。… ]+$/,'');
  t=t.replace(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/g,' ').trim()||t;
  if(/[?？][)\]\s]*$/.test(t)||EV_ENGLISH.test(t))return true;
  const main=t.split(EV_INDIRECT).pop();
  if(/(?:알려\s*주세요|궁금해요|궁금합니다)[?？]?$/.test(main)||/(?:맞|그렇)(?:죠|지요)$|냐$|(?:는|은|인|한|건)가$/.test(t))return true;
  let m=t.match(/(.)까(요?)$/);                // …ㄹ까(요), …ㅂ니까; not the reason ending …니까(요)
  if(m)return final(m[1])===8||(m[1]==='니'&&!m[2]&&t.length>2&&final(t.at(-3))===17);
  m=t.match(/(.)가요$/);if(m&&final(m[1])===4)return true; // …ㄴ가요; not 올라가요
  if(t.endsWith('나요')&&!EV_VERB_NA.test(t))return true;
  return main.endsWith('요')&&WH.test(main.replace(EV_INDEFINITE,' '))}
 /** True when the quotation touches a question, at any place in the text it may have come from. */
 function evidenceIsQuestion(quote,learnerText){
  const source=sentences(learnerText).flatMap(s=>s.split(EV_SPLIT)),parts=source.map(normQuote),joined=parts.join(''),needle=normQuote(quote);
  const n=longestCommon(needle,joined),spans=[]; // the whole quotation, or the longest stretch of a tolerated paraphrase
  if(n)for(let i=0;i+n<=needle.length;i++)for(let at=joined.indexOf(needle.slice(i,i+n));at!==-1;at=joined.indexOf(needle.slice(i,i+n),at+1))spans.push([at,at+n]);
  let offset=0;
  return source.some((sentence,i)=>{const start=offset,end=offset+=parts[i].length;
   return spans.some(([a,b])=>a<end&&start<b)&&asks(sentence)})}
 /** Questions the learner asked in their own explanation, as exact substrings of it, in order (at most 5). Uses the
     strict form-based `asks` (not sentenceKind), so 해요체 assertions, hedges, embedded "…인지" clauses and quoted
     questions are not offered. Only a suggestion for the learner to confirm or edit — never sent, graded or stored. */
 function learnerQuestions(text){const out=[];
  for(const s of sentences(text))for(const part of s.split(EV_SPLIT)){const p=part.trim();if(p&&asks(p)&&!out.includes(p))out.push(p)}
  return out.slice(0,5)}

 /** Returns clean feedback or throws on malformed structure. `learnerText` (the explanation the feedback is
     about) enables the quotation check; without it, v2 criticisms cannot be verified and are withheld.
     Missing optional lists become []; wrong types are rejected, never coerced. Unknown concept ids are dropped. */
 const ID_RE=/^[A-Za-z0-9_-]{8,64}$/;
 /** Gives NEW feedback (and each of its items) a random, immutable id when it is stored, so a follow-up can name the
     exact item it answers even after a later validator reorders, withholds or reclassifies items. Ids already present
     are kept; nothing else changes. Only v2 feedback is stamped (v1 is never stored any more). */
 function stampFeedback(f,mk){const make=mk||(()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'f'+Date.now().toString(36)+Math.random().toString(36).slice(2,12));
  if(!f||f.schema!==2)return f;const one=x=>x.id&&ID_RE.test(x.id)?x:{...x,id:make()};
  return {...f,id:f.id&&ID_RE.test(f.id)?f.id:make(),correct:f.correct.map(one),precision:f.precision.map(one),misconceptions:f.misconceptions.map(one),missing:f.missing.map(one)}}
 function validateFeedback(f,allowedIds,learnerText){
  if(!f||typeof f!=='object'||Array.isArray(f))throw Error('피드백이 객체 형식이 아니에요.');
  const normalized=f.schema===2&&Array.isArray(f.demonstrated);
  const summary=text(f.summary);if(!summary)throw Error('피드백 요약(summary)이 없어요.');
  const list=(k,item)=>{const v=f[k];if(v==null)return [];if(!Array.isArray(v))throw Error(`피드백 ${k} 형식이 올바르지 않아요.`);return v.slice(0,normalized&&k==='precision'?16:8).map(x=>item(x,k))};
  const plain=(x,k)=>{const s=text(x);if(!s)throw Error(`피드백 ${k} 항목 형식이 올바르지 않아요.`);return s.slice(0,400)};
  const pair=(x,k)=>{if(!x||typeof x!=='object'||!text(x.issue)||!text(x.question))throw Error(`피드백 ${k} 항목 형식이 올바르지 않아요.`);return {issue:text(x.issue).slice(0,400),question:text(x.question).slice(0,400)}};
  if(f.uncertainty!=null&&typeof f.uncertainty!=='string')throw Error('피드백 uncertainty 형식이 올바르지 않아요.');
  const allowed=new Set(allowedIds||[]),uncertainty=(f.uncertainty||'').trim().slice(0,600);
  // Which provider/model wrote this review (recorded by the app, not by the model). Kept for provenance.
  const reviewer=f.reviewer&&typeof f.reviewer==='object'?{provider:String(f.reviewer.provider||'').slice(0,40),model:String(f.reviewer.model||'').slice(0,200),at:Number(f.reviewer.at)||null}:null;
  if(f.schema!==FEEDBACK_SCHEMA){
   // Version 1 (before precision/quotes existed). Shown as saved; its concept ids are a legacy AI mention.
   if(f.demonstrated!=null&&!Array.isArray(f.demonstrated))throw Error('피드백 demonstrated 형식이 올바르지 않아요.');
   const point=(x,k)=>x&&typeof x==='object'&&!Array.isArray(x)?plain(x.point,k):plain(x,k);
   return {schema:1,summary:summary.slice(0,1200),correct:list('correct',point).map(p=>({quote:null,point:p})),precision:[],
    misconceptions:list('misconceptions',pair).map(x=>({quote:null,why:null,...x})),missing:list('missing',pair),explained:[],
    demonstrated:[...new Set((f.demonstrated||[]).filter(x=>typeof x==='string'&&allowed.has(x)))],uncertainty,withheld:0,reviewer};
  }
  const found=q=>learnerText!=null&&quoteFound(q,learnerText);let withheld=normalized&&Number.isSafeInteger(f.withheld)&&f.withheld>=0?f.withheld:0;
  // Durable ids (stampFeedback, 2026-11-24): carried through validation and reclassification, never invented here.
  const idOf=x=>x&&typeof x==='object'&&typeof x.id==='string'&&ID_RE.test(x.id)?{id:x.id}:{};
  const correct=list('correct',(x,k)=>{if(typeof x==='string')return {quote:null,point:plain(x,k)};
   if(!x||typeof x!=='object'||!text(x.point))throw Error(`피드백 ${k} 항목 형식이 올바르지 않아요.`);
   return {quote:text(x.quote)?text(x.quote).slice(0,300):null,point:text(x.point).slice(0,400),...idOf(x)}})
   .filter(x=>{if(x.quote&&!found(x.quote)){withheld++;return false}return true});
  const critique=(x,k)=>{if(!x||typeof x!=='object'||!text(x.issue)||!text(x.question))throw Error(`피드백 ${k} 항목 형식이 올바르지 않아요.`);
   return {quote:text(x.quote)?text(x.quote).slice(0,300):null,issue:text(x.issue).slice(0,400),why:text(x.why)?text(x.why).slice(0,500):null,question:text(x.question).slice(0,400),
    ...(TENTATIVE.includes(x.reclassified)?{reclassified:x.reclassified}:{}),...idOf(x)}};
  // A criticism must point at words the learner actually wrote and say why; otherwise it is withheld.
  const keep=x=>{if(!x.quote||!x.why||!found(x.quote)){withheld++;return false}return true};
  let precision=list('precision',critique).filter(keep),misconceptions=list('misconceptions',critique).filter(keep);
  // A question or hedged guess quoted from the explanation is not a confirmed misconception (mirrors server.py).
  if(learnerText!=null){const tagged=misconceptions.map(m=>[m,m.reclassified||quoteKind(m.quote,learnerText)]);
   const moved=tagged.filter(([,k])=>TENTATIVE.includes(k)).map(([m,k])=>({...m,reclassified:k}));
   if(moved.length){misconceptions=tagged.filter(([,k])=>!TENTATIVE.includes(k)).map(([m])=>m);precision=[...precision,...moved]}}
  const contested=[...misconceptions,...precision.filter(m=>m.reclassified)];
  const explained=[],seen=new Set();
  for(const e of list('explained',(x,k)=>{if(!x||typeof x!=='object'||typeof x.id!=='string')throw Error(`피드백 ${k} 항목 형식이 올바르지 않아요.`);return {id:x.id,quote:text(x.quote)?text(x.quote).slice(0,300):null}})){
   if(!allowed.has(e.id)||seen.has(e.id))continue;
   // Evidence must be the learner's own words, and not words that were just judged to be a misconception.
   if(!e.quote||!found(e.quote)||evidenceIsQuestion(e.quote,learnerText)||contested.some(m=>overlaps(m.quote,e.quote))){withheld++;continue}
   seen.add(e.id);explained.push(e)}
  // An explanation the AI itself rewrote, only if it actually wrote one (the feedback prompt asks it NOT to give answers,
  // so this is normally absent; it is never derived from the other fields). Kept verbatim, shown as AI-written.
  const revision=typeof f.revision==='string'&&f.revision.trim()?f.revision.trim().slice(0,3000):null;
  return {schema:2,summary:summary.slice(0,1200),correct,precision,misconceptions,missing:list('missing',pair).map((x,i)=>({...x,...idOf(f.missing[i])})),explained,
   demonstrated:explained.map(e=>e.id),uncertainty,withheld,reviewer,...(revision?{revision}:{}),...idOf(f)};
 }

 /** Achievement tier per concept id for one lesson, from its latest feedback:
     'explained'  – v2 feedback: the AI reviewer tied the concept to a quotation found in the learner's text;
     'legacy'     – v1 feedback named the concept; no evidence was stored, so it cannot be substantiated;
     'encountered'– everything else in the lesson. No tier claims mastery: there is no independent check yet. */
 function conceptStatus(lesson){
  const out=new Map(),concepts=lesson?.lesson?.concepts||[],ids=concepts.map(c=>c.id);
  for(const id of ids)out.set(id,{tier:'encountered'});
  const raw=lesson?.feedback;if(!raw)return out;
  const drafts=lesson.drafts||[],draft=drafts.find(d=>d.at===lesson.feedbackFor)||drafts.filter(d=>d.feedback).at(-1);
  let f;try{f=validateFeedback(raw,ids,draft?.text??null)}catch{return out}
  if(f.schema===2)for(const e of f.explained)out.set(e.id,{tier:'explained',quote:verbatimQuote(e.quote,draft?.text),model:f.reviewer?.model||null});
  else for(const id of f.demonstrated)out.set(id,{tier:'legacy'});
  return out;
 }

 /** The lesson material the feedback coach checks against. The story/scenario record travels separately as
     `context` (learningContext), labelled as hypothetical, so the coach can see what the explain prompt refers to. */
 function feedbackPayload(lesson){
  return {
   title:String(lesson.title||''),
   explainPrompt:String(lesson.explainPrompt||''),
   concepts:(lesson.concepts||[]).map(c=>({id:c.id,name:c.name,description:c.description})),
   technical:(lesson.technical||[]).map(t=>({heading:t.heading,text:t.text}))
  };
 }

 /** The learner's own lesson record that AI feedback and tutoring need to understand references such as "the
     red bag" (mirrors server.py clean_context): the story, the prediction, and per thought experiment the question,
     options and the learner's choice. A thought experiment's stated outcome and explanation are included only once
     the learner has answered it, so nothing is spoiled. Bounded by the server; no profile or other lessons. */
 function learningContext(l){
  const d=l?.lesson;if(!d)return null;const rec=Array.isArray(l.scenarios)?l.scenarios:[];
  return {story:String(d.story||''),prediction:{question:String(d.prediction||''),learner:String(l.prediction||''),unsure:!!l.predictionUnsure},
   scenarios:(d.scenarios||[]).map((s,i)=>{const r=rec.find(x=>x.i===i),answered=!!r,unsure=!!r&&(r.unsure||r.choice==null);
    return {title:scenarioTitle(s.title),question:String(s.question||''),options:(s.options||[]).map(String),answered,unsure,
     learnerChoice:answered&&!unsure?String(s.options?.[r.choice]??''):null,
     ...(answered?{statedOutcome:String(s.options?.[s.answerIndex]??''),reason:String(s.reason||'')}:{})}}),
   reflection:String(l.reflection||'')};
 }
 /** Model-written scenario titles sometimes repeat the app's own "사고 실험 N:" prefix; shown once (display only). */
 function scenarioTitle(t){return String(t||'').replace(/^\s*(사고\s*실험|생각\s*실험|thought\s*experiment)\s*\d*\s*[:：.\-–—]\s*/i,'').trim()}

 /** Fisher–Yates per scenario; answerIndex is remapped to the moved correct option. */
 function shuffleScenarios(lesson,rand=Math.random){
  return {...lesson,scenarios:lesson.scenarios.map(s=>{
   const order=s.options.map((_,i)=>i);
   for(let i=order.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[order[i],order[j]]=[order[j],order[i]]}
   return {...s,options:order.map(i=>s.options[i]),answerIndex:order.indexOf(s.answerIndex)};
  })};
 }

 const api={FEEDBACK_SCHEMA,utteranceKind,sentenceKind,quoteKind,guardVerdict,validateFeedback,stampFeedback,quoteFound,verbatimQuote,learnerQuestions,normQuote,conceptStatus,feedbackPayload,learningContext,scenarioTitle,shuffleScenarios};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriLearning=api;
})(typeof window!=='undefined'?window:globalThis);
