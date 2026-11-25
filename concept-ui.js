/* CURIVEN concept note on the completion screen (Phase 2E). Uses index.html / tutor-ui.js / notion-ui.js globals at
   call time (E, button, data, provider, inflight, api, persist, canWrite, track, lessonById, latestProfile, P,
   refreshNotionBlock). Pure parts: concept-note.js (CuriConcept).
   One explicit request makes the note ("개념 노트 만들기"); it is cached in the record (`l.conceptNote`) with the key
   of what it was made from, previewed here, editable, and used by the Notion save and the Markdown download. It is
   never regenerated or replaced on its own: when the exploration went on afterwards the preview says so and offers
   "다시 만들기"; replacing a note the learner edited asks first. A failed request changes nothing in the record, and
   the save/download keep working with the basic note (labelled as not synthesised). */
'use strict';
const CC=window.CuriConcept;
const conceptState=new Map(); // lessonId -> {state:'working'|'error', error}
const conceptOpen=new Set(),conceptEditing=new Set();

async function makeConceptNote(lessonId){const l=lessonById(lessonId);if(!l||!canWrite())return;
 const key='note:'+lessonId;if(inflight.has(key))return;
 if(l.conceptNote?.editedAt&&!confirm('직접 고친 개념 노트가 새로 만든 노트로 바뀌어요. 계속할까요?'))return;
 const ctl=new AbortController();inflight.set(key,ctl);conceptState.set(lessonId,{state:'working'});refreshNotionBlock();
 try{const basis=CC.basisKey(l),body=CC.payload(l,P.aiPayload(latestProfile()));
  const r=await api('note',body,ctl.signal);
  if(inflight.get(key)!==ctl)return;const cur=lessonById(lessonId);if(!cur||!canWrite())return;
  const note=CC.clean({...r.data,kind:'ai',generatedBy:{provider:r.provider,model:r.model},at:Date.now(),basis,truncated:body.omitted},cur);
  if(!note)throw Error('AI가 보낸 노트의 형식이 올바르지 않아요.');
  cur.conceptNote=note;conceptState.delete(lessonId);conceptOpen.add(lessonId);conceptEditing.delete(lessonId);track(cur,'개념 노트 만들기')}
 catch(e){if(inflight.get(key)!==ctl)return;
  if(e.name==='AbortError')conceptState.delete(lessonId);
  else conceptState.set(lessonId,{state:'error',error:e instanceof TypeError&&!e.status?'CURIVEN 서버와 연결이 끊겼어요.':e.message})}
 finally{if(inflight.get(key)===ctl)inflight.delete(key);refreshNotionBlock();
  if(!conceptState.has(lessonId))document.getElementById('conceptNote')?.querySelector('summary,h3')?.focus?.()}}
function cancelConceptNote(lessonId){inflight.get('note:'+lessonId)?.abort()}

/* ---------- preview (safe DOM: text only, no HTML from the note) ---------- */
function inlineDom(el,text){for(const r of CC.runs(text)){if(r.k==='code')el.append(E('code','',r.v));else if(r.k==='bold')el.append(E('strong','',r.v));else el.append(document.createTextNode(r.v))}return el}
function blocksDom(body){const frag=document.createDocumentFragment();
 for(const b of CC.parse(body)){
  if(b.t==='p')frag.append(inlineDom(E('p'),b.text));
  else if(b.t==='h')frag.append(inlineDom(E('h5'),b.text));
  else if(b.t==='ul'||b.t==='ol'){const list=E(b.t);if(b.t==='ol'&&b.start>1)list.start=b.start;for(const x of b.items)list.append(inlineDom(E('li'),x));frag.append(list)}
  else if(b.t==='code'){const pre=E('pre','cn-code');const c=E('code','',b.code);if(b.lang)pre.dataset.lang=b.lang;pre.append(c);frag.append(pre)}
  else if(b.t==='math'){const m=E('pre','cn-math',b.tex);m.setAttribute('aria-label','수식 (LaTeX)');frag.append(m)}
  else if(b.t==='table'){const wrap=E('div','cn-table'),t=E('table'),hr=E('tr');for(const h of b.head)hr.append(inlineDom(E('th'),h));const th=E('thead');th.append(hr);t.append(th);const tb=E('tbody');
   for(const r of b.rows){const tr=E('tr');for(const x of r)tr.append(inlineDom(E('td'),x));tb.append(tr)}t.append(tb);wrap.append(t);frag.append(wrap)}
  else if(b.t==='note')frag.append(inlineDom(E('aside','cn-note'),b.text))}
 return frag}
function noteDom(note,l){const a=E('article','cn-article'),mat=l.material&&window.CuriMaterial?l.material:null;
 a.append(E('h4','cn-title',note.title),inlineDom(E('p','cn-lead'),note.lead));
 for(const x of note.sections){const sec=E('section','cn-section');sec.append(E('h4','',x.heading),blocksDom(x.body));
  if(mat&&x.sources?.length)sec.append(E('p','cn-source','수업 자료 '+[...new Set(x.sources.map(z=>CuriMaterial.label(mat,z.page)))].join(', ')));a.append(sec)}
 const qa=note.resolved?.length?note.resolved:note.qa||[];
 if(qa.length){const sec=E('section','cn-section');sec.append(E('h4','',note.resolved?.length?'이번 탐험에서 풀린 질문':'이번 탐험에서 나눈 질문과 답'));
  for(const r of qa){const d=E('details','cn-qa');d.append(E('summary','','내 질문: “'+r.question.replace(/\s+/g,' ').trim()+'”'));
   if(note.resolved?.length)d.append(inlineDom(E('p'),r.answer+(r.section?` (자세히: ‘${r.section}’)`:'')));else d.append(E('p','cn-raw',r.answer));sec.append(d)}a.append(sec)}
 if(note.open?.length){const sec=E('section','cn-section'),ul=E('ul');sec.append(E('h4','','아직 남은 질문'));
  for(const x of note.open)ul.append(E('li','',x.n?`내 질문 “${x.text.replace(/\s+/g,' ').trim()}”${x.why?' — '+x.why:''}`:x.text));sec.append(ul);a.append(sec)}
 if(note.selfCheck?.length){const sec=E('section','cn-section');sec.append(E('h4','','스스로 확인하기'));
  note.selfCheck.forEach((x,i)=>{const d=E('details','cn-qa');d.append(E('summary','',`${i+1}. ${x.q}`),inlineDom(E('p'),x.a));sec.append(d)});a.append(sec)}
 const rel=[...(note.corrections||[]).map(c=>'대화 중에 고쳐진 설명: '+c.text),...(note.conflicts||[]).map(c=>'아직 정리되지 않은 설명 차이: '+c.text),...(note.limitations?['확인이 필요한 부분: '+note.limitations]:[])];
 if(rel.length){const sec=E('section','cn-section'),ul=E('ul','cn-reliability');sec.append(E('h4','','출처와 신뢰도'));for(const t of rel)ul.append(E('li','',t));sec.append(ul);a.append(sec)}
 a.append(E('p','cn-history','노트 끝에는 접힌 ‘학습 기록’으로 처음 예상, 사고 실험, 내 설명과 피드백, 질문과 대화 전체가 쓴 그대로 함께 저장돼요.'));
 return a}

/* ---------- editing: title, lead and each section (heading + body in the note's small Markdown) ---------- */
function noteEditor(note,l){const f=E('form','cn-edit');f.noValidate=true;
 const field=(label,el)=>{const w=E('label','cn-field');w.append(E('span','',label),el);f.append(w);return el};
 const ti=field('제목',E('input','input'));ti.value=note.title;ti.maxLength=CC.LIM.title;ti.id='cnEditTitle';
 const le=field('핵심 아이디어',E('textarea','input'));le.value=note.lead;le.rows=4;le.maxLength=CC.LIM.lead;
 const rows=note.sections.map((x,i)=>{const h=field(`섹션 ${i+1} 제목`,E('input','input'));h.value=x.heading;h.maxLength=CC.LIM.heading;
  const b=field(`섹션 ${i+1} 본문`,E('textarea','input cn-body'));b.value=x.body;b.rows=Math.min(18,Math.max(5,x.body.split('\n').length+1));b.maxLength=CC.LIM.body;b.spellcheck=false;return [h,b]});
 f.append(E('p','hint','본문에서는 빈 줄로 문단을 나누고, ‘- ’ 목록, ‘1. ’ 순서, ```로 감싼 코드, | 표 |, ‘> ’ 참고 상자를 쓸 수 있어요. 제목이나 본문을 비우면 그 섹션은 빠져요.'));
 const row=E('div','actions'),save=E('button','btn','고친 내용 저장');save.type='submit';
 row.append(save,button('취소',()=>{conceptEditing.delete(l.id);refreshNotionBlock()},'btn secondary'));f.append(row);
 f.addEventListener('submit',e=>{e.preventDefault();if(!canWrite())return;const cur=lessonById(l.id);if(!cur?.conceptNote)return;
  const next=CC.clean({...cur.conceptNote,title:ti.value,lead:le.value,sections:note.sections.map((x,i)=>({...x,heading:rows[i][0].value,body:rows[i][1].value}))},cur);
  if(!next){toast('핵심 아이디어와 섹션 하나 이상은 남겨 주세요.');return}
  cur.conceptNote={...next,editedAt:Date.now()};conceptEditing.delete(l.id);track(cur,'개념 노트 고치기');refreshNotionBlock();document.getElementById('conceptNote')?.querySelector('summary')?.focus()});
 return f}

/** The concept-note part of the Notion save / update dialog (notion-ui.js drawNoteDialog). */
function conceptArea(box,l){const writable=canWrite(),st=conceptState.get(l.id),note=l.conceptNote?CC.clean(l.conceptNote,l):null;
 const wrap=E('div','cn');wrap.id='conceptNote';box.append(wrap);
 if(st?.state==='working'){const p=E('p','notion-line','개념 노트를 만들고 있어요. 대화가 길면 1~3분 걸릴 수 있어요.');p.setAttribute('role','status');p.id='conceptStatus';
  const row=E('div','actions');row.append(button('취소',()=>cancelConceptNote(l.id),'btn secondary'));wrap.append(p,row);return}
 if(st?.state==='error'){const p=E('p','notion-line msg',`개념 노트를 만들지 못했어요: ${st.error} 학습 기록은 그대로예요. 지금 저장하거나 내려받으면 AI 종합 없이 정리한 기본 노트가 들어가요.`);p.setAttribute('role','alert');p.id='conceptStatus';wrap.append(p)}
 if(!note){if(!st){const row=E('div','actions');const b=button('개념 노트 만들기',()=>makeConceptNote(l.id),'btn secondary');b.id='conceptMake';b.disabled=!writable||!provider.online;row.append(b);wrap.append(row);
   if(writable&&!provider.online)wrap.append(E('p','hint','AI가 연결되면 만들 수 있어요. 지금 저장하거나 내려받으면 기본 노트가 들어가요.'))}
  else if(writable){const row=E('div','actions');const b=button('다시 시도',()=>makeConceptNote(l.id),'btn secondary');b.id='conceptMake';b.disabled=!provider.online;row.append(b);wrap.append(row)}
  return}
 const head=E('div','cn-head');head.append(E('h3','','개념 노트'));
 const when=note.at?new Date(note.at):null,meta=[note.generatedBy?.model?`AI 정리 (${note.generatedBy.model})`:'AI 정리',when?`${when.getMonth()+1}월 ${when.getDate()}일 ${String(when.getHours()).padStart(2,'0')}:${String(when.getMinutes()).padStart(2,'0')}`:'',note.editedAt?'직접 고침':''].filter(Boolean).join(' · ');
 head.append(E('p','cn-meta',meta));wrap.append(head);
 if(CC.stale(l)){const p=E('p','cn-stale','이 노트를 만든 뒤에 탐험이 이어졌어요. 새 내용은 아직 노트에 없어요.');p.id='conceptStale';wrap.append(p)}
 if(conceptEditing.has(l.id)&&writable){wrap.append(noteEditor(note,l));return}
 const d=E('details','cn-preview');d.open=conceptOpen.has(l.id);d.addEventListener('toggle',()=>{if(d.open)conceptOpen.add(l.id);else conceptOpen.delete(l.id)});
 d.append(E('summary','','노트 미리보기'),noteDom(note,l));wrap.append(d);
 if(writable){const row=E('div','actions');const ed=button('편집',()=>{conceptEditing.add(l.id);refreshNotionBlock();document.getElementById('cnEditTitle')?.focus()},'btn minor');ed.id='conceptEdit';
  const re=button('다시 만들기',()=>makeConceptNote(l.id),CC.stale(l)?'btn secondary':'btn minor');re.id='conceptRemake';re.disabled=!provider.online;row.append(ed,re);wrap.append(row)}}
