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

import {drawnProperties} from '../public/properties.js';
import {macroUses} from '../public/macro-detach.js';
test('a macro use reports what Pikchr drew for it, arguments and call attributes included', () => {
  const cases = [
    ['define m { box "M" }\nm fill red\n', {text: 'M', fill: '#ff0000', color: '#000000', thickness: 0.015, words: []}, {args: false, extra: true}],
    ['define m { box $1 fill $2 }\nm("hello", red)\n', {text: 'hello', fill: '#ff0000', color: '#000000', thickness: 0.015, words: []}, {args: true, extra: false}],
    ['define m { box "a" bold italic mono thick color blue }\nm\n', {text: 'a', fill: null, color: '#0000ff', thickness: 0.0225, words: ['bold', 'italic', 'mono']}, {args: false, extra: false}],
  ];
  for (const [source, want, call] of cases) {
    const r = compileStudio(source), o = r.scene.objects[0];
    assert.deepEqual(drawnProperties(r.scene.svg, o.id, r.scene.transform), want, source);
    const uses = macroUses(source, o, r.scene);
    assert.deepEqual({args: uses.call.args, extra: uses.call.extra}, call, source);
  }
  // Two uses, one with an attribute: each object finds its own call.
  const two = 'define m { box "M" }\nm\nm fill red\n', r = compileStudio(two);
  assert.deepEqual(r.scene.objects.map(o => macroUses(two, o, r.scene).call.extra), [false, true]);
  // Spanned at the call: each use is still its own.
  const named = 'define tile { $1: box $2 at $3 }\ntile(A, "One", (0,0))\ntile(B, "Two", (2,0)) fill red\n', n = compileStudio(named);
  assert.deepEqual(n.scene.objects.map(o => macroUses(named, o, n.scene).call), [{args: true, extra: false}, {args: true, extra: true}]);
});

import {parseConnector,connectorState} from '../public/route-styles.js';
test('a parenthesised, variable or arithmetic colour or thickness is one locked clause, not path tokens', () => {
  for (const [value, kind] of [['(0xff0000)', 'color'], ['$c', 'color'], ['0x10*2', 'color'], ['(A.color)', 'color'], ['0.01*2', 'thickness'], ['($t + 0.01)', 'thickness']]) {
    const source = `$c = 0xff0000\n$t = 0.01\nA: box "A"\nB: box "B" at (2,0)\narrow from A.e to B.w ${kind} ${value} dashed\n`;
    const {scene, object} = last(source), model = parseConnector(source, object, scene);
    assert.deepEqual(model.path.map(t => t.text), ['from', 'A.e', 'to', 'B.w'], value);
    if (kind === 'color') assert.equal(connectorState(source, object, scene).colour, value, value);
    assert.equal(connectorStyleCandidate(source, object, scene, kind === 'color' ? {color: 'red'} : {thickness: 'thick'}), null, value);
    assert.match(strokeCandidates(source, object, scene, 'dotted')[0].source, new RegExp(`${kind} ${value.replace(/[$()*+.]/g, '\\$&')} dotted\\n$`), value);
  }
});
