import test from 'node:test';
import assert from 'node:assert/strict';
import { readSizingPreference, writeSizingPreference, validateSizingPreferences } from '../public/sizing-preferences.js';
const bytes = text => new TextEncoder().encode(text).length;
function fixture(statement='A: box "wrapped" "text" width 1 height 1 at (0,0)') {
  const prefix='# café 😀\r\n', source=prefix+statement+'\r\n';
  const object={id:'a',name:'A',kind:'box',span:{start:bytes(prefix),end:bytes(prefix+statement)},bbox:{width:1,height:1}};
  const scene={source,objects:[object]};return{source,scene,object};
}
test('original paragraph and sizing intent survive without changing canonical source',()=>{
  const f=fixture(), previous={};
  const preferences=writeSizingPreference(f.source,f.scene,f.object,previous,{mode:'wrap',text:'wrapped text'});
  assert.deepEqual(previous,{});assert.equal(preferences.A.statement,'A: box "wrapped" "text" width 1 height 1 at (0,0)');
  assert.deepEqual(readSizingPreference(f.source,f.scene,f.object,preferences),{mode:'wrap',text:'wrapped text',width:1});
});
test('imports, changed statements, renamed or missing objects and stale scenes have no inferred intent',()=>{
  const f=fixture(), preferences=writeSizingPreference(f.source,f.scene,f.object,{}, {mode:'grow',text:'wrapped text'});
  assert.equal(readSizingPreference(f.source,f.scene,f.object,{}),null);
  const changed=fixture('A: box "new" width 1 height 1 at (0,0)');
  assert.equal(readSizingPreference(changed.source,changed.scene,changed.object,preferences),null);
  assert.equal(readSizingPreference(f.source,{...f.scene,source:f.source+' '},f.object,preferences),null);
  assert.equal(readSizingPreference(f.source,f.scene,{...f.object,name:'Renamed'},preferences),null);
  assert.equal(readSizingPreference(f.source,f.scene,null,preferences),null);
});
test('unrelated source changes preserve intent when the guarded statement is unchanged',()=>{
  const f=fixture(), preferences=writeSizingPreference(f.source,f.scene,f.object,{}, {mode:'fixed',text:'wrapped text'});
  const source=f.source+'# unrelated\n',scene={...f.scene,source};
  assert.deepEqual(readSizingPreference(source,scene,f.object,preferences),{mode:'fixed',text:'wrapped text',width:1});
});
test('storage is bounded and immutable, keeping the newest 500 entries',()=>{
  const f=fixture();const old=Object.fromEntries(Array.from({length:500},(_,i)=>['Shape'+i,{statement:'old',mode:'fixed',text:'x'}]));
  const next=writeSizingPreference(f.source,f.scene,f.object,old,{mode:'wrap',text:'hello'});
  assert.equal(Object.keys(next).length,500);assert.equal(Object.keys(old).length,500);assert.equal(next.Shape0,undefined);assert.ok(next.A);assert.notEqual(next.Shape1,old.Shape1);
  assert.throws(()=>writeSizingPreference(f.source,f.scene,f.object,{}, {mode:'wrap',text:'x'.repeat(10001)}),/10000/);
  assert.throws(()=>writeSizingPreference(f.source,f.scene,f.object,{}, {mode:'unknown',text:'x'}),/supported/);
});
test('malformed preferences and unsupported shapes fail safely',()=>{
  const f=fixture();for(const preferences of [null,[],{A:{mode:'wrap',text:3,statement:'x'}},{A:{mode:'auto',text:'x',statement:'x'}}]) assert.equal(readSizingPreference(f.source,f.scene,f.object,preferences),null);
  const nested={...f.object,depth:1};assert.throws(()=>writeSizingPreference(f.source,{...f.scene,objects:[nested]},nested,{}, {mode:'wrap',text:'x'}),/read-only/);
});
test('document validation clones only known fields and rejects pollution or excessive storage',()=>{
  const entry={statement:'A: box',mode:'grow',text:'hello',unexpected:'ignored'};
  const validated=validateSizingPreferences({A:entry});assert.deepEqual(validated,{A:{statement:'A: box',mode:'grow',text:'hello'}});assert.notEqual(validated.A,entry);
  assert.deepEqual(validateSizingPreferences(),{});
  assert.throws(()=>validateSizingPreferences(JSON.parse('{"__proto__":{"statement":"x","mode":"grow","text":"x"}}')),/Invalid/);
  assert.throws(()=>validateSizingPreferences({__proto__:{polluted:true}}),/Invalid/);
  assert.throws(()=>validateSizingPreferences({A:{...entry,statement:'x'.repeat(1024*1024)}}),/1 MB/);
  assert.throws(()=>validateSizingPreferences(Object.fromEntries(Array.from({length:501},(_,i)=>['Shape'+i,entry]))),/500/);
});
test('Undo and Redo recover original paragraphs and modes after document serialization',()=>{
  const first=fixture('A: box "original" "paragraph" width 1 height 1 at (0,0)');
  const second=fixture('A: box "original paragraph" width 2 height 1 at (0,0)');
  const p1=writeSizingPreference(first.source,first.scene,first.object,{}, {mode:'wrap',text:'original paragraph'});
  const p2=writeSizingPreference(second.source,second.scene,second.object,p1,{mode:'fixed',text:'different editing intent'});
  const reloaded=validateSizingPreferences(JSON.parse(JSON.stringify(p2)));
  assert.deepEqual(readSizingPreference(first.source,first.scene,first.object,reloaded),{mode:'wrap',text:'original paragraph',width:1});
  assert.deepEqual(readSizingPreference(second.source,second.scene,second.object,reloaded),{mode:'fixed',text:'different editing intent',width:1});
  assert.equal(p1.A.history,undefined);
});
test('history keeps at most 20 distinct statements including current and rejects corrupt histories',()=>{
  let preferences={};
  for(let i=0;i<25;i++) {const f=fixture(`A: box "${i}" at (0,0)`);preferences=writeSizingPreference(f.source,f.scene,f.object,preferences,{mode:'grow',text:String(i)});}
  assert.equal(preferences.A.history.length,19);assert.equal(preferences.A.history.at(-1).text,'5');
  const current=fixture('A: box "24" at (0,0)');
  preferences=writeSizingPreference(current.source,current.scene,current.object,preferences,{mode:'fixed',text:'24'});
  assert.equal(preferences.A.history.length,19);assert.equal(new Set([preferences.A.statement,...preferences.A.history.map(e=>e.statement)]).size,20);
  for(const history of [{},[null],[{mode:'bogus',text:'x',statement:'x'}],Array(20).fill({mode:'grow',text:'x',statement:'x'}),[{mode:'grow',text:'x',statement:'x',history:[]}]]) {
    assert.throws(()=>validateSizingPreferences({A:{mode:'grow',text:'x',statement:'x',history}}),/history/);
  }
});
