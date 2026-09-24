import test from 'node:test';
import assert from 'node:assert/strict';
import {createComponentLibrary} from '../public/component-library.js';
const key='pikchr-studio.components.v1';
const fragment=()=>({version:1,objects:[{name:'A',kind:'box',statement:'A: box "café 😀" at (0,0)',center:{x:0,y:0}}],omittedEdges:[]});
function storage(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};}

test('library persists portable fragments, returns unique ids and isolated copies',()=>{
  const store=storage(),library=createComponentLibrary({storage:store}),original=fragment();
  assert.deepEqual(library.list(),[]);
  const a=library.save(' Pipeline ',original),b=library.save('Pipeline',original);assert.notEqual(a,b);
  original.objects[0].statement='changed';
  assert.equal(library.get(a).objects[0].statement,'A: box "café 😀" at (0,0)');
  const copy=library.get(a);copy.objects[0].statement='changed again';
  assert.equal(library.get(a).objects[0].statement,'A: box "café 😀" at (0,0)');
  assert.deepEqual(createComponentLibrary({storage:store}).list(),[{id:a,name:'Pipeline'},{id:b,name:'Pipeline'}]);
  assert.throws(()=>library.get('missing'),/no longer/);
});

test('corrupt or unsupported libraries are never overwritten',()=>{
  for(const raw of ['{broken','{}',JSON.stringify({version:2,entries:[]}),JSON.stringify({version:1,entries:[{id:'x',name:'<script>',fragment:fragment()}]})]){
    const store=storage();store.map.set(key,raw);const library=createComponentLibrary({storage:store});
    assert.throws(()=>library.list(),/corrupt/);assert.throws(()=>library.save('New',fragment()),/corrupt/);assert.equal(store.map.get(key),raw);
  }
});

test('names, count, encoded size and fragment structure are bounded before writes',()=>{
  const store=storage(),library=createComponentLibrary({storage:store});
  for(const name of ['', ' ', 'a'.repeat(81), '<b>Title</b>', 'a\n'])assert.throws(()=>library.save(name,fragment()));
  assert.throws(()=>library.save('Missing',{version:1,objects:[]}));
  assert.throws(()=>library.save('Huge',{...fragment(),extra:'😀'.repeat(300000)}),/1 MB/);
  assert.equal(store.map.size,0);
  for(let i=0;i<50;i++)library.save('Part '+i,fragment());
  const before=store.map.get(key);assert.throws(()=>library.save('Overflow',fragment()),/50 components/);assert.equal(store.map.get(key),before);
});

test('storage exceptions report errors and retain previous components',()=>{
  const store=storage(),library=createComponentLibrary({storage:store});library.save('Saved',fragment());
  const before=store.map.get(key);store.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.throws(()=>library.save('Fail',fragment()),/not saved/);assert.equal(store.map.get(key),before);
  store.getItem=()=>{throw new Error('SecurityError');};assert.throws(()=>library.list(),/unavailable/);
});
