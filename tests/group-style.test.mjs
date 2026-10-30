import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudio} from './pikchr-wasm.mjs';
import {changeAppearance,changeSelectionAppearance,groupStyleCapabilities} from '../public/object-actions.js';

const render=source=>{
  const {scene}=compileStudio(source);
  assert.equal(scene.error,null,source);
  return scene;
};
const named=(scene,...names)=>scene.objects.filter(object=>names.includes(object.name));

const BASE='A: box "Café ☕" at (0,0)\nB: cylinder "Bêta" at (2.5,0)\nC: box "Gamma" at (5,0)\nLink: arrow from A.e to B.w\n';
const STYLED='A: box "Café ☕" at (0,0) color 0x123456 thickness 1.5\nB: cylinder "Bêta" at (2.5,0) color 0x123456 thickness 1.5\nC: box "Gamma" at (5,0) color 0x123456 thickness 1.5\nLink: arrow from A.e to B.w\n';

test('three selected shapes change stroke and thickness in one source edit',()=>{
  const scene=render(BASE),objects=named(scene,'A','B','C');
  const edit=changeSelectionAppearance(BASE,objects,scene,{color:'#123456',thickness:1.5});
  assert.equal(edit.source,STYLED);
  assert.match(edit.label,/3 objects/);
  assert.equal(edit.selectName,'A');
  // Geometry, identity and the connector statement are untouched.
  const result=render(edit.source);
  assert.deepEqual(result.objects.map(object=>[object.name,object.kind,object.center,object.bbox]),
    scene.objects.map(object=>[object.name,object.kind,object.center,object.bbox]));
  assert.ok(edit.source.endsWith('Link: arrow from A.e to B.w\n'));
});

test('mixed shape and connector selection styles stroke and thickness but refuses fill',()=>{
  const scene=render(BASE),objects=named(scene,'A','Link');
  const edit=changeSelectionAppearance(BASE,objects,scene,{stroke:'#222222',thickness:2});
  assert.equal(edit.source,'A: box "Café ☕" at (0,0) color 0x222222 thickness 2\nB: cylinder "Bêta" at (2.5,0)\nC: box "Gamma" at (5,0)\nLink: arrow from A.e to B.w color 0x222222 thickness 2\n');
  assert.deepEqual(groupStyleCapabilities(objects),{fill:false});
  assert.deepEqual(groupStyleCapabilities(named(scene,'A','B','C')),{fill:true});
  assert.throws(()=>changeSelectionAppearance(BASE,objects,scene,{fill:'#ffffff'}),/Fill is not available for every selected object/);
});

test('fill applies to an all-shape selection and leaves text and connectors alone',()=>{
  const scene=render(BASE),objects=named(scene,'A','B','C');
  const edit=changeSelectionAppearance(BASE,objects,scene,{fill:'#f2f5fa'});
  assert.equal(edit.source,'A: box "Café ☕" at (0,0) fill 0xf2f5fa\nB: cylinder "Bêta" at (2.5,0) fill 0xf2f5fa\nC: box "Gamma" at (5,0) fill 0xf2f5fa\nLink: arrow from A.e to B.w\n');
});

test('an unsupported member refuses the whole edit and names every offender',()=>{
  const source='G: [\n  N: box "inside"\n]\nA: box "Alpha" at (3,0)\nB: box "Beta" at (6,0)\n';
  const scene=render(source),objects=named(scene,'G','N','A','B');
  assert.throws(()=>changeSelectionAppearance(source,objects,scene,{thickness:2}),
    /No style applied[^\n]*G: only shapes, text and connectors[^\n]*N: Objects inside a group are inspect-only/);
});

test('an expression-valued member refuses the whole edit',()=>{
  const source='A: box "alpha" at (0,0) thickness 1+1\nB: box "beta" at (2,0)\n';
  const scene=render(source),objects=named(scene,'A','B');
  assert.throws(()=>changeSelectionAppearance(source,objects,scene,{thickness:2,color:'#123456'}),
    /No style applied[^\n]*A: The thickness expression must be edited in source/);
});

test('shifted source spans are refused before a group edit',()=>{
  // The UI owns source-versus-rendered-source checks. This layer additionally
  // refuses a span that no longer describes its expected object.
  const scene=render(BASE),objects=named(scene,'A','B','C');
  const shifted='X: box "extra" at (0,-3)\n'+BASE;
  assert.throws(()=>changeSelectionAppearance(shifted,objects,scene,{thickness:2}),/No style applied/);
  assert.equal(shifted,'X: box "extra" at (0,-3)\n'+BASE,'a refused edit leaves the source untouched');
});

test('sizing stays out of group style, and one object keeps the single-object path',()=>{
  const scene=render(BASE),objects=named(scene,'A','B','C');
  assert.throws(()=>changeSelectionAppearance(BASE,objects,scene,{width:2}),/stroke, thickness and fill only/);
  assert.throws(()=>changeSelectionAppearance(BASE,objects,scene,{height:1}),/stroke, thickness and fill only/);
  const single=named(scene,'A');
  assert.throws(()=>changeSelectionAppearance(BASE,single,scene,{thickness:2}),/at least two/);
  assert.equal(changeAppearance(BASE,single[0],scene,{thickness:2}).source,
    'A: box "Café ☕" at (0,0) thickness 2\nB: cylinder "Bêta" at (2.5,0)\nC: box "Gamma" at (5,0)\nLink: arrow from A.e to B.w\n');
});

test('named and unnamed members keep their stable identities in the selection',()=>{
  const source='A: box "Alpha" at (0,0)\nbox "Anonymous" at (2.5,0)\nB: cylinder "Beta" at (5,0)\n';
  const scene=render(source),objects=scene.objects;
  assert.deepEqual(objects.map(o=>[o.id,o.name||null]),[['o1','A'],['o2',null],['o3','B']]);
  const edit=changeSelectionAppearance(source,objects,scene,{thickness:2});
  assert.equal(edit.source,'A: box "Alpha" at (0,0) thickness 2\nbox "Anonymous" at (2.5,0) thickness 2\nB: cylinder "Beta" at (5,0) thickness 2\n');
  assert.deepEqual(edit.selectionIds,['o1','o2','o3']);
  const result=render(edit.source);
  assert.equal(result.objects.length,scene.objects.length);
  assert.deepEqual(result.objects.map(o=>[o.id,o.kind,o.name||null]),
    scene.objects.map(o=>[o.id,o.kind,o.name||null]));
  assert.deepEqual(result.objects.map(o=>[o.center,o.bbox]),scene.objects.map(o=>[o.center,o.bbox]));
});

test('an entirely unnamed group is styled and stays selectable by id',()=>{
  const source='box "One" at (0,0)\nbox "Two" at (2,0)\n';
  const scene=render(source);
  const edit=changeSelectionAppearance(source,scene.objects,scene,{color:'#123456',thickness:1.5});
  assert.equal(edit.source,'box "One" at (0,0) color 0x123456 thickness 1.5\nbox "Two" at (2,0) color 0x123456 thickness 1.5\n');
  assert.deepEqual(edit.selectionIds,['o1','o2']);
  const result=render(edit.source);
  assert.deepEqual(result.objects.map(o=>[o.id,o.kind,o.center,o.bbox]),scene.objects.map(o=>[o.id,o.kind,o.center,o.bbox]));
});

test('spline and arc connectors take stroke and thickness without changing their path',()=>{
  const shapes='A: box "Alpha" at (0,0)\nB: box "Beta" at (3,0)\n';
  const connector='S: spline from A.e to B.w\nR: arc from A.n to B.n cw\n';
  const source=shapes+connector,scene=render(source),objects=named(scene,'S','R');
  assert.deepEqual(objects.map(o=>o.kind),['spline','arc']);
  const edit=changeSelectionAppearance(source,objects,scene,{stroke:'#222222',thickness:2});
  assert.equal(edit.source,shapes+'S: spline from A.e to B.w color 0x222222 thickness 2\nR: arc from A.n to B.n cw color 0x222222 thickness 2\n');
  const result=render(edit.source);
  assert.equal(result.objects.length,scene.objects.length);
  for(const [before,after] of [[objects[0],result.objects[2]],[objects[1],result.objects[3]]]){
    assert.equal(after.id,before.id);assert.equal(after.kind,before.kind);assert.equal(after.name,before.name);
    // The route is byte-for-byte the same geometry; Pikchr's bbox includes
    // stroke width, so it may grow when a thick stroke is added.
    assert.deepEqual(after.path,before.path);
  }
  assert.deepEqual(result.objects.slice(0,2).map(o=>[o.center,o.bbox]),scene.objects.slice(0,2).map(o=>[o.center,o.bbox]));
  assert.throws(()=>changeSelectionAppearance(source,objects,scene,{fill:'#ffffff'}),/Fill is not available for every selected object/);
});

test('already-matching connector styles do not block the other selected members',()=>{
  for(const kind of ['arrow','line','spline','arc']){
    const source=`A: box "Alpha" at (0,0)\nB: box "Beta" at (3,0)\nS: ${kind} from A.e to B.w color 0x123456 thickness 2\n`;
    const scene=render(source),objects=named(scene,'A','S');
    const edit=changeSelectionAppearance(source,objects,scene,{color:'#123456',thickness:2});
    assert.equal(edit.source,source.replace('A: box "Alpha" at (0,0)','A: box "Alpha" at (0,0) color 0x123456 thickness 2'));
    assert.deepEqual(render(edit.source).objects.at(-1).path,scene.objects.at(-1).path);
  }
});

test('a connector can be restyled after its color was set to none',()=>{
  const source='A: box "Alpha" at (0,0)\nB: box "Beta" at (3,0)\nS: line from A.e to B.w color none\n';
  const scene=render(source),object=named(scene,'S')[0];
  const edit=changeAppearance(source,object,scene,{color:'#123456'});
  assert.equal(edit.source,source.replace('color none','color 0x123456'));
  assert.deepEqual(render(edit.source).objects.at(-1).path,object.path);
});

test('connector styling retains membership, ambiguous-span and size guards',()=>{
  const source='A: box "Alpha" at (0,0)\nB: box "Beta" at (3,0)\nS: spline from A.e to B.w\nR: arc from A.n to B.n cw\n';
  const scene=render(source),objects=named(scene,'S','R');
  for(const object of objects){
    assert.throws(()=>changeAppearance(source,{...object},scene,{color:'#123456'}),/edited in source/);
    const ambiguous={objects:[...scene.objects,{...object,id:'duplicate'}]};
    assert.throws(()=>changeAppearance(source,object,ambiguous,{thickness:2}),/edited in source/);
    assert.throws(()=>changeAppearance(source,object,scene,{width:2}),/Resize shapes, not connector paths/);
    assert.throws(()=>changeAppearance(source,object,scene,{height:2}),/Resize shapes, not connector paths/);
  }
});

test('an expression-valued connector refuses the whole group edit',()=>{
  const shapes='A: box "Alpha" at (0,0)\nB: box "Beta" at (3,0)\n';
  const source=shapes+'S: spline from A.e to B.w thickness 1+1\n';
  const scene=render(source),objects=named(scene,'A','S');
  assert.throws(()=>changeSelectionAppearance(source,objects,scene,{thickness:2,color:'#123456'}),
    /No style applied[^\n]*S: .*expression/i);
  assert.equal(scene.objects.length,3);
});
