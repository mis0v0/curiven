/* CURIVEN concept note — the primary learning document of an exploration (Phase 2E). Pure; shared by the browser and
   Node tests. Server side of the AI synthesis: server.py NOTE_SPEC / validate_note.

   One structured note, two renderers:
     note = {v, kind:'ai'|'basic', title, lead, sections:[{heading, body, sources:[{page,quote}], origin, asks:[n]}],
             resolved:[{n, question, answer, section}], open:[{n|null, text}], selfCheck:[{q,a}],
             corrections:[{text}], conflicts:[{text}], limitations, generatedBy, at, basis, editedAt}
     `body` is a small, closed Markdown subset (parse() below): paragraphs, '- ' and '1. ' lists, fenced code, $$ math,
     GFM pipe tables, '> ' notes and '### ' sub-headings. Inline: `code` and **bold** only — no HTML, links or images,
     so a model cannot slip in markup, invented links or anything a renderer would execute.
     toMarkdown(note, l)  → CommonMark (+ pipe tables, $$) for download
     toNotion(note, l)    → Notion-flavored Markdown (v2): callouts and toggles; the learning history goes in a toggle
   Both renderers append the learning history (notes.js, the learner's words exactly as written) after the concept note.

   Provenance: everything in the concept note is AI-written (or the learner's own edit, marked as edited). Sources are
   shown only when their quote is literally on the cited page of the uploaded file (CuriMaterial.verify). The learner's
   questions are quoted from the record by number, never from model output. No mastery or understanding is claimed.
   When no AI note exists (or synthesis failed) the same renderers use basic(l): the lesson's own material arranged
   concept-first, with each typed question next to the tutor's verbatim answer — clearly labelled as not synthesised. */
'use strict';
(function(root){
 const req=n=>typeof require==='function'?require(n):null;
 const N=root.CuriNotes||req('./notes.js');
 const T=root.CuriTutor||req('./tutor.js');
 const M=root.CuriMaterial||req('./material.js');
 const C=root.CuriCopy||req('./copy.js');
 const L=root.CuriLearning||req('./learning.js');

 const VERSION=1;
 const LIM={title:80,lead:1500,heading:80,body:6000,total:48000,sections:14,answer:900,q:300,a:900,text:400,limitations:1800};
 const ORIGINS=['lesson','tutor','material','mixed'];
 const s=v=>typeof v==='string'?v.replace(/\r\n?/g,'\n').trim():'';

 /* ---------- the body grammar ---------- */
 const FENCE=/^(`{3,})\s*([\w+#.-]*)\s*$/;
 const isTableSep=x=>/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(x);
 const cells=x=>{const t=x.trim().replace(/^\|/,'').replace(/\|$/,'');const out=[];let cur='';for(let i=0;i<t.length;i++){if(t[i]==='\\'&&t[i+1]==='|'){cur+='|';i++;continue}if(t[i]==='|'){out.push(cur.trim());cur=''}else cur+=t[i]}out.push(cur.trim());return out};
 /** body text → blocks. Never throws; anything unrecognised is a paragraph. */
 function parse(body){const lines=String(body??'').replace(/\r\n?/g,'\n').split('\n'),out=[];let i=0,para=[];
  const flush=()=>{if(para.length){out.push({t:'p',text:para.join('\n')});para=[]}};
  while(i<lines.length){const x=lines[i];
   const f=x.match(FENCE);
   if(f){flush();const code=[];i++;while(i<lines.length&&!(lines[i].startsWith(f[1])&&/^`+\s*$/.test(lines[i])))code.push(lines[i++]);i++;out.push({t:'code',lang:f[2]||'',code:code.join('\n')});continue}
   if(/^\s*\$\$\s*$/.test(x)){flush();const m=[];i++;while(i<lines.length&&!/^\s*\$\$\s*$/.test(lines[i]))m.push(lines[i++]);i++;out.push({t:'math',tex:m.join('\n').trim()});continue}
   if(/^\s*\|/.test(x)&&i+1<lines.length&&isTableSep(lines[i+1])){flush();const head=cells(x),rows=[];i+=2;while(i<lines.length&&/^\s*\|/.test(lines[i]))rows.push(cells(lines[i++]));
    const w=head.length;out.push({t:'table',head,rows:rows.map(r=>Array.from({length:w},(_,k)=>r[k]??''))});continue}
   if(/^###\s+/.test(x)){flush();out.push({t:'h',text:x.replace(/^###\s+/,'').trim()});i++;continue}
   if(/^\s*[-*]\s+/.test(x)){flush();const items=[];while(i<lines.length&&/^\s*[-*]\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*[-*]\s+/,''));i++;while(i<lines.length&&/^\s{2,}\S/.test(lines[i])&&!/^\s*([-*]|\d+[.)])\s+/.test(lines[i]))items[items.length-1]+='\n'+lines[i++].trim();if(!lines[i]?.trim()&&/^\s*[-*]\s+/.test(lines[i+1]||''))i++}out.push({t:'ul',items});continue}
   if(/^\s*\d+[.)]\s+/.test(x)){flush();const items=[],first=parseInt(x,10);
    // Steps split by a formula or code block ("1. … $$…$$ 1. …") continue the numbering of the list before them.
    const prev=[...out].reverse().find(b=>b.t!=='math'&&b.t!=='code'),start=prev&&prev.t==='ol'&&out[out.length-1]!==prev&&first<=prev.start+prev.items.length-1?prev.start+prev.items.length:first;while(i<lines.length&&/^\s*\d+[.)]\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*\d+[.)]\s+/,''));i++;while(i<lines.length&&/^\s{2,}\S/.test(lines[i])&&!/^\s*([-*]|\d+[.)])\s+/.test(lines[i]))items[items.length-1]+='\n'+lines[i++].trim();if(!lines[i]?.trim()&&/^\s*\d+[.)]\s+/.test(lines[i+1]||''))i++}out.push({t:'ol',items,start:Number.isFinite(start)&&start>0?start:1});continue}
   if(/^\s*>\s?/.test(x)){flush();const q=[];while(i<lines.length&&/^\s*>\s?/.test(lines[i]))q.push(lines[i++].replace(/^\s*>\s?/,''));out.push({t:'note',text:q.join('\n').trim()});continue}
   if(!x.trim()){flush();i++;continue}
   para.push(x);i++}
  flush();return out.filter(b=>b.t!=='p'||b.text.trim())}

 /* ---------- inline text ---------- */
 /** Inline runs: [{k:'text'|'code'|'bold', v}] — `code` and **bold** only. */
 function runs(text){const src=String(text??''),out=[];let i=0,buf='';
  const push=(k,v)=>{if(buf){out.push({k:'text',v:buf});buf=''}if(v)out.push({k,v})};
  while(i<src.length){
   if(src[i]==='`'){const j=src.indexOf('`',i+1);if(j>i+1&&!src.slice(i+1,j).includes('\n')){push('code',src.slice(i+1,j));i=j+1;continue}}
   // ***x*** (bold + italic): italic is not in the grammar, so it is bold — never bold with a stray star on each side
   if(src.startsWith('***',i)){const j=src.indexOf('***',i+3);if(j>i+3&&!src.slice(i+3,j).includes('*')){push('bold',src.slice(i+3,j));i=j+3;continue}}
   if(src.startsWith('**',i)){const j=src.indexOf('**',i+2);if(j>i+2){push('bold',src.slice(i+2,j));i=j+2;continue}}
   buf+=src[i++]}
  push();return out}
 const ESC=/[\\`*_\[\]<>#|~&$]/g;
 /** Escapes text so it renders literally in CommonMark and in Notion's Markdown (where `$` would start math). */
 const escText=t=>String(t).replace(ESC,'\\$&');
 const PUNCT=/[\p{P}\p{S}]/u,SPACE=/\s/u;
 /** **bold** that CommonMark and Notion actually read as bold. A ** only opens when the next character is not a space
     and, if it is punctuation, the character before the ** is a space or punctuation (closing: mirror image). So
     `**SQL 삽입(SQLi)**은` shows its stars: `)` is punctuation and `은` is a letter. Spaces at the edges move outside
     the markers, then one edge punctuation mark next to a letter moves outside (`**SQL 삽입(SQLi**)은`). The text
     is unchanged; only that mark is not bold. Bold that cannot exist (`**)**은`) becomes plain text, never stray stars.
     before/after: the Markdown characters just outside ('' = line edge). */
 function boldMd(v,before,after){let lead='',trail='',b=v.replace(/\n/g,' ');
  for(let k=0;k<8&&b;k++){const m=b.match(/^\s+/),n=b.match(/\s+$/);
   if(m){lead+=m[0];b=b.slice(m[0].length);continue}
   if(n){trail=n[0]+trail;b=b.slice(0,-n[0].length);continue}
   const f=String.fromCodePoint(b.codePointAt(0)),l=Array.from(b).pop();
   const p=lead?lead.slice(-1):before,q=trail?trail[0]:after,word=c=>!!c&&!SPACE.test(c)&&!PUNCT.test(c);
   if(PUNCT.test(f)&&word(p)){lead+=f;b=b.slice(f.length);continue}
   if(PUNCT.test(l)&&word(q)){trail=l+trail;b=b.slice(0,-l.length);continue}
   break}
  return escText(lead)+(b?`**${escText(b)}**`:'')+escText(trail)}
 function inlineMd(text){
  // two bold runs side by side (**a****b**) would print one four-star run that CommonMark reads differently: merge them
  const rs=runs(text).reduce((a,r)=>{const z=a[a.length-1];if(z&&z.k==='bold'&&r.k==='bold')z.v+=r.v;else a.push({...r});return a},[]);
  const md=rs.map(r=>r.k==='code'?codeSpan(r.v):r.k==='text'?escText(r.v):'');
  for(let k=0;k<rs.length;k++)if(rs[k].k==='bold')md[k]=boldMd(rs[k].v,md.slice(0,k).join('').slice(-1),(md[k+1]??'').slice(0,1));
  return md.join('').split('\n').map((x,i)=>i?x.replace(/^(\s*)([-+=]|\d+[.)])(?=\s|$)/,'$1\\$2'):x).join('  \n')}
 const codeSpan=v=>{const run=Math.max(0,...(v.match(/`+/g)||['']).map(x=>x.length));const f='`'.repeat(run+1);return f+(v.startsWith('`')||v.endsWith('`')?' '+v+' ':v)+f};
 const lineSafe=t=>inlineMd(t).replace(/^(\s*)([-+=]|\d+[.)])(?=\s|$)/,'$1\\$2');
 const cellMd=t=>inlineMd(t).replace(/ {2}\n/g,' ').replace(/(?<!\\)\|/g,'\\|');

 /* ---------- block renderers ---------- */
 function blocksMd(blocks,{notion=false}={}){const o=[];
  for(const b of blocks){
   if(b.t==='p')o.push(lineSafe(b.text));
   else if(b.t==='h')o.push(`### ${inlineMd(b.text).replace(/ {2}\n/g,' ')}`);
   else if(b.t==='ul')o.push(b.items.map(x=>`- ${inlineMd(x).replace(/ {2}\n/g,'  \n  ')}`).join('\n'));
   else if(b.t==='ol')o.push(b.items.map((x,i)=>`${(b.start||1)+i}. ${inlineMd(x).replace(/ {2}\n/g,'  \n   ')}`).join('\n'));
   else if(b.t==='code')o.push(N.fence(b.code,b.lang));
   else if(b.t==='math')o.push(`$$\n${b.tex.replace(/\$\$/g,'$ $')}\n$$`);
   else if(b.t==='table'){const w=b.head.length;o.push([`| ${b.head.map(cellMd).join(' | ')} |`,`|${' --- |'.repeat(w)}`,...b.rows.map(r=>`| ${r.map(cellMd).join(' | ')} |`)].join('\n'))}
   else if(b.t==='note')o.push(notion?callout(lineSafe(b.text)):b.text.split('\n').map(x=>'> '+inlineMd(x)).join('\n'))}
  return o.join('\n\n')}
 /** Notion callout (v2: tag form, body on the line after the opening tag, no padding blank lines). */
 const callout=body=>`<callout color="gray_bg">\n${body}\n</callout>`;
 /** Notion toggle: title on the line after the opening tag, children after one blank line. */
 const toggle=(title,children)=>`<toggle>\n${title}\n\n${children.replace(/\n+$/,'')}\n</toggle>`;

 /* ---------- record helpers ---------- */
 const dlg=l=>Array.isArray(l?.dialogue)?l.dialogue:[];
 const typed=m=>m&&m.role==='learner'&&!m.quick&&typeof m.text==='string'&&m.text.trim();
 /** The learner's typed messages, numbered from 1 in record order (the numbers the synthesis refers to). */
 function learnerMessages(l){return dlg(l).filter(typed).map((m,i)=>({n:i+1,id:m.id,text:m.text,reply:T?T.replyOf(l,m):null}))}
 const fnv=str=>{let h=0x811c9dc5;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h.toString(16).padStart(8,'0')};
 /** What a concept note was made from. A different key later means the exploration went on (or changed) since. */
 function basisKey(l){const d=l?.lesson||{};
  return fnv(JSON.stringify([d.title,(d.technical||[]).map(t=>[t.heading,t.text]),(d.concepts||[]).map(c=>c.name),dlg(l).map(m=>[m.id,m.role,m.status,(m.text||'').length]),
   (l?.drafts||[]).map(x=>[x.at,(x.text||'').length,!!x.feedback]),(l?.scenarios||[]).map(x=>[x.i,x.choice]),l?.prediction||'',l?.reflection||'']))}
 const stale=l=>!!l?.conceptNote&&l.conceptNote.basis!==basisKey(l);
 const titleOf=l=>(C?C.identity(l).title:l?.lesson?.title||l?.topic)||'학습 노트';

 /* ---------- cleaning (stored notes, imported records, server output) ---------- */
 function clean(v,l){if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const mat=l?.material&&M?l.material:null,msgs=learnerMessages(l),byN=new Map(msgs.map(m=>[m.n,m]));
  const sections=[];let total=0;
  for(const x of Array.isArray(v.sections)?v.sections:[]){if(!x||typeof x!=='object')continue;const heading=s(x.heading).slice(0,LIM.heading),body=s(x.body).slice(0,LIM.body);
   if(!heading||!body||total+body.length>LIM.total)continue;total+=body.length;
   sections.push({heading,body,sources:mat?M.verify(x.sources,mat):[],origin:ORIGINS.includes(x.origin)?x.origin:'lesson',asks:[...new Set((Array.isArray(x.asks)?x.asks:[]).filter(n=>byN.has(n)))].slice(0,8)});
   if(sections.length>=LIM.sections)break}
  const title=s(v.title).slice(0,LIM.title),lead=s(v.lead).slice(0,LIM.lead);
  if(!sections.length||!lead)return null;
  const heads=new Set(sections.map(x=>x.heading));const seen=new Set();
  const resolved=(Array.isArray(v.resolved)?v.resolved:[]).filter(x=>x&&byN.has(x.n)&&s(x.answer)&&!seen.has(x.n)&&seen.add(x.n))
   .map(x=>({n:x.n,question:byN.get(x.n).text,answer:s(x.answer).slice(0,LIM.answer),section:heads.has(s(x.section))?s(x.section):''})).slice(0,12);
  const open=(Array.isArray(v.open)?v.open:[]).filter(x=>x&&(byN.has(x.n)||s(x.text))).map(x=>byN.has(x.n)?{n:x.n,text:byN.get(x.n).text,why:s(x.why||x.text).slice(0,LIM.text)}:{n:null,text:s(x.text).slice(0,LIM.text)}).slice(0,8);
  const list=(k,f)=>(Array.isArray(v[k])?v[k]:[]).map(f).filter(Boolean);
  return {v:VERSION,kind:v.kind==='basic'?'basic':'ai',title:title||titleOf(l),lead,sections,resolved,open,
   selfCheck:list('selfCheck',x=>x&&s(x.q)&&s(x.a)?{q:s(x.q).slice(0,LIM.q),a:s(x.a).slice(0,LIM.a)}:null).slice(0,8),
   corrections:list('corrections',x=>s(x?.text??x)?{text:s(x?.text??x).slice(0,LIM.text)}:null).slice(0,5),
   conflicts:list('conflicts',x=>s(x?.text??x)?{text:s(x?.text??x).slice(0,LIM.text)}:null).slice(0,5),
   limitations:s(v.limitations).slice(0,LIM.limitations),
   generatedBy:v.generatedBy&&typeof v.generatedBy==='object'?{provider:String(v.generatedBy.provider||'').slice(0,40),model:String(v.generatedBy.model||'').slice(0,120)}:null,
   at:Number.isFinite(v.at)?v.at:null,basis:typeof v.basis==='string'?v.basis.slice(0,16):null,editedAt:Number.isFinite(v.editedAt)?v.editedAt:null,
   ...(v.truncated?{truncated:Math.max(0,Number(v.truncated)|0)}:{})}}

 /* ---------- the request for the AI synthesis (bounded) ---------- */
 const BUDGET={reply:2400,message:1200,messages:15000,dialogue:38000,draft:3000};
 /** Body of /api/ai mode 'note'. Bounded: replies/messages are clipped, and when the conversation is long the oldest
     button-only exchanges go first, then the oldest exchanges; `omitted` says how many messages were left out. */
 function payload(l,profile){const d=l.lesson||{},msgs=learnerMessages(l),num=new Map(msgs.map(m=>[m.id,m.n]));
  const ex=[];for(const m of dlg(l)){if(m.role!=='learner'||m.status==='noted')continue;const r=T?T.replyOf(l,m):null;if(!r)continue;
   ex.push({n:num.get(m.id)||null,ask:String(m.text).slice(0,BUDGET.message),button:!!m.quick,about:m.ref?.kind==='term'?`용어 ‘${m.ref.term}’`:m.ref?.kind==='section'?`개념 설명 ‘${d.technical?.[m.ref.i]?.heading||''}’`:m.ref?.kind==='scenario'?`사고 실험 ${m.ref.i+1}`:m.ref?.kind==='feedback'?'설명 피드백':m.ref?.kind==='draft'?'내 설명을 쓰다가 생긴 질문':'',
    reply:String(r.text||'').slice(0,BUDGET.reply),...(r.followUp?{tutorQuestion:String(r.followUp).slice(0,400)}:{})})}
  let size=JSON.stringify(ex).length,omitted=0;
  while(size>BUDGET.dialogue&&ex.length){let k=ex.findIndex(x=>x.button&&!x.n);if(k<0)k=0;size-=JSON.stringify(ex[k]).length;ex.splice(k,1);omitted+=2}
  const fbOf=dr=>{const f=T?T.validFeedback(l,dr):null;return f?{summary:f.summary,correct:f.correct.map(x=>x.point),precision:f.precision.map(x=>x.issue),misconceptions:f.misconceptions.map(x=>x.issue),missing:f.missing.map(x=>x.issue)}:null};
  return {mode:'note',title:titleOf(l),question:C?C.identity(l).question||'':l.topic||'',
   lesson:{prerequisites:(d.prerequisites||[]).map(p=>({term:p.term,plain:p.plain})),concepts:(d.concepts||[]).map(c=>({name:c.name,description:c.description})),
    technical:(d.technical||[]).map(t=>({heading:t.heading,plain:t.plain||'',text:t.text,example:t.example||'',steps:t.steps||[],misread:t.misread||'',conditions:t.conditions||'',
     ...(t.visual?{visual:t.visual}:{}),...(l.material&&M?{sources:M.verify(t.sources,l.material)}:{})})),
    scenarios:(d.scenarios||[]).map((sc,i)=>{const r=(l.scenarios||[]).find(x=>x.i===i);return {question:sc.question,answer:sc.options?.[sc.answerIndex]||'',reason:sc.reason||'',learner:!r?'미응답':r.unsure||r.choice==null?'모르겠다고 함':r.choice===sc.answerIndex?'해설과 같음':'해설과 다름'}}),
    limitations:d.limitations||''},
   prediction:l.prediction||'',reflection:l.reflection||'',
   drafts:(l.drafts||[]).slice(-2).map(dr=>({text:String(dr.text||'').slice(0,BUDGET.draft),feedback:fbOf(dr)})),
   // every typed message keeps its number; when there are many, each is clipped so the list stays within budget
   messages:msgs.map(m=>({n:m.n,text:String(m.text).slice(0,Math.max(80,Math.min(BUDGET.message,Math.floor(BUDGET.messages/Math.max(1,msgs.length))))),answered:!!m.reply})),exchanges:ex,omitted,
   ...(l.material&&M?{material:M.lessonPayload(l.material)}:{}),...(profile?{profile}:{})}}

 /* ---------- deterministic note (no AI synthesis) ---------- */
 function basic(l){const d=l?.lesson||{},sections=[];
  const blocksText=t=>{const b=[];if(t.plain)b.push(t.plain);if(t.text)b.push(t.text);
   if(t.example)b.push(/```/.test(t.example)?t.example:'**예시** '+t.example);
   if(t.steps?.length)b.push(t.steps.map((x,i)=>`${i+1}. ${x}`).join('\n'));
   const v=T?T.cleanVisual(t.visual):null;
   if(v?.type==='flow')b.push(`**흐름 — ${v.title}**`,v.steps.map((x,i)=>`${i+1}. **${x.label}** — ${x.detail||''}`).join('\n')+(v.note?`\n\n${v.note}`:''));
   if(v?.type==='compare')b.push(`**비교 — ${v.title}**`,[`| 기준 | ${v.columns.join(' | ')} |`,`|${' --- |'.repeat(v.columns.length+1)}`,...v.rows.map(r=>`| ${[r.aspect,...r.values].map(x=>String(x).replace(/\|/g,'\\|')).join(' | ')} |`)].join('\n')+(v.note?`\n\n${v.note}`:''));
   if(t.misread)b.push('> **흔한 오해** '+t.misread);if(t.conditions)b.push('> **조건과 한계** '+t.conditions);return b.join('\n\n')};
  if(d.prerequisites?.length)sections.push({heading:'먼저 알아 둘 개념',body:d.prerequisites.map(p=>`- **${p.term}** — ${p.plain}${p.example?` (예: ${p.example})`:''}`).join('\n'),sources:[],origin:'lesson',asks:[]});
  if(d.concepts?.length){const name=new Map(d.concepts.map(c=>[c.id,c.name]));
   sections.push({heading:'핵심 개념',body:d.concepts.map(c=>`- **${c.name}** — ${c.description}`).join('\n')+(d.connections?.length?'\n\n### 개념 사이의 연결\n\n'+d.connections.map(c=>`- ${name.get(c.from)||c.from} ↔ ${name.get(c.to)||c.to}${c.why?' — '+c.why:''}`).join('\n'):''),
    sources:[],origin:'lesson',asks:[]})}
  const lead=d.technical?.[0]?.plain||d.hook||d.concepts?.[0]?.description||'';
  (d.technical||[]).forEach((t,i)=>sections.push({heading:t.heading,body:blocksText(i===0&&t.plain===lead?{...t,plain:''}:t),sources:l.material&&M?M.verify(t.sources,l.material):[],origin:l.material&&M&&M.verify(t.sources,l.material).length?'material':'lesson',asks:[]}));
  const msgs=learnerMessages(l).filter(m=>m.reply);
  const selfCheck=(d.scenarios||[]).map(sc=>({q:sc.question,a:[sc.options?.[sc.answerIndex],sc.reason].filter(Boolean).join(' — ')})).filter(x=>x.q&&x.a);
  const note={v:VERSION,kind:'basic',title:titleOf(l),lead,sections,
   resolved:[],qa:msgs.map(m=>({n:m.n,question:m.text,answer:m.reply.text})),
   open:(N?N.aiQuestions(l):[]).filter(q=>q.status!=='answered').slice(0,6).map(q=>({n:null,text:q.question,ai:true})),
   selfCheck,corrections:[],conflicts:[],limitations:d.limitations||'',generatedBy:l?.generatedBy||null,at:null,basis:basisKey(l)};
  return note}

 /* ---------- rendering ---------- */
 const pad=n=>String(n).padStart(2,'0');
 const day=ms=>{if(!Number.isFinite(ms))return '';const x=new Date(ms);return `${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`};
 const gen=g=>g?[g.provider==='manual-import'?'직접 가져온 JSON':g.provider,g.model].filter(Boolean).join(' · '):'';
 /** The note to export for this exploration: the learner's AI note when there is one, otherwise the basic note. */
 const noteFor=l=>(l?.conceptNote&&clean(l.conceptNote,l))||basic(l);
 function srcLine(x,mat){if(!mat||!x.sources?.length)return '';
  return `수업 자료 ${[...new Set(x.sources.map(z=>M.label(mat,z.page)))].join(', ')}: ${x.sources.map(z=>`“${M.excerpt(mat,z)}”`).join(' · ')}`}
 /** Markdown of the whole note. opts: {notion, now, history:true} */
 function render(note,l,{notion=false,now=Date.now(),history=true}={}){
  const o=[],mat=l?.material&&M?l.material:null,idn=C?C.identity(l):{question:l?.topic};
  const meta=[idn.question?`처음 궁금했던 것: ${idn.question}`:mat?`수업 자료에서 시작: ${mat.name}`:'',day(l?.createdAt)].filter(Boolean).join(' · ');
  if(!notion)o.push(`# ${escText(note.title)}`);
  if(meta)o.push(`_${escText(meta)}_`);
  o.push(lineSafe(note.lead));
  const why=note.kind==='ai'
   ?`이 노트는 AI(${gen(note.generatedBy)||'기록 없음'})가 이 탐험의 학습 자료와 튜터 대화, 내가 던진 질문을 바탕으로 정리한 설명이에요.${note.editedAt?' 그 뒤에 내가 직접 고쳤어요.':''} 외부 자료로 확인한 내용이 아니에요.`
   :`이 노트는 AI 종합 없이 이 탐험의 학습 자료(AI ${gen(note.generatedBy)||'기록 없음'}가 만든 설명)를 개념 순서로 정리한 기본 노트예요. 외부 자료로 확인한 내용이 아니에요.`;
  o.push(notion?callout(escText(why)):`> ${escText(why)}`);
  for(const x of note.sections){o.push(`## ${escText(x.heading)}`,blocksMd(parse(x.body),{notion}));
   const sl=srcLine(x,mat);if(sl)o.push(`_${escText(sl)}_`)}
  if(note.resolved?.length){o.push('## 이번 탐험에서 풀린 질문');
   for(const r of note.resolved){const ref=r.section?` (자세히: ‘${r.section}’)`:'';
    if(notion)o.push(toggle(`내 질문: “${escText(oneLine(r.question))}”`,`${lineSafe(r.answer+ref)}`));
    else o.push(`**내 질문:** “${escText(oneLine(r.question))}”`,lineSafe(r.answer+ref))}}
  if(note.qa?.length){o.push('## 이번 탐험에서 나눈 질문과 답','_내 질문은 쓴 그대로, 답은 AI 튜터가 대화 중에 한 답이에요 (종합하지 않은 원문)._');
   for(const r of note.qa){const body=N.rich(r.answer);if(notion)o.push(toggle(`내 질문: “${escText(oneLine(r.question))}”`,body));else o.push(`**내 질문:** “${escText(oneLine(r.question))}”`,body)}}
  if(note.open?.length){o.push('## 아직 남은 질문',note.open.map(x=>x.n?`- **내 질문** “${escText(oneLine(x.text))}”${x.why?' — '+inlineMd(x.why):''}`:`- ${x.ai?'(AI가 던진 질문) ':''}${inlineMd(x.text)}`).join('\n'))}
  if(note.selfCheck?.length){o.push('## 스스로 확인하기');
   if(notion)note.selfCheck.forEach((x,i)=>o.push(toggle(`${i+1}\\. ${escText(oneLine(x.q))}`,lineSafe(x.a))));
   else{o.push(note.selfCheck.map((x,i)=>`${i+1}. ${inlineMd(oneLine(x.q))}`).join('\n'),'**답 확인**',note.selfCheck.map((x,i)=>`${i+1}. ${inlineMd(x.a).replace(/ {2}\n/g,'  \n   ')}`).join('\n'))}}
  // Sources and reliability: one place, short.
  const rel=[];
  if(mat)rel.push(`- 수업 자료: ${escText(mat.name)} (${M.kindName(mat)}). ‘수업 자료 p.N’ 표시는 그 내용이 올린 파일의 그 쪽에 있다는 뜻이고, 파일 내용이 맞다는 확인은 아니에요. 표시가 없는 부분은 AI의 설명이에요.`);
  for(const c of note.corrections||[])rel.push(`- 대화 중에 고쳐진 설명: ${inlineMd(c.text)}`);
  for(const c of note.conflicts||[])rel.push(`- 아직 정리되지 않은 설명 차이: ${inlineMd(c.text)}`);
  if(note.limitations)rel.push(`- 확인이 필요한 부분: ${inlineMd(note.limitations)}`);
  if(note.truncated)rel.push(`- 대화가 길어 메시지 ${note.truncated}개는 이 정리에 넣지 못했어요. 학습 기록에는 모두 있어요.`);
  if(note.kind==='ai'&&l&&note.basis&&note.basis!==basisKey(l))rel.push('- 이 노트를 만든 뒤에 이어진 학습 내용은 반영되지 않았어요.');
  rel.push('- 이 노트는 숙달이나 이해를 판정하지 않아요.');
  const rl=T&&l?.lesson?.concepts?T.readingList(l):[];
  o.push('## 출처와 신뢰도',rel.join('\n'));
  if(rl.length)o.push(rl[0].status==='ai-suggested'?'**찾아볼 곳 (AI 제안 · 아직 확인 안 됨)**':'**개념 이름으로 찾아보기 (앱이 만든 검색 링크)**',rl.map(r=>`- ${escText(r.claim)}${r.kind?' — '+escText(r.kind):''}: ${r.links.map(x=>`[${x.label}](${String(x.url).replace(/\(/g,'%28').replace(/\)/g,'%29')})`).join(' · ')}`).join('\n'));
  if(history&&N&&l){const hist=N.historyMarkdown(l,{notion,shift:notion?1:1});
   const intro='_이 탐험에서 내가 쓴 글은 쓴 그대로, AI의 답은 확인되지 않은 참고 의견으로 남긴 원래 기록이에요._';
   if(notion){const fit=fitNotion(o.join('\n\n'),hist,l);o.push(toggle('학습 기록 — 처음 예상, 사고 실험, 내 설명, 질문과 대화 전체',`${intro}\n\n${fit}`))}
   else o.push('---','## 학습 기록',intro,hist)}
  o.push('---',`_CURIVEN에서 ${escText(N?N.when(now):day(now))}에 ${notion?'저장한':'만든'} 노트예요.${notion?' 모든 원본 기록은 CURIVEN과 백업 파일(JSON)에 있어요.':' 모든 원본 기록은 백업 파일(JSON)에 있어요.'}_`);
  return o.filter(x=>x!=='').join('\n\n').replace(/\n{3,}/g,'\n\n')+'\n'}
 const oneLine=t=>String(t??'').replace(/\s+/g,' ').trim();
 /** Notion: one request may create at most 5,000 blocks and the server caps a note at 150,000 characters. When the
     history would push past a conservative budget, the conversation transcript is left out of the page (it stays in
     CURIVEN and the backup) and the page says so. */
 const NOTION_CHARS=120000,NOTION_BLOCKS=3500;
 const blocksIn=md=>md.split('\n').filter(x=>x.trim()).length;
 function fitNotion(head,hist,l){const fits=x=>head.length+x.length<NOTION_CHARS&&blocksIn(head)+blocksIn(x)<NOTION_BLOCKS;
  if(fits(hist))return hist;
  const tail='\n\n_기록이 길어 대화 전문은 Notion에 넣지 않았어요. CURIVEN과 백업 파일, Markdown 다운로드에는 모두 있어요._';
  let short=N.historyMarkdown(l,{notion:true,shift:1,transcript:false});if(fits(short+tail))return short+tail;
  short=N.historyMarkdown(l,{notion:true,shift:1,transcript:false,lists:false});if(fits(short+tail))return short+tail;
  // Still too long (very long explanations): cut at a paragraph boundary outside any code block.
  let cut=short.slice(0,Math.max(0,NOTION_CHARS-head.length-tail.length-200));cut=cut.slice(0,Math.max(0,cut.lastIndexOf('\n\n')));
  while(blocksIn(head)+blocksIn(cut)>=NOTION_BLOCKS&&cut.includes('\n\n'))cut=cut.slice(0,cut.lastIndexOf('\n\n'));
  if(((cut.match(/^`{3,}/gm)||[]).length)%2)cut=cut.slice(0,cut.lastIndexOf('\n```'));
  return cut+'\n\n_기록이 길어 일부만 Notion에 넣었어요. CURIVEN과 백업 파일, Markdown 다운로드에는 모두 있어요._'}

 const toMarkdown=(note,l,o={})=>render(note,l,{...o,notion:false});
 const toNotion=(note,l,o={})=>render(note,l,{...o,notion:true});
 /** What the download and the Notion save use. */
 const exportMarkdown=(l,o={})=>toMarkdown(noteFor(l),l,o);
 const exportNotion=(l,o={})=>toNotion(noteFor(l),l,o);

 const api={VERSION,LIM,parse,runs,escText,inlineMd,blocksMd,learnerMessages,basisKey,stale,clean,payload,basic,noteFor,render,toMarkdown,toNotion,exportMarkdown,exportNotion,titleOf};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriConcept=api;
})(typeof window!=='undefined'?window:globalThis);
