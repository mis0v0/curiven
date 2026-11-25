/* CURIVEN tutoring and beginner-scaffolding UI. Uses index.html globals (E, button, data, provider, inflight,
   api, persist, track, toast, canWrite, latestProfile, P, ...) at call time, like boundary-ui.js.
   Every AI request starts from an explicit learner click. A reply updates only the conversation boxes in place
   (never a full re-render), so text the learner is typing elsewhere is not disturbed. */
'use strict';
const T=window.CuriTutor,N=window.CuriNotes;
const tutorText=new Map(),tutorOpen=new Set(),tutorReplyTo=new Map(); // unsent composer text · opened toggles · follow-up being answered

const lessonById=id=>data.lessons.find(x=>x.id===id)||null;
const tKey=(l,ref)=>l.id+'|'+T.refKey(ref);
/** AI text: ``` fences become code blocks (textContent only — nothing is parsed as HTML). */
function richText(el,text){const re=/```([\w+-]*)[^\n]*\n?([\s\S]*?)```/g,src=String(text||'');let last=0,m;
 const para=t=>{t=t.replace(/^\n+|\n+$/g,'');if(t)el.append(E('p','tutor-p',t))};
 while((m=re.exec(src))){para(src.slice(last,m.index));const pre=E('pre','tutor-code'),code=E('code','',m[2].replace(/\n$/,''));pre.append(code);el.append(pre);last=re.lastIndex}
 para(src.slice(last));return el}

/* ---------- requests ---------- */
function askTutor(l,opts){if(!canWrite())return;
 const noted=!!opts.noted||!provider.online;
 const r=T.addLearner(l,{...opts,stage:l.stage,noted});
 if(!r.ok){toast(r.reason==='empty'?'먼저 내용을 적어 주세요.':r.reason==='long'?`메시지는 ${T.MAX_MESSAGE.toLocaleString()}자까지 보낼 수 있어요.`:r.reason==='full'?'이 탐험의 대화가 너무 길어요. 새 탐험에서 이어 가 주세요.':'보낼 수 없어요.');return false}
 const dk=opts.draftKey||tKey(l,opts.ref);tutorText.delete(dk);tutorReplyTo.delete(dk); // composer of the thread it was typed in
 track(l,noted?'질문을 메모함':'AI 튜터에게 물어봄');
 if(!noted)sendTutor(l.id,r.msg.id);else refreshTutor();
 return true}
async function sendTutor(lessonId,msgId){const l=lessonById(lessonId);if(!l||!canWrite())return;
 const key='tutor:'+lessonId;if(inflight.has(key)){toast('앞의 질문에 대한 답을 기다리고 있어요. 답이 오거나 취소한 뒤 보내 주세요.');refreshTutor();return}
 if(!provider.online){toast('AI가 연결되지 않았어요. 질문은 메모로 남아 있어요.');return}
 const m=(l.dialogue||[]).find(x=>x.id===msgId);if(!m)return;
 const ctl=new AbortController();inflight.set(key,ctl);m.status='pending';delete m.error;delete m.cancelled;persist();refreshTutor();
 try{const r=await api('tutor',T.payload(l,m,P.aiPayload(latestProfile())),ctl.signal);
  const reply=T.validateReply(r.data,m.text,m.intent);
  if(inflight.get(key)!==ctl)return;const cur=lessonById(lessonId);if(!cur||!canWrite())return;
  T.attachReply(cur,msgId,reply,{provider:r.provider,model:r.model});track(cur,'AI 튜터의 답을 받음')}
 catch(e){if(inflight.get(key)!==ctl)return;const cur=lessonById(lessonId);
  // fetch() rejects with a TypeError when the connection drops (or the page is being left): say so in plain words.
  const net=e instanceof TypeError&&!e.status,why=net?'연결이 끊겨 답을 받지 못했어요. 인터넷과 CURIVEN 서버 연결을 확인한 뒤 다시 보내 주세요.':(e.message||String(e));
  if(cur&&canWrite()){const cancelled=e?.name==='AbortError';T.markFailed(cur,msgId,cancelled?'요청을 취소했어요.':why,cancelled);persist()}
  if(e?.name!=='AbortError')afterAiError(e)}
 finally{if(inflight.get(key)===ctl)inflight.delete(key);refreshTutor()}}
function cancelTutor(lessonId){const c=inflight.get('tutor:'+lessonId);if(c)c.abort()}

/* ---------- conversation boxes ---------- */
/** A self-refreshing conversation box for one thread (general, one feedback item, or one thought experiment). */
function mountThread(box,l,ref,{primary='ask',chips=['simpler','example','direct'],intro='',composeRef}={}){
 box.dataset.tutorThread='1';box.dataset.lesson=l.id;box.dataset.ref=JSON.stringify(ref);box.__opts={primary,chips,intro,composeRef};buildThread(box);return box}
function refreshTutor(){
 const active=document.activeElement,activeId=active?.id,pos=active&&'selectionStart' in active?[active.selectionStart,active.selectionEnd]:null;
 document.querySelectorAll('[data-tutor-thread]').forEach(buildThread);
 if(activeId){const el=document.getElementById(activeId);if(el&&el!==active){el.focus();if(pos&&el.setSelectionRange)try{el.setSelectionRange(...pos)}catch{}}}}
function buildThread(box){
 const l=lessonById(box.dataset.lesson);box.replaceChildren();if(!l)return;
 const ref=JSON.parse(box.dataset.ref||'null'),o=box.__opts||{},k=tKey(l,ref),safe=T.refKey(ref).replace(/[^\w-]/g,'_');
 const busy=inflight.has('tutor:'+l.id),msgs=T.stream(l,ref),writable=canWrite();
 if(o.intro&&!msgs.length)box.append(E('p','hint',o.intro));
 const log=E('div','tutor-log');const showAll=tutorOpen.has(k+'|all'),hidden=showAll?0:Math.max(0,msgs.length-8);
 if(hidden){log.append(button(`이전 대화 ${hidden}개 보기`,()=>{tutorOpen.add(k+'|all');buildThread(box)},'linkish'))}
 for(const m of msgs.slice(hidden)){
  if(m.role==='learner'){const b=E('div','tutor-msg me');b.dataset.status=T.state(m,busy);
   b.append(E('div','tutor-who',m.intent==='check'?'나 · 이해 확인 요청':m.intent==='reply'?'나 · 답':'나'),E('p','tutor-p tutor-own',m.text));
   const st=T.state(m,busy&&m.status==='pending');
   if(st==='pending'){const s=E('p','tiny tutor-wait','답을 쓰는 중…');s.setAttribute('role','status');b.append(s);if(writable)b.append(button('취소',()=>cancelTutor(l.id),'small-action'))}
   else if(st==='interrupted'||st==='failed'){b.append(E('p','tiny tutor-error',st==='interrupted'?'답을 받지 못했어요. 요청이 중간에 끊겼어요.':m.cancelled?'요청을 취소했어요.':'답을 받지 못했어요: '+(m.error||'알 수 없는 오류')));
    if(writable&&provider.online&&!busy)b.append(button('다시 보내기',()=>sendTutor(l.id,m.id),'small-action tutor-retry'))}
   else if(st==='noted'){b.append(E('p','tiny','메모로 남긴 질문이에요.'));if(writable&&provider.online&&!busy)b.append(button('AI에게 보내기',()=>sendTutor(l.id,m.id),'small-action'))}
   log.append(b)}
  else{const b=E('div','tutor-msg ai');b.append(E('div','tutor-who','AI 튜터'));richText(b,m.text);if(typeof tutorSources==='function')tutorSources(b,l,m);
   // A short opinion only on what the learner asserted; questions get an answer, not a label (full assessment stays in the record).
   const op=T.opinionText(m.assessment);if(op){const a=E('p','tutor-assess',op+(m.assessment.quote&&m.assessment.verdict!=='correct'?` — “${m.assessment.quote}”`:''));a.dataset.verdict=m.assessment.verdict;b.append(a)}
   if(m.uncertainty)b.append(E('p','hint tutor-unc','확실하지 않은 점: '+m.uncertainty));
   if(m.followUp){const answered=(l.dialogue||[]).some(x=>x.inReplyTo===m.id);const f=E('div','tutor-follow');f.append(E('p','',m.followUp));
    if(!answered&&writable)f.append(button('이 질문에 답하기',()=>{tutorReplyTo.set(k,m.id);buildThread(box);document.getElementById('tin-'+safe)?.focus()},'small-action tutor-answer'));
    else if(answered)f.append(E('span','tiny','답했어요'));b.append(f)}
   log.append(b)}}
 box.append(log);
 if(!writable)return;
 // Composer
 const replyTo=tutorReplyTo.get(k),rt=replyTo&&(l.dialogue||[]).find(x=>x.id===replyTo);
 const comp=E('div','tutor-compose');
 if(rt){const r=E('div','tutor-replying');r.append(E('span','tiny','답하는 질문: '+rt.followUp),button('취소',()=>{tutorReplyTo.delete(k);buildThread(box)},'linkish'));comp.append(r)}
 const t=area('tin-'+safe,rt?'생각나는 대로 답해 보세요. 모르겠다고 해도 괜찮아요.':o.primary==='reply'?'피드백에 대한 생각, 반론, 궁금한 점을 적어 보세요.':'궁금한 점, 또는 지금 이해한 내용을 적어 보세요.',tutorText.get(k)||'',3);
 t.setAttribute('aria-label',rt?'튜터의 질문에 답하기':'AI 튜터에게 보낼 메시지');t.maxLength=T.MAX_MESSAGE;t.addEventListener('input',()=>tutorText.set(k,t.value));comp.append(t);
 // One send for every ordinary message — a question, "내가 이해한 건…", a challenge. The learner never picks a
 // processing mode: the app reads what kind of utterance it is (utteranceKind) and only assertions get an opinion.
 // In the shared lesson conversation, a question started from a concept section or term carries that context.
 const send=(intent,extra={})=>askTutor(l,{text:t.value,intent,ref:o.composeRef!==undefined?o.composeRef:ref,inReplyTo:rt?rt.id:null,draftKey:k,...extra});
 const online=provider.online,row=E('div','actions tutor-actions');
  // Two explicit actions on ONE composer (learner test: "ask" and "review my understanding" were indistinguishable):
 // 질문하기 answers and never grades; 내 이해 확인받기 treats the text as the learner's own statement and reviews it.
 // Answering a tutor question or a feedback item is a reply (answered first, assertions reviewed).
 const intent=rt?'reply':o.primary,label=online?T.INTENTS[intent].label:'메모로 남기기';
 const main=online?button(label,()=>send(intent),'btn tutor-send'):button(label,()=>send('ask',{noted:true}),'btn tutor-send');main.disabled=busy;row.append(main);
 const canCheck=online&&!rt&&o.primary==='ask';
 if(canCheck){const chk=button(T.INTENTS.check.label,()=>send('check'),'btn secondary tutor-check');chk.disabled=busy;chk.setAttribute('aria-describedby','tmode-'+safe);row.append(chk)}
 // Ctrl/⌘+Enter sends as a question; Enter that confirms a Hangul composition (isComposing / keyCode 229) never sends.
 t.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.isComposing&&e.keyCode!==229&&!main.disabled){e.preventDefault();main.click()}});
 if(online&&o.chips.length){const quick=E('div','tutor-chips');quick.setAttribute('role','group');quick.setAttribute('aria-label','빠른 요청');
  for(const intent of o.chips){const q=button(T.INTENTS[intent].label,()=>send(intent),'pill tutor-chip');q.dataset.intent=intent;q.disabled=busy;quick.append(q)}
  row.append(quick)}
 comp.append(row);
 if(canCheck){const h=E('p','tiny tutor-modes','‘내 이해 확인받기’는 적은 내용을 내 설명으로 보고, 맞는 부분과 다듬을 부분을 짚어 줘요. 질문은 채점하지 않아요.');h.id='tmode-'+safe;comp.append(h)}
 if(!online)comp.append(E('p','hint','AI가 연결되지 않았어요. 메모해 두면 나중에 보낼 수 있어요.'));
 box.append(comp)}
/** Collapsed-by-default inline thread (opened automatically once it has messages). */
function inlineThread(parent,l,ref,label,opts){const k=tKey(l,ref),has=T.stream(l,ref).length>0;
 const wrap=E('div','tutor-inline');parent.append(wrap);
 if(!has&&!tutorOpen.has(k)){if(canWrite()){const b=button(label,()=>{tutorOpen.add(k);wrap.replaceChildren();inlineThread_(wrap,l,ref,opts);document.getElementById('tin-'+T.refKey(ref).replace(/[^\w-]/g,'_'))?.focus()},'small-action tutor-open');wrap.append(b)}return}
 inlineThread_(wrap,l,ref,opts)}
function inlineThread_(wrap,l,ref,opts){const box=E('div','tutor-thread');wrap.append(box);mountThread(box,l,ref,opts)}

/* ---------- stage helpers ---------- */
/* ---------- one help region, opened where the learner is ----------
   Design (vs. a floating overlay): a compact "궁금한 점 묻기" entry sits at the top of every stage, and each
   concept section has its own "이 부분 묻기". Both open the SAME region (there is only ever one), inserted right
   where it was requested, so the learner keeps their place and the context goes with the question. Nothing
   floats over content or primary buttons, no focus trap is needed, and on a phone it is ordinary page flow.
   Thought-experiment and feedback-item conversations stay inline (collapsed) because they belong to that item. */
const helpState=new Map(); // lessonId -> {open, stage, anchor:'top'|'sec:<i>', ref, label, opener}
const reduceMotion=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function helpFor(l){let h=helpState.get(l.id);
 if(!h||h.stage!==l.stage){const live=T.stream(l,null).some(m=>m.role==='learner'&&['pending','failed'].includes(m.status));
  h={open:live,stage:l.stage,anchor:'top',ref:null,label:'',opener:'helpToggle'};helpState.set(l.id,h)}return h}
/** Called after every lesson-stage render: the entry bar near the top, and the region if it was open. */
function mountHelp(m,l){if(!l?.lesson)return;const card=m.querySelector('section.card');if(!card)return;
 const h=helpFor(l),n=T.stream(l,null).filter(x=>x.role==='learner').length;
 const bar=E('div','help-bar');bar.id='helpBar';
 const tg=button(h.open?'AI 튜터 접기':`AI 튜터에게 묻기${n?` · 대화 ${n}개`:''}`,()=>helpFor(l).open?closeHelp(l):openHelp(l,{anchor:'top',opener:'helpToggle'}),'small-action help-toggle');
 tg.id='helpToggle';tg.setAttribute('aria-expanded',String(h.open));tg.setAttribute('aria-controls','helpRegion');bar.append(tg);
 const after=card.querySelector(':scope > .sub')||card.querySelector(':scope > h2');(after||card.firstChild).after(bar);
 if(h.open)placeHelp(l,false)}
function anchorEl(l,h){if(h.anchor.startsWith('sec:')){const el=document.getElementById('sec-'+h.anchor.slice(4));if(el)return el}if(h.anchor==='mat'){const el=document.getElementById('materialViewer');if(el)return el}return document.getElementById('helpBar')}
function placeHelp(l,focus){const h=helpFor(l);document.getElementById('helpRegion')?.remove();const at=anchorEl(l,h);if(!at)return;
 const r=E('section','help-region');r.id='helpRegion';r.setAttribute('aria-label','AI 튜터');r.tabIndex=-1;
 const head=E('div','help-head');head.append(E('h3','','AI 튜터'),button('접기',()=>closeHelp(l),'linkish help-close'));r.append(head);
 r.append(E('p','tiny help-trust','답이 틀릴 수 있어요. 중요한 내용은 출처로 확인해 보세요.')); // stated once here, not on every reply
 if(h.ref){const ctx=E('div','help-context');ctx.append(E('span','',`지금 묻는 부분: ${h.label}`),button('일반 질문으로',()=>{h.ref=null;h.label='';placeHelp(l,true)},'linkish'));r.append(ctx)}
 const gl=T.glossary(l.lesson);
 if(gl.length){const d=E('details','tutor-glossary');d.id='glossary';d.open=tutorOpen.has(l.id+'|glossary');d.addEventListener('toggle',()=>{d.open?tutorOpen.add(l.id+'|glossary'):tutorOpen.delete(l.id+'|glossary')});
  d.append(E('summary','',`용어 풀이 (${gl.length}개)`));
  for(const g of gl){const row=E('div','tutor-term');row.append(E('strong','',g.term),E('p','',g.plain));if(g.example)row.append(E('p','hint','예: '+g.example));
   if(canWrite()&&provider.online)row.append(button('AI에게 더 물어보기',()=>askTutor(l,{intent:'meaning',ref:{kind:'term',term:g.term},quickText:`“${g.term}”이(가) 무슨 뜻인지 쉽게 설명해 줘.`}),'linkish'));d.append(row)}
  r.append(d)}
 const box=E('div','tutor-thread');box.id='tutorThread';r.append(box);
 mountThread(box,l,null,{primary:'ask',chips:['simpler','example','direct'],composeRef:h.ref});
 r.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeHelp(l)}});
 at.after(r);
 const tg=document.getElementById('helpToggle');if(tg){tg.setAttribute('aria-expanded','true');tg.textContent='AI 튜터 접기'}
 if(focus){r.scrollIntoView({block:'nearest',behavior:reduceMotion()?'auto':'smooth'});(r.querySelector('#tutorThread textarea')||r).focus({preventScroll:true})}}
function openHelp(l,{anchor='top',ref=null,label='',opener='helpToggle'}={}){const h=helpFor(l);Object.assign(h,{open:true,anchor,ref,label,opener});placeHelp(l,true)}
function closeHelp(l){const h=helpFor(l);h.open=false;document.getElementById('helpRegion')?.remove();
 const tg=document.getElementById('helpToggle');if(tg){tg.setAttribute('aria-expanded','false');const n=T.stream(l,null).filter(x=>x.role==='learner').length;tg.textContent=`AI 튜터에게 묻기${n?` · 대화 ${n}개`:''}`}
 document.getElementById(h.opener)?.focus()}
/** "이 부분 묻기" under a concept section: opens the one help region right below that section, with its context. */
function helpLink(block,l,i,heading){block.id='sec-'+i;const b=button('이 부분 묻기',()=>openHelp(l,{anchor:'sec:'+i,ref:{kind:'section',i},label:heading,opener:'ask-sec-'+i}),'small-action help-ask');
 b.id='ask-sec-'+i;b.setAttribute('aria-label',`‘${heading}’에 대해 묻기`);b.setAttribute('aria-controls','helpRegion');block.append(b)}

/** Story stage: plain-language prerequisites before any prediction (open for beginners, easy to fold away).
    Progressive: the terms the story and its question actually use come first (at most three shown); any others wait
    behind "더 보기". Each term is a short definition and one example; "더 자세히" asks the tutor without leaving the page. */
const PREREQ_FIRST=3;
function termRow(l,p){const row=E('div','tutor-term');row.append(E('strong','',p.term),E('p','',p.plain));if(p.example)row.append(E('p','hint','예: '+p.example));
 if(canWrite()&&provider.online){const more=button('더 자세히',()=>{openHelp(l,{anchor:'top',ref:{kind:'term',term:p.term},label:p.term,opener:'helpToggle'});askTutor(l,{intent:'meaning',ref:{kind:'term',term:p.term},quickText:`“${p.term}”이(가) 무슨 뜻인지 조금 더 자세히 알려 주세요.`})},'linkish term-more');more.setAttribute('aria-label',`‘${p.term}’ 더 자세히 묻기`);row.append(more)}
 return row}
function prereqBlock(c,l){const pre=l.lesson.prerequisites||[];if(!pre.length)return;
 const d=E('details','note prereq');d.id='prereqs';const k=l.id+'|prereq';
 d.open=tutorOpen.has(k)?true:tutorOpen.has(k+'|closed')?false:(latestProfile()?.depth||l.level)==='beginner';
 d.addEventListener('toggle',()=>{tutorOpen.delete(k);tutorOpen.delete(k+'|closed');tutorOpen.add(d.open?k:k+'|closed')});
 d.append(E('summary','',T.prereqLabel(pre.length)));
 const used=new Set(T.termsIn([l.lesson.story,l.lesson.prediction].join(' '),pre.map(p=>({...p,source:'prerequisite'}))).map(g=>g.term));
 const order=[...pre.filter(p=>used.has(p.term)),...pre.filter(p=>!used.has(p.term))],first=order.slice(0,PREREQ_FIRST),rest=order.slice(PREREQ_FIRST);
 for(const p of first)d.append(termRow(l,p));
 if(rest.length){const mk=l.id+'|prereq-more',wrap=E('div','prereq-more');wrap.id='prereqMore';
  const draw=()=>{wrap.replaceChildren();if(tutorOpen.has(mk))for(const p of rest)wrap.append(termRow(l,p));else{const b=button(`개념 ${rest.length}개 더 보기`,()=>{tutorOpen.add(mk);draw();wrap.querySelector('strong')?.scrollIntoView?.({block:'nearest'})},'linkish');b.setAttribute('aria-expanded','false');wrap.append(b)}};draw();d.append(wrap)}
 c.append(d)}

/** Before the options: terms this question uses (from the glossary) and an optional hint. */
function scenarioHelp(box,l,s,i,rec){
 const terms=T.termsIn([s.question,...s.options].join(' '),T.glossary(l.lesson));
 // Open when the question uses a lesson concept the learner has not been shown yet (concepts are read in the next stage), or for beginners.
 if(!rec&&terms.length){const d=E('details','tutor-terms');d.open=terms.some(g=>g.source==='concept')||(latestProfile()?.depth||l.level)==='beginner';d.append(E('summary','',T.prereqLabel(terms.length)));
  for(const g of terms){const row=E('div','tutor-term');row.append(E('strong','',g.term),E('p','',g.plain));d.append(row)}box.append(d)}
 if(!rec&&s.hint){const k=l.id+'|hint|'+i,h=E('div','tutor-hint');
  if(tutorOpen.has(k))h.append(E('p','info','힌트: '+s.hint));else h.append(button('힌트 보기',()=>{tutorOpen.add(k);h.replaceChildren(E('p','info','힌트: '+s.hint))},'small-action'));box.append(h)}}
/** After the outcome (or while still deciding): a conversation about this thought experiment. */
function scenarioAsk(box,l,i,rec){
 inlineThread(box,l,{kind:'scenario',i},rec?'이 해설에 대해 묻기':'이 문제에 대해 묻기',{primary:'ask',chips:rec?['simpler','example']:['hint','simpler']})}

/** Stage 3, progressive: the essential explanation is shown — plain words, then the representation that carries the
    idea (the lesson's visual, or its cause→effect steps as a sequence), then the precise text. The example, common
    misreading and conditions sit behind ONE "더 보기" per section. Nothing is removed or shortened. */
const TECH_MORE=[['example','예시'],['steps','단계별 원리'],['misread','흔한 오해'],['conditions','조건과 한계']];
function techLayers(b,x,key){
 if(!(x.plain||x.example||x.steps?.length||x.visual)){b.append(E('p','',x.text));return} // lessons made before this change: unchanged
 if(x.plain)b.append(E('p','tech-plain',x.plain));
 const vis=x.visual?T.cleanVisual(x.visual):null,seq=!vis&&x.steps?.length>=2;
 if(vis)visualBlock(b,x.visual);
 else if(seq){const f=E('div','tech-sequence');f.append(E('p','tech-label','단계별로 보기'));const ol=E('ol','tech-steps');ol.setAttribute('aria-label',`${x.heading||''} 단계별 원리`);for(const st of x.steps)ol.append(E('li','',st));f.append(ol);b.append(f)}
 const precise=E('div','tech-precise');precise.append(E('strong','tech-label','정확한 설명'));richText(precise,x.text);b.append(precise);
 const more=TECH_MORE.filter(([k])=>k==='steps'?x.steps?.length&&!seq:x[k]);if(!more.length)return;
 const d=E('details','tech-more');const id=key+'|more';d.open=tutorOpen.has(id);d.addEventListener('toggle',()=>{d.open?tutorOpen.add(id):tutorOpen.delete(id)});
 d.append(E('summary','','더 보기 · '+more.map(([,label])=>label).join(' · ')));
 for(const [k,label] of more){const part=E('div','tech-layer');part.dataset.layer=k;part.append(E('p','tech-label',label));
  if(k==='steps'){const ol=E('ol','tech-steps');for(const st of x.steps)ol.append(E('li','',st));part.append(ol)}else if(k==='example')richText(part,x.example);else part.append(E('p','',x[k]));
  d.append(part)}
 b.append(d)}
/** A visual explanation from the constrained lesson format (T.cleanVisual). Built only from text nodes in fixed
    semantic markup, so the list or table IS the text equivalent for screen readers; no animation; invalid
    specs never reach here (they are dropped when the lesson is installed). */
const RELATION_TEXT={cause:'원인 → 결과의 흐름이에요.',sequence:'순서대로 이어지는 과정이에요.',possible:'이렇게 이어질 수 있다는 흐름이에요. 항상 그렇게 되는 것은 아니에요.'};
function visualBlock(parent,v){const vis=T.cleanVisual(v);if(!vis)return;
 const fig=E('figure','viz viz--'+vis.type);fig.dataset.visual=vis.type;
 if(vis.type==='flow'){fig.append(E('figcaption','viz-title',vis.title));
  const ol=E('ol','viz-flow');ol.setAttribute('aria-label',vis.title+' — '+RELATION_TEXT[vis.relation]);
  vis.steps.forEach((st,i)=>{const li=E('li','viz-step');li.append(E('strong','',st.label));if(st.detail)li.append(E('span','',st.detail));
   if(i<vis.steps.length-1){const a=E('span','viz-arrow',vis.relation==='possible'?'⇣':'↓');a.setAttribute('aria-hidden','true');li.append(a)}ol.append(li)});
  fig.append(ol,E('p','tiny viz-note',RELATION_TEXT[vis.relation]+(vis.note?' '+vis.note:'')))}
 else{const wrap=E('div','viz-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',vis.title);
  const tb=E('table','viz-table'),cap=E('caption','viz-title',vis.title),hr=E('tr');hr.append(Object.assign(E('th','','구분'),{scope:'col'}));
  for(const c of vis.columns)hr.append(Object.assign(E('th','',c),{scope:'col'}));const thead=E('thead');thead.append(hr);const tbody=E('tbody');
  for(const r of vis.rows){const tr=E('tr');tr.append(Object.assign(E('th','',r.aspect),{scope:'row'}));for(const x of r.values)tr.append(E('td','',x));tbody.append(tr)}
  tb.append(cap,thead,tbody);wrap.append(tb);fig.append(wrap);if(vis.note)fig.append(E('p','tiny viz-note',vis.note))}
 parent.append(fig)}
/** End of stage 3: ONE place that says where the content comes from, kept apart by kind —
      수업 자료 근거  the cited words are on that page of the uploaded file (not proof the file is right);
      AI 설명         generated, not checked against any source;
      검색어 제안     search pages the learner can open (labelled as searches, never as references).
    What the lesson flags as uncertain stays visible (not folded away); only the search list is optional detail.
    CURIVEN has no verified external reference on the normal route, so none is ever shown as one. */
function sourcesBlock(c,l){const d=l.lesson,list=T.readingList(l),m=l.material;
 const box=E('section','sources');box.id='sources';box.setAttribute('aria-labelledby','sourcesTitle');const h=E('h3','','출처와 정확성');h.id='sourcesTitle';box.append(h);
 const kinds=E('ul','source-kinds');
 if(m){const li=E('li','');li.append(E('strong','','수업 자료 근거'),document.createTextNode(` — 📄 쪽 표시는 올린 파일(${m.name})의 그 쪽에 같은 글이 있다는 뜻이에요. 파일 내용이 맞다는 확인은 아니에요.`));kinds.append(li)}
 const ai=E('li','');ai.append(E('strong','','AI 설명'),document.createTextNode(m?' — ‘AI가 덧붙인 설명’ 표시와 나머지 설명은 AI가 만들었고, 출처로 확인하지 않았어요.':' — 이 설명은 AI가 만들었고, 아직 출처로 확인하지 않았어요.'));kinds.append(ai);box.append(kinds);
 if(d.limitations){const lim=E('p','sources-limit');lim.id='limitations';lim.append(E('strong','','확인이 필요한 부분 '),document.createTextNode(d.limitations));box.append(lim)}
 if(list.length){const k=l.id+'|sources',det=E('details','sources-search');det.id='sourcesSearch';det.open=tutorOpen.has(k);det.addEventListener('toggle',()=>{det.open?tutorOpen.add(k):tutorOpen.delete(k)});
  det.append(E('summary','',list[0].status==='ai-suggested'?`직접 찾아보기 · 검색어 ${list.length}개 (AI 제안 · 아직 확인 안 됨)`:`직접 찾아보기 · 개념 이름으로 찾아보기`));const ul=E('ul','sources-list');
  for(const r of list){const li=E('li','');li.dataset.status=r.status;li.append(E('span','',r.claim+(r.kind?` — ${r.kind}`:'')));
   for(const x of r.links){const a=E('a','sources-link',x.label+' ↗');a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',`‘${r.query}’ ${x.label} 결과 (새 창)`);li.append(' ',a)}ul.append(li)}
  det.append(ul,E('p','tiny','검색 결과 페이지로 연결돼요. 링크 자체는 출처가 아니에요. 교과서, 학술 논문, 공식 문서처럼 저자와 출처가 분명한 자료를 골라 보세요.'));box.append(det)}
 c.append(box)}

/** Under each feedback (summary) and each feedback item with a question: answer it or ask about it. */
function feedbackReplies(target,l,draft,type,index,label){
 // The reference carries the item's ids and words as shown now (T.itemRef), so it stays tied to THIS item.
 inlineThread(target,l,T.itemRef(l,draft,type,index),label,{primary:'reply',chips:['direct','simpler','example']})}

/* ---------- Markdown note ---------- */
function exportNote(l){if(!l?.lesson){toast('노트로 내보낼 탐험을 먼저 선택해 주세요.');return}
 const md=window.CuriConcept.exportMarkdown(l),b=new Blob([md],{type:'text/markdown;charset=utf-8'}),a=document.createElement('a');
 a.href=URL.createObjectURL(b);a.download=N.fileName(l);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),800)}
/** Learning-journey archive (journey.js): shown in full first, downloaded only on request. Local only — no AI, no
    server, no Notion; the record is read, never changed (no draft flush either). */
function openJourney(l){if(!l){toast('기록으로 내보낼 탐험을 먼저 선택해 주세요.');return}
 let md;try{md=window.CuriJourney.markdown(l)}catch(e){toast('학습 과정 기록을 만들지 못했어요: '+e.message);return}
 document.getElementById('journeyDialog')?.remove();
 const d=E('dialog','settings journey');d.id='journeyDialog';d.setAttribute('aria-labelledby','journeyTitle');
 const head=E('div','settings-head'),h=E('h2','','학습 과정 기록 미리 보기');h.id='journeyTitle';
 const x=button('×',()=>d.close(),'settings-close');x.setAttribute('aria-label','미리 보기 닫기');head.append(h,x);
 const body=E('div','settings-body');
 body.append(E('p','journey-note','이 탐험에서 내가 쓴 글, 처음 예상, 설명, AI와 나눈 대화 전체가 들어 있어요. 내려받은 파일은 이 기기에만 저장되고, 어디에도 올리거나 공유하지 않아요. 다른 사람과 나누기 전에 내용을 확인해 주세요.'));
 body.append(E('p','tiny',`${md.split('\n').length.toLocaleString()}줄 · ${md.length.toLocaleString()}자 · ${window.CuriJourney.FORMAT}`));
 const pre=E('pre','journey-preview');pre.id='journeyPreview';pre.tabIndex=0;pre.setAttribute('aria-label','내려받을 Markdown 내용');pre.textContent=md;body.append(pre);
 const foot=E('div','settings-foot'),dl=button('Markdown 파일로 내려받기',()=>{const b=new Blob([md],{type:'text/markdown;charset=utf-8'}),a=document.createElement('a');
  a.href=URL.createObjectURL(b);a.download=window.CuriJourney.fileName(l);a.click();setTimeout(()=>URL.revokeObjectURL(a.href),800)},'btn');dl.id='journeyConfirm';
 foot.append(dl,button('닫기',()=>d.close(),'btn secondary'));d.append(head,body,foot);
 d.addEventListener('close',()=>d.remove());document.body.append(d);if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')}
