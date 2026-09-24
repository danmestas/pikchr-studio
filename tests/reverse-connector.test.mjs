import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {reverseConnector} from '../public/reverse-connector.js';
import {applyPatch,routeCandidates} from '../public/edits.js';
import {inspectProperties} from '../public/properties.js';
const publicDir=path.resolve(import.meta.dirname,'../public');
const context=vm.createContext({require:createRequire(import.meta.url),process,console,__dirname:publicDir,__filename:path.join(publicDir,'pikchr.js'),URL,TextDecoder,TextEncoder,setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir,'pikchr.js'),'utf8'),context);
const module=await context.initPikchrModule({locateFile:p=>path.join(publicDir,p)});
const native=module.cwrap('pikchr_studio','number',['string']);
function render(source){const p=native(source);try{const result=JSON.parse(module.UTF8ToString(p));assert.equal(result.error,null,source);return result;}finally{module._free(p);}}
const prefix='# Unicode 😀\r\nA: box at (0,0)\r\nB: box at (4,2)\r\n';

test('reverse retains text, style and each termination mode while swapping endpoint references',()=>{
  for(const [kind,flag,mode]of [['arrow','','end'],['line','','none'],['arrow','<->','both'],['line','<-','start']]){
    const source=prefix+`L: ${kind} ${flag} "café from A.e to B.w" from A.e to B.w color blue dashed\r\n`;
    const scene=render(source),object=scene.objects[2],option=reverseConnector(source,scene,object);
    assert.equal(applyPatch(source,option.patch),option.source);assert.equal(option.selectName,'L');
    assert.equal(option.patch.expected,'from A.e to B.w');assert.equal(option.patch.text,'from B.w to A.e');
    assert.ok(option.source.startsWith(prefix));assert.ok(option.source.endsWith(' color blue dashed\r\n'));
    const result=render(option.source);assert.equal(inspectProperties(option.source,result.objects[2],result).termination,mode);
    assert.equal(inspectProperties(option.source,result.objects[2],result).text,'café from A.e to B.w');
    assert.equal(reverseConnector(option.source,result,result.objects[2]).source,source);
  }
});

test('all Studio route modes reverse ordered bend expressions and remain editable',()=>{
  const source=prefix+'L: arrow from A.e to B.w';
  const scene=render(source);
  for(const mode of ['straight','horizontal','vertical','via','via-x','via-y']){
    const routed=routeCandidates(source,scene.objects[2],scene,mode,{x:2,y:3})[0];
    const before=render(routed.source),option=reverseConnector(routed.source,before,before.objects[2]),after=render(option.source);
    assert.match(option.patch.text,/^from B.w to /);assert.match(option.patch.text,/to A.e$/);
    assert.ok(routeCandidates(option.source,after.objects[2],after,'straight').length);
    assert.equal(reverseConnector(option.source,after,after.objects[2]).source,routed.source);
  }
  const bends=prefix+'line from A.e to (1, 3) then to (3, 3) then to B.w',before=render(bends);
  const reversed=reverseConnector(bends,before,before.objects[2]);render(reversed.source);
  assert.equal(reversed.patch.text,'from B.w to (3, 3) then to (1, 3) then to A.e');
  assert.equal(reversed.selectId,before.objects[2].id);assert.equal(reversed.targetKind,'line');
});

test('unsupported expressions, groups, macros and stale sources fail closed',()=>{
  for(const source of [prefix+'L: arrow from A.e right 1 then to B.w','G: [ A: box; arrow; B: box ]',prefix+'define link { arrow from A.e to B.w }\nlink']){
    const scene=render(source),object=scene.objects.find(o=>o.kind==='arrow');assert.throws(()=>reverseConnector(source,scene,object));
  }
  const source=prefix+'L: arrow from A.e to B.w',scene=render(source);
  assert.throws(()=>reverseConnector(source,scene,scene.objects[0]));
  const option=reverseConnector(source,scene,scene.objects[2]);assert.throws(()=>applyPatch(source+' ',option.patch),/Source changed/);
});
