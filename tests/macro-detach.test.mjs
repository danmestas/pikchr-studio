import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudio} from './pikchr-wasm.mjs';
import {macroDefinitions, macroCallSites, inlineCall, detachCandidates, macroUses} from '../public/macro-detach.js';
import {applyPatch} from '../public/edits.js';

const bytes = text => new TextEncoder().encode(text).length;
const slice = (source, span) => Buffer.from(source).subarray(span.start, span.end).toString();
const render = async text => compileStudio(text).scene;
const scene = text => { const s = compileStudio(text).scene; assert.ok(!s.error, s.error); return s; };
const def = (source, name) => { const d = macroDefinitions(source).find(x => x.name === name); return d; };
const macroShapes = s => s.objects.filter(o => o.reason === 'Macro-expanded object');
const geometry = s => s.objects.map(o => [o.kind, o.center.x, o.center.y, o.bbox.width, o.bbox.height].join());
async function detach(source, pick, only) {
  const original = scene(source), object = pick(original);
  return {original, object, ...await detachCandidates(source, object, original, render, {only})};
}

test('definitions report name, body and UTF-8 byte spans; comments and strings are skipped', () => {
  const source = '# café define fake { box }\ntext "define nope { box }"\n/* define gone { x } */\ndefine tile { box "é" }\n';
  const defs = macroDefinitions(source);
  assert.deepEqual(defs.map(d => d.name), ['tile']);
  assert.equal(defs[0].body, ' box "é" ');
  assert.equal(slice(source, defs[0].span), 'define tile { box "é" }');
  assert.equal(slice(source, defs[0].bodySpan), ' box "é" ');
});

test('call sites: bare, argument forms, nesting, and what must not match', () => {
  const source = 'define m { box $1 $2 }\n# m in a comment\ntext "m in a string"\nmm = 1\n$m = 2\n'
    + 'm\nm("a, (b)", width (1+2)*0.5)\nG: [ m(fill red) ]\nm ; text "z"\n';
  const sites = macroCallSites(source, 'm');
  assert.deepEqual(sites.map(s => s.text), ['m', 'm("a, (b)", width (1+2)*0.5)', 'm(fill red)', 'm']);
  assert.deepEqual(sites[1].args, ['"a, (b)"', 'width (1+2)*0.5']);
  assert.deepEqual(sites[0].args, []);
  for (const s of sites) assert.equal(slice(source, s.span), s.text);
  scene(source);
});

test('labels, longer identifiers, anchors and other define bodies are not call sites', () => {
  const source = 'define m { box }\ndefine n { m; circle }\nA: box\nline from A.m to A.e\nm_2 = 1\nn\n';
  assert.deepEqual(macroCallSites(source, 'm'), []);
  assert.equal(macroCallSites(source, 'n').length, 1);
  assert.deepEqual(macroCallSites('m\ndefine m { box }\n', 'm'), [], 'uses before the define do not count');
  assert.deepEqual(macroCallSites('define m { box }\nm: box\n', 'm'), [], 'a label is not a use');
  assert.deepEqual(macroCallSites('define m { box $1 }\nm("a)b", [x(1)])\n', 'm')[0].args, ['"a)b"', '[x(1)]']);
});

test('inlining one site keeps indentation and leaves the define byte-identical', () => {
  const source = 'define pair {\n  box "$1"\n  circle $1\n}\nG: [\n    pair("x")\n]\n';
  const [site] = macroCallSites(source, 'pair');
  const next = inlineCall(source, site, def(source, 'pair'));
  assert.equal(next, 'define pair {\n  box "$1"\n  circle $1\n}\nG: [\n    # detached from pair\n    box "$1"\n    circle "x"\n]\n');
  assert.ok(next.startsWith('define pair {\n  box "$1"\n  circle $1\n}\n'));
  assert.deepEqual(geometry(scene(next)), geometry(scene(source)));
});

test('detach one of two uses: exact geometry, only that use, UTF-8 offsets', async () => {
  const source = '# Ünïcode ☕\ndefine tile { $1: box $2 at $3 }\ntile(A, "Café ☕", (0,0))\ntile(B, "資料", (2,0))\n';
  const {original, options, refusals, uses, macro} = await detach(source, s => s.objects[1]);
  assert.equal(macro, 'tile'); assert.equal(uses, 2);
  assert.deepEqual(refusals, []);
  const one = options.find(o => o.id === 'detach'), all = options.find(o => o.id === 'detach-all');
  assert.equal(one.source, '# Ünïcode ☕\ndefine tile { $1: box $2 at $3 }\ntile(A, "Café ☕", (0,0))\n# detached from tile\nB: box "資料" at (2,0)\n');
  assert.equal(applyPatch(source, one.patch), one.source);
  assert.equal(one.patch.start, bytes('# Ünïcode ☕\ndefine tile { $1: box $2 at $3 }\ntile(A, "Café ☕", (0,0))\n'));
  assert.equal(all.source, '# Ünïcode ☕\ndefine tile { $1: box $2 at $3 }\n# detached from tile\nA: box "Café ☕" at (0,0)\n# detached from tile\nB: box "資料" at (2,0)\n');
  assert.equal(applyPatch(source, all.patch), all.source);
  for (const option of options) {
    assert.equal(option.base, source);
    assert.equal(slice(option.source, macroDefinitions(option.source)[0].span), 'define tile { $1: box $2 at $3 }');
    assert.deepEqual(geometry(option.result), geometry(original));
  }
  const after = scene(one.source), target = after.objects.find(o => o.id === one.selectId);
  assert.equal(target.name, 'B'); assert.equal(target.editable, true);
  assert.equal(after.objects[0].reason, 'Macro-expanded object');
  assert.equal(macroShapes(scene(all.source)).length, 0);
});

test('detach the first use identifies the right site', async () => {
  const source = 'define tile { box "t" }\ntile\ntile\ntile\n';
  const {options} = await detach(source, s => s.objects[0], 'detach');
  assert.deepEqual(options.map(o => o.id), ['detach']);
  assert.equal(options[0].source, 'define tile { box "t" }\n# detached from tile\nbox "t"\ntile\ntile\n');
  assert.equal(options[0].selectId, 'o1');
});

test('mid-line uses are inlined verbatim; CRLF sources keep CRLF', async () => {
  const source = 'define m { box "a"\r\n  circle }\r\nbox; m; text "z"\r\n';
  const {options} = await detach(source, s => s.objects[2]);
  assert.equal(options[0].source, 'define m { box "a"\r\n  circle }\r\nbox; box "a"\r\ncircle; text "z"\r\n');
});

test('a use inside another call\'s arguments gets no comment line', async () => {
  const source = 'define sz { 2 }\ndefine sized { box width $1 }\nsized(\n  sz\n)\n';
  const [site] = macroCallSites(source, 'sz');
  assert.equal(site.enclosed, true);
  const {original, options} = await detach(source, s => s.objects[0]);
  assert.equal(options[0].source, 'define sz { 2 }\ndefine sized { box width $1 }\n# detached from sized\nbox width sz\n');
  const next = inlineCall(source, site, def(source, 'sz'));
  assert.equal(next, 'define sz { 2 }\ndefine sized { box width $1 }\nsized(\n  2\n)\n');
  assert.deepEqual(geometry(scene(next)), geometry(original));
});

test('a trailing line comment in the body cannot swallow the rest of the line', async () => {
  const source = 'define m {\n  box # first\n}\nm; circle\n';
  const {original, options} = await detach(source, s => s.objects[0]);
  assert.equal(options[0].source, 'define m {\n  box # first\n}\n# detached from m\nbox # first\n; circle\n');
  assert.deepEqual(geometry(options[0].result), geometry(original));
});

test('nested macros: the copy keeps the inner call and says so', async () => {
  const source = 'define inner { circle $1 }\ndefine outer { box; inner($1) }\nouter("z")\nouter("w")\n';
  const {options} = await detach(source, s => s.objects[0], 'detach');
  assert.equal(options[0].source, 'define inner { circle $1 }\ndefine outer { box; inner($1) }\n# detached from outer\nbox; inner("z")\nouter("w")\n');
  assert.match(options[0].note, /still calls inner/);
  const next = scene(options[0].source);
  assert.notEqual(next.objects[0].reason, 'Macro-expanded object');
  assert.equal(next.objects[1].reason, 'Macro-expanded object');
  // Now the inner use is top-level and can itself be detached.
  const inner = await detachCandidates(options[0].source, next.objects[1], next, render, {only:'detach'});
  assert.equal(inner.macro, 'inner');
  assert.match(inner.options[0].source, /\nbox; circle "z"\nouter/);
});

test('refusals: not a macro, only nested uses, identical twins, too many uses', async () => {
  let r = await detach('box "plain"\n', s => s.objects[0]);
  assert.match(r.refusals[0].reason, /not generated by a macro/);
  r = await detach('define inner { circle }\ndefine outer { inner }\nouter\n', s => s.objects[0]);
  assert.deepEqual(r.options, []);
  assert.match(r.refusals[0].reason, /inner is only used inside other macro definitions \(outer\)/);
  // Identical shapes are told apart by drawing order: the second use draws object 2.
  r = await detach('define m { box at (0,0) }\nm\nm\n', s => s.objects[1], 'detach');
  assert.equal(r.options[0].source, 'define m { box at (0,0) }\nm\n# detached from m\nbox at (0,0)\n');
  r = await detach('define m { box }\n' + 'm\n'.repeat(65), s => s.objects[0], 'detach');
  assert.match(r.refusals[0].reason, /65 uses; Studio checks at most 64/);
  assert.equal(macroUses('define m { box }\nm\nm\n', scene('define m { box }\nm\nm\n').objects[1]).uses, 2);
});

test('refusal: a candidate whose drawing differs from the original is not offered', async () => {
  const source = 'define outer { box width $1 }\nouter(1)\nouter(2)\n', original = scene(source);
  const fake = {...original, objects:original.objects.map(o => ({...o, center:{x:o.center.x+1, y:o.center.y}}))};
  const changed = await detachCandidates(source, fake.objects[0], fake, render);
  assert.deepEqual(changed.options, []);
  assert.match(changed.refusals.find(r => r.id === 'detach').reason, /No use of outer could be identified/);
  assert.match(changed.refusals.find(r => r.id === 'detach-all').reason, /object 1 \(box\) would change/);
  const broken = await detachCandidates(source, original.objects[0], original, async () => ({error:'ERROR: boom'}));
  assert.match(broken.refusals[0].reason, /No use of outer could be identified as producing this shape \(it does not render: ERROR: boom\)/);
});

test('detach all refuses changed geometry', async () => {
  const two = 'define m { box "q" }\nm\nm\n', t = scene(two);
  const skewed = {...t, objects:t.objects.map((o, i) => i ? {...o, bbox:{...o.bbox, width:9}} : o)};
  const bad = await detachCandidates(two, t.objects[0], skewed, render, {only:'detach-all'});
  assert.match(bad.refusals[0].reason, /Detaching every use of m is not offered: object 2 \(box\) would change/);
});

test('a nested use is never confused with a top-level use that draws the same shape', async () => {
  const source = 'define inner { circle at (0,0) }\ndefine outer { inner }\ninner\nouter\n';
  // o2 comes from outer -> inner. Inlining the top-level inner makes o1 native
  // and draws the same circle, but that is not the selected object.
  const nested = await detach(source, s => s.objects[1], 'detach');
  assert.equal(nested.macro, 'inner');
  assert.deepEqual(nested.options, []);
  assert.match(nested.refusals[0].reason, /No use of inner could be identified/);
  const top = await detach(source, s => s.objects[0], 'detach');
  assert.equal(top.options[0].source, 'define inner { circle at (0,0) }\ndefine outer { inner }\n# detached from inner\ncircle at (0,0)\nouter\n');
  assert.equal(top.options[0].selectId, 'o1');
});

test('a candidate that changes only fill, stroke or path is refused', async () => {
  const source = 'define m { line from (0,0) to (1,1) then to (2,0) }\nm\nbox at (3,0)\n', original = scene(source);
  const altered = change => async text => { const r = await render(text); return text === source ? r : change(r); };
  const fill = await detachCandidates(source, original.objects[0], original,
    altered(r => ({...r, svg:r.svg.replace('fill:none', 'fill:rgb(255,0,0)')})), {only:'detach'});
  assert.deepEqual(fill.options, []);
  const stroke = await detachCandidates(source, original.objects[0], original,
    altered(r => ({...r, svg:r.svg.replace('stroke:rgb(0,0,0)', 'stroke:rgb(0,0,255)')})), {only:'detach'});
  assert.deepEqual(stroke.options, []);
  const path = await detachCandidates(source, original.objects[0], original,
    altered(r => ({...r, objects:r.objects.map((o, i) => i ? o : {...o, path:o.path.map((p, j) => j === 1 ? {x:p.x, y:p.y - .5} : p)})})), {only:'detach'});
  assert.deepEqual(path.options, []);
  const same = await detachCandidates(source, original.objects[0], original, render, {only:'detach'});
  assert.equal(same.options.length, 1);
});
