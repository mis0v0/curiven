/* CURIVEN readable learning note (Markdown) — pure, offline, shared by the browser and Node tests.
   The JSON backup stays the lossless format; this note is a learning artifact for reading (and for pasting or
   importing into tools such as Notion — not verified by an actual import).
   Shape: a short learning journey first (question → first thoughts → concepts and visual summaries → what the
   thought experiments showed → my explanations and ideas → points to revisit and open questions → my questions →
   sources), then an appendix with the full concept text and every conversation, so no evidence is lost.
   Rules:
   - Learner-written text is reproduced exactly: Markdown-significant characters are backslash-escaped (so they
     render as typed) and line breaks become hard breaks. Nothing is trimmed, reworded or summarised.
   - AI-generated parts are attributed (once at the top, and per speaker in conversations), never as verified fact.
   - A question counts as answered only on recorded evidence (an explicit reply, or the learner's own answer in that
     item's thread); when the record cannot tell, it says so instead of marking it resolved.
   - Internal bookkeeping (judgement caps, withheld judgements, format repairs) stays in the JSON record only.
   - Only this lesson is included: no profile, account, provider credentials or other lessons.
   - Plain CommonMark (ATX headings, lists, block quotes, fenced code, links): no HTML, tables or footnotes. */
'use strict';
(function(root){
 const L=root.CuriLearning||(typeof require==='function'?require('./learning.js'):null);
 const T=root.CuriTutor||(typeof require==='function'?require('./tutor.js'):null);
 const M=root.CuriMaterial||(typeof require==='function'?require('./material.js'):null);
 const C=root.CuriCopy||(typeof require==='function'?require('./copy.js'):null);
 const B=root.CuriBoundary||(typeof require==='function'?(()=>{try{return require('./boundary.js')}catch{return null}})():null);

 /** Escapes inline Markdown so the text renders exactly as written; keeps line breaks as hard breaks. */
 function esc(text){
  return String(text??'').replace(/\r\n?/g,'\n').split('\n').map(line=>{
   let x=line.replace(/[\\`*_\[\]<>#|~&$]/g,'\\$&');
   x=x.replace(/^(\s*)([-+=])(?=\s|$)/,'$1\\$2').replace(/^(\s*)(\d+)([.)])(?=\s|$)/,'$1$2\\$3');
   // Leading spaces would be dropped (or start a code block) when rendered; keep them visible as no-break spaces.
   return x.replace(/^ +/,m=>' '.repeat(m.length));
  }).join('  \n');
 }
 /** Text that may contain ``` code fences (AI replies): fences become real code blocks, the rest is escaped. */
 function rich(text){
  const out=[],re=/```([\w+-]*)[^\n]*\n?([\s\S]*?)```/g;let last=0,m;const src=String(text??'');
  while((m=re.exec(src))){if(m.index>last)out.push(esc(src.slice(last,m.index).replace(/^\n+|\n+$/g,'')));out.push(fence(m[2].replace(/\n$/,''),m[1]));last=re.lastIndex}
  if(last<src.length)out.push(esc(src.slice(last).replace(/^\n+|\n+$/g,'')));
  return out.filter(x=>x!=='').join('\n\n');
 }
 /** Fenced code block whose fence is longer than any backtick run inside, so content is kept verbatim. */
 function fence(code,lang=''){const run=Math.max(2,...(String(code).match(/`+/g)||['']).map(x=>x.length));const f='`'.repeat(run+1);return `${f}${lang}\n${code}\n${f}`}
 const quote=block=>block.split('\n').map(x=>x?'> '+x:'>').join('\n');
 const pad=n=>String(n).padStart(2,'0');
 function when(ms){if(!Number.isFinite(ms))return '기록 없음';const d=new Date(ms);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
 const evTime=e=>{const t=Date.parse(e?.at);return Number.isFinite(t)?t:null};
 const title=t=>L?L.scenarioTitle(t):String(t||'');
 const key=t=>L?L.normQuote(t):String(t||'').toLowerCase();
 const link=(label,url)=>`[${label}](${String(url).replace(/\(/g,'%28').replace(/\)/g,'%29')})`;

 /* ---------- what the record says about questions ---------- */
 const dlg=l=>Array.isArray(l?.dialogue)?l.dialogue:[];
 const typed=m=>m.role==='learner'&&!m.quick;
 const isQuestion=m=>m.status==='noted'||/[?？]/.test(m.text)||(L?['question','check'].includes(L.utteranceKind(m.text)):false);
 /** The learner's own questions, each once (exact first wording), with how often it was sent and whether an answer
     was recorded for any of those sends. */
 function myQuestions(l){const out=new Map();
  for(const m of dlg(l)){if(!typed(m)||!isQuestion(m))continue;const k=key(m.text);if(!k)continue;
   const e=out.get(k)||{text:m.text,count:0,answered:false,noted:false,failed:false};e.count++;
   if(T&&T.replyOf(l,m))e.answered=true;else if(m.status==='noted')e.noted=true;else if(m.status==='failed'||m.status==='pending')e.failed=true;out.set(k,e)}
  return [...out.values()]}
 /** What the learner said that was not a question (ideas, answers, explanations in conversation), each once. */
 function myIdeas(l){const seen=new Set(),out=[];for(const m of dlg(l)){if(!typed(m)||isQuestion(m))continue;const k=key(m.text);if(!k||seen.has(k))continue;seen.add(k);out.push(m)}return out}
 /** Questions the AI asked, with what the record shows about the learner's response:
     'answered'  – explicit reply to that question, or the learner's own (non-question) message in that feedback item's thread;
     'continued' – the conversation went on in that thread, but only with questions: not marked as answered;
     'open'      – no response recorded. */
 function aiQuestions(l){const out=[],seen=new Set(),add=(q,status,from)=>{const k=key(q);if(!k||seen.has(k))return;seen.add(k);out.push({question:q,status,from})};
  const last=(l.drafts||[]).filter(d=>d.feedback).at(-1),f=last&&T?T.validFeedback(l,last):null;
  if(f)for(const type of ['misconceptions','precision','missing'])f[type].forEach((x,index)=>{
   const mine=T.stream(l,T.itemRef(l,last,type,index)).filter(typed);
   add(x.question,mine.some(m=>!isQuestion(m))?'answered':mine.length?'continued':'open','feedback')});
  for(const m of dlg(l)){if(m.role!=='tutor'||!m.followUp)continue;
   const explicit=dlg(l).some(x=>x.role==='learner'&&x.inReplyTo===m.id);
   const after=!explicit&&T?(()=>{const s=T.stream(l,dlg(l).find(x=>x.id===m.replyTo)?.ref??null),i=s.indexOf(m);return s.slice(i+1).some(typed)})():false;
   add(m.followUp,explicit?'answered':after?'continued':'open','tutor')}
  return out}
 /** Review prompts not yet answered (compatibility name): the AI questions whose status is not 'answered'. */
 const suggestions=l=>aiQuestions(l).filter(q=>q.status!=='answered').map(q=>q.question).slice(0,10);

 /** `notion:true` — the page title is the Notion page's own title (no H1), and the full transcript appendix is left
     out (the saved page is the learning journey; every original record stays in CURIVEN and its JSON backup).
     `history:true` (Phase 2E) — the learning-history part of a concept note: no title, no concept glossary or sources
     section (the concept note has them), headings `shift`ed down, the full appendix kept unless `transcript:false`;
     with `notion`, headings deeper than Notion's h4 become bold lines. */
 function lessonMarkdown(l,{now=Date.now(),notion=false,history=false,shift=0,transcript=true,lists=true}={}){
  const d=l.lesson||{},o=[],h=(n,t)=>{const k=n+shift;o.push(notion&&k>4?`**${esc(t)}**`:`${'#'.repeat(k)} ${esc(t)}`,'')};
  const times=[l.createdAt,l.updatedAt,...(l.events||[]).map(evTime),...dlg(l).map(m=>m.at)].filter(Number.isFinite);
  const gen=l.generatedBy?.provider==='manual-import'?'직접 가져온 JSON':[l.generatedBy?.provider,l.generatedBy?.model].filter(Boolean).join(' · ')||'기록 없음';
  const id=C?C.identity(l):{title:d.title||l.topic,question:l.topic,file:null};
  if(!notion&&!history)h(1,`${id.title} — CURIVEN 학습 노트`);
  o.push(id.question?`- **처음 궁금했던 것:** ${esc(id.question)}`:'- **처음 궁금했던 것:** _질문 없이 수업 자료에서 시작했어요._',`- **기간:** ${when(l.createdAt)} ~ ${when(times.length?Math.max(...times):null)}`,
   `- **상태:** ${l.complete?'탐험 완료':'진행 중'}`,`- **학습 자료:** AI가 만든 설명이에요 (${esc(gen)}). 출처로 확인하거나 숙달을 판정한 기록은 아니에요.`);
  const mat=l.material&&M?l.material:null;
  if(mat)o.push(`- **수업 자료:** ${esc(mat.name)} (${M.kindName(mat)}, ${mat.pageCount}${mat.kind==='pptx'?'장':'쪽'}${mat.unreadable?.length?`; 읽지 못한 곳 ${mat.unreadable.map(n=>M.label(mat,n)).join(', ')}`:''})`);
  o.push('');
  const refs=x=>{if(!mat)return '';const src=M.verify(x.sources,mat);return src.length?` _(수업 자료 ${[...new Set(src.map(s=>M.label(mat,s.page)))].join(', ')})_`:' _(AI 보충)_'};

  // 1–2. The question and what I first thought
  h(2,'처음 생각');
  if(d.prediction)o.push(`**예상 질문:** ${esc(d.prediction)}`,'');
  o.push(l.prediction?`**내 예상:** ${esc(l.prediction)}`:l.predictionUnsure?'**내 예상:** _“아직 잘 모르겠어요”라고 하고 넘어갔어요._':'**내 예상:** _기록 없음_','');

  // 3. Concepts and visual summaries
  if(!history&&(d.concepts?.length||d.prerequisites?.length)){h(2,'핵심 개념');
   if(d.prerequisites?.length){o.push('**먼저 알아볼 개념**','');for(const p of d.prerequisites)o.push(`- **${esc(p.term)}** — ${esc(p.plain)}`);o.push('')}
   if(d.concepts?.length){if(d.prerequisites?.length)o.push('**이 탐험의 개념**','');for(const c of d.concepts)o.push(`- **${esc(c.name)}** — ${esc(c.description)}${refs(c)}`);o.push('')}
   if(d.connections?.length){const name=new Map((d.concepts||[]).map(c=>[c.id,c.name]));o.push('**개념 사이의 연결**','');
    for(const c of d.connections)o.push(`- ${esc(name.get(c.from)||c.from)} ↔ ${esc(name.get(c.to)||c.to)}${c.why?' — '+esc(c.why):''}`);o.push('')}
   for(const t of d.technical||[]){const v=T?T.cleanVisual(t.visual):null;if(v)visualMd(o,v)}}

  // 4. Discoveries from the thought experiments
  if(d.scenarios?.length){h(2,'사고 실험에서 발견한 것');
   o.push('_AI가 만든 가상 상황이에요. 실제로 한 실험이 아니에요._','');
   d.scenarios.forEach((sc,i)=>{const r=(l.scenarios||[]).find(x=>x.i===i),name=title(sc.title)||`사고 실험 ${i+1}`;
    h(3,`${i+1}. ${name}`);o.push(esc(sc.question),'');
    if(!r)o.push('- 내 선택: _아직 답하지 않음_','');
    else{const unsure=r.unsure||r.choice==null;
     o.push(`- 내 선택: ${unsure?'_잘 모르겠다고 함_':esc(sc.options[r.choice]??'?')}`,`- 해설의 결과: ${esc(sc.options[sc.answerIndex])}${unsure?'':r.choice===sc.answerIndex?' (내 예상과 같음)':' (내 예상과 다름)'}`,`- 해설: ${esc(sc.reason)}`,'')}});
   if(l.reflection)o.push('**예상과 비교해 바뀐 내 생각:**','',esc(l.reflection),'')}

  // 5. My explanations, feedback and ideas
  const drafts=l.drafts||[],ideas=myIdeas(l);
  h(2,'내 설명과 생각의 변화');
  if(d.explainPrompt)o.push(`**설명 질문:** ${esc(d.explainPrompt)}`,'');
  if(!drafts.length)o.push('_아직 남긴 설명이 없어요._','');
  drafts.forEach((dr,i)=>{h(3,`설명 ${i+1} · ${i===0?'처음 쓴 설명':'고쳐 쓴 설명'} · ${when(dr.at)}`);o.push(esc(dr.text),'');
   const f=T?T.validFeedback(l,dr):null;
   if(f){o.push(`**AI 피드백${f.reviewer?.model?' ('+esc(f.reviewer.model)+')':''}:** ${esc(f.summary)}`,'');
    const q=x=>{const v=L?L.verbatimQuote(x.quote,dr.text):null;return v?`“${esc(v)}” — `:''};
    for(const x of f.correct)o.push(`- 잘한 점: ${q(x)}${esc(x.point)}`);
    for(const x of f.precision)o.push(`- 다듬을 점: ${q(x)}${esc(x.issue)}`);
    for(const x of f.misconceptions)o.push(`- 다시 생각할 점: ${q(x)}${esc(x.issue)}`);
    for(const x of f.missing)o.push(`- 빠진 조건: ${esc(x.issue)}`);
    if(f.uncertainty)o.push(`- AI가 판단하지 못한 점: ${esc(f.uncertainty)}`);
    o.push('')}
   else if(dr.feedbackError)o.push(`_AI 피드백을 받지 못했어요: ${esc(dr.feedbackError)}_`,'')});
  if(ideas.length&&lists){h(3,'대화에서 말한 내 생각');for(const m of ideas)o.push(`- ${esc(m.text.trimEnd())}`);o.push('')}

  // 6. My questions (the learner's own, verbatim)
  const mq=myQuestions(l);
  h(2,'내가 던진 질문');
  if(mq.length&&!lists)o.push(`_직접 남긴 질문 ${mq.length}개는 CURIVEN과 백업 파일에 있어요._`,'');
  else if(mq.length){for(const x of mq)o.push(`- ${esc(x.text.trimEnd())}${x.count>1?` _(${x.count}번 물어봄)_`:''}${x.answered?' _(답을 받음)_':x.noted?' _(메모만 함)_':x.failed?' _(답을 받지 못함)_':''}`);o.push('')}
  else o.push('_별도로 모은 대화 질문이 없어요. 내 설명에 적은 질문은 설명 원문에서 볼 수 있어요._','');

  // 7. Points to revisit and open questions (from AI feedback and tutor questions; status from the record)
  const aq=aiQuestions(l),open=aq.filter(q=>q.status!=='answered');
  h(2,'다시 볼 점과 남은 질문');
  if(!aq.length)o.push('_AI가 남긴 질문이 없어요._','');
  else{if(open.length){o.push('_AI 피드백과 튜터가 던진 질문 중 아직 답하지 않은 것이에요. 내가 쓴 질문이 아니에요._','');
    for(const x of open)o.push(`- ${esc(x.question)}${x.status==='continued'?' _(이 질문에 대한 대화를 이어 갔지만, 답했다는 기록은 없어요)_':''}`);o.push('')}
   const done=aq.length-open.length;if(done)o.push(`_AI가 던진 질문 ${done}개에는 답했어요. 내용은 ${notion&&!history?'CURIVEN':history?'아래 원래 기록':'부록'}의 대화 기록에 있어요._`,'')}

  const bd=B&&l.boundary&&B.usable(l.boundary)?l.boundary:null;
  if(bd){const ev=B.evidence(bd);h(2,'경계 비교 활동 (개발용 미리보기 · 검토 중인 자료)');
   for(const sit of bd.content.situations){const p=bd.predictions.find(x=>x.situationId===sit.id);o.push(`- **${esc(sit.title)}** — 내 예측: ${p?esc(p.text):'_없음_'}`)}
   if(bd.explanation)o.push('',`**내 설명:** ${esc(bd.explanation.text)}`);
   o.push('',`_${esc(B.describe(ev,bd.content.concepts))}_`,'')}

  // 8. Sources and reliability — one place (a concept note has its own)
  if(history){if(!transcript)return o.join('\n').replace(/\n{3,}/g,'\n\n').trim();}
  else{h(2,'출처와 신뢰도');
  o.push(`- 학습 자료, 해설, 피드백, 튜터 답변은 AI가 만든 내용이에요 (${esc(gen)}). 출처로 확인된 내용은 아직 없어요.`);
  if(mat){o.push(`- 수업 자료 표시(‘수업 자료 p.N’)는 그 내용이 올린 파일에서 왔다는 뜻이에요. 파일 내용이 맞다는 확인은 아니에요. ‘AI 보충’은 파일에 없는 AI 설명이에요.`);
   for(const t of d.technical||[]){const src=M.verify(t.sources,mat);if(src.length)o.push(`- ${esc(t.heading)}: ${src.map(s=>`${M.label(mat,s.page)} “${esc(M.excerpt(mat,s))}”`).join(' · ')}`)}}
  if(d.limitations)o.push(`- 확인이 필요한 부분: ${esc(d.limitations)}`);
  if(bd)o.push(`- 경계 비교 자료: ${esc(bd.pack.id)} (검토 상태: ${esc(bd.pack.gate.reviewStatus||'알 수 없음')}).`);
  o.push('- 이 노트는 숙달이나 영구적인 이해를 판정하지 않아요.','');
  const rl=T&&d.concepts?T.readingList(l):[];
  if(rl.length){o.push(rl[0].status==='ai-suggested'?'**찾아볼 곳 (AI 제안 · 아직 확인 안 됨):**':'**개념 이름으로 찾아보기 (앱이 만든 검색 링크):**','');
   for(const r of rl)o.push(`- ${esc(r.claim)}${r.kind?' — '+esc(r.kind):''}: ${r.links.map(x=>link(x.label,x.url)).join(' · ')}`);o.push('')}}

  // 9. Appendix: the full record
  if(notion&&!history){o.push('---','',`_CURIVEN에서 ${when(now)}에 저장한 학습 노트예요. 개념 설명 전문과 대화 기록은 CURIVEN과 백업 파일에 그대로 있어요._`,'');return o.join('\n').replace(/\n{3,}/g,'\n\n')}
  h(2,history?'원래 기록':'부록: 전체 기록');
  if(d.technical?.length){h(3,history?'처음 받은 개념 설명 (AI 생성)':'개념 설명 전문 (AI 생성)');
   for(const t of d.technical){h(4,t.heading);
    if(t.plain)o.push(`**쉬운 말:** ${esc(t.plain)}`,'');
    if(t.example)o.push('**예시:**','',rich(t.example),''); // own block, so a code fence starts at the line start
    if(t.steps?.length){o.push('**단계별 원리:**','');t.steps.forEach((x,i)=>o.push(`${i+1}. ${esc(x)}`));o.push('')}
    o.push(rich(t.text),'');
    if(t.misread)o.push(`**흔한 오해:** ${esc(t.misread)}`,'');
    if(t.conditions)o.push(`**조건과 한계:** ${esc(t.conditions)}`,'')}}
  const threads=[];
  (d.scenarios||[]).forEach((sc,i)=>threads.push([`사고 실험 ${i+1}${title(sc.title)?' · '+title(sc.title):''}`,{kind:'scenario',i}]));
  for(const dr of drafts){const f=T?T.validFeedback(l,dr):null;if(!f)continue;const n=drafts.indexOf(dr)+1;
   threads.push([`설명 ${n}의 피드백 전체`,T.itemRef(l,dr,'summary',0)]);
   for(const [type,label] of [['precision','다듬을 점'],['misconceptions','다시 생각할 점'],['missing','빠진 조건']])f[type].forEach((x,index)=>threads.push([`설명 ${n}의 ${label} — ${x.question}`,T.itemRef(l,dr,type,index)]));
   // follow-ups whose item can no longer be identified: kept, under their own heading, never under another item
   const loose=T.unplaced(l,dr);if(loose.length)threads.push([`설명 ${n}의 피드백 — 어느 항목에 대한 대화인지 확인할 수 없음`,loose])}
  if(T){const lost=T.unlinked(l);if(lost.length)threads.push(['어느 설명의 피드백에 대한 대화인지 확인할 수 없음',lost])}
  threads.push(['AI 튜터와의 대화 (이 탐험 전체)',null]);
  const shown=threads.map(([label,ref])=>[label,Array.isArray(ref)?ref:T?T.stream(l,ref):[]]).filter(([,msgs])=>msgs.length);
  if(shown.length){h(3,'대화 기록');o.push('_내 메시지는 쓴 그대로, AI 답변은 확인되지 않은 참고 의견이에요._','');
   for(const [label,msgs] of shown){h(4,label);threadMd(o,l,msgs)}}

  if(history)return o.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  o.push('---','',`_CURIVEN에서 ${when(now)}에 만든 학습 노트예요. 모든 원본 기록은 백업 파일(JSON)에 있어요._`,'');
  return o.join('\n').replace(/\n{3,}/g,'\n\n');
 }
 /** A visual explanation as Markdown text (its own text equivalent): numbered steps, or a list per row. */
 function visualMd(o,v){o.push(`**그림으로 보기 — ${esc(v.title)}**`,'');
  if(v.type==='flow'){v.steps.forEach((s,i)=>o.push(`${i+1}. **${esc(s.label)}**${s.detail?' — '+esc(s.detail):''}`));
   o.push('',`_${v.relation==='cause'?'원인 → 결과의 흐름':v.relation==='possible'?'이렇게 이어질 수 있다는 흐름 (항상 그런 것은 아님)':'순서대로 이어지는 과정'}${v.note?' · '+esc(v.note):''}_`,'')}
  else{for(const r of v.rows)o.push(`- **${esc(r.aspect)}** — ${r.values.map((x,i)=>`${esc(v.columns[i])}: ${esc(x)}`).join(' / ')}`);o.push('');if(v.note)o.push(`_${esc(v.note)}_`,'')}}
 function threadMd(o,l,msgs){if(!msgs||!msgs.length)return;
  for(const m of msgs){
   if(m.role==='learner'){const about=m.ref?.kind==='section'?` — 개념 설명 ‘${esc(l.lesson?.technical?.[m.ref.i]?.heading||'')}’에 대해`:m.ref?.kind==='term'?` — 용어 ‘${esc(m.ref.term)}’에 대해`:'';
    o.push(`**나**${m.intent==='check'?' (이해 확인 요청)':''} · ${when(m.at)}${m.quick?' (버튼)':''}${about}`,'',quote(esc(m.text)),'');
    if(m.status==='failed')o.push(`_답을 받지 못했어요${m.error?': '+esc(m.error):''}_`,'');
    else if(m.status==='noted')o.push('_메모로 남김 (AI에게 보내지 않음)_','')}
   else{o.push(`**AI 튜터**${m.reviewer?.model?' ('+esc(m.reviewer.model)+')':''}`,'',rich(m.text),'');
    const op=T?T.opinionText(m.assessment):null,lines=[];
    if(op)lines.push(`- ${op}${m.assessment.quote&&m.assessment.verdict!=='correct'?` — “${esc(m.assessment.quote)}”`:''}`);
    if(m.followUp)lines.push(`- 튜터의 질문: ${esc(m.followUp)}`);
    if(m.uncertainty)lines.push(`- 확실하지 않은 점: ${esc(m.uncertainty)}`);
    if(lines.length)o.push(...lines,'')}}
 }
 function fileName(l,now=Date.now()){const d=new Date(now),t=String((C?(C.identity(l).question||C.identity(l).title):l.topic)||'learning').replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').trim().replace(/\s+/g,'-').slice(0,40)||'learning';
  return `curiven-note-${t}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}.md`}

 /** The learning history that follows a concept note (Phase 2E): see lessonMarkdown `history`. */
 const historyMarkdown=(l,o={})=>lessonMarkdown(l,{...o,history:true});
 const api={lessonMarkdown,historyMarkdown,esc,rich,fence,suggestions,aiQuestions,myQuestions,myIdeas,fileName,when};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriNotes=api;
})(typeof window!=='undefined'?window:globalThis);
