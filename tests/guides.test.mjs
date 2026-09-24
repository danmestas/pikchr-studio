import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentGuides, gapMarks } from '../public/guides.js';

const box = (name, x, y, width, height) => ({name, bbox:{x, y, width, height}});

test('reports every shared line, spanning all shapes on it', () => {
  // D (moving) shares its bottom and middle with C, and its left edge with B.
  const moving = {x:2, y:-2, width:1, height:0.5};
  const C = box('C', -0.6, -2, 1.2, 0.5), B = box('B', 2, 0.2, 1, 0.5);
  const g = alignmentGuides(moving, [C, B]);
  const ys = g.filter(x => x.axis === 'y');
  assert.deepEqual(ys.map(x => x.value), [-1.75]);     // same size as C: one center guide, not three
  assert.deepEqual(ys[0].segments, [[0.6, 2]]);        // only in the gap between C and D
  const vertical = g.filter(x => x.axis === 'x');
  assert.deepEqual(vertical.map(x => [x.value, x.feature, x.names]), [[2.5, 'center', ['B']]]);  // same width as B
  assert.deepEqual(vertical[0].segments, [[-1.5, 0.2]]);                                        // D's top to B's bottom
  // Different widths: the shared left edge spans both shapes with a mark at each corner.
  const edge = alignmentGuides(moving, [box('E', 2, 0.2, 2, 0.5)]).find(x => x.axis === 'x');
  assert.equal(edge.value, 2); assert.equal(edge.from, -2); assert.equal(edge.to, 0.7); assert.equal(edge.points.length, 4);
});

test('center alignment marks only the centers', () => {
  const moving = {x:0, y:0, width:2, height:1};
  const g = alignmentGuides(moving, [box('A', 0.5, 3, 1, 1)]);
  const center = g.find(x => x.axis === 'x' && x.value === 1);
  assert.deepEqual(center.segments, [[1, 3]]);        // from moving top edge to A's bottom edge
  assert.equal(center.points.length, 2);
});

test('no shared lines, no guides', () => {
  assert.deepEqual(alignmentGuides({x:0, y:0, width:1, height:1}, [box('A', 5.3, 5.3, 1, 1)]), []);
});

test('equal gaps produce two labelled marks between neighbours', () => {
  const a = {x:0, y:0, width:1, height:1}, b = {x:2, y:0, width:1, height:1}, m = {x:4, y:0, width:1, height:1};
  const marks = gapMarks(a, b, m, 'x', 1);
  assert.deepEqual(marks.map(k => [k.from, k.to, k.label]), [[1, 2, '1.00'], [3, 4, '1.00']]);
  assert.equal(marks[0].at, 0.5);
});
