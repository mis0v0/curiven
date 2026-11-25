/* CURIVEN → personal Notion (settings tab + save on the completion screen). Server side: notion_link.py.
   The browser never sees or stores the Notion token after the one connect request; saving never changes the
   learning record, and "saved" is shown only after the server reports Notion's confirmation. */
'use strict';
let notionState={loaded:false,available:false,connected:false,page:null,autoSave:false};
const notionSaves=new Map(); // explorationId -> {state:'saving'|'saved'|'error', url, savedAt, error}
async function notionRefresh(){try{const r=await fetch('/api/notion/status');const j=await r.json();if(j.ok)notionState={loaded:true,...j}}catch{notionState={...notionState,loaded:false}}
 if(settingsIsOpen()&&settingsTab==='notion')renderSettings();refreshNotionBlock()}
/** The page: the concept note first (the learner's AI note, or the basic note), the learning history in a toggle. */
function notionMarkdown(l){return {explorationId:l.id,title:window.CuriConcept.noteFor(l).title||l.lesson?.title||l.topic,markdown:window.CuriConcept.exportNotion(l)}}
function notionTime(iso){const d=new Date(iso);return Number.isFinite(d.getTime())?`${d.toLocaleDateString('ko-KR')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`:''}

/* ---------- settings tab ---------- */
function notionTab(c){c.id='notionSettings';const s=notionState;
 c.append(E('h3','','Notion'));if(!s.connected)c.append(E('p','hint','탐험을 마치면 학습 노트를 내 Notion 페이지 아래에 저장할 수 있어요. 연결하고 저장하기 전에는 아무것도 보내지 않아요.'));
 const st=E('div','');st.id='notionStatus';st.setAttribute('aria-live','polite');
 const say=(t,ok)=>{st.className=ok?'saved':'msg';st.textContent=t};
 const call=async(path,body,okText)=>{try{const j=await post('/api/notion/'+path,body||{});notionState={loaded:true,...notionState,...j};renderSettings();if(okText){const n=document.getElementById('notionStatus');if(n){n.className='saved';n.textContent=okText}}refreshNotionBlock();return j}catch(e){say(e.message,false);return null}};
 if(!s.loaded){c.append(E('p','info','Notion 연결 상태를 확인하고 있어요…'));return}
 if(!s.available){c.append(E('div','msg','이 컴퓨터에서는 키체인을 쓸 수 없어 Notion 연결 정보를 안전하게 보관할 수 없어요.'));return}
 if(s.connected){
  const info=E('div','info');info.id='notionState';info.append(E('span','','연결됨 · 저장할 페이지: '));
  if(s.page?.url){const a=E('a','',(s.page.title||'(제목 없음)')+' ↗');a.href=s.page.url;a.target='_blank';a.rel='noopener noreferrer';info.append(a)}else info.append(E('strong','',s.page?.title||''));c.append(info);
  const auto=E('label','notion-auto');const cb=E('input');cb.type='checkbox';cb.id='notionAuto';cb.checked=!!s.autoSave;auto.append(cb,E('span','',' 탐험을 마치면 자동으로 저장하기'));
  cb.onchange=()=>call('auto',{autoSave:cb.checked},cb.checked?'탐험을 마치면 자동으로 저장해요.':'자동 저장을 껐어요. 마무리 화면에서 직접 저장할 수 있어요.');c.append(auto);
  const row=E('div','actions');row.append(button('연결 확인',()=>call('test',{},'Notion 페이지에 접근할 수 있어요.'),'btn secondary'),
   button('페이지 바꾸기',()=>{if(document.getElementById('notionNewPage'))return;const f=E('div','field');const i=E('input','input');i.id='notionNewPage';i.placeholder='https://www.notion.so/...';i.autocomplete='off';
    f.append(E('label','','새로 저장할 페이지 링크'),i);const r2=E('div','actions');r2.append(button('이 페이지로 바꾸기',()=>call('page',{page:i.value},'저장할 페이지를 바꿨어요. 이미 저장한 노트는 원래 자리에 남아요.')));f.append(r2);row.after(f);i.focus()},'btn secondary'),
   button('연결 해제',()=>{if(confirm('이 컴퓨터에서 Notion 연결을 해제할까요? 키체인의 연결 정보가 지워져요. 이미 저장한 Notion 페이지는 그대로 남고, Notion의 통합 자체는 Notion에서 따로 삭제할 수 있어요.'))call('disconnect',{},'연결을 해제했어요.')},'btn secondary'));
  c.append(row,st);return}
 const how=E('details','note notion-how');how.open=true;how.append(E('summary','','연결하는 방법 (한 번만)'));const ol=E('ol','notion-steps');
 const link=E('a','','Notion 개발자 포털 ↗');link.href='https://app.notion.com/developers/connections';link.target='_blank';link.rel='noopener noreferrer';
 const li1=E('li','');li1.append(link,document.createTextNode('에서 ‘내부(Internal)’ 통합을 새로 만들어요. 작업 공간 소유자만 만들 수 있어요.'));
 ol.append(li1,E('li','','기능은 ‘콘텐츠 읽기·업데이트·삽입’만 켜요. 사용자 정보 권한은 필요 없어요.'),E('li','','‘구성(Configuration)’ 탭의 내부 통합 시크릿을 복사해요.'),
  E('li','','노트를 모을 Notion 페이지를 열고 오른쪽 위 ••• → ‘연결 추가’에서 방금 만든 통합을 추가해요. 통합은 이 페이지와 그 아래 페이지에만 접근할 수 있어요.'),E('li','','그 페이지의 링크(공유 → 링크 복사)와 시크릿을 붙여 넣어요.'));
 how.append(ol);c.append(how);
 const tok=E('input','input');tok.id='notionToken';tok.type='password';tok.autocomplete='off';tok.spellcheck=false;tok.placeholder='ntn_…';inputField(c,'내부 통합 시크릿',tok,'이 Mac의 키체인에만 저장돼요. 브라우저, 학습 기록, 백업, 학습 노트에는 들어가지 않아요.');
 const pg=E('input','input');pg.id='notionPage';pg.autocomplete='off';pg.placeholder='https://www.notion.so/...';inputField(c,'저장할 페이지 링크',pg);
 const row=E('div','actions');const go=button('연결 확인하고 저장',async()=>{go.disabled=true;say('Notion에 연결을 확인하고 있어요…',true);const j=await call('connect',{token:tok.value,page:pg.value},'연결했어요. 탐험을 마치면 이 페이지 아래에 노트를 저장할 수 있어요.');if(!j){go.disabled=false}tok.value=''});
 row.append(go);c.append(row,st)}

/* ---------- completion screen: one group of note actions (at most three) ----------
   CURIVEN publishes; it does not sync (2026-11-24 reviews). A page that exists is never written to: the server refuses an
   update before any request (Notion's API has no conditional write, so replacing a page could destroy edits made in
   Notion). A later version is a NEW page, made only after the learner confirms it.
   State model (per exploration, never stored in the learning record):
     no Notion page yet (connected or not) → "Notion에 개념 노트 저장" + "학습 과정 기록 다운로드"
     saving                                → status line + "학습 과정 기록 다운로드"
     saved                                 → "Notion에서 보기 ↗" + "새 페이지로 저장" (the dialog) + "학습 과정 기록 다운로드";
                                             the line says when CURIVEN's note is unchanged since that save (local key only)
     unconfirmed                           → a create may have happened: nothing is retried or guessed; "저장 위치 열기 ↗",
                                             "새 페이지로 저장" (confirm, warns about a possible duplicate)
     archived                              → the page is in Notion's trash: "새 페이지로 저장" (confirm), "다시 연결"
     unavailable                           → the page can't be opened (deleted or no access): "다시 연결" (reads only),
                                             "새 페이지로 저장" (confirm)
     failed                                → the reason + "다시 시도" (same kind of save; a new page asks again)
   The archive download (journey.js) is in every state. "Saved" comes only from the server's mapping or a confirmed save;
   a failure never shows a link. */
const entryAsked=new Set();
const UNCONFIRMED_TEXT='Notion에 페이지가 만들어졌는지 확인하지 못했어요. 만들어졌을 수 있어서 다시 만들지 않았어요. 저장 위치를 Notion에서 확인한 뒤, 필요하면 ‘새 페이지로 저장’을 고를 수 있어요.';
function notionBlock(c,l){const box=E('div','note-actions');box.id='notionSave';box.dataset.lesson=l.id;box.setAttribute('role','group');box.setAttribute('aria-label','학습 노트');c.append(box);refreshNotionBlock()}
/** The saved state is looked up once Notion's status is known (it loads after the first render). */
function ensureEntry(l){if(!notionState.connected||notionSaves.has(l.id)||entryAsked.has(l.id))return;entryAsked.add(l.id);
 post('/api/notion/entry',{explorationId:l.id}).then(j=>{if(j.saved&&!notionSaves.has(l.id)){notionSaves.set(l.id,j.saved.unconfirmed?{state:'unconfirmed',error:UNCONFIRMED_TEXT}:{...j.saved,state:j.saved.archived?'archived':'saved'});refreshNotionBlock()}}).catch(()=>{entryAsked.delete(l.id)})}
function refreshNotionBlock(){const box=document.getElementById('notionSave');if(box){const l=data.lessons.find(x=>x.id===box.dataset.lesson);if(l){ensureEntry(l);drawNotionBlock(box,l)}}
 const d=document.getElementById('noteDialog');if(d?.open){const l=data.lessons.find(x=>x.id===d.dataset.lesson);if(l)drawNoteDialog(d,l)}}
/** A stable key of the note's content (the save time line excluded), to tell whether the note changed since a save. */
async function noteKey(l){try{const md=window.CuriConcept.exportNotion(l,{now:0}),h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(md));return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')}catch{return null}}
/** true: the note is the same as at the last save; false: it changed (or the page predates content keys); null: unknown. */
async function noteUnchanged(l,sv){if(!sv?.contentKey)return false;const k=await noteKey(l);return k?k===sv.contentKey:null}
function linkButton(text,url,id){const a=E('a','btn',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';if(id)a.id=id;return a}
const NEW_PAGE_CONFIRM='Notion에 새 페이지를 만들까요? 원래 페이지는 그대로 둬요.';
function drawNotionBlock(box,l){box.replaceChildren();const s=notionState,sv=notionSaves.get(l.id),writable=canWrite();
 const jb=button('학습 과정 기록 다운로드',()=>openJourney(l),'btn secondary');jb.id='journeyDownload';
 const line=E('p','notion-line');line.id='notionLine';line.setAttribute('role','status');const row=E('div','actions');
 const openSave=(label,cls)=>{const b=button(label,()=>openNoteDialog(l),cls);b.id='notionSaveBtn';b.disabled=!writable||!s.loaded;return b};
 const saveNew=(text=NEW_PAGE_CONFIRM)=>{const b=button('새 페이지로 저장',()=>{if(confirm(text))saveToNotion(l,'new')},'btn minor');b.id='notionSaveNew';b.disabled=!writable;return b};
 const reconnect=()=>{const r=button('다시 연결',()=>reconnectNotion(l),'btn secondary');r.id='notionReconnect';r.title='Notion에서 페이지를 복원했거나 권한을 다시 줬다면 연결해요(읽기만 해요).';return r};
 const st=s.connected?sv?.state:null;
 if(conceptState.get(l.id)?.state==='working')line.textContent='개념 노트를 만들고 있어요. 대화가 길면 1~3분 걸릴 수 있어요.';
 if(st==='saving'){line.textContent='Notion에 저장하는 중…';row.append(jb)}
 else if(st==='saved'){line.textContent=`Notion에 저장됨 · ${notionTime(sv.savedAt)}`;if(sv.url)row.append(linkButton('Notion에서 보기 ↗',sv.url,'notionOpen'));row.append(openSave('새 페이지로 저장','btn secondary'),jb);
  noteUnchanged(l,sv).then(u=>{if(u&&notionSaves.get(l.id)===sv&&box.isConnected&&line.isConnected)line.textContent+=' · 저장한 뒤 CURIVEN에서 바뀐 내용 없음'})}
 else if(st==='archived'){line.className='notion-line msg';line.textContent=sv.error||'Notion 휴지통에 있는 노트예요.';if(writable)row.append(saveNew(),reconnect());row.append(jb)}
 else if(st==='unavailable'){line.className='notion-line msg';line.textContent=sv.error;if(writable)row.append(reconnect(),saveNew());row.append(jb)}
 else if(st==='unconfirmed'){line.className='notion-line msg';line.textContent=sv.error||UNCONFIRMED_TEXT;if(s.page?.url)row.append(linkButton('저장 위치 열기 ↗',s.page.url,'notionDest'));
  if(writable)row.append(saveNew('지난번 저장이 Notion에 이미 만들어졌을 수 있어요. 새 페이지를 만들면 같은 노트가 두 개가 될 수 있어요. 저장 위치를 확인했나요? 새 페이지를 만들까요?'));row.append(jb)}
 else if(st==='error'){line.className='notion-line msg';line.textContent='Notion에 저장하지 못했어요: '+sv.error+' 학습 기록은 그대로예요.';
  if(sv.mode==='new'){if(writable)row.append(saveNew())}else{const r=button('다시 시도',()=>saveToNotion(l,'update'),'btn secondary');r.id='notionRetry';r.disabled=!writable;row.append(r)}row.append(jb)}
 else row.append(openSave('Notion에 개념 노트 저장','btn'),jb);
 if(line.textContent)box.append(line);box.append(row)}

/* ---------- the save dialog (first page, or a new page next to a saved one) ---------- */
function openNoteDialog(l){document.getElementById('noteDialog')?.remove();noteChecks.delete(l.id);
 const d=E('dialog','settings note-dialog');d.id='noteDialog';d.dataset.lesson=l.id;d.setAttribute('aria-labelledby','noteDialogTitle');
 d.addEventListener('close',()=>{noteChecks.delete(l.id);d.remove();document.getElementById('notionSaveBtn')?.focus()});document.body.append(d);drawNoteDialog(d,l);
 if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')}
function drawNoteDialog(d,l){const s=notionState,sv=notionSaves.get(l.id),writable=canWrite(),again=s.connected&&sv?.state==='saved';
 const keep=d.querySelector('.settings-body')?.scrollTop||0;d.replaceChildren();
 const head=E('div','settings-head'),h=E('h2','',again?'새 Notion 페이지로 저장':'Notion에 개념 노트 저장');h.id='noteDialogTitle';
 const x=button('×',()=>d.close(),'settings-close');x.setAttribute('aria-label','닫기');head.append(h,x);
 const body=E('div','settings-body'),intro=E('p','note-intro');intro.id='noteDialogIntro';
 intro.textContent=!s.connected?(s.available?'Notion에 저장하려면 먼저 Notion을 연결해야 해요. 개념 노트는 지금 만들고 미리 볼 수 있어요.':'이 컴퓨터에서는 Notion에 연결할 수 없어요. 개념 노트는 파일로 받을 수 있어요.')
  :again?'이미 저장한 Notion 페이지는 CURIVEN이 바꾸지 않아요. Notion에서 고친 내용을 지킬 안전한 방법이 아직 없어서 업데이트는 꺼 두었어요. 저장하면 같은 위치에 새 페이지가 하나 더 생기고, 원래 페이지는 그대로 남아요.'
  :'연결한 Notion 페이지 아래에 이 개념 노트가 새 페이지로 저장돼요. 노트 끝에는 접힌 ‘학습 기록’이 함께 들어가요.';
 body.append(intro);conceptArea(body,l);
 if(!l.conceptNote){const p=E('details','cn-preview');p.append(E('summary','','저장될 기본 노트 미리보기 (AI 종합 없이 정리)'),noteDom(window.CuriConcept.noteFor(l),l));body.append(p)}
 const same=E('p','note-same');same.id='noteUnchanged';same.hidden=true;body.append(same);
 if(again){const rc=E('div','note-remote');body.append(rc);drawRemoteCheck(rc,l,writable)}
 const file=button('Notion 없이 이 노트를 파일로 받기 (.md)',()=>{flushDraft();exportNote(l)},'linkish');file.id='noteFileDownload';const fp=E('p','note-file');fp.append(file);body.append(fp);
 const foot=E('div','settings-foot'),busy=conceptState.get(l.id)?.state==='working'||conceptEditing.has(l.id);
 const go=!s.connected?button('Notion 연결하기',()=>{d.close();openSettings('notion')},'btn'):button(again?'새 페이지로 저장':'Notion에 저장',()=>{d.close();saveToNotion(l,again?'new':'update')},'btn');
 go.id='noteConfirm';go.disabled=!writable||busy||(!s.connected&&!s.available);foot.append(go,button('취소',()=>d.close(),'btn secondary'));
 d.append(head,body,foot);body.scrollTop=keep;
 if(again&&!busy)noteUnchanged(l,sv).then(u=>{if(!u||!d.isConnected||!same.isConnected)return;same.hidden=false;same.textContent='마지막으로 저장한 뒤 CURIVEN의 노트는 바뀌지 않았어요. 새 페이지로 저장하면 같은 내용의 페이지가 하나 더 생겨요.'})}
/* A read-only look at the saved page, asked for explicitly (opening the dialog requests nothing). Informational only:
   nothing is offered that writes to that page. An answer that arrives after the dialog, the check or the saved state
   changed is dropped. Archived / unavailable answers move to the completion screen's states. */
const noteChecks=new Map(); // explorationId -> {state:'checking'|'done'|'error', remote, error} for the open dialog only
function drawRemoteCheck(rc,l,writable){const c=noteChecks.get(l.id);
 const btn=button(c?.state==='checking'?'Notion 페이지 확인하는 중…':c?'Notion 페이지 다시 확인':'저장한 Notion 페이지가 바뀌었는지 확인',()=>checkRemote(l),'btn secondary');btn.id='noteCheckRemote';btn.disabled=!writable||c?.state==='checking';
 const out=E('div','note-remote-result');out.id='noteRemote';out.setAttribute('role','status');out.hidden=!c||c.state==='checking';
 if(c?.state==='error'){out.className='note-remote-result msg';out.textContent=c.error}
 else if(c?.state==='done'){const r=c.remote,when=notionTime(r.checkedAt);
  if(r.state==='same')out.textContent=`Notion 페이지가 CURIVEN이 저장할 때 확인한 내용과 같아요. (${when} 확인)`;
  else if(r.state==='unreadable'){out.className='note-remote-result msg';out.textContent='Notion 페이지 내용을 모두 읽을 수 없어서 비교하지 못했어요. Notion에서 직접 확인해 주세요.'}
  else{out.append(E('p','msg',(r.state==='changed'?'CURIVEN이 저장한 뒤 Notion에서 이 페이지가 바뀌었어요.':'저장할 때 Notion이 돌려준 내용을 확인하지 못해서 비교할 기준이 없어요.')+` (${when} 확인) Notion의 내용은 CURIVEN이 바꾸지 않아요.`));
   const det=E('details','note-remote-now');det.open=true;det.append(E('summary','','지금 Notion 페이지 내용'));const pre=E('pre','');pre.id='noteRemoteText';pre.textContent=r.markdown+(r.clipped?'\n…(앞부분만 보여 줘요)':'');det.append(pre);out.append(det)}}
 rc.replaceChildren(btn,out)}
async function checkRemote(l){const t={state:'checking'},sv=notionSaves.get(l.id);noteChecks.set(l.id,t);refreshNotionBlock();
 const stale=()=>noteChecks.get(l.id)!==t||notionSaves.get(l.id)!==sv;   // another dialog, check or save since: drop the answer
 try{const j=await post('/api/notion/check',{explorationId:l.id});if(stale())return;noteChecks.set(l.id,{state:'done',remote:j.remote})}
 catch(e){if(stale())return;const prev=notionSaves.get(l.id);
  if(e.code==='archived'||e.code==='unavailable'){noteChecks.delete(l.id);notionSaves.set(l.id,e.code==='archived'?{state:'archived',url:prev?.url,savedAt:prev?.savedAt,contentKey:prev?.contentKey}:{state:'unavailable',error:e.message,url:prev?.url});document.getElementById('noteDialog')?.close()}
  else noteChecks.set(l.id,{state:'error',error:e instanceof TypeError&&!e.status?'CURIVEN 서버와 연결이 끊겼어요.':e.message})}
 refreshNotionBlock()}
async function saveToNotion(l,mode='update'){if(notionSaves.get(l.id)?.state==='saving')return;flushDraft();const prev=notionSaves.get(l.id);
 const body={...notionMarkdown(l),mode,contentKey:await noteKey(l),...(mode==='new'?{confirm:true}:{})};
 notionSaves.set(l.id,{...prev,state:'saving'});refreshNotionBlock();
 try{const j=await post('/api/notion/save',body);notionSaves.set(l.id,{state:'saved',url:j.url,savedAt:j.savedAt,contentKey:j.contentKey})}
 catch(e){const net=e instanceof TypeError&&!e.status;
  if(e.code==='update_disabled'){notionSaves.delete(l.id);entryAsked.delete(l.id)}   // a page exists (e.g. auto-save, an old tab): show its real state
  else if(e.code==='archived')notionSaves.set(l.id,{state:'archived',url:prev?.url,savedAt:prev?.savedAt,contentKey:prev?.contentKey});
  else if(e.code==='unavailable')notionSaves.set(l.id,{state:'unavailable',error:e.message,url:prev?.url});
  else if(e.code==='unconfirmed')notionSaves.set(l.id,{state:'unconfirmed',error:e.message});
  else notionSaves.set(l.id,{state:'error',mode,error:net?'CURIVEN 서버와 연결이 끊겼어요.':e.message,url:prev?.url})}
 refreshNotionBlock()}
/** After the learner restored the page (or its access) in Notion: link it again (the server only reads Notion here). */
async function reconnectNotion(l){const prev=notionSaves.get(l.id);notionSaves.set(l.id,{...prev,state:'saving'});refreshNotionBlock();
 try{const j=await post('/api/notion/reconnect',{explorationId:l.id});notionSaves.set(l.id,{...j.saved,state:'saved'})}
 catch(e){notionSaves.set(l.id,{...prev,state:e.code==='unavailable'?'unavailable':prev?.state==='archived'||e.code==='archived'?'archived':'error',error:e.message})}
 refreshNotionBlock()}
/** Called once when an exploration is completed: auto-save only if the learner turned it on. It sends the default mode,
    which the server turns into the FIRST page only — never a write into a saved page, never a guess after a failure. */
function notionAfterComplete(l){if(notionState.connected&&notionState.autoSave)saveToNotion(l)}
