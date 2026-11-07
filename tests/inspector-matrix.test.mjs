// Pure halves of the bugs tests/inspector-matrix-browser.py found: each test
// pins one root cause at the function that owns it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudio} from './pikchr-wasm.mjs';
import {changeAppearance} from '../public/object-actions.js';
import {textStyleCandidate} from '../public/text-style.js';
import {correspondingObject} from '../public/candidate-target.js';

const render = source => { const r = compileStudio(source); assert.equal(r.scene.error, null, source); return r.scene; };

test('a style edit on an unnamed shape still identifies that shape after the render', () => {
  for (const source of ['box "anchor"\narrow\nbox "L"\n', 'box "anchor"\narrow\ncircle "L" fill red\n', 'text "L"\n']) {
    const scene = render(source), object = scene.objects.at(-1);
    for (const values of [{fill: 'aliceblue'}, {color: 'blue'}, {thickness: 'thick'}, {thickness: 0.03}]) {
      if (object.kind === 'text' && 'fill' in values) continue;
      const edit = changeAppearance(source, object, scene, values), after = render(edit.source);
      const hit = correspondingObject(after.objects, object, edit);
      assert.equal(hit?.id, object.id, `${JSON.stringify(values)} on ${JSON.stringify(source)} -> ${JSON.stringify(edit.source)}`);
    }
    const bold = textStyleCandidate(source, object, scene, {bold: true});
    assert.equal(correspondingObject(render(bold.source).objects, object, bold)?.id, object.id);
  }
});

import {inspectProperties} from '../public/properties.js';
import {textStyle} from '../public/text-style.js';
import {labelCandidates} from '../public/route-styles.js';
const statementOf = (source, object) => new TextDecoder().decode(new TextEncoder().encode(source).slice(object.span.start, object.span.end));
const last = source => { const scene = render(source); return {scene, object: scene.objects.at(-1)}; };

test('splines and arcs read and rewrite colour and thickness like arrows, with no fill', () => {
  for (const kind of ['spline', 'arc']) {
    const source = `A: box "A"\n${kind} right then up color DarkRed thick\n`.replace(kind === 'arc' ? ' right then up' : '', '');
    const {scene, object} = last(source);
    const props = inspectProperties(source, object, scene);
    assert.equal(props.color, 'darkred', kind);
    assert.equal(props.fill, undefined, kind);
    assert.ok(Math.abs(props.thickness - 0.0225) < 1e-9, kind);
    const edit = changeAppearance(source, object, scene, {color: 'blue'});
    assert.match(statementOf(edit.source, render(edit.source).objects.at(-1)), new RegExp(`^${kind}.* color blue`), kind);
  }
});

test('connector labels take size, weight, slant, mono and placement; justification is kept, not offered', () => {
  const cases = [
    ['arrow "x" above', {placement: 'below'}, 'arrow "x" below'],
    ['arrow "x" above', {placement: 'center'}, 'arrow "x"'],
    ['arrow "x"', {placement: 'above'}, 'arrow "x" above'],
    ['arrow "x" above', {aligned: true}, 'arrow "x" above aligned'],
    ['line "x" below aligned', {aligned: false}, 'line "x" below'],
    ['arrow "x" above', {bold: true}, 'arrow "x" bold above'],
    ['arrow "x" ljust', {size: 'big'}, 'arrow "x" ljust big'],
    ['spline right then up "x" above', {mono: true}, 'spline right then up "x" mono above'],
  ];
  for (const [line, change, want] of cases) {
    const source = `A: box "A"\n${line}\n`, {scene, object} = last(source);
    const edit = textStyleCandidate(source, object, scene, change);
    assert.equal(statementOf(edit.source, render(edit.source).objects.at(-1)), want, `${line} ${JSON.stringify(change)}`);
  }
  const {scene, object} = last('A: box "A"\narrow "x" below aligned bold\n');
  const style = textStyle('A: box "A"\narrow "x" below aligned bold\n', object, scene);
  assert.equal(style.placement, 'below');
  assert.equal(style.aligned, true);
  assert.equal(style.bold, true);
  // Shapes keep above/below as line positions, never as a placement control.
  const shape = last('box "a" above "b" below\n');
  assert.throws(() => textStyleCandidate('box "a" above "b" below\n', shape.object, shape.scene, {placement: 'above'}), /connector/);
});

test('updating a connector label text keeps the words written after it', () => {
  const source = 'A: box "A"\narrow "x" below aligned bold\n', {scene, object} = last(source);
  const edit = labelCandidates(source, object, scene, {text: 'y'})[0];
  assert.equal(statementOf(edit.source, render(edit.source).objects.at(-1)), 'arrow "y" below aligned bold');
});

import {macroProperties} from '../public/properties.js';
test('a macro use reads its style and text from the define body, read-only', () => {
  const source = 'define m { box "M" bold fill aliceblue color 0x1a7f37 thick }\nA: box "A"\nm\nm\n';
  const scene = render(source), use = scene.objects.find(o => o.reason === 'Macro-expanded object');
  assert.deepEqual(macroProperties(source, use), {text: 'M', fill: 'aliceblue', color: '#1a7f37', thickness: 0.0225, words: ['bold']});
  const plain = 'define m { box }\nm\n', p = render(plain);
  assert.deepEqual(macroProperties(plain, p.objects[0]), {text: '', fill: null, color: null, thickness: 0.015, words: []});
  const expr = 'define m { box fill $c }\n$c = 0xff0000\nm\n', e = render(expr);
  assert.equal(macroProperties(expr, e.objects[0]).fill, 'fill $c');
});

import {connectorStyleCandidate,strokeCandidates} from '../public/route-styles.js';
test('keywords inside a comment are not clauses, for shapes and connectors', () => {
  const box = 'X: box "L" at (1,0) /* fill red */ color blue\n', b = last(box);
  const props = inspectProperties(box, b.object, b.scene);
  assert.equal(props.fill, undefined);
  assert.equal(props.locked.fill, null);
  assert.equal(changeAppearance(box, b.object, b.scene, {fill: 'white'}).source, 'X: box "L" at (1,0) /* fill red */ color blue fill white\n');
  const arrow = 'A: box "A"\nB: box "B" at (2,0)\narrow from A.e to B.w /* thick */ color blue\n', a = last(arrow);
  assert.equal(inspectProperties(arrow, a.object, a.scene).thicknessSet, false);
  const red = connectorStyleCandidate(arrow, a.object, a.scene, {color: 'red'});
  assert.equal(red.source, 'A: box "A"\nB: box "B" at (2,0)\narrow from A.e to B.w /* thick */ color red\n');
  const dashed = strokeCandidates(arrow, a.object, a.scene, 'dashed')[0];
  assert.match(dashed.source, /\/\* thick \*\/ color blue dashed\n$/);
});

test('one clause Studio cannot read locks only itself on a connector', () => {
  const variable = '$c = 0xff0000\nA: box "A"\nline right 1 color $c\n', v = last(variable);
  assert.equal(connectorStyleCandidate(variable, v.object, v.scene, {thickness: 'thick'}).source, '$c = 0xff0000\nA: box "A"\nline right 1 color $c thick\n');
  assert.equal(connectorStyleCandidate(variable, v.object, v.scene, {color: 'red'}), null);
  assert.match(strokeCandidates(variable, v.object, v.scene, 'dotted')[0].source, /line right 1 color \$c dotted\n$/);
  const expression = 'A: box "A"\narrow right 1 color blue thickness 0.01*2\n', e = last(expression);
  assert.equal(connectorStyleCandidate(expression, e.object, e.scene, {color: 'red'}).source, 'A: box "A"\narrow right 1 color red thickness 0.01*2\n');
  assert.equal(connectorStyleCandidate(expression, e.object, e.scene, {thickness: 'thin'}), null);
});

import {changeTermination} from '../public/properties.js';
test('removing arrowheads leaves no stray space behind', () => {
  for (const [line, want] of [['line from A.e to B.w <->', 'line from A.e to B.w'], ['arrow <-> from A.e to B.w', 'line from A.e to B.w'], ['line <- right 1', 'line right 1']]) {
    const source = `A: box "A"\nB: box "B" at (2,0)\n${line}\n`, {scene, object} = last(source);
    const edit = changeTermination(source, object, scene, 'none');
    assert.equal(edit.source, `A: box "A"\nB: box "B" at (2,0)\n${want}\n`);
  }
});
