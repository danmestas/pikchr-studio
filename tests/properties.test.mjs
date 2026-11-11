import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {inspectProperties,changeText,changeTermination,canFitText,fitText} from '../public/properties.js';
import {applyPatch,endpointCandidates,routeCandidates} from '../public/edits.js';
const publicDir=path.resolve(import.meta.dirname,'../public');
const context=vm.createContext({require:createRequire(import.meta.url),process,console,__dirname:publicDir,__filename:path.join(publicDir,'pikchr.js'),URL,TextDecoder,TextEncoder,setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir,'pikchr.js'),'utf8'),context);
const module=await context.initPikchrModule({locateFile:p=>path.join(publicDir,p)});
const native=module.cwrap('pikchr_studio','number',['string']);
function render(source){const pointer=native(source);try{return JSON.parse(module.UTF8ToString(pointer));}finally{module._free(pointer);}}
function fixture(statement){const source='# café 😀\r\nA: box at (0,0)\r\nB: box at (2,-1)\r\n'+statement+'\r\n# untouched\r\n';const scene=render(source);assert.equal(scene.error,null);return {source,scene,object:scene.objects.at(-1)};}

test('text editing preserves native types, styles, Unicode, placement and CRLF',()=>{
  for(const kind of ['box','cylinder','circle','ellipse','oval','diamond','file','line','arrow']){
    const statement=`C: ${kind} "old 😀" color blue `+(['line','arrow'].includes(kind)?'from A.e to (B.w,A.e) then to B.w':'at (4,-2)');
    const {source,object,scene}=fixture(statement);
    const edit=changeText(source,object,scene,'new café 🥳');
    assert.equal(edit.source,source.replace('old 😀','new café 🥳'));
    assert.equal(render(edit.source).error,null);
    assert.equal(inspectProperties(source,object,scene).text,'old 😀');
    assert.throws(()=>applyPatch(source+' ',edit.patch),/Source changed/);
  }
});
test('insert and clear one label; reject ambiguous or unsafe text',()=>{
  const {source,object,scene}=fixture('C: box at (4,0)');
  const edit=changeText(source,object,scene,'Hello');assert.equal(render(edit.source).error,null);
  assert.match(edit.source,/box "Hello" at/);
  for(const text of ['a\tb','a\u0000b'])assert.throws(()=>changeText(source,object,scene,text),/control characters/);
  // Quotes and backslashes are written escaped and read back exactly.
  const quoted=changeText(source,object,scene,'say "hi" C:\\dir\\');
  assert.match(quoted.source,/box "say \\"hi\\" C:\\\\dir\\\\" at/);
  const back=render(quoted.source);assert.equal(back.error,null);
  assert.equal(inspectProperties(quoted.source,back.objects.at(-1),back).text,'say "hi" C:\\dir\\');
  const two=fixture('C: box "one" "two"');assert.equal(inspectProperties(two.source,two.object,two.scene).text,'one\ntwo');
  const clear=fixture('C: box "old"');assert.match(changeText(clear.source,clear.object,clear.scene,'').source,/box ""/);
});
test('all native termination modes preserve route and remain endpoint-editable',()=>{
  for(const kind of ['arrow','line'])for(const existing of ['',' <-',' ->',' <->'])for(const mode of ['none','start','end','both']){
    const {source,object,scene}=fixture(`C: ${kind}${existing} "flow" from A.e to (B.w,A.e) then to B.w color blue`);
    const edit=changeTermination(source,object,scene,mode);
    const result=render(edit.source);assert.equal(result.error,null,edit.source);
    const changed=result.objects.at(-1);
    assert.equal(inspectProperties(edit.source,changed,result).termination,mode);
    assert.match(edit.source,/from A.e to \(B.w,A.e\) then to B.w color blue/);
    assert.equal(endpointCandidates(edit.source,changed,result,'to',result.objects[1],'n').length,1);
    assert.equal(routeCandidates(edit.source,changed,result,'straight').length,1);
  }
});
test('nested, macros, invalid spans, duplicate names and stale scene source rejected',()=>{
  for(const source of ['Group: [ C: box "x" ]','define shape { box "x" }\nC: shape']){
    const scene=render(source);for(const object of scene.objects)assert.throws(()=>inspectProperties(source,object,scene));
  }
  const {source,object,scene}=fixture('C: box "x"');
  assert.throws(()=>inspectProperties(source,object,{...scene,source:source+' '}));
  assert.throws(()=>inspectProperties(source,object,{objects:[...scene.objects,{name:'C'}]}));
  assert.throws(()=>inspectProperties(source,{...object,span:{start:1,end:999999}},scene));
});

test('fit to text grows all native shapes and preserves center, style and connected anchors',()=>{
  for(const kind of ['box','cylinder','circle','ellipse','oval','diamond']){
    const source=`A: ${kind} "The Node of the Day" width 0.5 height 0.4 color blue at (2,3)\nB: box at (5,3)\narrow from A.e to B.w\n`;
    const scene=render(source);assert.equal(scene.error,null);
    const object=scene.objects[0];assert.equal(canFitText(source,object,scene),true);
    const edit=fitText(source,object,scene), result=render(edit.source);
    assert.equal(result.error,null,edit.source);
    const fitted=result.objects[0];
    assert.ok(fitted.bbox.width>object.bbox.width,kind);
    assert.deepEqual(fitted.center,object.center);
    assert.match(edit.source,/color blue at \(2,3\) fit/);
    assert.doesNotMatch(edit.source,/width|height/);
    assert.match(edit.source,/arrow from A.e to B.w/);
    assert.deepEqual(result.objects[2].path[0],fitted.anchors.e);
  }
});
test('text updates can fit in one patch, preserve relative centers and remove existing fit and sizes',()=>{
  for(const kind of ['box','circle']){
    const {source,object,scene}=fixture(`C: ${kind} "old" radius 0.2 fit with .c at B.c + (1,2)`);
    const edit=changeText(source,object,scene,'The Node of the Day',{fit:true});
    const result=render(edit.source);assert.equal(result.error,null,edit.source);
    assert.deepEqual(result.objects.at(-1).center,object.center);
    assert.ok(result.objects.at(-1).bbox.width>object.bbox.width);
    assert.equal((edit.source.match(/\bfit\b/g)||[]).length,1);
    assert.doesNotMatch(edit.source,/radius|diameter/);
  }
  const empty=fixture('C: box at (4,0)');
  assert.equal(canFitText(empty.source,empty.object,empty.scene),true);
  assert.throws(()=>fitText(empty.source,empty.object,empty.scene),/Add a text label/);
  const edit=changeText(empty.source,empty.object,empty.scene,'A long first label',{fit:true});
  assert.equal(render(edit.source).error,null);
  assert.match(edit.source,/fit/);
});
test('explicit fit opt-out preserves a previously fitted shape size',()=>{
  for(const kind of ['box','cylinder','circle','ellipse','oval','diamond']){
    const {source,object,scene}=fixture(`C: ${kind} "The Node of the Day" fit at (4,0)`);
    const edit=changeText(source,object,scene,'Short',{fit:false});
    const result=render(edit.source);assert.equal(result.error,null,edit.source);
    const changed=result.objects.at(-1);
    assert.doesNotMatch(edit.source,/\bfit\b/);
    for(const dimension of ['width','height'])assert.ok(Math.abs(changed.bbox[dimension]-object.bbox[dimension])<1e-9,kind+' '+dimension);
    assert.deepEqual(changed.center,object.center);
    assert.match(changeText(source,object,scene,'Short').source,/\bfit\b/,'default API remains unchanged');
  }
});
test('fit capability rejects connectors, ambiguous labels and unsafe dimension expressions',()=>{
  for(const statement of ['C: arrow from A.e to B.w','C: box "one" above "two" at (4,0)','C: box "text" width (2+1) at (4,0)','C: box "text" with .w at B.e']){
    const {source,object,scene}=fixture(statement);
    assert.equal(canFitText(source,object,scene),false,statement);
    assert.throws(()=>fitText(source,object,scene),undefined,statement);
  }
});
test('fit removes complete literal dimensions including percentages, units and trailing decimals',()=>{
  for(const size of ['50%','1.','5mm','0.5in','12px','12pt']){
    const {source,object,scene}=fixture(`C: box "The Node of the Day" width ${size} at (4,0)`);
    const edit=fitText(source,object,scene),result=render(edit.source);
    assert.equal(result.error,null,edit.source);
    assert.doesNotMatch(edit.source,/\bwidth\b/);
    assert.equal(fitText(edit.source,result.objects.at(-1),result).source,edit.source);
  }
});
test('each line keeps the style of the string it replaces; added lines take the last one',()=>{
  const {source,object,scene}=fixture('C: box "one" bold "two" italic below at (4,0)');
  assert.match(changeText(source,object,scene,'ONE\ntwo').source,/C: box "ONE" bold "two" italic below at/);
  assert.match(changeText(source,object,scene,'a\nb\nc').source,/C: box "a" bold "b" italic below "c" italic below at/);
  assert.match(changeText(source,object,scene,'only').source,/C: box "only" bold at/);
  const spline=fixture('spline from A.e to B.w "x" above');
  const edit=changeText(spline.source,spline.object,spline.scene,'y');
  assert.match(edit.source,/spline from A.e to B.w "y" above/);assert.equal(render(edit.source).error,null);
});
test('a fitted shape keeps its fit when its placement is an expression',()=>{
  const {source,object,scene}=fixture('C: box "old" fit at (A.x + 2, A.y)');
  const edit=changeText(source,object,scene,'A much longer label',{fit:true});
  assert.match(edit.source,/C: box "A much longer label" fit at \(A.x \+ 2, A.y\)/);
  const result=render(edit.source);assert.equal(result.error,null);
  assert.deepEqual(result.objects.at(-1).center,object.center);
  assert.ok(result.objects.at(-1).bbox.width>object.bbox.width);
});
test('a fitted text object keeps its fit when its text changes',()=>{
  const {source,object,scene}=fixture('T: text "old" fit at (4,0)');
  const edit=changeText(source,object,scene,'',{fit:false});
  assert.match(edit.source,/T: text "" fit at \(4,0\)/);assert.equal(render(edit.source).error,null);
});
test('a monospace label can grow to fit',()=>{
  const {source,object,scene}=fixture('C: box "code" mono big at (4,0)');
  const edit=changeText(source,object,scene,'longer code',{fit:true});
  assert.match(edit.source,/C: box "longer code" mono big at \(4,0\) fit/);assert.equal(render(edit.source).error,null);
});
test('lines the author did not edit keep their source text, unknown escapes included',()=>{
  const {source,object,scene}=fixture('C: box "a\\tb" bold "two" at (4,0)');
  assert.equal(inspectProperties(source,object,scene).text,'atb\ntwo');
  const edit=changeText(source,object,scene,'atb\nTWO');
  assert.match(edit.source,/C: box "a\\tb" bold "TWO" at/);
  assert.equal(changeText(source,object,scene,'atb\ntwo').source,source);
});
