import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSvg} from './pikchr-wasm.mjs';
import {createShape, createConnector, changeShape, shapeKinds,connectableShapes,repeatPosition,repeatShape} from '../public/creation.js';
import {applyPatch} from '../public/edits.js';

const bytes = text => new TextEncoder().encode(text).length;
function compile(source) {
  const result = compileSvg(source);
  assert.equal(result.status, 0, result.stdout);
}
function fixture(statement = 'A: box "café 😀" fill blue at (0, 0)') {
  const prefix = '# Unicode 😀\r\n';
  const second = 'B: cylinder "DB" at (3, 0)';
  const source = prefix + statement + '\r\n' + second + '\r\n';
  const a = {id:'o1', name:'A', kind:'box', span:{start:bytes(prefix), end:bytes(prefix + statement)}};
  const b = {id:'o2', name:'B', kind:'cylinder', span:{start:bytes(prefix + statement + '\r\n'), end:bytes(source.trimEnd())}};
  return {source, a, b, scene:{objects:[a,b]}};
}

test('creation compiles every native shape and preserves Unicode and CRLF', () => {
  for (const kind of shapeKinds) {
    const {source,scene} = fixture();
    const candidate = createShape(source,scene,{kind,label:'New café 😀',x:2,y:-1});
    assert.ok(candidate.source.startsWith(source));
    assert.ok(candidate.source.endsWith(`${kind === 'text' ? 'T1' : 'Shape1'}: ${kind} "New café 😀" at (2, -1)\r\n`));
    assert.equal(applyPatch(source,candidate.patch),candidate.source);
    assert.equal(candidate.selectName,kind==='text'?'T1':'Shape1');
    assert.throws(()=>applyPatch(source+' ',candidate.patch),/Source changed/);
    compile(candidate.source);
  }
});

test('new names cannot shadow references, declarations, macro names, or scene names', () => {
  const source = '# Shape1: reserved\n# define Shape2\nShape3: box\n';
  const candidate = createShape(source,{objects:[{name:'Shape4'}]},{kind:'box',x:0,y:0});
  assert.equal(candidate.selectName,'Shape5');
  assert.match(candidate.source,/Shape5: box at \(0, 0\)\n$/);
  compile(candidate.source);
});

test('repeat placement preserves a lane and validates offsets',()=>{
  assert.deepEqual(repeatPosition({x:3.9,y:-2},0,-1),{x:3.9,y:-3});
  assert.deepEqual(repeatPosition({x:0,y:2},1.25,0),{x:1.25,y:2});
  assert.throws(()=>repeatPosition({x:0,y:0},0,0),/nonzero/);
  assert.throws(()=>repeatPosition({x:0,y:0},Infinity,0));
  assert.throws(()=>repeatPosition({x:1000000,y:0},1,0),/Position/);
});

test('repeated shapes keep a stable name base and skip reserved names',()=>{
  let source='Shape1: circle "Commit" width 0.35 height 0.35 fill blue at (0, 0)\n';
  const objects=[];
  for(let i=1;i<=4;i++){
    const statement=source.trimEnd().split('\n').at(-1),start=source.lastIndexOf(statement);
    const object={id:'o'+i,name:'Shape'+i,kind:'circle',center:{x:0,y:1-i},span:{start:bytes(source.slice(0,start)),end:bytes(source.slice(0,start+statement.length))}};
    objects.push(object);
    const next=repeatShape(source,object,{objects});
    assert.equal(next.selectName,'Shape'+(i+1));
    assert.match(next.patch.text,/circle "Commit" width 0.35 height 0.35 fill blue/);
    assert.match(next.patch.text,new RegExp(`at \\(0, -${i}\\)`));
    compile(next.source);source=next.source;
  }
  const next=repeatShape(source+'# Shape6 reserved\n',objects.at(-1),{objects});
  assert.equal(next.selectName,'Shape7');
});

test('endpoint choices omit text by default but preserve explicit text support',()=>{
  const f=fixture('A: text "Heading" at (0, 0)');f.a.kind='text';
  assert.deepEqual(connectableShapes(f.source,f.scene).map(o=>o.name),['B']);
  assert.deepEqual(connectableShapes(f.source,f.scene,{includeText:true}).map(o=>o.name),['A','B']);
  compile(createConnector(f.source,f.scene,{fromId:'o1',toId:'o2',fromAnchor:'e',toAnchor:'w'}).source);
});

test('new statement safely follows an unterminated comment or empty document', () => {
  compile(createShape('# trailing comment',{}, {kind:'box',x:0,y:0}).source);
  compile(createShape('',{}, {kind:'box',x:0,y:0}).source);
  assert.throws(()=>createShape('box \\',{}, {kind:'box',x:0,y:0}),/continued/);
});

test('invalid shape, labels, and coordinates are rejected before producing a patch', () => {
  for (const label of ['quote"','slash\\','tab\t','\x00']) assert.throws(()=>createShape('',{}, {kind:'box',label,x:0,y:0}),/plain text/);
  for (const x of [NaN,Infinity,1e21,undefined]) assert.throws(()=>createShape('',{}, {kind:'box',x,y:0}),/Position/);
  assert.throws(()=>createShape('',{}, {kind:'triangle',x:0,y:0}),/supported/);
});

test('connectors compile for every anchor and preserve named references', () => {
  const {source,scene}=fixture();
  for (const kind of ['arrow','line']) for (const anchor of ['n','ne','e','se','s','sw','w','nw','c']) {
    const candidate = createConnector(source,scene,{fromId:'o1',toId:'o2',fromAnchor:anchor,toAnchor:'w',kind});
    assert.equal(candidate.selectName,'Link1');
    assert.ok(candidate.source.startsWith(source));
    assert.ok(candidate.source.includes(`Link1: ${kind} from A.${anchor} to B.w`));
    compile(candidate.source);
  }
});

test('connector creation rejects missing, nested, macro, duplicate, stale, and invalid targets', () => {
  const options={fromId:'o1',toId:'o2',fromAnchor:'e',toAnchor:'w'};
  for (const mutate of [f=>f.a.depth=1,f=>f.a.reason='macro expansion',f=>f.scene.objects.push({...f.a,id:'duplicate'}),f=>f.a.name='Missing',f=>f.a.span.end=99999]) {
    const f=fixture();mutate(f);
    assert.throws(()=>createConnector(f.source,f.scene,options));
  }
  const f=fixture();
  for (const extra of [{fromId:'absent'},{fromAnchor:'north'},{kind:'spline'},{toId:'o1'}]) assert.throws(()=>createConnector(f.source,f.scene,{...options,...extra}));
});

test('shape conversion changes only its primitive keyword and compiles every native kind', () => {
  const f=fixture();
  for (const kind of shapeKinds) {
    const candidate=changeShape(f.source,f.a,f.scene,kind);
    assert.equal(candidate.source,f.source.replace('A: box','A: '+kind));
    assert.equal(candidate.patch.expected,'box');
    assert.equal(candidate.selectName,'A');
    compile(candidate.source);
  }
});

test('shape conversion refuses implicit placement, expressions, nesting, and macros', () => {
  for (const statement of ['A: box "at (0,0)"','A: box at (x,y)','A: box width size at (0,0)','A: box with .n at (0,0)','A: box at (0,0); box']) {
    const f=fixture(statement);
    assert.throws(()=>changeShape(f.source,f.a,f.scene,'circle'));
  }
  for (const field of ['macro','studioMacro','parent']) {
    const f=fixture();f.a[field]=true;
    assert.throws(()=>changeShape(f.source,f.a,f.scene,'circle'));
  }
});
