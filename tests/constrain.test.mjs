import test from 'node:test';
import assert from 'node:assert/strict';
import { lockDirection, constrainDrag } from '../public/constrain.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('locks to horizontal, vertical and 45 degree diagonals', () => {
  const s = {x:0, y:0};
  let r = lockDirection(s, {x:2, y:0.3}); assert.equal(r.axis, 'x'); close(r.point.y, 0, 'horizontal y');
  r = lockDirection(s, {x:-0.2, y:-3}); assert.equal(r.axis, 'y'); close(r.point.x, 0, 'vertical x');
  r = lockDirection(s, {x:1, y:1.2}); assert.equal(r.axis, 'diagonal'); close(r.point.x, r.point.y, 'diagonal');
  r = lockDirection(s, {x:-1.1, y:1}); assert.equal(r.axis, 'diagonal'); close(r.point.x, -r.point.y, 'anti-diagonal');
  assert.deepEqual(lockDirection(s, s), {point:{x:0, y:0}, axis:null});
});

test('horizontal drag snaps into line with another object center or edge and names the guide', () => {
  const api = {name:'API', center:{x:2, y:0}, bbox:{x:1.625, y:-0.25, width:0.75, height:0.5}};
  const size = {width:0.75, height:0.5};
  // Center lands 0.1 in from API's center: snaps onto it.
  let r = constrainDrag({x:0, y:-2}, {x:1.9, y:-2.1}, {size, others:[api]});
  assert.equal(r.axis, 'x'); close(r.point.x, 2, 'center snap'); close(r.point.y, -2, 'y locked');
  assert.equal(r.guide.name, 'API'); assert.equal(r.guide.axis, 'x'); assert.equal(r.guide.kind, 'center');
  // Left edge near API's right edge.
  r = constrainDrag({x:0, y:-2}, {x:2.8, y:-2}, {size, others:[api]});
  close(r.point.x - 0.375, 2.375, 'edge snap'); assert.equal(r.guide.kind, 'edge');
  // Nothing within tolerance: no guide, pure axis lock.
  r = constrainDrag({x:0, y:-2}, {x:5, y:-2}, {size, others:[api]});
  assert.equal(r.guide, null); close(r.point.x, 5, 'free');
});

test('diagonal locks never snap', () => {
  const api = {name:'API', center:{x:1, y:1}, bbox:{x:0.6, y:0.6, width:0.8, height:0.8}};
  const r = constrainDrag({x:0, y:0}, {x:1.05, y:0.95}, {others:[api]});
  assert.equal(r.axis, 'diagonal'); assert.equal(r.guide, null); close(r.point.x, r.point.y, 'still diagonal');
});
