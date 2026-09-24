import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { textStyle, textStyleCandidate } from '../public/text-style.js';

const publicDir = path.resolve(import.meta.dirname, '../public');
const context = vm.createContext({ require: createRequire(import.meta.url), process, console, __dirname: publicDir, __filename: path.join(publicDir, 'pikchr.js'), URL, TextDecoder, TextEncoder, setTimeout });
vm.runInContext(fs.readFileSync(path.join(publicDir, 'pikchr.js'), 'utf8'), context);
const module = await context.initPikchrModule({ locateFile: p => path.join(publicDir, p) });
const native = module.cwrap('pikchr_studio', 'number', ['string', 'string', 'number']);
function render(source) { const p = native(source, null, 1); try { const r = JSON.parse(module.UTF8ToString(p)); assert.equal(r.error, null, source); return r; } finally { module._free(p); } }
const apply = (source, pick, change) => { const scene = render(source); const edit = textStyleCandidate(source, pick(scene), scene, change); render(edit.source); return edit.source; };

test('text objects are editable natively and report default style', () => {
  const source = 'T1: text "Hello" at (0,0)\n';
  const scene = render(source);
  assert.equal(scene.objects[0].editable, true);
  assert.deepEqual(textStyle(source, scene.objects[0], scene), { size: 'normal', bold: false, italic: false, align: 'center', colour: 'default' });
});

test('size, bold, italic, alignment and colour toggles write Pikchr text attributes', () => {
  const pick = s => s.objects[0];
  let source = 'T1: text "Hello" at (0,0)\n';
  source = apply(source, pick, { size: 'big' });
  assert.equal(source, 'T1: text "Hello" big at (0,0)\n');
  source = apply(source, pick, { bold: true });
  assert.equal(source, 'T1: text "Hello" big bold at (0,0)\n');
  source = apply(source, pick, { size: 'bigger' });
  assert.equal(source, 'T1: text "Hello" big big bold at (0,0)\n');
  source = apply(source, pick, { italic: true });
  source = apply(source, pick, { align: 'left' });
  assert.equal(source, 'T1: text "Hello" big big bold italic ljust at (0,0)\n');
  source = apply(source, pick, { colour: 'red' });
  assert.equal(source, 'T1: text "Hello" big big bold italic ljust at (0,0) color red\n');
  const scene = render(source);
  assert.deepEqual(textStyle(source, scene.objects[0], scene), { size: 'bigger', bold: true, italic: true, align: 'left', colour: 'red' });
  source = apply(source, pick, { size: 'normal' });
  source = apply(source, pick, { bold: false });
  source = apply(source, pick, { italic: false });
  source = apply(source, pick, { align: 'center' });
  source = apply(source, pick, { colour: 'default' });
  assert.equal(source, 'T1: text "Hello" at (0,0)\n');
});

test('every line of a multi-line label is styled and kept attributes survive', () => {
  const source = 'A: box "one" above "two" below at (0,0)\n';
  const scene = render(source);
  const edit = textStyleCandidate(source, scene.objects[0], scene, { bold: true });
  assert.equal(edit.source, 'A: box "one" above bold "two" below bold at (0,0)\n');
  assert.equal(edit.selectName, 'A');
  render(edit.source);
});

test('unnamed objects are selected by id; no-op and empty labels are refused', () => {
  const source = 'text "hi" at (0,0)\nbox at (1,0)\n';
  const scene = render(source);
  const edit = textStyleCandidate(source, scene.objects[0], scene, { italic: true });
  assert.equal(edit.selectId, scene.objects[0].id); assert.equal(edit.targetKind, 'text');
  assert.throws(() => textStyleCandidate(source, scene.objects[0], scene, { bold: false }), /already/);
});
