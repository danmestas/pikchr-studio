import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {copySelection,pasteSelection} from '../public/subgraph.js';
import {applyPatch} from '../public/edits.js';
const publicDir=path.resolve(import.meta.dirname,'../public');
const context=vm.createContext({require:createRequire(import.meta.url),process,console,__dirname:publicDir,__filename:path.join(publicDir,'pikchr.js'),URL,TextDecoder,TextEncoder,setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir,'pikchr.js'),'utf8'),context);
const module=await context.initPikchrModule({locateFile:p=>path.join(publicDir,p)});
const native=module.cwrap('pikchr_studio','number',['string']);
function render(source){const p=native(source);try{const result=JSON.parse(module.UTF8ToString(p));assert.equal(result.error,null,source);return result;}finally{module._free(p);}}
const source='# café 😀\r\nA: box "A (1,2) café" at (0,0)\r\nB: box "B" with .c at A.c + (3,0)\r\nC: box at (6,0)\r\nL: arrow from A.e to (1.5, 1) then to B.w\r\nOut: arrow from B.e to C.w\r\n';

test('copy auto-includes internal edges, reports outgoing edges, and pastes one atomic remapped subgraph',()=>{
  const scene=render(source),fragment=copySelection(source,scene,scene.objects.slice(0,2).map(o=>o.id));
  assert.deepEqual(fragment.objects.map(o=>o.name),['A','B','L']);assert.deepEqual(fragment.omittedEdges,['Out']);
  const candidate=pasteSelection(source,scene,JSON.parse(JSON.stringify(fragment)),{dx:1,dy:-2});
  assert.ok(candidate.source.startsWith(source));assert.equal(applyPatch(source,candidate.patch),candidate.source);
  assert.deepEqual(candidate.selectionNames,['A2','B2']);assert.match(candidate.source,/"A \(1,2\) café"/);
  assert.match(candidate.source,/B2: box "B" with \.c at A2\.c \+ \(3,0\)/);
  assert.match(candidate.source,/L2: arrow from A2.e to \(2.5, -1\) then to B2.w/);
  const result=render(candidate.source),a=result.objects.find(o=>o.name==='A2'),b=result.objects.find(o=>o.name==='B2');
  assert.deepEqual(a.center,{x:1,y:-2});assert.deepEqual(b.center,{x:4,y:-2});
  assert.throws(()=>applyPatch(source+' ',candidate.patch),/Source changed/);
});

test('repeated paste avoids reserved names and preserves internal references',()=>{
  const scene=render(source),fragment=copySelection(source,scene,scene.objects.slice(0,2).map(o=>o.id));
  const first=pasteSelection(source,scene,fragment);
  const second=pasteSelection(first.source,render(first.source),fragment);
  assert.deepEqual(second.selectionNames,['A3','B3']);assert.match(second.source,/B3: box "B" with \.c at A3\.c/);render(second.source);
});

test('external dependencies, unnamed objects, expressions, groups and forged fragments fail closed',()=>{
  const scene=render(source);
  assert.throws(()=>copySelection(source,scene,[scene.objects[1].id]),/unselected/);
  assert.throws(()=>copySelection(source,scene,[scene.objects[0].id,scene.objects[3].id]),/unselected/);
  for(const text of ['box at (0,0)','A: box width (1+1) at (0,0)','A: box width 1 +1 at (0,0)','[ A: box at (0,0) ]']) {
    const result=render(text);assert.throws(()=>copySelection(text,result,result.objects.map(o=>o.id)));
  }
  const fragment=copySelection(source,scene,[scene.objects[0].id]);
  const forged=JSON.parse(JSON.stringify(fragment));forged.objects[0].statement='A: box at Missing.c';
  assert.throws(()=>pasteSelection(source,scene,forged));
  assert.throws(()=>pasteSelection(source,scene,fragment,{dx:Infinity}));
  assert.throws(()=>pasteSelection('box \\',scene,fragment),/continued/);
  assert.throws(()=>copySelection(source,scene,[]));
});

test('reference elbows move with the copied endpoints',()=>{
  const source='A: box at (0,0)\nB: box at (3,2)\nL: arrow from A.e to (B.w,A.e) then to B.w';
  const scene=render(source),fragment=copySelection(source,scene,scene.objects.slice(0,2).map(o=>o.id));
  const candidate=pasteSelection('',{objects:[]},fragment,{dx:2,dy:3});
  assert.match(candidate.source,/to \(B.w,A.e\)/);const result=render(candidate.source);
  assert.deepEqual(result.objects[0].center,{x:2,y:3});assert.deepEqual(result.objects[1].center,{x:5,y:5});
});

test('default pipeline copies all three shapes and both unnamed internal arrows without changing original source',()=>{
  const source='Client: box "Client" at (0,0)\nAPI: box "API" at (2,0)\nDatabase: cylinder "Database" at (4,0)\narrow from Client.e to API.w\narrow from API.e to Database.w\n';
  const scene=render(source),before=JSON.stringify(scene),fragment=copySelection(source,scene,scene.objects.slice(0,3).map(o=>o.id));
  assert.equal(fragment.objects.length,5);assert.deepEqual(fragment.omittedEdges,[]);
  assert.deepEqual(fragment.objects.slice(3).map(o=>o.name),['CopiedLink1','CopiedLink2']);
  assert.equal(JSON.stringify(scene),before);assert.equal(scene.objects[3].name,'');
  const option=pasteSelection(source,scene,fragment),result=render(option.source);
  assert.ok(option.source.startsWith(source));assert.equal(result.objects.length,10);
  assert.match(option.source,/CopiedLink1: arrow from Client2.e to API2.w/);
  assert.match(option.source,/CopiedLink2: arrow from API2.e to Database2.w/);
  const repeated=pasteSelection(option.source,result,fragment);render(repeated.source);
  assert.match(repeated.source,/CopiedLink12: arrow from Client3.e to API3.w/);
});

test('synthetic arrow names avoid existing identifiers and still reject external endpoints',()=>{
  const source='# CopiedLink1 reserved\nA: box at (0,0)\nB: box at (3,0)\narrow from A.e to B.w';
  const scene=render(source),fragment=copySelection(source,scene,scene.objects.slice(0,2).map(o=>o.id));
  assert.equal(fragment.objects[2].name,'CopiedLink2');render(pasteSelection('',{objects:[]},fragment).source);
  assert.throws(()=>copySelection(source,scene,[scene.objects[0].id,scene.objects[2].id]),/unselected/);
});
