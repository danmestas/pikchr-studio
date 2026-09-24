import test from 'node:test';
import assert from 'node:assert/strict';
import { smartSnap } from '../public/constrain.js';

const shape = (name, x, y, w=1, h=0.6) => ({name, center:{x, y}, bbox:{x:x-w/2, y:y-h/2, width:w, height:h}});
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('snaps edges and centers to other shapes on each axis independently', () => {
  const yes = shape('Yes', -2, -1.5);
  const r = smartSnap({x:1.3, y:-1.45}, {size:{width:1, height:0.6}, others:[yes]});
  close(r.point.y, -1.5, 'center y aligned with Yes');
  assert.equal(r.guides.find(g => g.axis === 'y').other.name, 'Yes');
});

test('snaps to the mirror of a sibling about a pivot', () => {
  const q = shape('Q', 0, 0, 1.2, 0.9), yes = shape('Yes', -2, -1.5);
  const r = smartSnap({x:1.95, y:-1.55}, {size:{width:1, height:0.6}, others:[q, yes]});
  close(r.point.x, 2, 'mirrored x'); close(r.point.y, -1.5, 'same y as Yes');
  const g = r.guides.find(g => g.axis === 'x');
  assert.equal(g.type, 'mirror'); assert.equal(g.pivot.name, 'Q'); assert.equal(g.other.name, 'Yes');
});

test('continues an equal gap along a row', () => {
  const a = shape('A', 0, 0), b = shape('B', 2, 0);   // gap 1.0 between edges
  const r = smartSnap({x:3.95, y:0.02}, {size:{width:1, height:0.6}, others:[a, b]});
  close(r.point.x, 4, 'equal gap after B');
  assert.equal(r.guides.find(g => g.axis === 'x').type, 'gap');
});

test('leaves the point alone when nothing is within tolerance', () => {
  const r = smartSnap({x:10, y:10}, {size:{width:1, height:1}, others:[shape('A', 0, 0)]});
  assert.deepEqual(r.point, {x:10, y:10}); assert.equal(r.guides.length, 0);
});
