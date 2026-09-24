import test from 'node:test';
import assert from 'node:assert/strict';
import {exportWorkspace,parseWorkspace,WORKSPACE_LIMITS} from '../public/workspace-backup.js';
import {createDocumentStore} from '../public/documents.js';

const state=(source='A: box "Café 資料"')=>({source,draft:[],draftRedo:[],draftBase:null,undo:['box'],redo:[],autoApply:true,applied:true,title:'My diagram'});
const record=(id='example',s=state())=>({version:1,id,revision:2,updated:123,state:s});
const raw=documents=>JSON.stringify({format:'pikchr-studio-workspace',version:1,documents});
function storage(){const data=new Map();return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value))};}

test('workspace round trip preserves unicode, titles, history, queued changes and draft redo',()=>{
  const s=state('circle');s.autoApply=false;s.applied=false;s.draftBase='box';
  s.draft=[{before:'box',after:'circle',label:'Change shape',diff:'- box\n+ circle'}];
  s.draftRedo=[{before:'circle',after:'ellipse',label:'Next',diff:'Next'}];
  const original=[record(),record('queued',s)];
  const restored=parseWorkspace(exportWorkspace(original));
  assert.deepEqual(restored,original);
  restored[0].state.undo.push('changed');assert.equal(original[0].state.undo.length,1);
  assert.deepEqual(parseWorkspace(exportWorkspace([])),[]);
});
test('unsupported versions, duplicate IDs and malformed state reject the whole bundle',()=>{
  assert.throws(()=>parseWorkspace('{'),/valid JSON/);
  assert.throws(()=>parseWorkspace('{"format":"pikchr-studio-workspace","version":2}'),/Unsupported/);
  assert.throws(()=>parseWorkspace(raw([record(),record()])),/duplicate/);
  for(const change of [r=>r.version=2,r=>r.id='../bad',r=>r.revision=0,r=>r.state.source=3,r=>r.state.title='x'.repeat(101),r=>r.state.draftBase='orphan']){
    const broken=record('bad');change(broken);assert.throws(()=>parseWorkspace(raw([record(),broken])));
  }
  const broken=record();broken.state.draft=[{before:'wrong',after:broken.state.source,label:'x',diff:'x'}];broken.state.draftBase='base';
  assert.throws(()=>exportWorkspace([broken]),/chain/);
});
test('workspace bounds count, history, source and UTF-8 payload size',()=>{
  assert.throws(()=>exportWorkspace(Array.from({length:101},(_,i)=>record('d'+i))),/100 documents/);
  const r=record();r.state.undo=Array(1001).fill('box');assert.throws(()=>exportWorkspace([r]),/1000/);
  r.state=state('x'.repeat(2*1024*1024+1));assert.throws(()=>exportWorkspace([r]),/Invalid/);
  assert.throws(()=>parseWorkspace(' '.repeat(WORKSPACE_LIMITS.bytes+1)),/16 MB/);
  assert.throws(()=>parseWorkspace('é'.repeat(WORKSPACE_LIMITS.bytes/2+1)),/16 MB/);
});
test('records is read-only, excludes corrupt entries, returns copies and retains conflict detection',()=>{
  const local=storage(),session=storage(),store=createDocumentStore({local,session});
  const first=store.create();assert.equal(store.save(state()).ok,true);
  const second=store.create();assert.equal(store.save(state('circle')).ok,true);
  store.open(first);
  const beforeSession=session.getItem('pikchr-studio.current-document.v1');
  local.setItem('pikchr-studio.document.v1.corrupt','not json');
  const found=store.records();assert.equal(found.length,2);assert(found.some(r=>r.id===second));
  found.find(r=>r.id===first).state.source='changed';
  assert.equal(session.getItem('pikchr-studio.current-document.v1'),beforeSession);
  assert.equal(store.save(state('box')).ok,true,'records did not switch active document');
  const remote=createDocumentStore({local,session:storage()});remote.open(first);remote.save(state('ellipse'));
  store.records();assert.equal(store.save(state('circle')).ok,false,'records did not reset conflict baseline');
  assert.equal(local.getItem('pikchr-studio.document.v1.corrupt'),'not json');
});
