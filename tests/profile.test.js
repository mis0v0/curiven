// Run: node --test tests/profile.test.js
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../profile.js');

class MemoryStorage{
 constructor(init={}){this.m=new Map(Object.entries(init))}
 getItem(k){return this.m.has(k)?this.m.get(k):null}
 setItem(k,v){this.m.set(k,String(v))}
 removeItem(k){this.m.delete(k)}
}
class BrokenStorage{getItem(){throw Error('SecurityError')}setItem(){throw Error('QuotaExceededError')}removeItem(){}}

test('normalizeProfile cleans, dedupes and defaults',()=>{
 const p=P.normalizeProfile({nickname:'  새봄  ',interests:['추리 소설',' 추리 소설 ','','등산'],approach:'nope',depth:'deep',meaning:' 재밌어요 '},1000);
 assert.deepEqual(p,{version:1,nickname:'새봄',interests:['추리 소설','등산'],meaning:'재밌어요',approach:'mixed',depth:'deep',createdAt:1000,updatedAt:1000});
 assert.equal(P.normalizeProfile(null),null);
 assert.equal(P.normalizeProfile([]),null);
 assert.deepEqual(P.normalizeProfile({}).interests,[]);
});

test('interests accept comma text and are capped',()=>{
 assert.deepEqual(P.splitInterests('a, b，c\nd'),['a','b','c','d']);
 assert.equal(P.splitInterests(Array.from({length:30},(_,i)=>'x'+i)).length,P.LIMITS.interests);
});

test('profile round-trips through storage under its own key',()=>{
 const s=new MemoryStorage({'curiven-v01-personal':'{"lessons":[],"active":null}'});
 assert.equal(P.readProfile(s).status,'empty');
 const p=P.normalizeProfile({interests:['요리']});
 assert.equal(P.writeProfile(s,p),true);
 const r=P.readProfile(s);
 assert.equal(r.status,'ok');assert.deepEqual(r.profile,p);
 assert.equal(s.getItem('curiven-v01-personal'),'{"lessons":[],"active":null}','learning records untouched');
});

test('corrupt profile is reported, not silently treated as empty, and can be quarantined',()=>{
 const s=new MemoryStorage({[P.PROFILE_KEY]:'{oops'});
 const r=P.readProfile(s);
 assert.equal(r.status,'corrupt');assert.equal(r.raw,'{oops');
 const k=P.quarantine(s,P.PROFILE_KEY,r.raw,42);
 assert.equal(k,P.PROFILE_KEY+'.corrupt-42');assert.equal(s.getItem(k),'{oops');
});

test('unavailable storage never throws',()=>{
 const b=new BrokenStorage();
 assert.equal(P.storageAvailable(b),false);
 assert.equal(P.storageAvailable(null),false);
 assert.equal(P.readProfile(b).status,'unavailable');
 assert.equal(P.writeProfile(b,P.normalizeProfile({})),false);
 assert.equal(P.quarantine(b,'k','raw'),null);
});

test('legacy lesson interests seed onboarding (latest lesson wins)',()=>{
 const lessons=[{interest:'등산',level:'some',createdAt:1},{interest:'추리 소설, 범죄 수사',level:'deep',createdAt:5},{interest:'',createdAt:9}];
 assert.deepEqual(P.legacyInterests(lessons),['추리 소설','범죄 수사']);
 assert.equal(P.legacyDepth(lessons),'deep');
 assert.deepEqual(P.legacyInterests(undefined),[]);
});

test('planImport never decides to overwrite silently',()=>{
 const cur=P.normalizeProfile({interests:['a']});
 assert.equal(P.planImport(cur,undefined).action,'none');
 assert.equal(P.planImport(cur,'garbage').action,'none');
 assert.equal(P.planImport(null,{interests:['b']}).action,'restore');
 assert.equal(P.planImport(cur,{interests:['a'],createdAt:1}).action,'same');
 const o=P.planImport(cur,{interests:['b']});
 assert.equal(o.action,'overwrite');assert.deepEqual(o.incoming.interests,['b']);
});

test('AI payload and prompt text reflect the latest values',()=>{
 const p=P.normalizeProfile({nickname:'새봄',interests:['등산'],approach:'experiment',depth:'some',meaning:'정상에서의 성취감'});
 assert.deepEqual(P.aiPayload(p),{nickname:'새봄',interests:['등산'],meaning:'정상에서의 성취감',approach:'experiment',depth:'some'});
 const t=P.promptText(p);
 assert.match(t,/관심사·취미: 등산/);assert.match(t,/먼저 예측하고 실험해 보기/);assert.match(t,/호칭: 새봄/);
 assert.equal(P.promptText(null),'학습자 프로필: 없음');
});
