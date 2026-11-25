/* CURIVEN home — "Minimal Curiosity" (design spec pp.1, 3, 6): a small constellation line drawing, one question,
   one composer with a black send button; attaching class material (PDF/PPTX) is the secondary action inside the same
   composer. Uses index.html / material-ui.js globals at call time (E, button, provider, profile, start, prepare, ...). */
'use strict';
let materialDraft=null,materialBusy=false,materialError='';
const MATERIAL_ACCEPT='.pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_UPLOAD=10*1024*1024;
const SVG='http://www.w3.org/2000/svg';
function svgEl(tag,attrs,cls){const el=document.createElementNS(SVG,tag);if(cls)el.setAttribute('class',cls);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));return el}
/** The home motif: five stars on thin lines, one quiet orbit, one halo. Drawn once (260 ms); `working` lets the halo
    breathe while a lesson is being prepared. Decorative only (aria-hidden); reduced motion shows it static. */
function homeMotif(working=false){const s=svgEl('svg',{viewBox:'0 0 240 92',width:240,height:92,'aria-hidden':'true',focusable:'false'},'home-motif'+(working?' working':''));
 s.append(svgEl('ellipse',{cx:122,cy:54,rx:108,ry:20,transform:'rotate(-6 122 54)'},'orbit'));
 const pts=[[24,66],[80,34],[142,70],[206,40]];
 for(let i=0;i<pts.length-1;i++)s.append(svgEl('line',{x1:pts[i][0],y1:pts[i][1],x2:pts[i+1][0],y2:pts[i+1][1]},'edge'));
 s.append(svgEl('line',{x1:80,y1:34,x2:118,y2:27},'edge'));
 s.append(svgEl('circle',{cx:142,cy:70,r:8},'halo'));
 for(const [x,y,r] of [[24,66,2.6],[80,34,3.2],[118,27,1.8],[142,70,3.8],[206,40,2.6]])s.append(svgEl('circle',{cx:x,cy:y,r},'star'));
 const sp=svgEl('g',{},'spark');sp.append(svgEl('line',{x1:200,y1:14,x2:210,y2:14}),svgEl('line',{x1:205,y1:9,x2:205,y2:19}));s.append(sp);
 return s}
function sendIcon(){const s=svgEl('svg',{viewBox:'0 0 24 24',width:18,height:18,'aria-hidden':'true',focusable:'false'});s.append(svgEl('path',{d:'M12 19V5M6 11l6-6 6 6',fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'}));return s}

function homeHero(m){const c=E('section','home');c.id='home';m.append(c);
 c.append(homeMotif(),E('h1','','오늘은 무엇이 궁금한가요?'),E('p','home-sub','작은 질문 하나가 새로운 발견의 시작이에요.'));
 const form=E('form','composer');form.id='composer';form.noValidate=true;
 if(materialDraft)form.append(materialChip());
 const t=E('textarea','');t.id='topic';t.rows=2;t.maxLength=160;t.placeholder=materialDraft?'이 자료에서 특히 궁금한 점이 있나요? (선택)':'궁금한 것을 자유롭게 적어보세요…';
 t.setAttribute('aria-label',materialDraft?'이 자료에서 궁금한 점 (선택)':'궁금한 주제나 질문');form.append(t);
 const row=E('div','composer-row');
 const attach=E('label','composer-attach');attach.id='attachMaterial';
 attach.append(document.createTextNode(materialBusy?'자료를 읽고 있어요…':materialDraft?'＋ 다른 자료 첨부':'＋ 수업 자료 첨부'));
 const inp=E('input');inp.type='file';inp.id='materialFile';inp.accept=MATERIAL_ACCEPT;inp.disabled=materialBusy;inp.className='visually-hidden';inp.setAttribute('aria-label','수업 자료 첨부 (PDF 또는 PPTX, 10MB까지)');
 inp.onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)readMaterial(f)};attach.append(inp);
 const send=E('button','composer-send');send.type='submit';send.id='startExplore';send.setAttribute('aria-label',materialDraft?'이 자료로 탐험 시작':'탐험 시작');send.append(sendIcon());
 // The send button stays black (one obvious action); an empty question gets a one-line prompt instead of a disabled button.
 const sync=()=>{send.disabled=materialBusy;if(t.value.trim()){form.classList.remove('needs-text');t.removeAttribute('aria-invalid')}};sync();t.addEventListener('input',sync);
 t.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();if(!send.disabled)form.requestSubmit()}});
 form.addEventListener('submit',e=>{e.preventDefault();if(send.disabled)return;const q=t.value.trim();
  if(!q&&!materialDraft){form.classList.add('needs-text');t.setAttribute('aria-invalid','true');const st=document.getElementById('materialStatus');if(st){st.hidden=false;st.className='home-status';st.textContent='궁금한 것을 한 줄 적어 주세요.'}t.focus();return}
  if(materialDraft)startFromMaterial(q);else start(q)});
 row.append(attach,send);form.append(row);c.append(form);
 const st=E('p',materialError?'home-status msg':'home-status');st.id='materialStatus';st.setAttribute('role','status');
 st.textContent=materialBusy?'파일에서 글을 뽑고 있어요. 이 컴퓨터에서만 처리해요.':materialError;st.hidden=!st.textContent;c.append(st);
 if(materialDraft){const pv=E('details','home-preview');pv.append(E('summary','','읽은 글 미리보기'));
  for(const p of materialDraft.pages.slice(0,3))pv.append(E('p','tiny',CM.label(materialDraft,p.n)),E('p','material-snippet',p.text.slice(0,240)+(p.text.length>240?'…':'')));c.append(pv);
  c.append(E('p','home-hint','자료에서 읽은 글은 탐험을 만들고 질문에 답하기 위해 연결된 AI(ChatGPT)로 보내지고, 이 브라우저의 학습 기록에 저장돼요. 원본 파일은 저장하지 않아요.'))}
 if(!provider.online){const h=E('p','home-hint','AI가 연결되지 않았어요. ');h.append(button('설정에서 연결하기',()=>openSettings('ai'),'linkish'));c.append(h)}
 unfinishedList(c);
 const extra=E('div','home-extra');c.append(extra);boundaryEntry(extra);if(!extra.childNodes.length)extra.remove()}

/** Explorations left before completion (the learner started something else). Without this list they stayed in storage
    and backups but had no way back. Opening one only makes it active again at its saved stage: no AI request, no record
    change. Most recent first; three visible, the rest behind "더 보기". */
const UNFINISHED_FIRST=3;
function unfinishedList(c){const list=data.lessons.filter(l=>l&&!l.complete&&l.id!==data.active).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
 // Only the tab that may write offers it (choosing one updates the active exploration).
 if(!list.length||(typeof canWrite==='function'&&!canWrite()))return;
 const sec=E('section','home-resume');sec.id='unfinished';sec.setAttribute('aria-labelledby','unfinishedTitle');const h=E('h2','home-resume-title','이어서 할 탐험');h.id='unfinishedTitle';sec.append(h);
 const row=l=>{const idn=CuriCopy.identity(l),li=E('li','');
  const b=button('',()=>{data.active=l.id;persist();render();document.getElementById('main')?.scrollIntoView?.({block:'start'})},'home-resume-item');
  b.dataset.id=l.id;b.append(E('span','home-resume-name',idn.short),E('span','home-resume-stage',l.lesson?`${CuriCopy.stageCopy(l.stage||1,l.lesson).label} 단계`:'자료 준비 전'));
  b.setAttribute('aria-label',`${idn.title} — ${l.lesson?CuriCopy.stageCopy(l.stage||1,l.lesson).label+' 단계에서 이어서 하기':'학습 자료 준비하기'}`);li.append(b);return li};
 const ul=E('ul','home-resume-list');list.slice(0,UNFINISHED_FIRST).forEach(l=>ul.append(row(l)));sec.append(ul);
 if(list.length>UNFINISHED_FIRST){const d=E('details','home-resume-more');d.append(E('summary','',`더 보기 (${list.length-UNFINISHED_FIRST})`));const ul2=E('ul','home-resume-list');list.slice(UNFINISHED_FIRST).forEach(l=>ul2.append(row(l)));d.append(ul2);sec.append(d)}
 c.append(sec)}

function materialChip(){const m=materialDraft,box=E('div','composer-file');box.id='materialSummary';
 box.append(E('span','composer-file-icon',m.kind==='pptx'?'PPT':'PDF'));const body=E('div','composer-file-body');body.append(E('strong','',m.name));
 for(const t of CM.summary(m))body.append(E('p','',t));box.append(body);
 const x=button('×',()=>{materialDraft=null;materialError='';render();document.getElementById('topic')?.focus()},'composer-file-remove');x.id='removeMaterial';x.setAttribute('aria-label',`첨부한 자료 ${m.name} 빼기`);box.append(x);return box}

async function readMaterial(file){materialError='';
 const ext=(file.name.split('.').pop()||'').toLowerCase();
 if(!['pdf','pptx'].includes(ext)){materialError='PDF나 PowerPoint(.pptx) 파일만 열 수 있어요.';render();return}
 if(file.size>MAX_UPLOAD){materialError='파일이 너무 커요. 10MB 이하로 올려 주세요.';render();return}
 materialBusy=true;render();
 try{const buf=new Uint8Array(await file.arrayBuffer());let bin='';for(let i=0;i<buf.length;i+=0x8000)bin+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));
  const j=await post('/api/material',{name:file.name,data:btoa(bin)});materialDraft=CM.fromServer(j.material);if(!materialDraft)throw Error('이 파일에서 읽을 수 있는 글을 찾지 못했어요.')}
 catch(e){materialError=e instanceof TypeError&&!e.status?'CURIVEN 서버에 연결할 수 없어요. server.py로 실행 중인지 확인해 주세요.':e.message}
 finally{materialBusy=false;render();document.getElementById(materialDraft?'topic':'materialFile')?.focus?.()}}

function startFromMaterial(question){const m=materialDraft;if(!m)return;if(question.length>160){toast('질문을 조금 더 짧게 적어 주세요.');return}
 // `topic` keeps the old shape (the server needs a subject line); `question` records only what the learner typed.
 const l=newRecord(question||CuriCopy.MATERIAL_PREFIX+m.name,profile.interests.join(', ').slice(0,300),profile.depth,question);l.material=m;
 data.lessons.push(l);data.active=l.id;materialDraft=null;track(l,`수업 자료로 시작: ${m.name}`);prepare(l)}
