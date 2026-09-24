import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createShape} from '../public/creation.js';
import {inspectProperties,changeText,fitText} from '../public/properties.js';
import {candidates,endpointCandidates} from '../public/edits.js';
import {changeAppearance,duplicateObject,deleteObjects,layoutObjects,moveObjects,pinMove} from '../public/object-actions.js';
const publicDir=path.resolve(import.meta.dirname,'../public');
const context=vm.createContext({require:createRequire(import.meta.url),process,console,__dirname:publicDir,__filename:path.join(publicDir,'pikchr.js'),URL,TextDecoder,TextEncoder,setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir,'pikchr.js'),'utf8'),context);
const module=await context.initPikchrModule({locateFile:p=>path.join(publicDir,p)});
const native=module.cwrap('pikchr_studio','number',['string']);
function render(source){const p=native(source);try{const result=JSON.parse(module.UTF8ToString(p));assert.equal(result.error,null,source);return result;}finally{module._free(p);}}

test('multiline shape and standalone text creation, edit and movement use real native geometry',()=>{
  for(const kind of ['box','text']) {
    const source=createShape('',{objects:[]},{kind,label:'Top café\nSecond line',x:0,y:0,fit:true,color:'black',fill:'none'}).source;
    const scene=render(source),object=scene.objects[0];
    assert.equal(inspectProperties(source,object,scene).text,'Top café\nSecond line');
    assert.equal(object.kind,kind);
    const edited=changeText(source,object,scene,'First\nSecond\nThird');
    const result=render(edited.source);assert.equal(inspectProperties(edited.source,result.objects[0],result).text,'First\nSecond\nThird');
    const moved=candidates(source,object,scene,{x:2,y:-1});assert.ok(moved.length,JSON.stringify(object));
    assert.deepEqual(render(moved[0].source).objects[0].center,{x:2,y:-1});
  }
});

test('dimensions and hex styles remain draggable and keep attached connectors',()=>{
  const source='A: box "Title" "Subtitle" fit at (0,0)\nB: box at (4,0)\nL: arrow from A.e to B.w\n';
  const scene=render(source),object=scene.objects[0];
  const edited=changeAppearance(source,object,scene,{width:2,height:1,fill:'#f2f5fa',stroke:'#26384a',thickness:1.5});
  const result=render(edited.source),a=result.objects[0];
  assert.equal(a.bbox.width,2);assert.equal(a.bbox.height,1);
  assert.deepEqual(result.objects[2].path[0],a.anchors.e);
  assert.ok(candidates(edited.source,a,result,{x:1,y:1}).length);
  assert.equal(inspectProperties(edited.source,a,result).fill,'#f2f5fa');
  render(fitText(edited.source,a,result).source);
  const arrow=changeAppearance(edited.source,result.objects[2],result,{color:'#345678',thickness:2});
  const rs=render(arrow.source);assert.equal(endpointCandidates(arrow.source,rs.objects[2],rs,'to',rs.objects[1],'n').length,1);
});

test('dimension aliases stay editable without matching partial expressions',()=>{
  const source='A: box "wide" wid 1 ht 0.5 fill 0xeeeeee at (0,0)';
  const scene=render(source);
  const edited=changeAppearance(source,scene.objects[0],scene,{width:2,height:1});
  assert.equal(render(edited.source).objects[0].bbox.width,2);
  assert.ok(candidates(source,scene.objects[0],scene,{x:1,y:1}).length);
  const expression='A: box width (1+2) at (0,0)',rs=render(expression);
  assert.throws(()=>changeAppearance(expression,rs.objects[0],rs,{width:2}),/expression/);
  for(const size of ['1+2','1 + 2','1*2']) {
    const source=`A: box width ${size} at (0,0)`,scene=render(source);
    assert.throws(()=>changeAppearance(source,scene.objects[0],scene,{width:2}),/expression/);
  }
});

test('simple reference centers stay relative while complex placement remains read-only',()=>{
  const source='A: box at (1,1)\nB: text "title" at A.c';
  const scene=render(source),move=candidates(source,scene.objects[1],scene,{x:2,y:3})[0];
  assert.match(move.source,/with .c at A.c \+ \(1, 2\)/);
  assert.deepEqual(render(move.source).objects[1].center,{x:2,y:3});
  const complex='A: box at (0,0)\nB: box at A.c + (1+2,3)';
  const rs=render(complex);assert.equal(candidates(complex,rs.objects[1],rs,{x:1,y:1}).length,0);
});

test('duplicate preserves label style and dimensions with unique name and offset',()=>{
  const source='A: box "one" "two" width 2 height 1 fill 0xeeeeee at (0,0)\n';
  const scene=render(source),edit=duplicateObject(source,scene.objects[0],scene),result=render(edit.source);
  assert.equal(edit.selectName,'A2');assert.deepEqual(result.objects[1].center,{x:.4,y:-.4});
  assert.equal(result.objects[1].bbox.width,2);assert.match(edit.source,/A2: box "one" "two"/);
});

test('deletion requires explicit connected-line inclusion and rejects dependent shapes',()=>{
  const source='A: box at (0,0)\nB: box at (2,0)\nL: arrow from A.e to B.w\n';
  const scene=render(source);
  assert.throws(()=>deleteObjects(source,[scene.objects[0]],scene),/connects to this selection/);
  const edit=deleteObjects(source,[scene.objects[0]],scene,{includeConnectors:true});
  const result=render(edit.source);assert.equal(result.objects.length,1);assert.equal(result.objects[0].name,'B');
  const dependent='A: box at (0,0)\nB: box at A.c + (2,0)';const rs=render(dependent);
  assert.throws(()=>deleteObjects(dependent,[rs.objects[0]],rs,{includeConnectors:true}),/positioned relative/);
});

test('multi-object alignment distribution and equal dimensions compile atomically',()=>{
  const source='A: box at (0,0)\nB: box width 2 at (1,1)\nC: box at (4,-1)\n';
  const scene=render(source);
  for(const mode of ['align-x','align-y','distribute-x','distribute-y','equal-width','equal-height']) {
    const edit=layoutObjects(source,scene.objects,scene,mode),result=render(edit.source);
    assert.equal(result.objects.length,3);
    if(mode==='align-x')assert.ok(result.objects.every(o=>o.center.x===0));
    if(mode==='align-y')assert.ok(result.objects.every(o=>o.center.y===0));
    if(mode==='distribute-x')assert.equal(result.objects[1].center.x,2);
    if(mode==='equal-width')assert.ok(result.objects.every(o=>o.bbox.width===2));
  }
});

test('moving multiple shapes preserves all centers including selected relative references',()=>{
  for(const source of ['A: box at (0,0)\nB: box at (2,1)','A: box at (0,0)\nB: text "title" at A.c']) {
    const scene=render(source),edit=moveObjects(source,scene.objects,scene,2,-1),result=render(edit.source);
    scene.objects.forEach((object,index)=>assert.deepEqual(result.objects[index].center,{x:object.center.x+2,y:object.center.y-1}));
  }
});

test('deletion can pin dependent shapes in place so nothing else moves',()=>{
  const source='Client: box "Client" at (0,0)\nAPI: box "API" at (2,0)\nDatabase: cylinder "Database" with .n at 0.6 below API.s\narrow from Client.e to API.w\narrow from API.e to Database.w\n';
  const scene=render(source),api=scene.objects.find(o=>o.name==='API'),db=scene.objects.find(o=>o.name==='Database');
  assert.throws(()=>deleteObjects(source,[api],scene,{includeConnectors:true}),/positioned relative/);
  const edit=deleteObjects(source,[api],scene,{includeConnectors:true,pinDependents:true});
  assert.match(edit.label,/pin Database/);
  assert.doesNotMatch(edit.source,/\bAPI\b/);
  const result=render(edit.source),moved=result.objects.find(o=>o.name==='Database');
  assert.ok(Math.abs(moved.center.x-db.center.x)<1e-6&&Math.abs(moved.center.y-db.center.y)<1e-6,edit.source);
  assert.deepEqual(result.objects.map(o=>o.name).filter(Boolean),['Client','Database']);
  // Pinning a shape written as a center offset also works, and non-dependents are untouched.
  const offset='A: box at (0,0)\nB: box at A.c + (2,0)\nC: box at (5,0)\n';const os=render(offset);
  const e2=deleteObjects(offset,[os.objects[0]],os,{pinDependents:true});
  assert.match(e2.source,/^B: box at \(2, 0\)\nC: box at \(5,0\)\n$/);
});

test('group move skips attached connectors and dependents, moves free lines',()=>{
  const source='Q: oval "Q" at (0,0)\nYes: diamond "Yes" at (-1.7,-1.6)\nNo: diamond "No" with .w at 2.4 right of Yes.e\narrow from Q.sw to Yes.ne\nL: line from (3,1) to (4,1)\n';
  const scene=render(source);
  const edit=moveObjects(source,scene.objects,scene,1,0.5);
  const after=render(edit.source),c=n=>after.objects.find(o=>o.name===n).center,b=n=>scene.objects.find(o=>o.name===n).center;
  for(const n of ['Q','Yes','No']){assert.ok(Math.abs(c(n).x-b(n).x-1)<1e-9&&Math.abs(c(n).y-b(n).y-0.5)<1e-9,n+' '+edit.source);}
  assert.match(edit.source,/No: diamond "No" with \.w at 2\.4 right of Yes\.e/);  // follows Yes, link kept
  assert.match(edit.source,/arrow from Q\.sw to Yes\.ne/);                          // follows its shapes
  assert.match(edit.source,/L: line from \(4, 1\.5\) to \(5, 1\.5\)/);                 // free line translated
});

test('moving shapes pins unselected shapes positioned against them',()=>{
  const source='Client: box "Client" at (0,0)\nDatabase: cylinder "Database" with .c at Client.c + (3, -1)\nOther: box at (5,5)\narrow from Client.e to Database.w\n';
  const scene=render(source),client=scene.objects[0],db=scene.objects[1];
  const edit=moveObjects(source,[client],scene,1,1,{pinDependents:true});
  assert.match(edit.source,/Database: cylinder "Database" at \(3, -1\)/);
  assert.match(edit.label,/pin Database/);
  const after=render(edit.source);
  assert.deepEqual(after.objects[1].center,db.center);
  assert.equal(after.objects[0].center.x,1);
  // Without pinning the dependent follows its anchor, as Pikchr defines.
  const follow=moveObjects(source,[client],scene,1,1);
  assert.equal(render(follow.source).objects[1].center.x,db.center.x+1);
  // pinMove wraps a single-shape candidate the same way.
  const single=pinMove(source,scene,{label:'Place here',patch:candidates(source,client,scene,{x:1,y:1},{precise:true})[0].patch},[client.id]);
  assert.deepEqual(render(single.source).objects[1].center,db.center);
});

test('a free drop prefers a plain position over an arbitrary offset from a neighbour',()=>{
  const source='A: box at (0,0)\nB: box at (3,0)\n';
  const scene=render(source),b=scene.objects[1];
  const ranked=candidates(source,b,scene,{x:1.37,y:-1.83});
  assert.equal(ranked[0].label,'Place here');
  assert.ok(ranked.some(c=>c.label==='Position relative to A'),'the relation is still offered');
});
