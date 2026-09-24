import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeBox, RESIZE_HANDLES } from '../public/resize-guides.js';

const box = {x:0, y:0, width:2, height:1};           // right 2, top 1
const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);

test('every handle keeps the opposite side or corner fixed', () => {
  let r = resizeBox({box, handle:'ne', pointer:{x:3, y:2}});
  close(r.x, 0, 'left fixed'); close(r.y, 0, 'bottom fixed'); close(r.width, 3, 'w'); close(r.height, 2, 'h');
  r = resizeBox({box, handle:'nw', pointer:{x:-1, y:1.5}});
  close(r.x + r.width, 2, 'right fixed'); close(r.y, 0, 'bottom fixed'); close(r.width, 3, 'w'); close(r.height, 1.5, 'h');
  r = resizeBox({box, handle:'sw', pointer:{x:0.5, y:-1}});
  close(r.x + r.width, 2, 'right fixed'); close(r.y + r.height, 1, 'top fixed'); close(r.width, 1.5, 'w'); close(r.height, 2, 'h');
  r = resizeBox({box, handle:'n', pointer:{x:9, y:1.5}});
  close(r.width, 2, 'edge handle leaves width'); close(r.y, 0, 'bottom fixed'); close(r.height, 1.5, 'h');
  r = resizeBox({box, handle:'w', pointer:{x:-0.5, y:9}});
  close(r.height, 1, 'edge handle leaves height'); close(r.x + r.width, 2, 'right fixed'); close(r.width, 2.5, 'w');
  assert.equal(RESIZE_HANDLES.length, 8);
});

test('cannot invert past the fixed side', () => {
  const r = resizeBox({box, handle:'w', pointer:{x:5, y:0}});
  close(r.width, 0.1, 'min width'); close(r.x + r.width, 2, 'right fixed');
});

test('from center keeps the center and grows both sides', () => {
  const r = resizeBox({box, handle:'e', pointer:{x:2.5, y:0}, fromCenter:true});
  close(r.center.x, 1, 'center'); close(r.width, 3, 'w');
});

test('aspect ratio follows the leading axis and keeps the anchor', () => {
  const r = resizeBox({box, handle:'ne', pointer:{x:4, y:1.2}, ratio:2});
  close(r.width, 4, 'w leads'); close(r.height, 2, 'h follows'); close(r.x, 0, 'left'); close(r.y, 0, 'bottom');
});

test('moving edges snap to other shapes and report guides', () => {
  const other = {name:'B', bbox:{x:3, y:-2, width:1, height:4}};
  const r = resizeBox({box, handle:'ne', pointer:{x:2.97, y:2.04}, others:[other]});
  close(r.x + r.width, 3, 'right edge meets B left'); close(r.y + r.height, 2, 'top meets B top');
  assert.deepEqual(r.guides.map(g => g.axis).sort(), ['x', 'y']);
});
