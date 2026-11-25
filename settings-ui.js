/* CURIVEN settings — one dialog for profile, AI connection, Notion and data, opened from one sidebar entry.
   Uses index.html globals at call time (E, button, profile, provider, saveProfile, profileForm, status, post, ...).

   Why a modal dialog instead of a full-page view: the lesson underneath is never re-rendered by opening or using
   settings, so whatever the learner was typing stays exactly where it was, and "back to the lesson" is simply
   closing the dialog (×, Esc, or the footer button). Native <dialog> gives focus containment and Esc for free;
   on a phone it fills the screen. Moving controls here removed nothing: JSON backup/restore, the AI connection
   and the profile work exactly as before. */
'use strict';
const SETTINGS_TABS=[['profile','프로필'],['ai','AI'],['notion','Notion'],['data','데이터']];
let settingsTab='profile',profileReader=null;
const settingsDlg=()=>document.getElementById('settings');
function settingsIsOpen(){return !!settingsDlg()?.open}
/** The sidebar entry is a fixed icon + "설정" (index.html); nothing about it depends on the profile any more. */
function settingsEntry(){}
function openSettings(tab='profile'){const d=settingsDlg();if(!d)return;if(typeof flushDraft==='function')flushDraft();settingsTab=SETTINGS_TABS.some(([k])=>k===tab)?tab:'profile';
 renderSettings();if(!d.open){if(typeof d.showModal==='function')d.showModal();else d.setAttribute('open','')}
 document.querySelector(`#settingsTabs [data-settings-tab="${settingsTab}"]`)?.focus();
 if(settingsTab==='ai')status(false);if(settingsTab==='notion'&&typeof notionRefresh==='function')notionRefresh()}
/** Unsaved profile edits are never dropped silently. `force` skips the question (after a restore). */
function profileUnsaved(){if(settingsTab!=='profile'||!profileReader||!profile)return false;return !P.sameProfile(P.normalizeProfile(profileReader()),profile)}
function closeSettings(force=false){const d=settingsDlg();if(!d?.open)return true;
 if(!force&&profileUnsaved()&&!confirm('저장하지 않은 프로필 변경 사항이 있어요. 저장하지 않고 닫을까요?'))return false;
 profileReader=null;if(typeof d.close==='function')d.close();else d.removeAttribute('open');
 settingsEntry();if(!force)render();document.getElementById('settingsBtn')?.focus({preventScroll:true});return true}
function switchSettings(tab){if(tab===settingsTab)return;if(profileUnsaved()&&!confirm('저장하지 않은 프로필 변경 사항이 있어요. 저장하지 않고 다른 항목으로 갈까요?'))return;
 settingsTab=tab;profileReader=null;renderSettings();document.querySelector(`#settingsTabs [data-settings-tab="${tab}"]`)?.focus();
 if(tab==='ai')status(false);if(tab==='notion'&&typeof notionRefresh==='function')notionRefresh()}
function renderSettings(){const tabs=document.getElementById('settingsTabs'),body=document.getElementById('settingsBody');if(!tabs||!body)return;
 tabs.replaceChildren(...SETTINGS_TABS.filter(([k])=>k!=='notion'||typeof notionTab==='function').map(([k,label])=>{const b=button(label,()=>switchSettings(k),'settings-tab');b.dataset.settingsTab=k;if(k===settingsTab)b.setAttribute('aria-current','page');return b}));
 // Re-rendering the profile form would discard what is typed in it; only the other tabs refresh in place.
 if(settingsTab==='profile'&&profileReader&&body.querySelector('#profileSettings'))return;
 body.replaceChildren();const c=E('section','settings-section');body.append(c);
 if(settingsTab==='profile')profileTab(c);else if(settingsTab==='ai')aiTab(c);else if(settingsTab==='notion'){if(typeof notionTab==='function')notionTab(c)}else dataTab(c);
 const back=document.getElementById('settingsBack');if(back)back.textContent=current()?.lesson?'← 학습으로 돌아가기':'← 돌아가기'}

/* ---------- profile ---------- */
function profileTab(c){c.id='profileSettings';c.append(E('h3','','나의 학습 프로필'),E('p','hint','저장한 뒤 새로 요청하는 이야기·사고 실험·피드백에 반영돼요. 이미 저장된 학습 기록과 별자리는 바뀌지 않아요.'));
 const writable=canWrite();profileReader=profileForm(c,profile||P.normalizeProfile({}));
 const status=E('div','');status.id='profileStatus';status.setAttribute('aria-live','polite');
 const row=E('div','actions');const save=button('변경 사항 저장',()=>{const r=saveProfile(profileReader());
  if(r==='conflict'){status.className='msg';status.textContent='다른 탭에서 프로필이 먼저 바뀌어 저장하지 않았어요. 입력한 내용은 그대로 두었어요. 확인한 뒤 다시 저장하면 이 내용으로 바뀌어요.';return}
  if(r==='readonly'){status.className='msg';status.textContent='이 탭은 읽기 전용이에요.';return}
  profileReader=null;renderSettings();settingsEntry();render();const s=document.getElementById('profileStatus');if(s){s.className=r==='ok'?'saved':'msg';s.textContent=r==='ok'?'저장했어요. 다음 AI 요청부터 새 프로필을 사용해요.':'이 창에는 적용됐지만 브라우저 저장소에 저장하지 못했어요. 데이터 항목에서 백업을 저장해 주세요.'}});
 save.disabled=!writable;row.append(save);c.append(row,status);if(!writable)c.append(E('p','hint','다른 탭에서 학습 중이라 이 탭에서는 프로필을 바꿀 수 없어요.'))}

/* ---------- AI connection (moved unchanged from the old full-page view) ---------- */
function aiTab(c){const p=provider;c.id='aiSettings';c.append(E('h3','','AI 연결'));
 if(p.provider!=='chatgpt'){c.append(E('p','hint',p.provider==='ollama'?'서버가 로컬 Ollama(실험용)를 쓰도록 설정되어 있어요. 이 모델의 학습 자료 정확도는 아직 검증을 통과하지 못했으니 공식 자료와 꼭 비교해 주세요.':'AI 연결은 CURIVEN 서버(server.py)로 실행할 때 쓸 수 있어요.'));return}
 c.append(E('p','hint','ChatGPT Plus·Pro 플랜을 OpenAI 공식 ‘Sign in with ChatGPT’로 연결해 학습 자료와 피드백을 만들어요. API 요금은 따로 들지 않고, 사용량은 ChatGPT 플랜 한도에 포함돼요.'));
 const connected=p.status==='connected',st=E('div','info');st.id='aiState';
 st.textContent=p.status==='sdk_missing'?'공식 SDK가 아직 설치되지 않았어요.':p.status==='connecting'?'열린 브라우저 창에서 ChatGPT 로그인과 권한 동의를 마쳐 주세요. 완료되면 이 화면이 자동으로 바뀌어요.':connected&&p.sharing?`연결됨${p.account?' · '+p.account:''}`:connected?'로그인은 됐지만 ChatGPT 플랜 사용 권한이 허용되지 않았어요. 다시 연결하면서 권한을 허용해 주세요.':p.status==='reauth_required'?'연결을 다시 확인해야 해요. 다시 로그인해 주세요.':'연결되지 않았어요.';c.append(st);
 if(p.error?.message){const e=E('div','msg',p.error.message);e.id='aiError';c.append(e)}
 const act=E('div','actions');
 if(p.status==='connecting')act.append(button('로그인 취소',()=>aiAction('cancel')));
 else if(p.status!=='sdk_missing'&&!(connected&&p.sharing))act.append(button('ChatGPT로 계속하기',()=>aiAction('connect')));
 if(connected)act.append(button('연결 해제',()=>{if(confirm('이 기기에서 ChatGPT 연결을 해제할까요? 저장된 로그인 정보가 삭제되고 원격 연결도 해제를 요청해요.'))aiAction('disconnect')},'btn secondary'));
 if(act.children.length)c.append(act);
 if(connected&&p.sharing){if(p.models?.length){const s=selectOf('aiModel',{...(p.model?{}:{'':'모델을 선택해 주세요'}),...Object.fromEntries(p.models.map(x=>[x.slug,x.displayName+' ('+x.slug+')']))},p.model||'');s.onchange=()=>{if(s.value)aiAction('model',{model:s.value})};inputField(c,'사용할 모델',s,p.model?'선택한 모델은 저장되고, 만든 학습 자료와 피드백에 함께 기록돼요.':'자동으로 고르지 않아요. 학습 자료와 피드백을 만들 모델을 직접 선택해 주세요.')}
  if(p.modelError)c.append(E('div','msg',p.modelError))}
 const note=E('div','note');note.append(E('p','hint','• 로그인 정보는 이 Mac의 키체인 키로 암호화되어 서버 프로세스에만 보관돼요. 브라우저, 학습 기록, 백업 파일에는 들어가지 않아요.'),E('p','hint','• AI 요청에는 주제, 학습 프로필, 학습 자료, 내 설명이 포함되어 ChatGPT로 전송돼요. 응답 저장 안 함(store:false)으로 요청해요.'),E('p','hint','• AI가 만든 자료와 피드백은 틀릴 수 있어요.'));
 const a=E('a','','ChatGPT 사용량 보기 ↗');a.href='https://chatgpt.com/settings/usage';a.target='_blank';a.rel='noopener noreferrer';const pa=E('p','hint');pa.append(a);note.append(pa);c.append(note)}

/* ---------- data ---------- */
function dataTab(c){c.id='dataSettings';c.append(E('h3','','데이터'),E('p','hint',`이 브라우저에 저장된 탐험 ${data.lessons.length}개와 프로필을 파일 하나로 백업하거나, 백업 파일에서 되살릴 수 있어요.`));
 const row=E('div','actions');const ex=button('백업 저장 (.json)',()=>{flushDraft();exportData()},'btn secondary');ex.id='exportData';row.append(ex);
 const lab=E('label','btn secondary settings-file','백업 불러오기');const inp=E('input');inp.type='file';inp.id='importData';inp.accept='application/json';inp.hidden=true;lab.append(inp);row.append(lab);c.append(row);
 const st=E('div','');st.id='dataStatus';st.setAttribute('aria-live','polite');c.append(st);
 inp.onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(!await importBackup(file)){st.className='';st.textContent=''}}catch(err){st.className='msg';st.textContent='복원 실패: '+err.message}e.target.value=''};
 c.append(E('p','hint','불러오면 지금 기록이 파일의 기록으로 바뀌어요.'))}

(function wire(){const d=settingsDlg();if(!d)return;
 document.getElementById('settingsBtn')?.addEventListener('click',()=>openSettings(settingsTab));
 document.getElementById('settingsClose')?.addEventListener('click',()=>closeSettings());
 document.getElementById('settingsBack')?.addEventListener('click',()=>closeSettings());
 d.addEventListener('cancel',e=>{e.preventDefault();closeSettings()}); // Esc: same path, so unsaved edits are asked about
 d.addEventListener('keydown',e=>{const tabs=[...document.querySelectorAll('#settingsTabs .settings-tab')],i=tabs.indexOf(document.activeElement);if(i<0)return;
  if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length].focus()}})})();
