// Bold in the concept note's Markdown and Notion output must actually render as bold.  node --test tests/emphasis.test.js
// Real defect (Phase 2E-R, live Notion read-back): `**SQL 삽입(SQLi)**은` was stored with literal asterisks, while
// `**데이터베이스**는` became bold. Notion follows CommonMark's flanking rule: a closing ** right after punctuation
// and right before a letter (Korean particles included) does not close anything.
'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const C=require('../concept-note.js');
const fx=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',n),'utf8'));
const NOW=Date.parse('2026-11-23T18:00:00+09:00');

/** A strict model of how CommonMark reads one line of inline Markdown: backslash escapes, code spans and `*` runs
    (left/right-flanking, rule of 3, nearest opener). Returns the visible result, with <b>/<i>/<code> marking what
    became formatting and &lt; &gt; &amp; for literal characters; `stray` counts delimiter stars left as text. */
function cm(src){const P=/[\p{P}\p{S}]/u,W=/\s/u,tok=[];let i=0;
 const lit=c=>({t:c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')});
 while(i<src.length){const c=src[i];
  if(c==='\\'&&/[!-\/:-@\[-`{-~]/.test(src[i+1]||'')){tok.push(lit(src[i+1]));i+=2;continue}
  if(c==='`'){let n=0;while(src[i+n]==='`')n++;let j=i+n,end=-1;
   while((j=src.indexOf('`',j))>=0){let m=0;while(src[j+m]==='`')m++;if(m===n){end=j;break}j+=m}
   if(end>=0){let v=src.slice(i+n,end);if(/^ [\s\S]* $/.test(v)&&v.trim())v=v.slice(1,-1);tok.push({t:'<code>'+lit(v).t+'</code>'});i=end+n;continue}
   tok.push({t:'`'.repeat(n)});i+=n;continue}
  if(c==='*'){let n=0;while(src[i+n]==='*')n++;const b=i?src[i-1]:' ',a=src[i+n]??' ';
   tok.push({d:n,d0:n,open:!W.test(a)&&(!P.test(a)||W.test(b)||P.test(b)),close:!W.test(b)&&(!P.test(b)||W.test(a)||P.test(a))});i+=n;continue}
  tok.push(lit(c));i++}
 const stack=[];
 for(let k=0;k<tok.length;k++){const t=tok[k];if(!t.d)continue;
  while(t.close&&t.d){let s=stack.length-1;
   for(;s>=0;s--){const o=tok[stack[s]];if(o.d&&!((o.close||t.open)&&(o.d0+t.d0)%3===0&&(o.d0%3||t.d0%3)))break}
   if(s<0)break;const o=tok[stack[s]],use=o.d>=2&&t.d>=2?2:1,g=use===2?'b':'i';
   o.d-=use;t.d-=use;o.post=`<${g}>`+(o.post||'');t.pre=(t.pre||'')+`</${g}>`;stack.length=o.d?s+1:s}
  if(t.open&&t.d)stack.push(k)}
 let stray=0;const html=tok.map(t=>{if(!t.d0)return t.t;stray+=t.d;return (t.pre||'')+'*'.repeat(t.d)+(t.post||'')}).join('');
 return {html,stray}}
const view=md=>cm(md).html;

test('the CommonMark model agrees with the spec and with what live Notion did',()=>{
 // live Notion read-back (Phase 2E-R): these exact lines
 assert.equal(view('**SQL 삽입(SQLi)**은 외부'),'**SQL 삽입(SQLi)**은 외부');
 assert.equal(view('**데이터베이스**는 정'),'<b>데이터베이스</b>는 정');
 assert.equal(view('**책 제목을 하나의 값으로 전달해요.** 설명'),'<b>책 제목을 하나의 값으로 전달해요.</b> 설명');
 // CommonMark spec examples
 assert.equal(view('a**"foo"**'),'a**"foo"**');assert.equal(view('**foo**bar'),'<b>foo</b>bar');
 assert.equal(view('foo**bar**'),'foo<b>bar</b>');assert.equal(view('**foo "*bar*" foo**'),'<b>foo "<i>bar</i>" foo</b>');
 assert.equal(view('** foo**'),'** foo**');assert.equal(view('*(*foo*)*'),'<i>(<i>foo</i>)</i>');
 assert.equal(view('***foo***'),'<i><b>foo</b></i>');assert.equal(view('foo\\*bar\\*'),'foo*bar*');
 assert.equal(view('`**x**`'),'<code>**x**</code>');
});

/** One paragraph of note body → what the reader sees, in the Markdown download and in Notion's Markdown. */
const both=body=>{const b=C.parse(body),a=C.blocksMd(b),n=C.blocksMd(b,{notion:true});assert.equal(a,n,'paragraphs are the same in both');return a};

test('bold next to Korean particles, parentheses and punctuation renders as bold, with no visible markers',()=>{
 const cases=[
  ['**SQL 삽입(SQLi)**은 외부 입력이','<b>SQL 삽입(SQLi</b>)은 외부 입력이'],
  ['**데이터베이스(DB)**가 응답한다','<b>데이터베이스(DB</b>)가 응답한다'],
  ['**인증(Authentication)**을 거친다','<b>인증(Authentication</b>)을 거친다'],
  ['**중요 개념**은 이것','<b>중요 개념</b>은 이것'],
  ['**핵심 원리**를 이해한다','<b>핵심 원리</b>를 이해한다'],
  ['먼저 **정의**: 입력이 명령이 된다','먼저 <b>정의</b>: 입력이 명령이 된다'],
  ['이건 **끝.**','이건 <b>끝.</b>'],
  ['**왜?**라고 물었다','<b>왜</b>?라고 물었다'],
  ['**“따옴표”**는','<b>“따옴표</b>”는'],
  ['값은**(주의)**이에요','값은(<b>주의</b>)이에요'],
  ['**(주의) 입력값**은 그대로','<b>(주의) 입력값</b>은 그대로'],
  ['조건 **A(참)**과 **B(거짓)**를 비교','조건 <b>A(참</b>)과 <b>B(거짓</b>)를 비교'],
  ['**SQL 삽입(SQLi).**은','<b>SQL 삽입(SQLi)</b>.은'],
 ];
 for(const [src,want] of cases){const md=both(src),r=cm(md);
  assert.equal(r.html,want,src+'  →  '+md);assert.equal(r.stray,0,'no stray markers: '+md)}
});

test('literal asterisks, code spans, malformed and unmatched delimiters stay plain text',()=>{
 const cases=[
  ['2 * 3 * 4는 24','2 * 3 * 4는 24'],
  ['5 ** 2는 25','5 ** 2는 25'],
  ['**열림만 있는 문장','**열림만 있는 문장'],
  ['닫힘만 있는 문장**은','닫힘만 있는 문장**은'],
  ['****','****'],
  ['**a**b**','<b>a</b>b**'],
  ['**가****나**는','<b>가나</b>는'],                            // adjacent bold runs are merged, not a four-star run
  ['`**굵게**`는 코드','<code>**굵게**</code>는 코드'],
  ['*기울임*은','*기울임*은'],                                  // italic is not in the note grammar: kept as typed
  ['***강조***는','<b>강조</b>는'],                              // bold+italic: the bold is kept, no stray stars
  ['** 공백 **은',' <b>공백</b> 은'],                              // spaces move outside the markers
  ['**`SELECT *`**은','<b>`SELECT *</b>`은'],                    // code inside bold is not in the grammar: shown as typed
  ['**)**은',')은'],                                              // cannot be bold in CommonMark: plain, never stray stars
 ];
 for(const [src,want] of cases){const md=both(src),r=cm(md);assert.equal(r.html,want,src+'  →  '+md)}
});

test('untrusted text inside bold stays text: no HTML, links, math or script survive, and the bold still renders',()=>{
 for(const [src,want] of [
  ['**<script>alert(1)</script>**은','<b>&lt;script&gt;alert(1)&lt;/script</b>&gt;은'],
  ['**[링크](https://evil.example)**를','<b>[링크](https://evil.example</b>)를'],
  ['**$x$ 비용**은','<b>$x$ 비용</b>은'],
  ['**a\\**b','<b>a</b>\\b'],
 ]){const md=both(src);assert.equal(cm(md).html,want,src+'  →  '+md);
  assert.ok(!/<(?!\\)/.test(md.replace(/\\</g,'')),'no raw < in output: '+md);assert.ok(!/(?<!\\)\$/.test(md),'no unescaped $: '+md);
  assert.ok(!/(?<!\\)\[/.test(md),'no link syntax: '+md)}
 // tables, lists, notes and sub-headings use the same inline renderer
 const md=C.blocksMd(C.parse('### **방어(Defense)**는\n\n- **입력(Input)**은 값\n\n1. **명령(Command)**이 된다\n\n> **오해(Misread)**는 흔하다\n\n| **열(A)**은 | B |\n| --- | --- |\n| **행(1)**이 | 2 |'));
 for(const line of md.split('\n'))assert.equal(cm(line).stray,0,line);
 const seen=md.split('\n').map(x=>cm(x).html).join('\n');
 for(const w of ['<b>방어(Defense</b>)는','<b>입력(Input</b>)은','<b>명령(Command</b>)이','<b>오해(Misread</b>)는','<b>열(A</b>)은','<b>행(1</b>)이'])assert.ok(seen.includes(w),w);
});

test('the synthetic catalog note: every ** in the download and in the Notion page renders as bold (concept note and history)',()=>{
 const AI=fx('sqli_concept_note_ai.json'),l=fx('sqli_time_blind_record.json');
 const note=C.clean({...AI.raw,kind:'ai',generatedBy:{provider:'chatgpt',model:AI.model},at:NOW,basis:C.basisKey(l)},l);
 for(const [name,md] of [['download',C.toMarkdown(note,l,{now:NOW})],['notion',C.toNotion(note,l,{now:NOW})],
                         ['basic download',C.exportMarkdown(fx('sqli_time_blind_record.json'),{now:NOW})],['basic notion',C.exportNotion(fx('sqli_time_blind_record.json'),{now:NOW})]]){
  const prose=md.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm,'').replace(/^\$\$\n[\s\S]*?\n\$\$$/gm,'');
  const bad=prose.split('\n').filter(x=>cm(x).stray);assert.deepEqual(bad,[],name+': lines whose ** would show as text');
  if(name==='download'||name==='notion')assert.ok(prose.split('\n').some(x=>cm(x).html.includes('<b>SQL 삽입(SQLi</b>)은 외부 입력이')),name)}
});
