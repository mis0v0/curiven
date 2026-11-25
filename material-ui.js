/* CURIVEN — start from class material (PDF / PPTX) and see where explanations come from.
   Uses index.html globals at call time (E, button, data, profile, newRecord, track, prepare, post, toast, openHelp...). */
'use strict';
const CM=window.CuriMaterial;
// The start screen (topic / material composer) lives in home-ui.js.

/* ---------- where an explanation comes from ---------- */
/** Under a concept section of a material lesson: verified page quotes, or a plain "added by the AI" label. */
function materialRefs(b,l,x){const m=l.material;if(!m)return;const src=CM.verify(x.sources,m);
 const row=E('div','material-refs');
 if(!src.length){row.append(E('span','tiny material-ai','AI가 덧붙인 설명 · 수업 자료에서 온 내용이 아니에요'));b.append(row);return}
 row.append(E('span','tiny','수업 자료 근거:'));
 for(const s of src){const chip=button('📄 '+CM.label(m,s.page),()=>showMaterialPage(l,s.page,s.quote),'pill material-chip');chip.setAttribute('aria-label',`${CM.label(m,s.page)}의 “${s.quote}” 자료에서 보기`);row.append(chip)}
 const q=E('p','material-quote');for(const s of src)q.append(E('span','',`“${CM.excerpt(m,s)}” (${CM.label(m,s.page)})`));b.append(row,q)}
/** The uploaded text, page by page, with “이 쪽에 대해 묻기”. */
function materialViewer(c,l){const m=l.material;if(!m)return;const k=l.id+'|material';
 const d=E('details','note material-viewer');d.id='materialViewer';d.open=tutorOpen.has(k);d.addEventListener('toggle',()=>{d.open?tutorOpen.add(k):tutorOpen.delete(k)});
 d.append(E('summary','',`수업 자료 보기 · ${m.name}`));for(const t of CM.summary(m))d.append(E('p','hint',t));
 d.append(E('p','tiny','파일에서 뽑은 글 그대로예요. 자료에서 왔다는 뜻이지, 자료 내용이 맞다는 확인은 아니에요.'));
 const sel=selectOf('materialPage',Object.fromEntries(m.pages.map(p=>[String(p.n),CM.label(m,p.n)+' · '+p.text.split('\n')[0].slice(0,40)])),String(materialPageOf.get(l.id)||m.pages[0].n));
 sel.setAttribute('aria-label','볼 쪽 고르기');const body=E('div','material-page');body.id='materialPageText';body.tabIndex=0;body.setAttribute('role','region');body.setAttribute('aria-label','수업 자료 본문');
 const draw=(n,quote)=>{const p=m.pages.find(x=>x.n===n)||m.pages[0];materialPageOf.set(l.id,p.n);sel.value=String(p.n);body.replaceChildren(...highlight(p.text,quote))};
 sel.onchange=()=>draw(Number(sel.value));
 const ask=button('이 쪽에 대해 묻기',()=>openHelp(l,{anchor:'mat',ref:{kind:'page',n:Number(sel.value)},label:'수업 자료 '+CM.label(m,Number(sel.value)),opener:'askPage'}),'small-action');ask.id='askPage';
 const row=E('div','material-nav');row.append(sel);if(canWrite())row.append(ask);d.append(row,body);c.append(d);
 d.__draw=draw;draw(Number(sel.value),materialQuote.get(l.id));materialQuote.delete(l.id)}
const materialPageOf=new Map(),materialQuote=new Map();
function showMaterialPage(l,n,quote){const d=document.getElementById('materialViewer');if(!d)return;tutorOpen.add(l.id+'|material');d.open=true;d.__draw(n,quote);
 const t=document.getElementById('materialPageText');t.scrollIntoView({block:'nearest',behavior:reduceMotion()?'auto':'smooth'});(t.querySelector('mark')||t).scrollIntoView?.({block:'nearest'});t.focus({preventScroll:true})}
/** Text nodes with the quoted passage in <mark> (whitespace-tolerant match); nothing is parsed as HTML. */
function highlight(text,quote){if(!quote)return [document.createTextNode(text)];
 const t=text.normalize('NFC'),at=CM.locate(t,quote);if(!at)return [document.createTextNode(t)];
 return [document.createTextNode(t.slice(0,at[0])),E('mark','',t.slice(at[0],at[1])),document.createTextNode(t.slice(at[1]))]}
/** In the conversation: quotes the tutor took from the material (verified when stored), or that it used none. */
function tutorSources(b,l,m){if(!l.material||m.role!=='tutor')return;const src=CM.verify(m.sources,l.material);const row=E('div','tutor-src');
 if(!src.length){row.append(E('span','tiny material-ai','수업 자료 인용 없음 · AI 설명'));b.append(row);return}
 row.append(E('span','tiny','수업 자료에서:'));const viewable=!!document.getElementById('materialViewer');
 for(const s of src){const ex=CM.excerpt(l.material,s),text=`📄 ${CM.label(l.material,s.page)} “${ex.slice(0,60)}${ex.length>60?'…':''}”`;row.append(viewable?button(text,()=>showMaterialPage(l,s.page,s.quote),'linkish material-chip'):E('span','tiny material-chip',text))}b.append(row)}
