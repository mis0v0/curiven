/* CURIVEN personal learning profile.
   Stored under its own localStorage key, independent of learning records
   ('curiven-v01-personal'), so starting/resetting/importing lessons never touches it.
   Works in the browser (window.CuriProfile) and in Node tests (module.exports). */
'use strict';
(function(root){
 const PROFILE_KEY='curiven-profile-v1';
 const VERSION=1;
 const APPROACHES={mixed:'주제에 맞게 섞어서',story:'이야기 속 사건에서 출발하기',experiment:'먼저 예측하고 실험해 보기',concept:'핵심 개념부터 정확하게'};
 const DEPTHS={beginner:'처음 접해요 — 핵심부터 차근차근',some:'조금 알아요 — 원리와 이유까지',deep:'깊이 탐구하고 싶어요 — 세부 조건과 예외까지'};
 const LIMITS={nickname:30,interest:60,interests:12,meaning:600};

 const line=(v,n)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,n);

 function splitInterests(v){
  const raw=Array.isArray(v)?v:typeof v==='string'?v.split(/[,，、\n]/):[];
  const seen=new Set(),out=[];
  for(const x of raw){
   const s=line(x,LIMITS.interest),k=s.toLowerCase();
   if(s&&!seen.has(k)){seen.add(k);out.push(s)}
   if(out.length>=LIMITS.interests)break;
  }
  return out;
 }

 /** Returns a clean profile object, or null if the value cannot be a profile. */
 function normalizeProfile(v,now=Date.now()){
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  return {
   version:VERSION,
   nickname:line(v.nickname,LIMITS.nickname),
   interests:splitInterests(v.interests),
   meaning:String(v.meaning??'').trim().slice(0,LIMITS.meaning),
   approach:Object.hasOwn(APPROACHES,v.approach)?v.approach:'mixed',
   depth:Object.hasOwn(DEPTHS,v.depth)?v.depth:'beginner',
   createdAt:Number(v.createdAt)||now,
   updatedAt:Number(v.updatedAt)||now
  };
 }

 /** The fields sent to AI requests (no timestamps). */
 function aiPayload(p){
  if(!p)return null;
  return {nickname:p.nickname,interests:p.interests.slice(),meaning:p.meaning,approach:p.approach,depth:p.depth};
 }

 function sameProfile(a,b){return JSON.stringify(aiPayload(a))===JSON.stringify(aiPayload(b))}

 /** Plain-text profile block for the manual (copy/paste) prompt. Mirrors server.py profile_block. */
 function promptText(p){
  if(!p)return '학습자 프로필: 없음';
  const rows=['학습자 프로필:'];
  if(p.nickname)rows.push(`- 호칭: ${p.nickname}`);
  rows.push(`- 관심사·취미: ${p.interests.length?p.interests.join(', '):'입력 없음'}`);
  if(p.meaning)rows.push(`- 그 관심사가 즐겁거나 의미 있는 이유: ${p.meaning}`);
  rows.push(`- 선호 학습 방식: ${APPROACHES[p.approach]}`);
  rows.push(`- 원하는 설명 깊이: ${DEPTHS[p.depth]}`);
  return rows.join('\n');
 }

 function summary(p){
  if(!p)return '';
  return `${p.interests.length?p.interests.join(' · '):'관심사 미입력'} · ${DEPTHS[p.depth].split(' — ')[0]}`;
 }

 /* ---------- storage ---------- */
 function storageAvailable(storage){
  if(!storage)return false;
  try{const k='__curiven_probe__';storage.setItem(k,'1');storage.removeItem(k);return true}catch{return false}
 }

 /** {status:'ok'|'empty'|'corrupt'|'unavailable', profile, raw} — never throws. */
 function readProfile(storage){
  let raw;
  try{if(!storage)throw Error('no storage');raw=storage.getItem(PROFILE_KEY)}catch{return {status:'unavailable',profile:null}}
  if(raw==null)return {status:'empty',profile:null};
  try{const p=normalizeProfile(JSON.parse(raw));if(p&&p.version===VERSION)return {status:'ok',profile:p}}catch{}
  return {status:'corrupt',profile:null,raw};
 }

 function writeProfile(storage,p){
  try{if(!storage)return false;storage.setItem(PROFILE_KEY,JSON.stringify(p));return true}catch{return false}
 }

 /** Copies an unreadable stored value aside so a later save cannot silently destroy it. */
 function quarantine(storage,key,raw,now=Date.now()){
  try{const k=`${key}.corrupt-${now}`;storage.setItem(k,raw);return k}catch{return null}
 }

 /* ---------- migration / import ---------- */
 /** v0.1/v0.2 stored a free-text interest on each lesson. Offer the latest one as an onboarding suggestion. */
 function legacyInterests(lessons){
  if(!Array.isArray(lessons))return [];
  const withInterest=lessons.filter(l=>l&&typeof l.interest==='string'&&l.interest.trim());
  if(!withInterest.length)return [];
  const latest=withInterest.reduce((a,b)=>(Number(b.createdAt)||0)>=(Number(a.createdAt)||0)?b:a);
  return splitInterests(latest.interest);
 }
 function legacyDepth(lessons){
  const l=Array.isArray(lessons)?lessons.filter(x=>x&&Object.hasOwn(DEPTHS,x.level)).at(-1):null;
  return l?l.level:'beginner';
 }

 /** Decides how a backup's profile relates to the current one. Never overwrites by itself.
     'none'      file has no (valid) profile → keep current
     'same'      identical content → nothing to do
     'restore'   no current profile → safe to restore
     'overwrite' differs from current → caller must ask the learner */
 function planImport(current,incomingRaw){
  const incoming=normalizeProfile(incomingRaw);
  if(!incoming)return {action:'none'};
  if(!current)return {action:'restore',incoming};
  if(sameProfile(current,incoming))return {action:'same',incoming};
  return {action:'overwrite',incoming};
 }

 const api={PROFILE_KEY,VERSION,APPROACHES,DEPTHS,LIMITS,splitInterests,normalizeProfile,aiPayload,sameProfile,promptText,summary,storageAvailable,readProfile,writeProfile,quarantine,legacyInterests,legacyDepth,planImport};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.CuriProfile=api;
})(typeof window!=='undefined'?window:globalThis);
