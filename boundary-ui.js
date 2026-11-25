/* CURIVEN Boundary Constellation — development-only prototype UI (Stage B1).
   Active only on the /dev/boundary page (the server adds <meta name="curiven-dev-pilot"> there and nowhere
   else). On the normal learning route every function here is a no-op, and boundary data that a lesson may
   already carry is kept in storage and exports but not shown.
   No new stage: the comparison lives inside stage 2 (예측·사고 실험) and the explanation and keyed checks
   inside stage 4 (내 언어로 설명). Every part can be skipped without penalty.
   Uses the page helpers defined in index.html (E, button, area, track, persist, render, ...) at call time. */
'use strict';
const DEV_PILOT=document.querySelector('meta[name="curiven-dev-pilot"]')?.content||'';
const bText=new Map(),bPick=new Map(); // unsent text / unconfirmed choice per `${lessonId}:${key}` (this tab only)
function boundaryOf(l){return DEV_PILOT&&l&&window.CuriBoundary.usable(l.boundary)?l.boundary:null}
function bNames(b){return b.content.concepts.map(c=>c.name).join(' ↔ ')}
function bBadge(b){const d=E('div','boundary-badge',b.pack.mode==='reviewed'?'검토를 마친 학습 자료':'검토 중인 학습 자료 · 개발용 미리보기 · 성취로 기록되지 않아요');d.setAttribute('role','note');return d}
function bArea(l,key,placeholder,rows,label){const k=l.id+':'+key,t=area('b-'+key,placeholder,bText.get(k)||'',rows);t.maxLength=window.CuriBoundary.MAX_TEXT;t.setAttribute('aria-label',label);t.addEventListener('input',()=>bText.set(k,t.value));return t}
function bRefuse(r){toast(r.reason==='long'?'조금 더 짧게 적어 주세요.':r.reason==='already'?'이미 기록했어요.':'한 문장 정도 더 적어 주세요.')}

/* Home (dev page only): explicit entry. Normal topics typed above keep the free-exploration flow. */
function boundaryEntry(c){if(!DEV_PILOT)return;const box=E('div','boundary-dev');box.id='boundaryEntry';
 box.append(E('div','eyebrow','DEVELOPMENT · BOUNDARY CONSTELLATION'),E('h3','','경계 별자리 미리보기'),E('div','boundary-badge','검토 중인 학습 자료'),
  E('p','hint','HTTP 쿠키와 서버 측 세션을 두 상황에서 비교해 보는 시험용 활동이에요. 사람의 검토를 아직 마치지 않은 자료를 쓰므로 어떤 결과도 성취로 기록되지 않아요.'));
 const msg=E('div','');msg.id='boundaryEntryMsg';msg.setAttribute('aria-live','polite');
 box.append(button('미리보기 탐험 시작 →',()=>startBoundary(msg),'btn secondary'),msg);c.append(box)}
async function startBoundary(msg){if(!canWrite())return;msg.className='hint';msg.textContent='참고 자료를 확인하는 중…';let b;
 try{const r=await fetch('/api/pilot/'+encodeURIComponent(DEV_PILOT));let j={};try{j=await r.json()}catch{}
  if(!r.ok||!j.ok)throw Error(j.error||`오류 ${r.status}`);b=window.CuriBoundary.attach(j.activity)}
 catch(e){msg.className='msg';msg.textContent='참고 자료를 불러오지 못했어요: '+e.message+' 일반 탐험은 그대로 할 수 있어요.';return}
 if(!canWrite())return;
 const topic=String(b.pack.title||bNames(b)).split(':')[0].trim().slice(0,160);
 const l=newRecord(topic,profile.interests.join(', ').slice(0,300),profile.depth);l.boundary=b;data.lessons.push(l);data.active=l.id;
 track(l,'경계 비교 미리보기 시작 (검토 중인 학습 자료)');prepare(l)}

/* Stage 2: predict each situation in your own words, then see the stated outcome beside your exact text. */
function boundarySituations(c,l){const b=boundaryOf(l);if(!b)return;const B=window.CuriBoundary;
 const box=E('section','boundary');box.id='boundarySituations';const h=E('h3','','경계 비교: '+bNames(b));h.id='bSitTitle';box.setAttribute('aria-labelledby','bSitTitle');box.append(bBadge(b),h);
 if(b.skipped.situations&&!b.predictions.length){box.append(E('p','hint','이 비교는 건너뛰었어요. 원할 때 다시 할 수 있어요.'),button('지금 해 보기',()=>{B.unskip(b,'situations');persist();render()},'small-action'));c.append(box);return}
 box.append(E('p','sub','결과를 보기 전에 두 상황에서 무슨 일이 일어날지 내 말로 예측해 보세요. 예측을 기록하면 자료에 적힌 결과가 옆에 나타나요. 맞히는 시험이 아니에요.'));
 b.content.situations.forEach((s,i)=>{const pr=b.predictions.find(p=>p.situationId===s.id),card=E('div','concept boundary-situation');card.id='bSit-'+s.id;
  card.append(E('div','eyebrow',`상황 ${i+1}`),E('h3','',s.title),E('p','spaced',s.setup));
  if(!pr){const t=bArea(l,'pred-'+s.id,'다음 요청에서 무슨 일이 일어날까요? 내 예측을 적어 보세요.',3,`상황 ${i+1} 내 예측`);card.append(t);
   const row=E('div','actions');row.append(button('예측 기록하고 결과 보기',()=>{if(!canWrite())return;const r=B.recordPrediction(b,s.id,t.value);if(!r.ok){bRefuse(r);return}bText.delete(l.id+':pred-'+s.id);track(l,`경계 비교 상황 ${i+1} 예측 기록`);render()},'btn minor'));card.append(row)}
  else{const cmp=E('div','boundary-compare');const mine=E('div','old');mine.append(E('strong','','내 예측'),E('p','boundary-text',pr.text));
   const ref=E('div','new');ref.append(E('strong','','자료에 적힌 결과'),E('p','',s.outcome));cmp.append(mine,ref);
   card.append(cmp,E('p','tiny','결과는 검토 중인 참고 자료의 서술이에요. 내 예측과 무엇이 같고 다른지 스스로 비교해 보세요. 예측은 채점하지 않아요.'))}
  box.append(card)});
 if(!b.predictions.length){const row=E('div','actions');row.append(button('이 비교 건너뛰기',()=>{if(!canWrite())return;B.skip(b,'situations');track(l,'경계 비교를 건너뜀');render()},'linkish'));box.append(row)}
 c.append(box)}

/* Stage 4: explain the difference from memory (optional AI review), then two keyed checks (no AI). */
function boundaryApply(c,l){const b=boundaryOf(l);if(!b)return;const B=window.CuriBoundary;
 const box=E('section','boundary');box.id='boundaryApply';box.append(bBadge(b),E('h3','','경계 설명과 적용: '+bNames(b)));
 const ex=E('div','concept');ex.id='bExplain';ex.append(E('div','eyebrow','내 말로 구분하기'),E('p','q',b.content.prompt.text),E('p','hint','자료를 다시 보지 않고 2~4문장이면 충분해요. 건너뛰어도 괜찮아요.'));
 if(b.explanation){ex.append(E('div','old boundary-text',b.explanation.text));const fb=b.explanation.feedback,ids=b.content.concepts.map(x=>x.id),pending=inflight.has('bfb:'+l.id);let f=null,bad=false;
  if(fb){try{f=L.validateFeedback(fb,ids,b.explanation.text)}catch{bad=true}}
  ex.append(E('p','tiny boundary-kind','AI 검토 의견 · 참고용 · 이해를 판정하지 않아요'));
  if(f)renderFeedback(ex,f,b.content.concepts,null,b.explanation.text);
  else{const m=E('p','hint',pending?'AI가 설명을 검토하는 중…':bad?'저장된 AI 피드백의 형식이 올바르지 않아 표시하지 않았어요.':b.explanation.feedbackError?'AI 피드백을 받지 못했어요: '+b.explanation.feedbackError+' (내 설명은 저장됐어요)':'AI 검토 없음');m.id='bFeedbackState';ex.append(m);
   if(provider.online&&!pending){const r=button('AI 검토 요청',()=>requestBoundaryFeedback(l),'small-action');r.id='bFeedbackRetry';ex.append(r)}}}
 else if(b.skipped.explanation)ex.append(E('p','hint','설명은 건너뛰었어요.'),button('지금 써 보기',()=>{B.unskip(b,'explanation');persist();render()},'small-action'));
 else{const t=bArea(l,'explain','두 개념이 어떻게 다르고 어떻게 함께 일하는지 내 말로 적어 보세요.',5,'경계 설명');ex.append(t);const row=E('div','actions');
  row.append(button(provider.online?'설명 저장 + AI 검토':'내 설명 저장하기',()=>{if(!canWrite())return;const r=B.recordExplanation(b,t.value);if(!r.ok){bRefuse(r);return}bText.delete(l.id+':explain');track(l,'경계 설명을 남김');if(provider.online)requestBoundaryFeedback(l);else render()},'btn minor'),
   button('건너뛰기',()=>{if(!canWrite())return;B.skip(b,'explanation');track(l,'경계 설명을 건너뜀');render()},'linkish'));ex.append(row)}
 box.append(ex);
 const ck=E('div','concept');ck.id='bChecks';ck.append(E('div','eyebrow','적용 문항 · 정답 키와 비교 (AI 아님)'),E('p','hint','같은 원리를 새 맥락에 적용해 보는 문항이에요. 결과는 이 문항들에 대한 것일 뿐 이해 전체를 판정하지 않아요.'));
 if(b.skipped.checks&&!b.answers.length)ck.append(E('p','hint','적용 문항은 건너뛰었어요.'),button('지금 풀어 보기',()=>{B.unskip(b,'checks');persist();render()},'small-action'));
 else{b.content.checks.forEach((q,i)=>ck.append(bCheck(l,b,q,i)));
  if(!b.answers.length){const row=E('div','actions');row.append(button('적용 문항 건너뛰기',()=>{if(!canWrite())return;B.skip(b,'checks');track(l,'적용 문항을 건너뜀');render()},'linkish'));ck.append(row)}}
 box.append(ck);c.append(box)}
function bCheck(l,b,q,i){const B=window.CuriBoundary,a=b.answers.find(x=>x.checkId===q.id),k=l.id+':'+q.id;
 const f=E('fieldset','boundary-check');f.id='bCheck-'+q.id;f.append(E('legend','',`문항 ${i+1}`),E('p','',q.stem));
 if(q.assumptions.length){const d=E('details','boundary-assume');d.append(E('summary','',`이 문항의 전제 ${q.assumptions.length}개`),...q.assumptions.map(x=>E('p','hint',x.text)));f.append(d)}
 const opts=E('div');opts.setAttribute('role','group');opts.setAttribute('aria-label',`문항 ${i+1} 선택지`);let picked=a?a.choice:bPick.get(k)??null;
 q.options.forEach(o=>{const label=a?o.text+(o.id===q.answer?' — 정답 키':'')+(o.id===a.choice?' — 내 선택':''):o.text;
  const btn=button(label,()=>{picked=o.id;bPick.set(k,o.id);opts.querySelectorAll('button').forEach(x=>{const on=x.dataset.opt===o.id;x.className='opt'+(on?' selected':'');x.setAttribute('aria-pressed',String(on))})},'opt'+(picked===o.id?' selected':''));
  btn.dataset.opt=o.id;btn.setAttribute('aria-pressed',String(picked===o.id));
  if(a){btn.disabled=true;if(o.id===q.answer)btn.classList.add('right');else if(o.id===a.choice)btn.classList.add('wrong')}opts.append(btn)});f.append(opts);
 if(!a){const row=E('div','actions');row.append(button('답 확인하기',()=>{if(!canWrite())return;if(picked==null){toast('하나를 선택해 주세요.');return}const r=B.answerCheck(b,q.id,picked);if(!r.ok){bRefuse(r);return}bPick.delete(k);track(l,`적용 문항 ${i+1} 응답`);render()},'btn minor'));f.append(row)}
 else{const res=E('p','info');res.append(E('strong','',a.choice===q.answer?'정답 키와 일치했어요. ':'정답 키와 달랐어요. '),q.rationale);f.append(res,E('p','tiny','결정적 비교: 내 선택을 참고 자료의 정답 키와 그대로 비교했어요. AI 판단이 아니에요.'))}
 return f}

/* Optional AI review of the boundary explanation: the existing feedback coach and validator, unchanged. */
async function requestBoundaryFeedback(l){const b=l.boundary;if(busy||!canWrite()||!b?.explanation)return;busy=true;
 const id=l.id,key='bfb:'+id,ctl=new AbortController(),at=b.explanation.at,text=b.explanation.text;inflight.set(key,ctl);render();
 const find=()=>{const cur=data.lessons.find(x=>x.id===id),ex=cur?.boundary?.explanation;return ex&&ex.at===at&&ex.text===text?[cur,ex]:[]};
 try{const r=await api('feedback',{lesson:window.CuriBoundary.feedbackLesson(b),text,profile:P.aiPayload(latestProfile())},ctl.signal);
  const f=L.validateFeedback({...r.data,reviewer:{provider:r.provider,model:r.model,at:Date.now()}},b.content.concepts.map(c=>c.id),text);
  if(inflight.get(key)!==ctl)return;const [cur,ex]=find();if(!ex||!canWrite())return;ex.feedback=f;delete ex.feedbackError;track(cur,'경계 설명에 AI 피드백 받음')}
 catch(e){if(inflight.get(key)!==ctl)return;const [,ex]=find();if(ex&&canWrite()){ex.feedbackError=String(e.message||e).slice(0,300);persist()}afterAiError(e)}
 finally{if(inflight.get(key)===ctl){inflight.delete(key);busy=false}const cur=current();if(cur?.id===id&&!view)render()}}

/* Stage 5 summary: what evidence exists, in plain words. */
function boundarySummary(c,l){const b=boundaryOf(l);if(!b)return;const B=window.CuriBoundary,ev=B.evidence(b);
 const box=E('div','note boundary-summary');box.id='boundarySummary';box.append(bBadge(b),E('h3','','경계 비교 기록'),E('p','',B.describe(ev,b.content.concepts)));c.append(box)}

/* Constellation data for one lesson: the two boundary concepts and the evidence on the line between them. */
function boundaryAtlas(l){const b=boundaryOf(l);if(!b)return null;const B=window.CuriBoundary,ev=B.evidence(b);
 return {concepts:b.content.concepts,evidence:ev,text:B.describe(ev,b.content.concepts),names:bNames(b),mode:b.pack.mode}}
