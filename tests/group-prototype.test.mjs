import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createComposite,moveGeneratedGroup} from '../public/group-prototype.js';
import {applyPatch} from '../public/edits.js';
const publicDir=path.resolve(import.meta.dirname,'../public');
const context=vm.createContext({require:createRequire(import.meta.url),process,console,__dirname:publicDir,__filename:path.join(publicDir,'pikchr.js'),URL,TextDecoder,TextEncoder,setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir,'pikchr.js'),'utf8'),context);
const module=await context.initPikchrModule({locateFile:p=>path.join(publicDir,p)});
const native=module.cwrap('pikchr_studio','number',['string']);
function render(source){const p=native(source);try{const result=JSON.parse(module.UTF8ToString(p));assert.equal(result.error,null,source);return result;}finally{module._free(p);}}

test('triangle and trapezoid compile into native groups with declared anchors and source round trips',()=>{
  for(const kind of ['triangle','trapezoid']){
    const before='# Unicode café 😀\r\n',option=createComposite(before,{objects:[]},{kind,x:1,y:2,width:2,height:1,label:'Café'});
    assert.ok(option.source.startsWith(before));assert.equal(applyPatch(before,option.patch),option.source);
    assert.ok(option.source.endsWith('] at (1, 2)\r\n'));assert.equal(option.ports[1],'Composite1.Bounds.e');
    const source=option.source+'B: box at (5,2)\r\nConnector: arrow from Composite1.Bounds.e to B.w\r\n';
    const scene=render(source),group=scene.objects.find(o=>o.name==='Composite1');
    assert.deepEqual(group.center,{x:1,y:2});assert.equal(group.editable,false);
    assert.ok(scene.objects.some(o=>o.name==='Outline'&&o.reason==='Nested object'));
    const moved=moveGeneratedGroup(source,scene,group,{x:2,y:3});
    const result=render(moved.source),bounds=result.objects.find(o=>o.name==='Bounds'),arrow=result.objects.find(o=>o.name==='Connector');
    assert.deepEqual(result.objects.find(o=>o.name==='Composite1').center,{x:2,y:3});
    assert.deepEqual(arrow.path[0],bounds.anchors.e);
    assert.equal(moved.patch.expected,'] at (1, 2)');assert.equal(moved.patch.text,'] at (2, 3)');
    assert.equal(moved.source.replace('] at (2, 3)','] at (1, 2)'),source);
    assert.throws(()=>applyPatch(source+' ',moved.patch),/Source changed/);
    assert.equal(moveGeneratedGroup(moved.source,result,result.objects.find(o=>o.name==='Composite1'),{x:1,y:2}).source,source);
  }
});

test('ordinary groups, modified children and metadata cannot impersonate editable composites',()=>{
  const normal='G: [ A: box at (0,0) ] at (1,1)',normalScene=render(normal);
  assert.throws(()=>moveGeneratedGroup(normal,normalScene,normalScene.objects[0],{x:0,y:0}));
  const original=createComposite('',{objects:[]},{kind:'triangle',x:0,y:0,label:'A'}).source;
  for(const source of [original.replace('Caption: text "A"','Caption: text "Changed"'),original.replace('"height":1','"height":2'),original.replace('  Outline:','  # custom comment\n  Outline:')]){
    const scene=render(source);assert.throws(()=>moveGeneratedGroup(source,scene,scene.objects[0],{x:1,y:1}));
  }
});

test('creation reserves names, validates finite coordinates and never appends to continued source',()=>{
  const source='# Composite1 reserved\n',option=createComposite(source,{objects:[{name:'Composite2'}]},{kind:'trapezoid',x:0,y:0});
  assert.equal(option.selectName,'Composite3');render(option.source);
  for(const options of [{kind:'diamond',x:0,y:0},{kind:'triangle',x:Infinity,y:0},{kind:'triangle',x:0,y:0,width:0},{kind:'triangle',x:0,y:0,label:'bad"label'}])assert.throws(()=>createComposite('',{objects:[]},options));
  assert.throws(()=>createComposite('box \\',{}, {kind:'triangle',x:0,y:0}),/continued/);
});
