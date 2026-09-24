import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentStore} from '../public/documents.js';

function memory(){const data=new Map();return {
  get length(){return data.size;},key:i=>[...data.keys()][i]??null,
  getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)
};}
const state=(source='A: box "Hello"')=>({source,draft:[],draftRedo:[],draftBase:null,undo:[],redo:[],autoApply:true,applied:true});
const setup=()=>({local:memory(),session:memory()});

test('documents restore applied source, history and mode without aliasing',()=>{
  const storage=setup(),store=createDocumentStore(storage),initial=state();
  initial.undo=['box'];initial.redo=['circle'];
  assert.deepEqual(store.save(initial),{ok:true});initial.undo.push('changed');
  const loaded=createDocumentStore(storage).load();
  assert.deepEqual(loaded.state.undo,['box']);assert.equal(loaded.state.source,state().source);
  assert.equal(loaded.state.applied,true);assert.equal(loaded.state.autoApply,true);
});
test('explicit document titles survive reload and override the first diagram label',()=>{
  const storage=setup(),store=createDocumentStore(storage),initial={...state('Client: box "Client"'),title:'Pipeline'};
  assert.equal(store.save(initial).ok,true);
  assert.deepEqual(createDocumentStore(storage).load().state,initial);
  assert.equal(store.list()[0].title,'Pipeline');
});
test('legacy documents retain their exact title-free state and derived labels',()=>{
  const storage=setup(),store=createDocumentStore(storage),initial=state('box "Legacy label"');
  store.save(initial);
  const loaded=createDocumentStore(storage).load().state;
  assert.deepEqual(loaded,initial);assert.equal(Object.hasOwn(loaded,'title'),false);
  assert.equal(store.list()[0].title,'Legacy label');
});
test('invalid document titles are rejected without replacing saved state',()=>{
  const storage=setup(),store=createDocumentStore(storage),initial={...state(),title:'Original'};
  store.save(initial);
  for(const title of [null,42,'x'.repeat(101)])assert.equal(store.save({...initial,title}).ok,false);
  assert.equal(createDocumentStore(storage).load().state.title,'Original');
});
test('documents restore queued draft and validate the complete chain',()=>{
  const storage=setup(),store=createDocumentStore(storage),initial=state('box "Two"');
  initial.draftBase='box';initial.applied=false;initial.autoApply=false;
  initial.draft=[{before:'box',after:'box "One"',label:'Text',diff:'One'},
    {before:'box "One"',after:initial.source,label:'Text',diff:'Two'}];
  assert.equal(store.save(initial).ok,true);
  assert.deepEqual(createDocumentStore(storage).load().state,initial);
  initial.draft[1].before='circle';assert.equal(store.save(initial).ok,false);
  assert.equal(createDocumentStore(storage).load().state.draft[1].before,'box "One"');
});
test('corruption never overwrites the raw document and healthy documents remain accessible',()=>{
  const storage=setup(),store=createDocumentStore(storage),id=store.create();
  store.save(state());const key='pikchr-studio.document.v1.'+id;
  storage.local.setItem(key,'{broken');
  const reload=createDocumentStore(storage);assert.throws(()=>reload.load());
  assert.equal(reload.save(state()).ok,false);assert.equal(storage.local.getItem(key),'{broken');
  assert.deepEqual(reload.list(),[]);
  reload.create();assert.equal(reload.save(state()).ok,true);assert.equal(reload.list().length,1);
});
test('quota and disabled storage failures are explicit',()=>{
  const storage=setup(),store=createDocumentStore(storage);store.create();
  storage.local.setItem=()=>{throw Error('Quota exceeded');};
  assert.deepEqual(store.save(state()),{ok:false,error:'Quota exceeded'});
  assert.equal(createDocumentStore({local:null,session:null}).save(state()).ok,false);
});
test('multiple documents preserve independent state and per-tab selection',()=>{
  const storage=setup(),store=createDocumentStore(storage),a=store.create();store.save(state('box "A"'));
  const b=store.create();assert.equal(store.load(),null);store.save(state('box "B"'));
  assert.equal(store.list().length,2);assert.equal(store.open(a).state.source,'box "A"');
  const other=createDocumentStore({local:storage.local,session:memory()});
  assert.equal(other.load().id,b);assert.equal(store.load().id,a);
  assert.equal(store.list().find(item=>item.id===a).title,'A');
});
test('external changes are detected before overwriting, including same-millisecond saves',()=>{
  const storage=setup(),first=createDocumentStore(storage);first.save(state());
  const other=createDocumentStore({local:storage.local,session:memory()});const {id}=other.load();
  first.save(state('circle "New"'));
  assert.match(other.save(state('box "Old"')).error,/another tab/);
  assert.equal(other.open(id).state.source,'circle "New"');assert.equal(other.save(state('box "Updated"')).ok,true);
});
test('invalid loaded history, source size and draft endpoints fail closed',()=>{
  for(const change of [s=>{s.undo=[3];},s=>{s.source='x'.repeat(2*1024*1024+1);},s=>{s.draftBase='box';s.draft=[{before:'box',after:'circle',label:'Move',diff:''}];}]){
    const storage=setup(),store=createDocumentStore(storage),id=store.create();store.save(state());
    const key='pikchr-studio.document.v1.'+id,record=JSON.parse(storage.local.getItem(key));
    change(record.state);storage.local.setItem(key,JSON.stringify(record));
    assert.throws(()=>createDocumentStore(storage).load());
  }
});
test('legacy documents load with an empty draft redo stack',()=>{
  const storage=setup(),store=createDocumentStore(storage),id=store.create();store.save(state());
  const key='pikchr-studio.document.v1.'+id,record=JSON.parse(storage.local.getItem(key));
  delete record.state.draftRedo;storage.local.setItem(key,JSON.stringify(record));
  assert.deepEqual(createDocumentStore(storage).load().state.draftRedo,[]);
});
test('draft redo survives reload in reverse stack order, with or without queued edits',()=>{
  for(const queued of [false,true]){
    const storage=setup(),store=createDocumentStore(storage),initial=state('box "One"');
    initial.autoApply=false;
    if(queued){initial.draftBase='box';initial.draft=[{before:'box',after:initial.source,label:'Text',diff:'One'}];initial.applied=false;}
    initial.draftRedo=[{before:'box "Two"',after:'box "Three"',label:'Text',diff:'Three'},
      {before:initial.source,after:'box "Two"',label:'Text',diff:'Two'}];
    assert.deepEqual(store.save(initial),{ok:true});
    assert.deepEqual(createDocumentStore(storage).load().state,initial);
    initial.draftRedo[1].label='Changed';
    assert.equal(createDocumentStore(storage).load().state.draftRedo[1].label,'Text');
  }
});
test('corrupt draft redo chains are rejected without overwriting the saved document',()=>{
  for(const change of [
    s=>{s.draftRedo=null;},
    s=>{s.draftRedo=[{}];},
    s=>{s.draftRedo[0].before='circle';},
    s=>{s.draftRedo[0].diff=7;},
    s=>{s.draftRedo.push({before:'wrong source',after:'box',label:'Text',diff:''});},
    s=>{s.autoApply=true;}
  ]){
    const storage=setup(),store=createDocumentStore(storage),initial=state('box');initial.autoApply=false;
    initial.draftRedo=[{before:'box',after:'circle',label:'Shape',diff:'circle'}];
    store.save(initial);
    const id=store.load().id,key='pikchr-studio.document.v1.'+id,raw=storage.local.getItem(key);
    change(initial);assert.equal(store.save(initial).ok,false);assert.equal(storage.local.getItem(key),raw);
    const record=JSON.parse(raw);record.state=initial;const corrupt=JSON.stringify(record);storage.local.setItem(key,corrupt);
    const reload=createDocumentStore(storage);assert.throws(()=>reload.load());
    assert.equal(reload.save(state()).ok,false);assert.equal(storage.local.getItem(key),corrupt);
  }
});
