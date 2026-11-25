/* CURIVEN star atlas — Minimal Curiosity "monochrome observatory" (design spec p.5).
   Every knowledge star comes from a lesson record; the faint background dots are decoration, never knowledge.
   Encoding (never colour alone): size + outline + brightness + a text label in the detail panel and legend.
     exploration   larger white star with a thin outer ring and a faint halo
     explained     white star with a ring  — the learner's own words were tied to this concept by AI feedback (v2)
     legacy        white star with a dotted ring — an older feedback mentioned it; which sentence is not recorded
     encountered   small grey star — met in the exploration
     reference     hollow star — dev-only boundary activity concept
     relation      thin solid grey line — a connection recorded in the lesson
     membership    very faint dotted line — "same exploration", not a conceptual claim
   No star means mastery. Layout: atlas-layout.js (deterministic clusters). Exploration names: copy.js identity. */
'use strict';
const SVG_NS='http://www.w3.org/2000/svg',AL=window.CuriAtlasLayout;
let atlasLesson=null,atlasMode='today',atlasPreviousFocus=null,atlasFit=false,atlasFocus=null;
const atlasSeen=new Set(); // reveal animations play once per (mode, explorations) in a session, not on every redraw
function nsvg(parent,tag,attrs={},content){
 const el=document.createElementNS(SVG_NS,tag);
 for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));
 if(content!=null)el.textContent=String(content);
 parent.append(el);return el;
}
function prng(seed){let x=seed>>>0;return()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296}}
/** Static, sparse background dots (no twinkling). */
function ambientStars(svg,width,height,n,seed){
 const r=prng(seed),g=nsvg(svg,'g',{'aria-hidden':'true',class:'atlas-dust'});
 for(let i=0;i<n;i++)nsvg(g,'circle',{cx:(8+r()*(width-16)).toFixed(1),cy:(8+r()*(height-16)).toFixed(1),r:(.4+r()*.8).toFixed(2),fill:'#ffffff',opacity:(.06+r()*.18).toFixed(2)});
}
/* Boundary line style by evidence tier (dev prototype). Shape and weight carry the tier: dotted = encountered,
   long dashes = explored, solid = explained, thick bright with a soft glow = keyed checks of a reviewed pack. */
function boundaryStroke(ev){
 if(ev.tier==='keyed')return {color:'#ffffff',width:3.2,dash:null,glow:true};
 if(ev.tier==='explained')return {color:'#e6e6e3',width:2.4,dash:null};
 if(ev.tier==='explored')return {color:'#c4c4c0',width:1.8,dash:'9 6'};
 return {color:'#9c9c98',width:1.4,dash:'2 7'};
}
const TIER_TEXT={explained:'AI가 내 설명과 연결한 개념',legacy:'이전 버전 피드백에서 언급된 개념',reference:'경계 비교 활동에서 만난 개념',encountered:'이 탐험에서 만난 개념'};
const compactAtlas=()=>window.matchMedia('(max-width:760px)').matches;
function atlasRecords(l,mode){
 if(mode==='today')return l&&l.lesson?[l]:[];
 return data.lessons.filter(x=>x.complete&&x.lesson&&Array.isArray(x.lesson.concepts));
}
/** The one graph model shared by the full atlas and the small map. */
function modelAtlas(l,mode,{width=null,overview=false}={}){
 const compact=compactAtlas(),records=atlasRecords(l,mode),nodes=[],edges=[],clusters=[];
 const prepared=records.map(lesson=>{const concepts=lesson.lesson.concepts||[];
  const bd=typeof boundaryAtlas==='function'?boundaryAtlas(lesson):null; // Boundary Constellation: dev prototype only; null elsewhere
  const pairs=bd?bd.concepts.map(bc=>({bc,match:window.CuriBoundary.matchConcept(bc,concepts)})):[];
  return {lesson,concepts,bd,pairs,extra:pairs.filter(p=>!p.match)}});
 const lay=AL.layout(prepared.map(p=>({id:p.lesson.id,count:p.concepts.length+p.extra.length})),{compact,single:mode==='today'&&!overview,width,overview});
 const names=exploreNames(prepared.map(p=>p.lesson));
 prepared.forEach(({lesson,concepts,bd,pairs,extra},k)=>{
  const cl=lay.clusters[k],idn=window.CuriCopy.identity(lesson),name=names[k],topicId=`${lesson.id}:topic`,status=window.CuriLearning.conceptStatus(lesson);
  clusters.push({lessonId:lesson.id,title:name,fullTitle:idn.title,cx:cl.cx,cy:cl.cy,r:cl.r,cell:cl.cell});
  // name: the short display title (copy.js identity.short); the full lesson title, question and file stay in `fullTitle`/details.
  nodes.push({id:topicId,x:cl.cx,y:cl.cy,name,fullTitle:idn.title,shortSource:idn.shortSource,short:AL.shortLabel(name,overview?(compact?9:11):mode==='today'?(compact?20:30):(compact?14:18)),topic:true,lessonId:lesson.id,latest:lesson.id===l?.id,
   question:idn.question,file:idn.file,complete:!!lesson.complete});
  const lookup=new Map();
  concepts.forEach((c,i)=>{const pt=cl.points[i],id=`${lesson.id}:${c.id}`;lookup.set(c.id,id);const st=status.get(c.id)||{tier:'encountered'};
   // Identity stays per lesson record; a concept named like its own exploration is marked, never merged into it.
   nodes.push({id,x:pt.x,y:pt.y,name:c.name,description:c.description,topic:false,verified:st.tier!=='encountered',tier:st.tier,quote:st.quote||null,model:st.model||null,lessonId:lesson.id,latest:lesson.id===l?.id,
    lessonTopic:mode==='all'?name:null,sameAsTopic:[lesson.topic,lesson.lesson.title,idn.short].some(t=>nameKey(c.name)===nameKey(t))});
   edges.push({from:topicId,to:id,kind:'membership',reason:'같은 탐험에서 만난 개념'})});
  for(const c of (lesson.lesson.connections||[]))if(lookup.has(c.from)&&lookup.has(c.to))edges.push({from:lookup.get(c.from),to:lookup.get(c.to),kind:'relation',reason:c.why||'연결 이유 없음',lessonId:lesson.id});
  if(bd){extra.forEach((p,j)=>{const pt=cl.points[concepts.length+j],id=`${lesson.id}:boundary:${p.bc.id}`;p.node=id;
    nodes.push({id,x:pt.x,y:pt.y,name:p.bc.name,description:'경계 비교 활동의 참고 자료(검토 중인 학습 자료)에 나오는 개념이에요.',topic:false,verified:false,tier:'reference',lessonId:lesson.id,latest:lesson.id===l?.id});
    edges.push({from:topicId,to:id,kind:'membership',reason:'경계 비교 활동에서 만난 개념'})});
   const end=p=>p.match?lookup.get(p.match.id):p.node;
   if(pairs.length===2)edges.push({from:end(pairs[0]),to:end(pairs[1]),kind:'boundary',evidence:bd.evidence,reason:bd.text,names:bd.names,lessonId:lesson.id})}
 });
 markSameNames(nodes);
 return {nodes,edges,records,clusters,width:lay.width,height:lay.height,overview:!!lay.overview};
}
/** Display names for explorations: identity.short, numbered "(2)", "(3)" when several explorations share one (display only). */
function exploreNames(lessons){const seen=new Map();
 return lessons.map(x=>{const s=window.CuriCopy.identity(x).short,k=nameKey(s),n=(seen.get(k)||0)+1;seen.set(k,n);return n>1?`${s} (${n})`:s})}
/** Same concept name in several explorations: separate stars (each belongs to its own record), never silently merged. */
function nameKey(s){return String(s||'').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'')}
function markSameNames(nodes){const key=n=>nameKey(n.name),count=new Map();
 for(const n of nodes)if(!n.topic)count.set(key(n),(count.get(key(n))||0)+1);
 for(const n of nodes)if(!n.topic)n.sameName=count.get(key(n))-1}
/** One star glyph, shared by the atlas and the small map (scale s). */
function starGlyph(g,node,s=1){const x=node.x,y=node.y;
 if(node.topic){nsvg(g,'circle',{cx:x,cy:y,r:22*s,class:'halo',fill:'#ffffff',opacity:.06});nsvg(g,'circle',{cx:x,cy:y,r:11*s,fill:'none',stroke:'#f7f7f5','stroke-opacity':.55,'stroke-width':1,class:'star-ring'});nsvg(g,'circle',{cx:x,cy:y,r:6*s,fill:'#ffffff',class:'star-core'});return}
 if(node.tier==='explained'||node.tier==='legacy'){nsvg(g,'circle',{cx:x,cy:y,r:12*s,class:'halo',fill:'#ffffff',opacity:.05});
  const ring=nsvg(g,'circle',{cx:x,cy:y,r:7.5*s,fill:'none',stroke:'#ffffff','stroke-opacity':.85,'stroke-width':1.1,class:'star-ring'});if(node.tier==='legacy')ring.setAttribute('stroke-dasharray','1.5 2.5');
  nsvg(g,'circle',{cx:x,cy:y,r:4*s,fill:'#ffffff',class:'star-core'});return}
 if(node.tier==='reference'){nsvg(g,'circle',{cx:x,cy:y,r:4*s,fill:'#111317',stroke:'#c4c4c0','stroke-width':1.2,class:'star-core'});return}
 nsvg(g,'circle',{cx:x,cy:y,r:3.4*s,fill:'#b4b4b0',class:'star-core'})}

/* ---------- small map: an overview, not every label ---------- */
function paintMiniConstellation(l){
 const svg=document.getElementById('map'),caption=document.getElementById('map-caption');svg.replaceChildren();
 const lesson=l?.lesson?l:data.lessons.filter(x=>x.complete&&x.lesson).at(-1);
 if(!lesson){svg.setAttribute('viewBox','0 0 290 265');ambientStars(svg,290,265,26,7801);caption.textContent='첫 탐험을 마치면 이곳에 별자리가 생겨요.';return}
 const model=modelAtlas(lesson,'today'),cl=model.clusters[0],pad=34,half=cl.r+pad,vb=[cl.cx-half*1.1,cl.cy-half,half*2.2,half*2];
 svg.setAttribute('viewBox',vb.map(v=>v.toFixed(1)).join(' '));
 const s=vb[2]/290,byId=new Map(model.nodes.map(n=>[n.id,n])); // s: viewBox units per screen pixel, so marks keep a constant on-screen size
 const dust=nsvg(svg,'g',{'aria-hidden':'true'}),rr=prng(7801);for(let i=0;i<22;i++)nsvg(dust,'circle',{cx:(vb[0]+rr()*vb[2]).toFixed(1),cy:(vb[1]+rr()*vb[3]).toFixed(1),r:((.4+rr()*.7)*s).toFixed(2),fill:'#fff',opacity:(.08+rr()*.16).toFixed(2)});
 for(const e of model.edges){const a=byId.get(e.from),b=byId.get(e.to);if(!a||!b)continue;
  if(e.kind==='boundary'){const st=boundaryStroke(e.evidence);nsvg(svg,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:st.color,'stroke-width':st.width*.8,'stroke-dasharray':st.dash||'none',class:'atlas-boundary'});continue}
  const m=e.kind==='membership';nsvg(svg,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#ffffff','stroke-opacity':m?.16:.5,'stroke-width':m?.8:1.1,'stroke-dasharray':m?`${3*s} ${6*s}`:'none'})}
 for(const n of model.nodes){const g=nsvg(svg,'g',{class:'mini-star'});starGlyph(g,n,s*.85);nsvg(g,'title',{},n.topic?n.fullTitle:n.name)}
 const t=model.nodes[0];nsvg(svg,'text',{x:t.x,y:t.y+24*s,'text-anchor':'middle',class:'mini-title','font-size':(11.5*s).toFixed(1),'stroke-width':(3*s).toFixed(1)},AL.shortLabel(t.name,16));
 const concepts=model.nodes.filter(n=>!n.topic),explained=concepts.filter(n=>n.tier==='explained').length,links=model.edges.filter(e=>e.kind==='relation').length;
 caption.textContent=`개념 ${concepts.length} · 연결 ${links}${explained?` · AI 연결 ${explained}`:''}`;
 const be=model.edges.find(e=>e.kind==='boundary');svg.setAttribute('aria-label',`${t.name} (${t.fullTitle}): 개념 ${concepts.length}개, 기록된 연결 ${links}개의 별자리`+(be?'. '+be.reason:''));
 if(be)caption.textContent+=` · 경계 비교: ${window.CuriBoundary.TIER_TEXT[be.evidence.tier].split(' — ')[0]}${be.evidence.preview?' (성취 미리보기, 기록 안 됨)':''}`;
}

/* ---------- labels ---------- */
/* Each label keeps its spot below the star unless that collides with a label already placed in the same cluster, a star,
   or the map edge; then above, right, left, keeping the least-overlapping spot. Clusters own separate cells, so labels are
   compared only within a cluster (linear in the number of explorations). Measured with getBBox at the real font size. */
function placeLabels(items,width,height){
 const pad=3,box=b=>({x:b.x,y:b.y,w:b.width,h:b.height});
 const hit=(a,b)=>{const w=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)+pad,h=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)+pad;return w>0&&h>0?w*h:0};
 const byCluster=new Map();for(const it of items){if(!byCluster.has(it.node.lessonId))byCluster.set(it.node.lessonId,[]);byCluster.get(it.node.lessonId).push(it)}
 for(const group of byCluster.values()){const starBoxes=group.map(it=>({x:it.node.x-it.r,y:it.node.y-it.r,w:it.r*2,h:it.r*2})),placed=[];
  for(const it of [...group].sort((a,b)=>Number(b.node.topic)-Number(a.node.topic))){
   const {el,node,r}=it,fs=parseFloat(el.style.fontSize)||13,lines=el.childNodes.length||1,x=node.x,y=node.y;
   const lh=fs*1.15,spots=[[x,y+r+fs+2,'middle'],[x,y-r-6-(lines-1)*lh,'middle'],[x+r+7,y+fs*.35-(lines-1)*lh/2,'start'],[x-r-7,y+fs*.35-(lines-1)*lh/2,'end'],
    [x+r+5,y+r+fs,'start'],[x-r-5,y+r+fs,'end'],[x+r+5,y-r-4-(lines-1)*lh,'start'],[x-r-5,y-r-4-(lines-1)*lh,'end'],[x,y+r+fs*2.3+2,'middle']];
   // A concept label first tries the side facing away from its exploration star (the natural constellation reading).
   if(!node.topic&&it.center){const dx=x-it.center.x,dy=y-it.center.y,d=Math.hypot(dx,dy)||1,ux=dx/d,uy=dy/d;
    const out=Math.abs(ux)>.45?(ux>0?spots[2]:spots[3]):(uy>0?spots[0]:spots[1]);spots.splice(spots.indexOf(out),1);spots.unshift(out)}
   let best=null;
   for(const [sx,sy,anchor] of spots){setLabel(el,sx,sy,anchor);
    const b=box(el.getBBox());if(!b.w){best={sx,sy,anchor,b,cost:0};break}
    let cost=placed.reduce((s,p)=>s+hit(b,p),0);starBoxes.forEach((s,k)=>{if(group[k]!==it)cost+=hit(b,s)});
    // Stay inside the exploration's own cell (so neighbouring clusters never collide), and inside the map.
    const c=it.cell||{x:0,y:0,w:width,h:height},x0=Math.max(0,c.x),y0=Math.max(0,c.y),x1=Math.min(width,c.x+c.w),y1=Math.min(height,c.y+c.h);
    cost+=(Math.max(0,x0-b.x)+Math.max(0,b.x+b.w-x1))*b.h*4+(Math.max(0,y0-b.y)+Math.max(0,b.y+b.h-y1))*b.w*4;
    if(!best||cost<best.cost)best={sx,sy,anchor,b,cost};if(cost===0)break}
   setLabel(el,best.sx,best.sy,best.anchor);placed.push(best.b)}}
}
function setLabel(el,x,y,anchor){el.setAttribute('x',x);el.setAttribute('y',y);el.setAttribute('text-anchor',anchor);for(const t of el.querySelectorAll('tspan'))t.setAttribute('x',x)}

/* ---------- detail panel ---------- */
function atlasSelect(star){
 const info=document.getElementById('atlasInfo');info.replaceChildren();info.scrollTop=0;
 document.querySelectorAll('#atlasSvg .atlas-star.selected').forEach(g=>g.classList.remove('selected'));
 if(star.id){const g=document.querySelector(`#atlasSvg .atlas-star[data-id="${CSS.escape(star.id)}"]`);if(g)g.classList.add('selected')}
 if(star.boundary){info.append(E('h3','',star.name),E('p','',star.description),E('p','atlas-hint','선 모양: 점선 = 만남 · 긴 점선 = 예측으로 탐색 · 실선 = 내 설명 있음 · 굵고 밝은 선 = 검토를 마친 자료의 채점 문항 통과. 어느 단계도 영구적인 지식이나 완전한 이해를 뜻하지 않아요.'));return}
 const h=E('h3','',star.name);h.id='atlasInfoTitle';
 if(star.empty){info.append(h,E('p','',star.description));return}
 const writable=star.topic&&star.lessonId&&typeof canWrite==='function'&&canWrite();
 if(writable){const head=E('div','atlas-title-row');const r=button('이름 바꾸기',()=>renameForm(star),'atlas-rename-btn');r.id='atlasRename';r.setAttribute('aria-label',`${star.name} 이름 바꾸기`);head.append(h,r);info.append(head)}else info.append(h);
 if(star.lessonTopic)info.append(E('p','atlas-from','탐험 · '+star.lessonTopic));
 if(star.topic){
  const members=atlasModel?.nodes.filter(n=>!n.topic&&n.lessonId===star.lessonId)||[];
  if(members.length){const ul=E('ul','atlas-members');ul.setAttribute('aria-labelledby','atlasMembersLabel');
   for(const n of members){const li=E('li','');const b=button(n.name,()=>{atlasSelect(n);focusStar(n.id)},'atlas-member');b.dataset.tier=n.tier;b.setAttribute('aria-label',`${n.name} — ${TIER_TEXT[n.tier]||''}`);li.append(b);if(n.tier==='explained'||n.tier==='legacy')li.append(E('span','atlas-member-tier',n.tier==='explained'?'AI 연결':'이전 피드백'));ul.append(li)}
   const lab=E('p','atlas-sub',`개념 ${members.length}`);lab.id='atlasMembersLabel';info.append(lab,ul)}
  // Full lesson title, the learner's question and the source file: kept, one tap away.
  const about=E('details','atlas-about');about.append(E('summary','','탐험 정보'));
  const dl=E('dl','');const row=(k,v,cls)=>{dl.append(E('dt','',k));const dd=E('dd',cls||'',v);dl.append(dd)};
  if(star.fullTitle)row('학습 제목',star.fullTitle,'atlas-full-title');
  if(star.question)row('처음 질문',star.question,'atlas-question');
  if(star.file)row(star.file.kind==='pptx'?'수업 자료 (PPTX)':'수업 자료 (PDF)',star.file.name,'atlas-file');
  if(star.complete===false)row('상태','진행 중');
  about.append(dl);info.append(about);
 }else if(star.description)info.append(E('p','atlas-desc',star.description));
 // What was recorded, in plain words. No star claims mastery: there is no independent check of understanding.
 if(star.tier==='explained'){info.append(E('p','atlas-tier','◉ AI가 내 설명과 연결한 개념'));if(star.quote)info.append(E('p','atlas-quote','“'+star.quote+'”'));info.append(E('p','atlas-hint','내 설명 중 이 문장을 AI 피드백이 이 개념과 연결했어요. 이해를 확인한 시험 결과는 아니에요.'))}
 else if(star.tier==='legacy')info.append(E('p','atlas-tier','◌ 이전 버전 피드백에서 언급된 개념'),E('p','atlas-hint','어느 문장 때문이었는지는 기록되지 않았어요.'));
 else if(star.tier==='reference')info.append(E('p','atlas-tier','경계 비교 활동에서 만난 개념'));
 else if(!star.topic&&star.name&&star.tier)info.append(E('p','atlas-tier','● 이 탐험에서 만난 개념'));
 if(!star.topic&&star.sameAsTopic)info.append(E('p','atlas-hint','탐험 주제와 이름이 같은 개념 별이에요. 큰 별은 탐험 전체, 이 별은 그 안의 개념이에요.'));
 if(!star.topic&&star.sameName>0)info.append(E('p','atlas-hint',`같은 이름의 별이 ${star.sameName}개 더 있어요. 탐험마다 뜻이 다를 수 있어 합치지 않고 따로 보여 줘요.`));
 if(star.lessonId&&typeof canWrite==='function'&&canWrite()){const stage=star.topic?null:star.tier==='explained'?4:3;
  const open=button('학습 기록 열기 ↗',()=>openRecord(star.lessonId,stage),'atlas-open');open.id='atlasOpenRecord';info.append(open)}
}
/* Rename (display only): saved as the record's `displayTitle` on an explicit save. The lesson title, the learner's question,
   the file name, the record id and Notion pages are untouched (Notion and Markdown keep the full lesson title). */
function renameForm(star){const l=data.lessons.find(x=>x.id===star.lessonId);if(!l)return;
 const row=document.querySelector('#atlasInfo .atlas-title-row');if(!row)return;
 const f=E('form','atlas-rename');f.noValidate=true;const lab=E('label','','별자리에 표시할 이름');lab.htmlFor='atlasRenameInput';
 const inp=E('input','');inp.id='atlasRenameInput';inp.maxLength=window.CuriCopy.SHORT_MAX;inp.value=window.CuriCopy.identity(l).short;inp.autocomplete='off';
 const err=E('p','atlas-rename-error','');err.id='atlasRenameError';err.hidden=true;inp.setAttribute('aria-describedby','atlasRenameError');
 const acts=E('div','atlas-rename-actions'),save=button('저장',()=>{},'atlas-rename-save');save.type='submit';
 acts.append(save,button('취소',()=>atlasSelect(atlasModel.nodes.find(n=>n.id===star.id)||star),'atlas-rename-cancel'));
 if(typeof l.displayTitle==='string')acts.append(button('원래 이름',()=>applyRename(l,null,star),'atlas-rename-reset'));
 for(const b of acts.querySelectorAll('button'))if(b!==save)b.type='button';
 f.append(lab,inp,err,acts);row.replaceWith(f);inp.focus();inp.select();
 f.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();atlasSelect(atlasModel.nodes.find(n=>n.id===star.id)||star);document.getElementById('atlasRename')?.focus()}});
 f.addEventListener('submit',e=>{e.preventDefault();const v=inp.value.replace(/\s+/g,' ').trim();
  if(!v){applyRename(l,null,star);return}
  const ok=window.CuriCopy.cleanManual(v);if(!ok){err.textContent=`${window.CuriCopy.SHORT_MAX}자 이내로 적어 주세요.`;err.hidden=false;inp.setAttribute('aria-invalid','true');inp.focus();return}
  applyRename(l,ok,star)})}
function applyRename(l,v,star){const before=l.displayTitle;if(v)l.displayTitle=v;else delete l.displayTitle;
 if(typeof persist==='function'&&persist()===false){if(before===undefined)delete l.displayTitle;else l.displayTitle=before;if(typeof toast==='function')toast('이 탭에서는 저장할 수 없어요.');return}
 drawAtlas(atlasLesson,atlasMode,{keep:star.lessonId});if(typeof graph==='function'&&typeof current==='function')graph(current());
 document.getElementById('atlasRename')?.focus()}
/** Leaves the atlas and shows that exploration where its record lives (the concept stage, or the learner's own explanation). */
function openRecord(lessonId,stage){const l=data.lessons.find(x=>x.id===lessonId);if(!l)return;closeAtlas();
 data.active=l.id;if(Number.isInteger(stage))l.stage=Math.min(stage,l.maxStage);persist();render();document.getElementById('main')?.scrollIntoView?.({block:'start'})}

/* ---------- full atlas ---------- */
let atlasModel=null;
const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function drawAtlas(l,mode,{keep=null}={}){
 const svg=document.getElementById('atlasSvg'),sky=svg.parentElement;
 // Lay out at the sky's own width (in 20px steps, so small resizes do not move stars): 1 logical unit = 1 CSS px.
 const width=Math.max(280,Math.floor((sky.clientWidth||960)/20)*20);
 // "한눈에 보기" (overview) is its own compact layout (not a shrunken picture): small uniform clusters, exploration names only.
 const detail=modelAtlas(l,mode,{width}),tall=detail.records.length>1&&detail.height>sky.clientHeight*1.15;if(!tall)atlasFit=false;
 const model=atlasFit?modelAtlas(l,mode,{width,overview:true}):detail;atlasModel=model;svg.replaceChildren();
 svg.setAttribute('viewBox',`0 0 ${model.width} ${model.height}`);
 const key=mode+'|'+model.records.map(r=>r.id+':'+r.lesson.concepts.length).join(',');
 svg.classList.toggle('no-anim',atlasSeen.has(key));atlasSeen.add(key);
 const jump=document.getElementById('atlasJump');
 if(!model.nodes.length){svg.style.height='';atlasSelect({empty:true,name:'아직 완성된 탐험이 없어요',description:'첫 탐험을 마치면 별이 생겨요.'});document.getElementById('atlasCount').textContent='';if(jump)jump.hidden=true;fitControl(false);return}
 // Scale: readable 1:1 by default (the sky scrolls); "한눈에 보기" fits everything and keeps only exploration names visible.
 svg.classList.toggle('overview',atlasFit);svg.style.width='100%';svg.style.height=Math.ceil(sky.clientWidth*model.height/model.width)+'px';sky.scrollTop=0;
 fitControl(tall);
 ambientStars(svg,model.width,model.height,Math.min(140,Math.round(model.width*model.height/9000)),44021);
 const defs=nsvg(svg,'defs'),filter=nsvg(defs,'filter',{id:'atlasGlow',x:'-200%',y:'-200%',width:'500%',height:'500%'});nsvg(filter,'feGaussianBlur',{stdDeviation:'4'});
 const byId=new Map(model.nodes.map((v,i)=>[v.id,{...v,order:i}])),groups=new Map(),compact=compactAtlas();
 const groupOf=id=>{if(!groups.has(id)){const g=nsvg(svg,'g',{class:'atlas-cluster','data-lesson':id});groups.set(id,{g,lines:nsvg(g,'g'),stars:nsvg(g,'g')})}return groups.get(id)};
 for(const c of model.clusters)groupOf(c.lessonId);
 const bkey=document.getElementById('atlasBoundaryKey');if(bkey)bkey.hidden=!model.edges.some(e=>e.kind==='boundary');
 const lkey=document.getElementById('atlasLegacyKey');if(lkey)lkey.hidden=!model.nodes.some(n=>n.tier==='legacy');
 for(const edge of model.edges){const a=byId.get(edge.from),b=byId.get(edge.to);if(!a||!b)continue;const parent=groupOf(a.lessonId).lines;
  if(edge.kind==='boundary'){drawBoundaryEdge(parent,edge,a,b);continue}
  const m=edge.kind==='membership';
  const el=nsvg(parent,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#ffffff','stroke-opacity':m?.14:.5,'stroke-width':m?.8:1.15,'stroke-linecap':'round',class:m?'atlas-membership':'atlas-link'});
  if(m){el.setAttribute('stroke-dasharray','2 6');el.setAttribute('aria-hidden','true')}
  else{el.setAttribute('pathLength','1');el.style.setProperty('--delay',`${Math.min(.9,.28+b.order%12*.04)}s`);el.setAttribute('role','button');el.setAttribute('tabindex','-1');el.setAttribute('aria-label',`${a.name} ↔ ${b.name}: ${edge.reason}`);
   el.addEventListener('click',()=>atlasSelect({topic:false,name:`${a.name} ↔ ${b.name}`,description:'기록된 연결: '+edge.reason,lessonId:a.lessonId,lessonTopic:mode==='all'?byId.get(`${a.lessonId}:topic`)?.name:null}));nsvg(el,'title',{},edge.reason)}}
 const labels=[],cellOf=new Map(model.clusters.map(c=>[c.lessonId,c.cell])),centerOf=new Map(model.clusters.map(c=>[c.lessonId,{x:c.cx,y:c.cy}]));
 model.nodes.forEach(node=>{const grp=groupOf(node.lessonId),k=grp.stars.childElementCount;
  const g=nsvg(grp.stars,'g',{class:'atlas-star'+(node.topic?' atlas-topic':''),role:'button','data-id':node.id,'aria-label':`${node.name}: ${node.topic?'탐험':'개념'}`});
  g.setAttribute('aria-description',node.topic?node.fullTitle:TIER_TEXT[node.tier]||'');
  g.style.setProperty('--delay',`${Math.min(.6,k*.05)}s`);
  nsvg(g,'circle',{cx:node.x,cy:node.y,r:node.topic?24:16,fill:'transparent',class:'hit'});starGlyph(g,node);
  const fs=model.overview?12.5:node.topic?16:(compact?14:13),txt=nsvg(g,'text',{x:node.x,y:node.y,'text-anchor':'middle',class:`atlas-node-label ${node.topic?'atlas-topic-label':''}`});txt.style.fontSize=fs+'px';
  const lines=node.topic?[node.short]:model.overview?[]:AL.wrapLabel(node.name,compact?9:10);lines.forEach((s,i)=>nsvg(txt,'tspan',{x:node.x,dy:i?Math.round(fs*1.15):0},s));
  labels.push({el:txt,node,r:node.topic?(model.overview?27:12):node.tier==='explained'||node.tier==='legacy'?8:5,cell:cellOf.get(node.lessonId),center:centerOf.get(node.lessonId)});
  nsvg(g,'title',{},node.topic?node.fullTitle:node.name);
  g.addEventListener('click',()=>{if(atlasFit){atlasFit=false;drawAtlas(atlasLesson,atlasMode);focusCluster(node.lessonId,true);const t=atlasModel.nodes.find(n=>n.id===node.id);if(t)atlasSelect(t);return}atlasSelect(node);focusCluster(node.lessonId,false)});
  g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();atlasSelect(node);focusCluster(node.lessonId,false)}else if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();stepStar(node,e.key)}})});
 placeLabels(labels,model.width,model.height);plateLabels(labels);
 const conceptCount=model.nodes.filter(n=>!n.topic).length,linkCount=model.edges.filter(e=>e.kind==='relation').length;
 document.getElementById('atlasCount').textContent=(mode==='all'?`탐험 ${model.records.length} · `:'')+`개념 ${conceptCount} · 연결 ${linkCount}`;
 if(jump){jump.hidden=mode!=='all'||model.records.length<2;const sel=jump.querySelector('select');sel.replaceChildren(...model.clusters.map(c=>{const o=E('option','',c.title);o.value=c.lessonId;o.title=c.fullTitle;return o}))}
 const start=(keep&&model.nodes.find(n=>n.topic&&n.lessonId===keep))||model.nodes.find(n=>n.topic&&n.latest)||model.nodes[0];atlasFocus=null;focusCluster(start.lessonId,false,true);atlasSelect(start);
}
/** A dark plate behind each visible label, inside the star's own group: links and membership lines of the cluster are drawn
    in the layer below, so they pass under the name instead of through it. Purely visual (aria-hidden); positions are
    unchanged. Labels hidden by CSS (overview) get none. */
function plateLabels(labels){const svg=labels[0]?.el.ownerSVGElement;
 // Soft edges, so a plate reads as a darker patch of sky rather than a new UI chip.
 if(svg&&!svg.querySelector('#atlasPlateSoft')){const NS='http://www.w3.org/2000/svg',defs=document.createElementNS(NS,'defs'),f=document.createElementNS(NS,'filter'),bl=document.createElementNS(NS,'feGaussianBlur');
  f.id='atlasPlateSoft';f.setAttribute('x','-20%');f.setAttribute('y','-40%');f.setAttribute('width','140%');f.setAttribute('height','180%');bl.setAttribute('stdDeviation','1.6');f.append(bl);defs.append(f);svg.prepend(defs)}
 for(const {el} of labels){if(!el.isConnected||getComputedStyle(el).display==='none'||!el.textContent.trim())continue;
 let b;try{b=el.getBBox()}catch{continue}if(!b.width||!b.height)continue;
 const r=document.createElementNS('http://www.w3.org/2000/svg','rect');
 for(const [k,v] of Object.entries({x:b.x-5,y:b.y-2,width:b.width+10,height:b.height+4,rx:5,class:'atlas-label-plate',filter:'url(#atlasPlateSoft)','aria-hidden':'true'}))r.setAttribute(k,String(+v===+v?Math.round(+v*10)/10:v));
 el.parentNode.insertBefore(r,el)}}
function fitControl(show){const b=document.getElementById('atlasFit');if(!b)return;b.hidden=!show;b.setAttribute('aria-pressed',String(atlasFit));b.textContent=atlasFit?'크게 보기':'한눈에 보기'}
/** Keyboard reach without hundreds of tab stops: every exploration star, plus the concept stars of the focused exploration. */
function focusCluster(lessonId,scroll=true,initial=false){atlasFocus=lessonId;const many=(atlasModel?.records.length||0)>1;
 document.querySelectorAll('#atlasSvg .atlas-cluster').forEach(g=>{const on=g.dataset.lesson===lessonId;g.classList.toggle('dim',many&&!on&&!initial);
  g.querySelectorAll('.atlas-star').forEach(s=>s.setAttribute('tabindex',on||s.classList.contains('atlas-topic')?'0':'-1'));g.querySelectorAll('.atlas-link').forEach(s=>s.setAttribute('tabindex',on?'0':'-1'))});
 const sel=document.querySelector('#atlasJump select');if(sel)sel.value=lessonId;
 if(!scroll)return;const c=atlasModel?.clusters.find(x=>x.lessonId===lessonId);const svg=document.getElementById('atlasSvg'),sky=svg?.parentElement;if(!c||!sky)return;
 if(atlasFit){atlasFit=false;drawAtlas(atlasLesson,atlasMode);focusCluster(lessonId,true);return}
 const k=svg.getBoundingClientRect().width/atlasModel.width;sky.scrollTo({top:Math.max(0,c.cell.y*k-12),behavior:reduced()?'auto':'smooth'})}
function focusStar(id){const g=document.querySelector(`#atlasSvg .atlas-star[data-id="${CSS.escape(id)}"]`);if(g){g.setAttribute('tabindex','0');g.focus({preventScroll:false})}}
/** Arrow keys move between the stars of one exploration (exploration star first). */
function stepStar(node,key){const list=atlasModel.nodes.filter(n=>n.lessonId===node.lessonId),i=list.findIndex(n=>n.id===node.id);
 const j=key==='Home'?0:key==='End'?list.length-1:(i+(key==='ArrowRight'||key==='ArrowDown'?1:-1)+list.length)%list.length;focusCluster(node.lessonId,false);focusStar(list[j].id);atlasSelect(list[j])}
function drawBoundaryEdge(parent,edge,a,b){
 const ev=edge.evidence,st=boundaryStroke(ev),g=nsvg(parent,'g',{class:'atlas-boundary',role:'button',tabindex:0,'aria-label':edge.reason});
 nsvg(g,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'transparent','stroke-width':16,'pointer-events':'stroke',class:'bnd-focus','stroke-linecap':'round'});
 if(st.glow)nsvg(g,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:st.color,'stroke-width':st.width*3,'stroke-opacity':.18,filter:'url(#atlasGlow)'});
 const line=nsvg(g,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:st.color,'stroke-width':st.width,'stroke-linecap':'round','stroke-opacity':.95});if(st.dash)line.setAttribute('stroke-dasharray',st.dash);
 // Draft packs may preview how an achievement would look, always labelled as a non-awarding preview.
 if(ev.preview){nsvg(g,'line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:'#ffffff','stroke-width':1.2,'stroke-dasharray':'4 5','stroke-opacity':.8});
  nsvg(g,'text',{x:(a.x+b.x)/2,y:(a.y+b.y)/2-9,'text-anchor':'middle',class:'atlas-node-label',style:'font-size:12px'},'미리보기 · 성취 아님')}
 nsvg(g,'title',{},edge.reason);
 const pick=()=>atlasSelect({boundary:true,topic:false,name:`${edge.names} 경계`,description:edge.reason.replace(/^.*? 경계: /,''),evidence:ev});
 g.addEventListener('click',pick);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick()}});
}
function openAtlas(l){
 if(!l?.lesson)return;atlasLesson=l;atlasMode='today';atlasFit=false;atlasPreviousFocus=document.activeElement;
 const overlay=document.getElementById('atlasOverlay');overlay.hidden=false;overlay.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
 drawAtlas(l,atlasMode);updateAtlasSwitch();document.getElementById('atlasClose').focus();
}
function closeAtlas(){const overlay=document.getElementById('atlasOverlay');overlay.hidden=true;overlay.setAttribute('aria-hidden','true');document.body.style.overflow='';if(atlasPreviousFocus?.isConnected)atlasPreviousFocus.focus()}
function updateAtlasSwitch(){document.querySelectorAll('[data-atlas-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.atlasMode===atlasMode)))}
function startAtlasUI(){
 document.getElementById('atlasClose').addEventListener('click',closeAtlas);
 document.getElementById('atlasOverlay').addEventListener('click',e=>{if(e.target.id==='atlasOverlay')closeAtlas()});
 document.addEventListener('keydown',e=>{const overlay=document.getElementById('atlasOverlay');if(overlay.hidden)return;if(e.key==='Escape'){e.preventDefault();closeAtlas()}if(e.key==='Tab'){const all=[...overlay.querySelectorAll('button,select,[role=button][tabindex="0"],[tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.disabled);if(!all.length)return;const first=all[0],last=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
 document.querySelectorAll('[data-atlas-mode]').forEach(b=>b.addEventListener('click',()=>{atlasMode=b.dataset.atlasMode;atlasFit=false;updateAtlasSwitch();drawAtlas(atlasLesson,atlasMode)}));
 document.getElementById('atlasFit')?.addEventListener('click',()=>{atlasFit=!atlasFit;const f=atlasFocus;drawAtlas(atlasLesson,atlasMode);if(f&&!atlasFit)focusCluster(f,true)});
 document.querySelector('#atlasJump select')?.addEventListener('change',e=>{const id=e.target.value;focusCluster(id,true);const t=atlasModel?.nodes.find(n=>n.topic&&n.lessonId===id);if(t)atlasSelect(t)});
 // The sky's scale follows its width: redraw (without replaying the reveal) when the window changes size.
 let rt=0;addEventListener('resize',()=>{if(document.getElementById('atlasOverlay').hidden)return;clearTimeout(rt);rt=setTimeout(()=>drawAtlas(atlasLesson,atlasMode),150)});
}
startAtlasUI();
