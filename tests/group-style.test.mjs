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

test('a stale scene is refused rather than styled against old offsets',()=>{
  const scene=render(BASE),objects=named(scene,'A','B','C');
  const stale={...scene,source:'A: box at (0,0)\n'};
  assert.throws(()=>changeSelectionAppearance(BASE,objects,stale,{thickness:2}),/No style applied/);
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

test('a selection with no name has nowhere to restore its identity',()=>{
  const source='box at (0,0)\nbox at (2,0)\n';
  const scene=render(source);
  assert.throws(()=>changeSelectionAppearance(source,scene.objects,scene,{thickness:2}),/at least one named object/);
});
