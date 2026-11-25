/* CURIVEN constellation layout — pure and deterministic (browser + Node tests). No randomness, no physics, no library.

   Each exploration is a cluster: its exploration star in the centre and its concept stars on one ring (two rings when
   there are many), spaced so neighbouring stars keep at least CONCEPT_GAP between them. Clusters are packed left→right,
   top→bottom in record order inside a fixed logical width (one width per breakpoint), each in its own cell with room
   for labels, so clusters never overlap and adding an exploration never moves the ones before it.
   Positions depend only on (record order, concept count per record, breakpoint): ordinary re-renders give identical
   coordinates. Label text is display-only (shortLabel); records are never changed. */
'use strict';
(function(root){
 const CONCEPT_GAP=92;           // minimum distance between neighbouring concept stars on a ring (logical px)
 const LABEL_ROOM={wide:66,compact:62}; // space around a ring for concept labels
 const TITLE_ROOM=46;           // space below a cluster for nothing (exploration label sits under the centre star)
 const WIDTH={wide:960,compact:380};

 /** Visible label for a long title or name: whole words up to `max` characters, then "…". The full text stays elsewhere. */
 function shortLabel(text,max=18){const s=String(text||'').replace(/\s+/g,' ').trim();if(s.length<=max)return s;
  const cut=s.slice(0,max+1),sp=Math.max(cut.lastIndexOf(' '),cut.lastIndexOf(':'),cut.lastIndexOf('·'));
  return (sp>=Math.floor(max*.55)?s.slice(0,sp):s.slice(0,max)).replace(/[\s:·,—-]+$/,'')+'…'}
 /** Up to two lines of at most `per` characters each, breaking at a space when possible; "…" when longer. */
 function wrapLabel(text,per=10){const s=String(text||'').replace(/\s+/g,' ').trim();if(s.length<=per)return [s];
  // Break at a space, or just after "·", "/", "-" (names such as HTML·CSS·JavaScript have no spaces); else at `per`.
  let cut=-1;for(let i=Math.min(per,s.length-1);i>=3;i--){if(s[i]===' '){cut=i;break}if('·/-'.includes(s[i-1])){cut=i;break}}
  if(cut<0)cut=per;const a=s.slice(0,cut).trim(),rest=s.slice(cut).trim();
  return [a,rest.length>per?rest.slice(0,per-1).trim()+'…':rest]}

 /** Ring radius for n concept stars: neighbours at least CONCEPT_GAP apart, never smaller than `min`. */
 const ringRadius=(n,min)=>Math.max(min,Math.ceil(n*CONCEPT_GAP/(2*Math.PI)));
 /** Concept positions around (cx,cy): one ring up to 10 stars, then two rings (inner/outer alternate). */
 function ring(n,cx,cy,r){const pts=[];if(!n)return pts;
  if(n<=10){for(let i=0;i<n;i++){const a=-Math.PI/2+2*Math.PI*i/n;pts.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r*.92})}return pts}
  const inner=Math.ceil(n/2),outer=n-inner,ri=r*.62;
  for(let i=0;i<n;i++){const onIn=i%2===0,k=Math.floor(i/2),m=onIn?inner:outer,rr=onIn?ri:r,off=onIn?0:Math.PI/m;
   const a=-Math.PI/2+off+2*Math.PI*k/m;pts.push({x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr*.92})}
  return pts}

 /** clusters: [{id, count}] in display order; options {compact, single, width}. → {width, height, clusters:[{id,cx,cy,r,cell:{x,y,w,h},points:[{x,y}]}]}.
     `single` (one exploration on its own) uses a roomier ring. */
 function layout(clusters,{compact=false,single=false,width=null,overview=false}={}){
  // `width`: the real drawing width in CSS px (rounded by the caller), so text is drawn at its true size; else a default per breakpoint.
  const W=Number.isFinite(width)&&width>=280?Math.round(width):WIDTH[compact?'compact':'wide'],room=LABEL_ROOM[compact?'compact':'wide'];
  if(single&&clusters.length===1){const c=clusters[0],r=ringRadius(c.count,compact?118:190),h=Math.round(2*r*.92+2*room+TITLE_ROOM);
   const cx=W/2,cy=Math.round(h/2);return {width:W,height:Math.max(h,compact?360:500),clusters:[{id:c.id,cx,cy:Math.max(cy,compact?180:250),r,cell:{x:0,y:0,w:W,h:Math.max(h,compact?360:500)},points:ring(c.count,cx,Math.max(cy,compact?180:250),r)}]}}
  // Overview ("한눈에 보기"): every exploration as a small, uniform cell — the exploration name stays readable, concept names hide.
  if(overview){const cw=compact?120:150,ch=compact?118:126,cols=Math.max(1,Math.floor(W/cw)),gx=Math.floor((W-cols*cw)/2),out=[];
   clusters.forEach((c,i)=>{const col=i%cols,row=Math.floor(i/cols),cell={x:gx+col*cw,y:12+row*ch,w:cw,h:ch},cx=cell.x+cw/2,cy=cell.y+44,r=26;
    out.push({id:c.id,r,cell,cx,cy,points:ring(c.count,cx,cy,r)})});
   return {width:W,height:Math.max(compact?300:420,12+Math.ceil(clusters.length/cols)*ch+12),clusters:out,overview:true}}
  const out=[];let x=0,y=0,rowH=0;
  for(const c of clusters){const r=ringRadius(c.count,compact?92:84),w=Math.min(W,Math.round(2*r+2*room)),h=Math.round(2*r*.92+2*room+TITLE_ROOM*.5);
   if(x>0&&x+w>W){x=0;y+=rowH;rowH=0}
   out.push({id:c.id,r,cell:{x,y,w,h}});x+=w;rowH=Math.max(rowH,h)}
  // Centre each row's clusters horizontally (still deterministic), then place the stars.
  const rows=new Map();for(const c of out){const k=c.cell.y;if(!rows.has(k))rows.set(k,[]);rows.get(k).push(c)}
  for(const row of rows.values()){const used=row.reduce((s,c)=>s+c.cell.w,0),shift=Math.floor((W-used)/2),gap=row.length>1?Math.floor((W-used)/(row.length+1)):0;
   let xx=row.length>1?gap:shift;for(const c of row){c.cell.x=xx;xx+=c.cell.w+gap;c.cx=c.cell.x+c.cell.w/2;c.cy=c.cell.y+room+c.r*.92;c.points=ring(clusters.find(k=>k.id===c.id).count,c.cx,c.cy,c.r)}}
  const height=Math.max(compact?360:500,Math.ceil(y+rowH+16));
  return {width:W,height,clusters:out};
 }
 const api={CONCEPT_GAP,WIDTH,shortLabel,wrapLabel,ringRadius,ring,layout};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriAtlasLayout=api;
})(typeof window!=='undefined'?window:globalThis);
