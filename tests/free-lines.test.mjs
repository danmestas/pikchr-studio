import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { freeLineCandidate, translateLineCandidate, moveEndpointCandidate, literalRoute } from '../public/free-lines.js';

const publicDir = path.resolve(import.meta.dirname, '../public');
const context = vm.createContext({ require: createRequire(import.meta.url), process, console, __dirname: publicDir, __filename: path.join(publicDir, 'pikchr.js'), URL, TextDecoder, TextEncoder, setTimeout });
vm.runInContext(fs.readFileSync(path.join(publicDir, 'pikchr.js'), 'utf8'), context);
const module = await context.initPikchrModule({ locateFile: p => path.join(publicDir, p) });
const native = module.cwrap('pikchr_studio', 'number', ['string', 'string', 'number']);
function render(source) { const p = native(source, null, 1); try { const r = JSON.parse(module.UTF8ToString(p)); assert.equal(r.error, null, source); return r; } finally { module._free(p); } }
const base = 'A: box "A" at (0,0)\nB: box "B" at (3,0)\n';

test('free line between two literal points snaps to the grid', () => {
  const scene = render(base);
  const edit = freeLineCandidate(base, scene, { start: { point: { x: 0.52, y: -1.01 } }, end: { point: { x: 2.004, y: -0.98 } }, kind: 'arrow' });
  assert.equal(edit.source, base + 'Link1: arrow from (0.5, -1) to (2, -1)\n');
  assert.equal(edit.selectName, 'Link1');
  const line = render(edit.source).objects.at(-1);
  assert.deepEqual(line.path[0], { x: 0.5, y: -1 }); // the drawn end is shortened for the arrowhead
  assert.ok(Math.abs(line.path[1].y + 1) < 1e-9);
});

test('mixed ends attach to shape anchors; two shapes reuse connect routing', () => {
  const scene = render(base), [a, b] = scene.objects;
  let edit = freeLineCandidate(base, scene, { start: { object: a, anchor: 'e' }, end: { point: { x: 1.5, y: 1 } }, kind: 'line' });
  assert.match(edit.source, /Link1: line from A\.e to \(1\.5, 1\)\n$/);
  render(edit.source);
  edit = freeLineCandidate(base, scene, { start: { point: { x: 1, y: 1 } }, end: { object: b, anchor: 'w' } });
  assert.match(edit.source, /Link1: arrow from \(1, 1\) to B\.w\n$/);
  render(edit.source);
  edit = freeLineCandidate(base, scene, { start: { object: a, anchor: 'e' }, end: { object: b, anchor: 'w' } });
  assert.match(edit.source, /Link1: arrow from A\.e to B\.w/);
});

test('zero-length and same-shape lines are refused', () => {
  const scene = render(base);
  assert.throws(() => freeLineCandidate(base, scene, { start: { point: { x: 1, y: 1 } }, end: { point: { x: 1.01, y: 1 } } }), /farther/);
  assert.throws(() => freeLineCandidate(base, scene, { start: { object: scene.objects[0], anchor: 'e' }, end: { object: scene.objects[0], anchor: 'w' } }), /different shape/);
});

test('dragging a literal line body translates every tuple and keeps the rest', () => {
  const source = base + 'L: arrow "go" from (0,-1) to (1,-1) then to (1,-2) dashed # keep\n';
  const scene = render(source), line = scene.objects.at(-1);
  assert.equal(literalRoute(source, line), true);
  const edit = translateLineCandidate(source, scene, line, 0.52, 0.49);
  assert.match(edit.source, /L: arrow "go" from \(0\.5, -0\.5\) to \(1\.5, -0\.5\) then to \(1\.5, -1\.5\) dashed # keep/);
  assert.equal(edit.selectName, 'L');
  render(edit.source);
  // Unnamed lines are selected by id and kind.
  const unnamed = base + 'line from (0,-1) to (1,-1)\n', us = render(unnamed);
  const e2 = translateLineCandidate(unnamed, us, us.objects.at(-1), 1, 0);
  assert.equal(e2.selectId, us.objects.at(-1).id); assert.equal(e2.targetKind, 'line');
});

test('lines attached to shapes are not body-draggable', () => {
  const source = base + 'arrow from A.e to (2,1)\n';
  const scene = render(source);
  assert.equal(literalRoute(source, scene.objects.at(-1)), false);
  assert.throws(() => translateLineCandidate(source, scene, scene.objects.at(-1), 1, 0), /endpoint/);
});

test('endpoint drags move one end, attach to earlier shapes, detach to points', () => {
  const source = base + 'L: arrow from (0,-1) to (1,-1)\nC: box "C" at (5,0)\n';
  const scene = render(source), line = scene.objects.find(o => o.name === 'L'), b = scene.objects.find(o => o.name === 'B'), c = scene.objects.find(o => o.name === 'C');
  let edit = moveEndpointCandidate(source, scene, line, 'to', { object: b, anchor: 'w' });
  assert.match(edit.source, /L: arrow from \(0,-1\) to B\.w\n/); render(edit.source);
  edit = moveEndpointCandidate(source, scene, line, 'from', { point: { x: -0.49, y: 0.51 } });
  assert.match(edit.source, /L: arrow from \(-0\.5, 0\.5\) to \(1,-1\)\n/); render(edit.source);
  assert.throws(() => moveEndpointCandidate(source, scene, line, 'to', { object: c, anchor: 'w' }), /defined after/);
  const attached = base + 'L: arrow from A.e to B.w\n', as = render(attached);
  edit = moveEndpointCandidate(attached, as, as.objects.at(-1), 'to', { point: { x: 2, y: 1 } });
  assert.match(edit.source, /L: arrow from A\.e to \(2, 1\)\n/); render(edit.source);
});

test('lineEnds reports literal and attached ends with positions', async () => {
  const { lineEnds } = await import('../public/free-lines.js');
  const source = base + 'L: arrow from A.e to (2,1)\nM: line from (0,-1) to (1,-1)\nN: arrow from A.e right until even with B then to B.w\n';
  const scene = render(source);
  const l = lineEnds(source, scene, scene.objects.find(o => o.name === 'L'));
  assert.equal(l.from.literal, false); assert.equal(l.from.object.name, 'A'); assert.deepEqual(l.to, { literal: true, point: { x: 2, y: 1 } });
  const m = lineEnds(source, scene, scene.objects.find(o => o.name === 'M'));
  assert.equal(m.from.literal && m.to.literal, true);
  const n = lineEnds(source, scene, scene.objects.find(o => o.name === 'N'));
  assert.equal(n.to.object.name, 'B');
});
