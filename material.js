/* CURIVEN class material (PDF / PPTX) — pure helpers shared by the browser and Node tests. Server side: material.py.

   Record: an exploration started from a file carries `material` = {name, kind:'pdf'|'pptx', pageCount, pages:[{n,text}],
   unreadable:[n], omitted:[n], at}. Only extracted text is kept (never the file). Lesson items made from it carry
   `sources:[{page, quote}]`; a source is shown only if its quote literally occurs on that page (verify), which means
   "this text came from the uploaded file" — not that the file is right. Items with an empty list were added by the AI. */
'use strict';
(function(root){
 const PROMPT_CHARS=40000,TUTOR_CHARS=9000,MAX_PAGES=200,PAGE_CHARS=6000;
 const QUOTES={'‘':"'",'’':"'",'“':'"','”':'"','–':'-','—':'-','−':'-',' ':' '};
 function norm(s){return String(s??'').normalize('NFC').replace(/[‘’“”–—− ]/g,c=>QUOTES[c]).replace(/\s+/g,' ').trim()}
 /** Where `quote` occurs in `text` under the same normalisation as verify: [start,end] in the NFC text, or null. */
 function locate(text,quote){const t=String(text??'').normalize('NFC'),q=norm(quote);if(!q)return null;let flat='';const pos=[];
  for(let i=0;i<t.length;i++){let c=t[i];c=QUOTES[c]||c;if(/\s/.test(c)){if(!flat||flat.endsWith(' '))continue;c=' '}flat+=c;pos.push(i)}
  const k=flat.indexOf(q);return k<0?null:[pos[k],pos[k+q.length-1]+1]}
 /** A verified source as it is written in the file (verify stores the comparison form). */
 function excerpt(m,s){const p=m?.pages.find(x=>x.n===s.page);const at=p&&locate(p.text,s.quote);return at?p.text.normalize('NFC').slice(...at).replace(/\s+/g,' '):s.quote}
 const label=(m,n)=>m?.kind==='pptx'?`슬라이드 ${n}`:`p.${n}`;
 const kindName=m=>m?.kind==='pptx'?'PowerPoint':'PDF';
 /** The material as kept in the record (bounded; anything else from the server response is dropped). */
 function fromServer(m,now=Date.now()){if(!m||typeof m!=='object'||!Array.isArray(m.pages))return null;
  const ints=a=>(Array.isArray(a)?a:[]).filter(Number.isInteger).slice(0,MAX_PAGES);
  const pages=m.pages.filter(p=>p&&Number.isInteger(p.n)&&typeof p.text==='string'&&p.text.trim()).slice(0,MAX_PAGES).map(p=>({n:p.n,text:p.text.slice(0,PAGE_CHARS)}));
  if(!pages.length)return null;
  return {name:String(m.name||'수업 자료').slice(0,120),kind:m.kind==='pptx'?'pptx':'pdf',pageCount:Number.isInteger(m.pageCount)?m.pageCount:pages.length,pages,unreadable:ints(m.unreadable),omitted:ints(m.omitted),at:now}}
 function budget(m,pages,max){const out=[];let total=0;for(const p of pages){if(total+p.text.length>max)continue;out.push({n:p.n,text:p.text});total+=p.text.length}return {name:m.name,kind:m.kind,pages:out,unreadable:m.unreadable||[]}}
 /** For lesson generation: pages in order up to the prompt budget. */
 function lessonPayload(m){return m?budget(m,m.pages,PROMPT_CHARS):null}
 /** For one tutor question: the page asked about, pages cited where the learner is, then the best keyword matches. */
 // Character bigrams, not whole words: Korean particles ("미분가능이" vs "미분가능하다") defeat word matching.
 const bigrams=t=>{const out=new Set();for(const w of norm(t).toLowerCase().split(/[^\p{L}\p{N}]+/u))for(let i=0;i+1<w.length;i++)out.add(w.slice(i,i+2));return out};
 function tutorPayload(m,text,{page=null,cited=[]}={}){if(!m)return null;
  const words=bigrams(text);
  const score=p=>{const t=bigrams(p.text);let n=0;for(const w of words)if(t.has(w))n++;return n};
  const want=[page,...cited].filter(Number.isInteger),pick=[];
  for(const n of want){const p=m.pages.find(x=>x.n===n);if(p&&!pick.includes(p))pick.push(p)}
  for(const p of m.pages.map(p=>[score(p),p]).filter(([s])=>s>0).sort((a,b)=>b[0]-a[0]).map(([,p])=>p))if(pick.length<4&&!pick.includes(p))pick.push(p);
  if(!pick.length)pick.push(...m.pages.slice(0,2));
  return budget(m,pick,TUTOR_CHARS)}
 /** Sources whose quote is literally on the cited page of this material (same rule as material.py ground). */
 function verify(sources,m,limit=3){if(!m||!Array.isArray(sources))return [];const pages=new Map(m.pages.map(p=>[p.n,norm(p.text)])),out=[],seen=new Set();
  for(const s of sources){if(!s||!Number.isInteger(s.page))continue;const q=norm(s.quote);const k=s.page+'|'+q;
   if(!pages.has(s.page)||q.length<4||q.length>200||!pages.get(s.page).includes(q)||seen.has(k))continue;seen.add(k);out.push({page:s.page,quote:q});if(out.length>=limit)break}
  return out}
 /** Installing a lesson made from material: every concept/section gets a verified `sources` list (possibly empty). */
 function groundLesson(lesson,m){if(!m||!lesson)return lesson;for(const k of ['concepts','technical'])for(const x of lesson[k]||[])if(x&&typeof x==='object')x.sources=verify(x.sources,m);return lesson}
 /** Plain summary of what could and could not be read. */
 function summary(m){const read=m.pages.length,parts=[`${kindName(m)} ${m.pageCount}${m.kind==='pptx'?'장':'쪽'} 중 ${read}${m.kind==='pptx'?'장':'쪽'}에서 글을 읽었어요.`];
  if(m.unreadable?.length)parts.push(`읽지 못한 ${m.kind==='pptx'?'슬라이드':'쪽'}: ${m.unreadable.slice(0,12).map(n=>label(m,n)).join(', ')}${m.unreadable.length>12?' 외':''} — 그림이나 스캔이라 글자 정보가 없을 수 있어요.`);
  if(m.omitted?.length)parts.push(`자료가 길어 ${label(m,m.omitted[0])}부터는 이번 탐험에 넣지 않았어요.`);
  return parts}
 const api={norm,locate,excerpt,label,kindName,fromServer,lessonPayload,tutorPayload,verify,groundLesson,summary,PROMPT_CHARS,TUTOR_CHARS};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriMaterial=api;
})(typeof window!=='undefined'?window:globalThis);
