import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createConnectedNeighbor,resizeShape} from '../public/canvas-operations.js';
import {applyPatch} from '../public/edits.js';
const publicDir=path.resolve(import.meta.dirname,'../public');
const context=vm.createContext({require:createRequire(import.meta.url),process,console,__dirname:publicDir,__filename:path.join(publicDir,'pikchr.js'),URL,TextDecoder,TextEncoder,setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir,'pikchr.js'),'utf8'),context);
const module=await context.initPikchrModule({locateFile:p=>path.join(publicDir,p)});
const native=module.cwrap('pikchr_studio','number',['string']);
function render(source){const p=native(source);try{const result=JSON.parse(module.UTF8ToString(p));assert.equal(result.error,null,source);return result;}finally{module._free(p);}}

test('connected neighbors preserve source and produce one atomic native node and edge in all directions',()=>{
  const source='# café 😀\r\nA: box "Start" width 1 height 0.5 at (0,0)\r\n# Shape1 Link1 reserved\r\n';
  const scene=render(source),object=scene.objects[0];
  for(const [direction,anchor,end,axis,sign] of [['right','e','w','x',1],['left','w','e','x',-1],['up','n','s','y',1],['down','s','n','y',-1]]){
    const option=createConnectedNeighbor(source,scene,object,{direction,type:'cylinder',label:'Next café',gap:0.5});
    assert.ok(option.source.startsWith(source));assert.equal(option.selectName,'Shape2');
    assert.equal(applyPatch(source,option.patch),option.source);
    assert.match(option.source,new RegExp(`Link2: arrow from A\\.${anchor} to Shape2\\.${end}\\r\\n$`));
    const result=render(option.source),shape=result.objects[1],arrow=result.objects[2];
    assert.equal(result.objects.length,3);
    assert.equal(shape.center[axis],sign*((axis==='x'?1:0.5)+0.5));
    assert.deepEqual(arrow.path[0],result.objects[0].anchors[anchor]);
    // Native path stops just before the arrowhead tip at the target anchor.
    assert.ok(Math.hypot(arrow.path.at(-1).x-shape.anchors[end].x,arrow.path.at(-1).y-shape.anchors[end].y)<0.1);
    assert.throws(()=>applyPatch(source+' ',option.patch),/Source changed/);
  }
});

test('resize preserves label, style, center and dependent connector endpoints',()=>{
  const source='# 😀\nA: box "width 20 fit" fit fill blue at (0,0)\nB: box at (4,0)\nL: arrow from A.e to B.w\n';
  const scene=render(source),option=resizeShape(source,scene,scene.objects[0],{width:2,height:1});
  const result=render(option.source),a=result.objects[0];
  assert.equal(a.bbox.width,2);assert.equal(a.bbox.height,1);assert.deepEqual(a.center,{x:0,y:0});
  assert.match(option.source,/"width 20 fit"/);assert.match(option.source,/fill blue/);
  assert.ok(option.source.endsWith('B: box at (4,0)\nL: arrow from A.e to B.w\n'));
  assert.deepEqual(result.objects[2].path[0],a.anchors.e);
});

test('resize supports native shapes, literal units, uniform circles and center-preserving relative placement',()=>{
  for(const kind of ['box','cylinder','circle','ellipse','oval','diamond']){
    const source=`A: box at (1,1)\nB: ${kind} "B" width 2cm height 1cm with .c at A.c + (2,0)`;
    const scene=render(source),option=resizeShape(source,scene,scene.objects[1],{width:2,height:1});
    const result=render(option.source),b=result.objects[1];
    assert.equal(b.bbox.width,2);assert.equal(b.bbox.height,kind==='circle'?2:1);
    assert.deepEqual(b.center,{x:3,y:1});assert.match(option.source,/with \.c at A\.c \+ \(2,0\)/);
  }
  const source='A: box at (0,0)\nB: circle radius 1 at A.c';
  const scene=render(source),option=resizeShape(source,scene,scene.objects[1],{width:3,height:2,center:{x:4,y:5}});
  const b=render(option.source).objects[1];assert.equal(b.bbox.width,3);assert.equal(b.bbox.height,3);assert.deepEqual(b.center,{x:4,y:5});
});

test('invalid sizes, expressions, stale sources and unsupported objects fail without a patch',()=>{
  for(const statement of ['A: box width (1+1) at (0,0)','A: box width 1+1 at (0,0)','A: box width 1 + 1 at (0,0)','A: box width 1 +1 at (0,0)','A: box']){
    const scene=render(statement);assert.throws(()=>resizeShape(statement,scene,scene.objects[0],{width:2,height:1}));
  }
  const source='A: box at (0,0)',scene=render(source),a=scene.objects[0];
  for(const width of [0,0.09,101,NaN,Infinity]) assert.throws(()=>resizeShape(source,scene,a,{width,height:1}));
  assert.throws(()=>resizeShape(source,scene,a,{width:1,height:1,center:{x:Infinity,y:0}}));
  assert.throws(()=>createConnectedNeighbor(source,scene,a,{gap:0}));
  assert.throws(()=>createConnectedNeighbor(source,scene,a,{direction:'diagonal'}));
  assert.throws(()=>createConnectedNeighbor(source,scene,a,{type:'triangle'}));
  assert.throws(()=>resizeShape('B: box at (0,0)',scene,a,{width:1,height:1}));
  a.depth=1;assert.throws(()=>resizeShape(source,scene,a,{width:1,height:1}));
  assert.throws(()=>createConnectedNeighbor(source,scene,a));
});

test('resizing a shape attached to another keeps the attachment and grows around it',()=>{
  const source='API: box "API" at (2,0)\nDatabase: cylinder "Database" with .n at 0.6 below API.s\n';
  const scene=render(source),db=scene.objects[1];
  const option=resizeShape(source,scene,db,{width:1.5,height:1,center:{x:9,y:9}});
  assert.match(option.source,/Database: cylinder "Database" with \.n at 0\.6 below API\.s width 1\.5 height 1/);
  const result=render(option.source),after=result.objects[1];
  assert.ok(Math.abs(after.anchors.n.y-db.anchors.n.y)<1e-9,'north edge stays attached');
  assert.equal(after.bbox.width,1.5);
});
