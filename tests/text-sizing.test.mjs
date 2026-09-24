import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { buildTextEdit } from '../public/text-sizing.js';
import { inspectProperties } from '../public/properties.js';
const publicDir = path.resolve(import.meta.dirname, '../public');
const context = vm.createContext({ require: createRequire(import.meta.url), process, console, __dirname: publicDir, __filename: path.join(publicDir, 'pikchr.js'), URL, TextDecoder, TextEncoder, setTimeout });
vm.runInContext(fs.readFileSync(path.join(publicDir, 'pikchr.js'), 'utf8'), context);
const module = await context.initPikchrModule({ locateFile: p => path.join(publicDir, p) });
const native = module.cwrap('pikchr_studio', 'number', ['string']);
function render(source) { const pointer = native(source); try { return JSON.parse(module.UTF8ToString(pointer)); } finally { module._free(pointer); } }
function fixture(statement = 'A: box "old" width 1.2 height 0.4 at (0,0)') {
  const source = '# café 😀\r\n' + statement + '\r\nB: box at (3,0)\r\narrow from A.e to B.w\r\n# untouched\r\n';
  const scene = render(source); assert.equal(scene.error, null); return { source, scene, object: scene.objects[0] };
}
test('Grow and Fixed use safe native geometry and preserve unrelated source', async () => {
  for (const mode of ['grow', 'fixed']) {
    const { source, scene, object } = fixture();
    const edit = await buildTextEdit(source, scene, object, { text: 'The Node of the Day', mode }, render);
    const result = render(edit.source); assert.equal(result.error, null);
    assert.deepEqual(result.objects[0].center, object.center);
    if (mode === 'grow') assert.ok(result.objects[0].bbox.width > object.bbox.width);
    else assert.deepEqual(result.objects[0].bbox, object.bbox);
    assert.ok(edit.source.endsWith('\r\nB: box at (3,0)\r\narrow from A.e to B.w\r\n# untouched\r\n'));
  }
});
test('Wrap materializes native multiline text, keeps width and grows height with anchors following', async () => {
  const { source, scene, object } = fixture('A: box "old" width 0.8 height 0.15 at (0,0)'); let calls = 0;
  const edit = await buildTextEdit(source, scene, object, { text: 'The Node of the Day', mode: 'wrap' }, s => { calls++; return render(s); });
  const result = render(edit.source), box = result.objects[0];
  assert.equal(result.error, null); assert.ok(calls <= 32); assert.equal(calls, edit.sizing.renderCount);
  assert.equal(box.bbox.width, object.bbox.width); assert.ok(box.bbox.height > object.bbox.height);
  assert.deepEqual(box.center, object.center); assert.deepEqual(result.objects[2].path[0], box.anchors.e);
  const text = inspectProperties(edit.source, box, result).text;
  assert.equal(text.replaceAll('\n', ' '), 'The Node of the Day'); assert.ok(text.includes('\n'));
  assert.doesNotMatch(edit.source, /\bfit\b/);
});
test('Wrap preserves explicit blank lines and whole Unicode graphemes', async () => {
  const { source, scene, object } = fixture('A: box "old" width 2 height 0.4 color blue at (0,0)');
  const text = 'cafe\u0301 👨‍👩‍👧‍👦\n\nmore text';
  const edit = await buildTextEdit(source, scene, object, { text, mode: 'wrap', width: 2 }, render);
  const result = render(edit.source), wrapped = inspectProperties(edit.source, result.objects[0], result).text;
  assert.ok(wrapped.includes('e\u0301')); assert.ok(wrapped.includes('👨‍👩‍👧‍👦')); assert.ok(wrapped.includes('\n\n'));
  assert.match(edit.source, /color blue/);
});
test('Wrap fails safely for unsupported inputs, narrow boxes and excessive measurement work', async () => {
  const { source, scene, object } = fixture();
  for (const options of [{ text: 'x', width: 0 }, { text: 'x', width: 0.001 }, { text: 'a"b' }, { text: 'a\\b' }, { text: 'x'.repeat(4097) }]) {
    await assert.rejects(buildTextEdit(source, scene, object, { mode: 'wrap', ...options }, render));
  }
  let calls = 0;
  await assert.rejects(buildTextEdit(source, scene, object, { mode: 'wrap', text: 'word '.repeat(150) }, s => { calls++; return render(s); }), /safe limit/);
  assert.ok(calls <= 32);
  const circle = fixture('A: circle "old" at (0,0)');
  await assert.rejects(buildTextEdit(circle.source, circle.scene, circle.object, { text: 'x', mode: 'wrap' }, render), /boxes/);
  await assert.rejects(buildTextEdit(source, { ...scene, source: source + ' ' }, object, { text: 'x', mode: 'wrap' }, render), /read-only/);
});
test('Wrap measures native font scale, preserves relative centers, and never shrinks height', async () => {
  const source = 'textcharwid = 0.1\ntextcharht = 0.2\nOrigin: box at (0,0)\nA: box "old" bold width 1.4 height 2 with .c at Origin.c + (2,1)\n';
  const scene = render(source); assert.equal(scene.error, null);
  const object = scene.objects[1];
  const edit = await buildTextEdit(source, scene, object, { text: 'Long label with several words', mode: 'wrap' }, render);
  const result = render(edit.source), box = result.objects[1];
  assert.equal(box.bbox.width, object.bbox.width); assert.equal(box.bbox.height, object.bbox.height);
  assert.deepEqual(box.center, object.center); assert.match(edit.source, /bold/);
  assert.ok(edit.source.startsWith('textcharwid = 0.1\ntextcharht = 0.2\nOrigin: box at (0,0)\n'));
});
test('Wrap handles empty labels and source errors without proposing an invalid edit', async () => {
  const { source, scene, object } = fixture();
  const edit = await buildTextEdit(source, scene, object, { text: '', mode: 'wrap' }, render);
  const result = render(edit.source); assert.equal(result.error, null);
  assert.equal(inspectProperties(edit.source, result.objects[0], result).text, '');
  await assert.rejects(buildTextEdit(source, scene, object, { text: 'hello', mode: 'wrap' }, () => ({ error: 'worker error' })), /worker error/);
});
test('bundled native renderer has a five-term limit and wrapping reports actionable guidance',async()=>{
  assert.equal(render('box "one" "two" "three" "four" "five" fit').error,null);
  assert.match(render('box "one" "two" "three" "four" "five" "six" fit').error,/too many text terms/);
  const {source,scene,object}=fixture();
  await assert.rejects(buildTextEdit(source,scene,object,{text:'word word word word word word',mode:'wrap',width:0.35},render),/more than five lines.*Increase the wrap width or choose Grow/);
  await assert.rejects(buildTextEdit(source,scene,object,{text:'1\n2\n3\n4\n5\n6',mode:'wrap'},render),/at most five text lines/);
});
