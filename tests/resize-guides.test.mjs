import test from 'node:test';
import assert from 'node:assert/strict';
import {snapResize} from '../public/resize-guides.js';
const shape=(id,x,y,width=1,height=1,kind='box')=>({id,name:id,kind,bbox:{x,y,width,height}});
const object=shape('A',0,0),target=shape('B',2,-2);
const call=(options={})=>snapResize({object,scene:{objects:[object,target]},width:1.95,height:2.95,handle:'se',...options});

test('corner snaps right and bottom edges to exact model coordinates with full guide extents',()=>{
  const result=call();assert.equal(result.width,2);assert.equal(result.height,3);
  assert.deepEqual(result.guides.map(g=>[g.axis,g.value,g.from,g.to]),[['x',2,-2,1],['y',-2,0,3]]);
});

test('single-axis handles, disabled snapping and tolerance boundaries preserve intended dimensions',()=>{
  assert.deepEqual(call({enabled:false}),{width:1.95,height:2.95,guides:[]});
  const e=call({handle:'e'});assert.equal(e.width,2);assert.equal(e.height,2.95);assert.equal(e.guides.length,1);
  const s=call({handle:'s'});assert.equal(s.width,1.95);assert.equal(s.height,3);assert.equal(s.guides.length,1);
  assert.equal(call({width:1.92,handle:'e'}).width,2);
  assert.equal(call({width:1.919,handle:'e'}).guides.length,0);
});

test('target ties are deterministic and inputs are never mutated',()=>{
  const a=shape('Left',1.95,2,.1,1),b=shape('Right',2.05,2,.1,1);
  const scene={objects:[object,a,b]},before=JSON.stringify(scene);
  const first=call({scene,width:2,handle:'e'}),second=call({scene:{objects:[b,object,a]},width:2,handle:'e'});
  assert.deepEqual(first,second);assert.equal(JSON.stringify(scene),before);
  const arrow=shape('Arrow',2,-2,1,1,'arrow');assert.equal(call({scene:{objects:[object,arrow]},handle:'e'}).guides.length,0);
});

test('circle and locked-ratio resizing use one compatible snap constraint',()=>{
  const circle={...object,kind:'circle'};
  const result=call({object:circle,width:1.95,height:1.95,handle:'e'});
  assert.equal(result.width,2);assert.equal(result.height,2);assert.equal(result.guides.length,1);
  const wide=shape('Wide',0,0,2,1);
  const locked=call({object:wide,width:1.95,height:.7,handle:'e',lockRatio:true});
  assert.equal(locked.width,2);assert.equal(locked.height,1);
  assert.deepEqual(call({object:circle,width:.5,height:1,handle:'e',enabled:false}),{width:.5,height:.5,guides:[]});
});

test('snap targets outside allowed sizes are ignored and invalid inputs fail explicitly',()=>{
  const tooSmall=shape('Tiny',.05,3,.01,1);
  const small=call({scene:{objects:[tooSmall]},width:.1,height:1,handle:'e',tolerance:.1});
  assert.equal(small.width,.1);assert.equal(small.guides.length,0);
  const tooLarge=shape('Huge',100.05,3,1,1);
  assert.equal(call({scene:{objects:[tooLarge]},width:100,height:1,handle:'e'}).guides.length,0);
  for(const options of [{width:0},{height:101},{width:NaN},{tolerance:-1},{handle:'nw'}])assert.throws(()=>call(options));
});
