// Every render checks each object's move refusal (and the inspector reads
// spans through byteOffsetToIndex). Both must stay linear in the document:
// a 60-object diagram once cost 350 ms per render here, growing as n².
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudio} from './pikchr-wasm.mjs';
import {moveRefusal,movementBlocked,byteOffsetToIndex} from '../public/edits.js';

const diagram = n => 'A: box "A" at (0,0)\n' + Array.from({length:n}, (_, i) => i % 3 ? `box "é${i}"\narrow\n` : `B${i}: box "B${i}" at A + (${i},2)\n`).join('');
const sceneOf = source => JSON.parse(compileStudio(source).stdout);
// The best of three runs, so a busy machine (tests run in parallel) does not
// read as a regression.
function cost(n) {
  const source = diagram(n), scene = sceneOf(source);
  let ms = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = performance.now();
    for (const o of scene.objects) { moveRefusal(source, o, scene); movementBlocked(source, o, scene); }
    ms = Math.min(ms, performance.now() - t);
  }
  return {ms, objects: scene.objects.length};
}

test('move refusals for a 200-object diagram stay within budget (2 s before the fix)', () => {
  cost(20);   // warm the JIT
  const large = cost(120);
  assert.ok(large.objects > 150, large.objects);
  assert.ok(large.ms < 150, `${large.objects} objects took ${large.ms.toFixed(1)} ms`);
});

test('byteOffsetToIndex maps UTF-8 offsets and refuses split characters', () => {
  const s = 'aé日😀b';
  assert.deepEqual([0, 1, 3, 6, 10, 11].map(o => byteOffsetToIndex(s, o)), [0, 1, 2, 3, 5, 6]);
  for (const bad of [2, 4, 5, 7, 8, 9]) assert.throws(() => byteOffsetToIndex(s, bad), /splits/);
  assert.throws(() => byteOffsetToIndex(s, 12), /outside/);
  assert.throws(() => byteOffsetToIndex(s, -1), /Invalid/);
  assert.throws(() => byteOffsetToIndex(s, 1.5), /Invalid/);
  // Many sources in turn: the answer never comes from another source.
  for (let i = 0; i < 20; i++) assert.equal(byteOffsetToIndex('é'.repeat(i) + 'x', 2 * i), i);
});
