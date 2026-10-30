import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudio} from './pikchr-wasm.mjs';
import {endpointCandidates,applyPatch} from '../public/edits.js';

const prefix = 'Client: box "Client" at (0,0)\nAPI: box "API" at (2,0)\nDatabase: cylinder "Database" at (4,0)\n';
function setup({route='arrow from Client.e to API.w',between='arrow from API.e to Database.w\n',target='Shape1: box "café 😀" at (2,-2)',after=''}={}) {
  const source=prefix+route+'\n'+between+target+'\n'+after;
  const {scene,status}=compileStudio(source);
  assert.equal(status,0,scene.error);
  return {source,scene,object:scene.objects.find(o=>o.span.start===Buffer.byteLength(prefix)),target:scene.objects.find(o=>o.name==='Shape1')};
}
function candidate(f,endpoint='to',anchor='n') {
  return endpointCandidates(f.source,f.object,f.scene,endpoint,f.target,anchor)[0];
}
function unchangedGeometry(before,after,edited,editedId) {
  assert.equal(after.objects.length,before.objects.length);
  const identity = o=>o.name || `${o.kind}:${JSON.stringify(o.path)}`;
  assert.deepEqual(after.objects.filter(o=>o.id!==editedId).map(identity),before.objects.filter(o=>o!==edited).map(identity),'all unrelated objects keep painter order');
  const remaining=after.objects.filter(o=>o.id!==editedId);
  // Sequential ids change; match unchanged objects by name or path.
  for(const old of before.objects.filter(o=>o!==edited)) {
    const next=old.name ? after.objects.find(o=>o.name===old.name) : remaining.find(o=>JSON.stringify(o.path)===JSON.stringify(old.path));
    assert.ok(next,old.name||old.kind);
    for(const field of ['center','bbox','anchors','path']) assert.deepEqual(next[field],old[field],`${old.name||old.kind}.${field}`);
  }
}
test('later named shapes support both endpoints and all anchors without unrelated geometry changes',()=>{
  for(const endpoint of ['from','to']) for(const anchor of ['c','n','s','e','w','ne','nw','se','sw']) {
    const f=setup();const option=candidate(f,endpoint,anchor);assert.ok(option,`${endpoint}.${anchor}`);
    assert.equal(applyPatch(f.source,option.patch),option.source);
    assert.equal(option.selectId,f.target.id);
    assert.equal(Object.hasOwn(option,'preservePaintOrder'),false);
    assert.throws(()=>applyPatch(f.source+' ',option.patch),/Source changed/);
    assert.ok(option.source.indexOf('Shape1:')<option.source.indexOf(`${endpoint==='from'?'arrow from Shape1.':'arrow from Client.e'}`));
    assert.ok(option.source.includes('"café 😀" at (2,-2)'));
    const result=compileStudio(option.source);assert.equal(result.status,0,result.scene.error);
    unchangedGeometry(f.scene,result.scene,f.object,option.selectId);
    const link=result.scene.objects.find(o=>o.id===option.selectId);
    const tip=link.path[endpoint==='from'?0:link.path.length-1], point=f.target.anchors[anchor];
    assert.ok(Math.hypot(tip.x-point.x,tip.y-point.y)<0.05,'rendered arrowhead ends just short of its anchor');
    assert.ok(option.source.includes(`${endpoint} Shape1.${anchor}`));
  }
});
test('explicit relative placements and dependents retain their geometry and source expressions',()=>{
  const f=setup({target:'Shape1: box "Later" with .n at 1 below API.s',after:'Child: circle at Shape1.c + (2,0)\n'});
  const option=candidate(f);assert.ok(option);
  assert.ok(option.source.includes('Shape1: box "Later" with .n at 1 below API.s'));
  assert.ok(option.source.endsWith('Child: circle at Shape1.c + (2,0)\n'));
  unchangedGeometry(f.scene,compileStudio(option.source).scene,f.object,option.selectId);
});
test('literal bends and route styling survive later endpoint reconnection',()=>{
  const f=setup({route:'Link: arrow "route" from Client.e to (1,-1) then to API.w dashed color blue'});
  const option=candidate(f);assert.ok(option);
  assert.match(option.source,/Link: arrow "route" from Client\.e to \(1,\s*-1\) then to Shape1\.n dashed color blue/);
  const result=compileStudio(option.source);assert.equal(result.status,0,result.scene.error);
  unchangedGeometry(f.scene,result.scene,f.object,option.selectId);
  assert.deepEqual(result.scene.objects.find(o=>o.name==='Link').path[1],f.object.path[1]);
});
test('unsafe declaration-order dependencies are refused rather than silently changing meaning',()=>{
  for(const options of [
    {target:'Shape1: box "implicit"'},
    {target:'Shape1: box at last arrow.end'},
    {after:'box\n'},
    {after:'Child: circle at last box.c\n'},
    {after:'Child: circle at 1st arrow.end\n'},
    {after:'Alias: Client\n'},
    {after:'Child: box same\n'},
    {after:'LinkDependent: circle at Link.c\n',route:'Link: arrow from Client.e to API.w'},
    {after:'box at (6,0)\n'},
    {between:'right\narrow from API.e to Database.w\n'},
    {between:'boxwid = 2\narrow from API.e to Database.w\n'},
    {after:'define draw { box }\ndraw\n'},
  ]) {
    const f=setup(options);assert.equal(candidate(f),undefined,JSON.stringify(options));
  }
});
test('overlapping filled later targets keep their original painter order against unrelated connectors',()=>{
  const f=setup({route:'Edited: arrow from Client.e to API.w',between:'Unrelated: arrow from API.e to Database.w color red\n',target:'Shape1: box "T" fill white at (3,0)'});
  const option=candidate(f,'to','c');assert.ok(option);
  const result=compileStudio(option.source);assert.equal(result.status,0,result.scene.error);
  unchangedGeometry(f.scene,result.scene,f.object,option.selectId);
  const north=candidate(f,'to','n');assert.ok(north);
  unchangedGeometry(f.scene,compileStudio(north.source).scene,f.object,north.selectId);
  assert.ok(option.source.indexOf('Unrelated:')<option.source.indexOf('Shape1:'));
  const ids=result.scene.objects.filter(o=>o.name!=='Edited').map(o=>o.id);
  const groups=[...result.scene.svg.matchAll(/<g data-pikchr-id="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(groups.filter(id=>id!==option.selectId),ids,'SVG draws every unrelated object in its original order');
  const painted = (svg,editedId)=>[...svg.matchAll(/<g data-pikchr-id="([^"]+)">([\s\S]*?)<\/g>/g)].filter(m=>m[1]!==editedId).map(m=>m[2]);
  assert.deepEqual(painted(result.scene.svg,option.selectId),painted(f.scene.svg,f.object.id),'unrelated SVG paint stays byte-identical');
});

test('moving named and anonymous connector lines preserves nested prefixes, comments and UTF-8 spans',()=>{
  for(const header of ['arrow','Link: line']) for(const newline of ['\n','\r\n']) {
    const leading='# café 😀\nGroup: [ Inner: box "nested" at (-3,0) ]\n';
    const route=`  ${header} "label 😀" from Client.e to API.w color blue # connector comment\n`;
    const target='Shape1: box "T" at (3,-2) # target comment\n';
    const source=(leading+prefix+route+'# unchanged divider\narrow from API.e to Database.w\n'+target+'Child: circle at Shape1.c + (2,0)\n').replaceAll('\n',newline);
    const {scene,status}=compileStudio(source);assert.equal(status,0,scene.error);
    const object=scene.objects.find(o=>['arrow','line'].includes(o.kind));
    const later=scene.objects.find(o=>o.name==='Shape1');
    const [option]=endpointCandidates(source,object,scene,'to',later,'n');assert.ok(option);
    const editedLine=route.replace('to API.w','to Shape1.n').replaceAll('\n',newline);
    assert.ok(option.source.includes(target.replaceAll('\n',newline)+editedLine));
    assert.equal(option.source.replace(editedLine,''),source.replace(route.replaceAll('\n',newline),''));
    const result=compileStudio(option.source);assert.equal(result.status,0,result.scene.error);
    assert.equal(result.scene.objects.find(o=>o.id===option.selectId).kind,object.kind);
    unchangedGeometry(scene,result.scene,object,option.selectId);
  }
});

test('target may depend on crossed positioned shapes because only the connector moves',()=>{
  const f=setup({between:'Middle: box at (6,-2)\n',target:'Shape1: box at Middle.c + (2,0)'});
  const option=candidate(f);assert.ok(option);
  const result=compileStudio(option.source);assert.equal(result.status,0,result.scene.error);
  unchangedGeometry(f.scene,result.scene,f.object,option.selectId);
});

test('last-line target comments are retained without becoming connector comments',()=>{
  const f=setup();f.source=f.source.trimEnd()+' # target café 😀';
  f.scene=compileStudio(f.source).scene;f.object=f.scene.objects.find(o=>o.kind==='arrow');f.target=f.scene.objects.find(o=>o.name==='Shape1');
  const option=candidate(f);assert.ok(option);
  assert.ok(option.source.includes('at (2,-2) # target café 😀\narrow from Client.e to Shape1.n'));
  assert.equal(compileStudio(option.source).status,0);
});

test('earlier targets remain local edits even in documents outside the relocation grammar',()=>{
  const f=setup({after:'box\n'});const earlier=f.scene.objects.find(o=>o.name==='Database');
  const [option]=endpointCandidates(f.source,f.object,f.scene,'to',earlier,'w');
  assert.equal(option.source,f.source.replace('to API.w\n','to Database.w\n'));
});
test('CRLF, Unicode and comments survive relocation as one stale-guarded patch',()=>{
  const f=setup();f.source=('# café 😀\n'+f.source+'# end\n').replaceAll('\n','\r\n');f.scene=compileStudio(f.source).scene;
  f.object=f.scene.objects.find(o=>o.kind==='arrow');f.target=f.scene.objects.find(o=>o.name==='Shape1');
  const option=candidate(f);assert.ok(option);assert.equal(compileStudio(option.source).status,0);
  assert.ok(option.source.startsWith('# café 😀\r\n'));assert.ok(option.source.endsWith('# end\r\n'));
  assert.equal(option.source.replaceAll('\r\n','').includes('\n'),false);
});
