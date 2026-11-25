// Phase 2C — deterministic constellation layout (pure). node --test tests/atlas_layout.test.js
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const AL=require('../atlas-layout.js');
const set=n=>Array.from({length:n},(_,i)=>({id:'l'+i,count:3+(i*7)%6}));
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;

test('same input → identical coordinates (no randomness)',()=>{
 for(const opts of [{},{compact:true},{width:800},{width:800,overview:true},{single:true}])assert.deepEqual(AL.layout(set(12),opts),AL.layout(set(12),opts),JSON.stringify(opts));
});
test('clusters never overlap and stay inside the drawing width, at every size tested',()=>{
 for(const width of [320,390,640,800,960,1180])for(const n of [1,3,10,30,120])for(const overview of [false,true]){
  const L=AL.layout(set(n),{width,compact:width<560,overview});
  for(const c of L.clusters){assert.ok(c.cell.x>=0&&c.cell.x+c.cell.w<=L.width+.5,`${width}/${n}: cell inside width`);for(const p of c.points)assert.ok(p.x>0&&p.x<L.width&&p.y>0&&p.y<L.height,`${width}/${n}: star inside the map`)}
  for(let i=0;i<L.clusters.length;i++)for(let j=i+1;j<L.clusters.length;j++)assert.ok(!overlap(L.clusters[i].cell,L.clusters[j].cell),`${width}/${n}/${overview}: cells ${i},${j} overlap`)}
});
test('concept stars keep a minimum distance on their ring',()=>{
 for(const n of [2,3,6,10,14]){const c=AL.layout([{id:'a',count:n}],{width:960}).clusters[0];let min=Infinity;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)min=Math.min(min,Math.hypot(c.points[i].x-c.points[j].x,c.points[i].y-c.points[j].y));
  assert.ok(min>=40,`${n} concepts: nearest stars ${min.toFixed(1)}px apart`)}
});
test('adding an exploration never moves the rows already laid out before it',()=>{
 const a=AL.layout(set(9),{width:960}),b=AL.layout(set(10),{width:960});
 const lastRowY=Math.max(...a.clusters.map(c=>c.cell.y));
 for(const c of a.clusters.filter(c=>c.cell.y<lastRowY)){const d=b.clusters.find(x=>x.id===c.id);assert.equal(d.cx,c.cx);assert.equal(d.cy,c.cy)}
});
test('labels: long titles get a short visible label; the full text is never altered',()=>{
 const t='웹 입문: 서버가 보내고 브라우저가 보여 주는 과정과 HTML·CSS·JavaScript';
 const s=AL.shortLabel(t,18);assert.ok(s.length<=19&&s.endsWith('…'));assert.ok(t.startsWith(s.slice(0,-1)),'a prefix of the real title');assert.equal(AL.shortLabel('삼각함수',18),'삼각함수');
 assert.deepEqual(AL.wrapLabel('확신과 정확성의 구별',10),['확신과 정확성의','구별']);assert.equal(AL.wrapLabel('재구성적 기억 개념의 긴 이름 예시',10).length,2);
 assert.ok(AL.wrapLabel('가'.repeat(40),10)[1].endsWith('…'));
});
