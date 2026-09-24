import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import {
  parseConnector, connectorState, routeStyleCandidates, strokeCandidates, weightCandidates, colourCandidates,
  chopCandidates, labelCandidates, checkStyleResult, thumbnailBox,
} from '../public/route-styles.js';
import { applyPatch } from '../public/edits.js';

const publicDir = path.resolve(import.meta.dirname, '../public');
const context = vm.createContext({ require: createRequire(import.meta.url), process, console, __dirname: publicDir, __filename: path.join(publicDir, 'pikchr.js'), URL, TextDecoder, TextEncoder, setTimeout });
vm.runInContext(fs.readFileSync(path.join(publicDir, 'pikchr.js'), 'utf8'), context);
const module = await context.initPikchrModule({ locateFile: p => path.join(publicDir, p) });
const native = module.cwrap('pikchr_studio', 'number', ['string']);
function render(source) { const pointer = native(source); try { return JSON.parse(module.UTF8ToString(pointer)); } finally { module._free(pointer); } }

const SHAPES = 'A: box "A" at (0,0)\nB: box "B" at (3,-1.5)\n';
function setup(connector, { shapes = SHAPES, after = '' } = {}) {
  const source = shapes + connector + '\n' + after;
  const scene = render(source);
  assert.equal(scene.error, null, source);
  const object = scene.objects.find(o => ['arrow','line','spline','arc'].includes(o.kind) && o.span.start >= Buffer.byteLength(shapes));
  return { source, scene, object };
}
const statementOf = (option, object) => option.patch.text;
const byId = (list, id) => list.find(o => o.id === id);
// Every candidate must render, keep the connector, and leave every other object where it was.
function assertValid(option, scene, object) {
  const result = render(option.source);
  assert.equal(checkStyleResult(scene, object, option, result), null, option.source);
  return result;
}

test('parser classifies style tokens and keeps path, labels and unknown attributes', () => {
  const { source, scene, object } = setup('Link: arrow from A.e to (1.5,0) then to B.w dashed 0.05 thick color red "go" above <-> chop fill blue');
  const model = parseConnector(source, object, scene);
  assert.ok(model);
  assert.deepEqual(model.styles.map(s => s.cat), ['dash','weight','color','label','head','chop']);
  assert.equal(model.path.map(t => t.text).join(' '), 'from A.e to ( 1.5 , 0 ) then to B.w fill blue');
  const state = connectorState(source, object, scene);
  assert.deepEqual({ ...state, label:undefined }, { kind:'arrow', heads:'<->', dash:'dashed', weight:'thick', colour:'red', chop:true, rounded:false, turn:null, label:undefined, labelEditable:true });
  assert.deepEqual(state.label, { text:'go', placement:'above' });
});

test('parser refuses macros, blocks, multi-line statements and interior comments', () => {
  for (const connector of ['arrow from A.e to B.w /* note */ dashed', 'arrow from A.e to B.w \\\n dashed']) {
    const source = SHAPES + connector + '\n';
    const scene = render(source);
    if (scene.error) continue;
    const object = scene.objects.at(-1);
    assert.equal(parseConnector(source, object, scene), null, connector);
    assert.deepEqual(routeStyleCandidates(source, object, scene).options, []);
  }
  const macro = 'define link { arrow from A.e to B.w }\n' + SHAPES + 'link\n';
  const scene = render(macro);
  assert.equal(parseConnector(macro, scene.objects.at(-1), scene), null);
});

test('curve converts an elbow arrow to a spline with the same waypoints and back', () => {
  const { source, scene, object } = setup('arrow from A.e to (3,0) then to B.n rad 0.1');
  const curve = byId(routeStyleCandidates(source, object, scene).options, 'curve');
  assert.equal(statementOf(curve), 'spline from A.e to (3,0) then to B.n ->');
  assert.equal(curve.targetKind, 'spline');
  assertValid(curve, scene, object);
  const back = setup('spline -> from A.e to (3,0) then to B.n');
  const straight = byId(routeStyleCandidates(back.source, back.object, back.scene).options, 'straighten');
  assert.equal(statementOf(straight), 'arrow from A.e to (3,0) then to B.n');
  assertValid(straight, back.scene, back.object);
  const none = setup('spline from A.e to (3,0) then to B.n');
  assert.equal(statementOf(byId(routeStyleCandidates(none.source, none.object, none.scene).options, 'straighten')), 'line from A.e to (3,0) then to B.n');
});

test('arc options exist for two-point connectors, flip and straighten for arcs', () => {
  const { source, scene, object } = setup('arrow from A.e to B.w');
  const options = routeStyleCandidates(source, object, scene).options;
  assert.equal(statementOf(byId(options, 'arc-cw')), 'arc from A.e to B.w -> cw');
  assert.equal(statementOf(byId(options, 'arc-ccw')), 'arc from A.e to B.w -> ccw');
  assert.equal(byId(options, 'curve'), undefined, 'a straight two-point route has no curve');
  for (const o of options) assertValid(o, scene, object);
  const arc = setup('arc -> from A.e to B.w cw');
  const arcOptions = routeStyleCandidates(arc.source, arc.object, arc.scene).options;
  assert.equal(statementOf(byId(arcOptions, 'flip-arc')), 'arc -> from A.e to B.w ccw');
  assert.equal(statementOf(byId(arcOptions, 'straighten')), 'arrow from A.e to B.w');
});

test('corners toggle rad 0.1 on multi-segment routes only', () => {
  const sharp = setup('arrow from A.e to (3,0) then to B.n');
  const rounded = byId(routeStyleCandidates(sharp.source, sharp.object, sharp.scene).options, 'rounded');
  assert.equal(statementOf(rounded), 'arrow from A.e to (3,0) then to B.n rad 0.1');
  assert.notEqual(render(rounded.source).svg, sharp.scene.svg);
  const round = setup('arrow from A.e to (3,0) then to B.n rad 0.1');
  assert.equal(statementOf(byId(routeStyleCandidates(round.source, round.object, round.scene).options, 'sharp')), 'arrow from A.e to (3,0) then to B.n');
  const two = setup('arrow from A.e to B.w');
  assert.equal(byId(routeStyleCandidates(two.source, two.object, two.scene).options, 'rounded'), undefined);
});

test('arrowheads cover all four states; an arrow with none becomes a line', () => {
  const { source, scene, object } = setup('Link: arrow from A.e to B.w');
  const options = routeStyleCandidates(source, object, scene).options;
  assert.equal(statementOf(byId(options, 'heads-start')), 'Link: arrow from A.e to B.w <-');
  assert.equal(statementOf(byId(options, 'heads-both')), 'Link: arrow from A.e to B.w <->');
  assert.equal(statementOf(byId(options, 'heads-none')), 'Link: line from A.e to B.w');
  assert.equal(byId(options, 'heads-end'), undefined, 'current state is not offered');
  for (const o of options) assertValid(o, scene, object);
  const line = setup('line from A.e to B.w');
  assert.equal(statementOf(byId(routeStyleCandidates(line.source, line.object, line.scene).options, 'heads-end')), 'line from A.e to B.w ->');
  const both = setup('arrow <-> from A.e to B.w');
  assert.equal(statementOf(byId(routeStyleCandidates(both.source, both.object, both.scene).options, 'heads-end')), 'arrow from A.e to B.w');
});

test('type changes are withheld when another object depends on the connector', () => {
  const { source, scene, object } = setup('arrow from A.e to B.w', { after:'C: circle at last arrow.end' });
  const { options, unavailable } = routeStyleCandidates(source, object, scene);
  assert.equal(byId(options, 'heads-none'), undefined);
  assert.ok(unavailable.some(u => u.id === 'heads-none' && /refers to this connector/.test(u.reason)));
  assert.ok(byId(options, 'heads-both'), 'same-kind edits remain available');
  assertValid(byId(options, 'heads-both'), scene, object);
});

test('stroke, weight, colour and chop swap in place and preserve everything else', () => {
  const { source, scene, object } = setup('arrow "café 😀" above from A.e to B.w thin color blue fill red');
  assert.equal(statementOf(strokeCandidates(source, object, scene, 'dashed')[0]), 'arrow "café 😀" above from A.e to B.w thin color blue fill red dashed');
  assert.equal(statementOf(weightCandidates(source, object, scene, 'thick')[0]), 'arrow "café 😀" above from A.e to B.w thick color blue fill red');
  assert.equal(statementOf(weightCandidates(source, object, scene, 'normal')[0]), 'arrow "café 😀" above from A.e to B.w color blue fill red');
  assert.equal(statementOf(colourCandidates(source, object, scene, 'red')[0]), 'arrow "café 😀" above from A.e to B.w thin color red fill red');
  assert.equal(statementOf(colourCandidates(source, object, scene, 'default')[0]), 'arrow "café 😀" above from A.e to B.w thin fill red');
  assert.equal(statementOf(chopCandidates(source, object, scene, true)[0]), 'arrow "café 😀" above from A.e to B.w thin color blue fill red chop');
  assert.deepEqual(weightCandidates(source, object, scene, 'thin'), [], 'no-op edits are not offered');
  assert.deepEqual(colourCandidates(source, object, scene, 'purple'), []);
  const dashed = setup('arrow from A.e to B.w dashed 0.05');
  assert.equal(statementOf(strokeCandidates(dashed.source, dashed.object, dashed.scene, 'dotted')[0]), 'arrow from A.e to B.w dotted');
  assert.equal(statementOf(strokeCandidates(dashed.source, dashed.object, dashed.scene, 'solid')[0]), 'arrow from A.e to B.w');
  for (const list of [strokeCandidates(source, object, scene, 'dotted'), weightCandidates(source, object, scene, 'thick'), colourCandidates(source, object, scene, 'green'), chopCandidates(source, object, scene, true)])
    assertValid(list[0], scene, object);
});

test('labels are added, edited with escaping, and removed; several labels stay source-only', () => {
  const { source, scene, object } = setup('arrow from A.e to B.w');
  const added = labelCandidates(source, object, scene, { text:'say "hi" \\ ✓', placement:'above' })[0];
  assert.equal(statementOf(added), 'arrow from A.e to B.w "say \\"hi\\" \\\\ ✓" above');
  const result = assertValid(added, scene, object);
  assert.match(result.svg, /say\s"hi"\s&#92;\s✓/);
  const labelled = setup('arrow from A.e to B.w "old" below italic');
  assert.equal(statementOf(labelCandidates(labelled.source, labelled.object, labelled.scene, { text:'new', placement:'aligned' })[0]), 'arrow from A.e to B.w "new" aligned italic');
  assert.equal(statementOf(labelCandidates(labelled.source, labelled.object, labelled.scene, { text:'' })[0]), 'arrow from A.e to B.w');
  assert.deepEqual(labelCandidates(source, object, scene, { text:'a\nb' }), []);
  const two = setup('arrow from A.e to B.w "a" above "b" below');
  assert.deepEqual(labelCandidates(two.source, two.object, two.scene, { text:'x' }), []);
  assert.equal(connectorState(two.source, two.object, two.scene).labelEditable, false);
});

test('edits keep CRLF documents, comments, unicode and unnamed connectors intact', () => {
  const shapes = '# café 😀 header\r\nA: box "Ünïcødé" at (0,0)\r\nB: box "B" at (3,-1.5)\r\n';
  const source = shapes + 'arrow from A.e to (3,0) then to B.n # trailing note\r\n# untouched\r\n';
  const scene = render(source); assert.equal(scene.error, null);
  const object = scene.objects.at(-1);
  const curve = byId(routeStyleCandidates(source, object, scene).options, 'curve');
  assert.equal(curve.source, shapes + 'spline from A.e to (3,0) then to B.n -> # trailing note\r\n# untouched\r\n');
  assert.equal(applyPatch(source, curve.patch), curve.source);
  assert.throws(() => applyPatch(source + ' ', curve.patch), /Source changed/);
  assertValid(curve, scene, object);
});

test('bend ties replace aligned literal bends with until even with and keep the geometry', () => {
  const shapes = 'A: box "A" at (0,0)\nB: box "B" at (3,-1.5)\nC: box "C" at (1.5,1)\n';
  const { source, scene, object } = setup('arrow from A.e to (1.5,0) then to (1.5,-1.5) then to B.w', { shapes });
  const options = routeStyleCandidates(source, object, scene).options;
  const all = byId(options, 'tie-bends');
  assert.equal(statementOf(all), 'arrow from A.e right until even with C then down until even with B then to B.w');
  const result = assertValid(all, scene, object);
  assert.equal(all.preservePath > 0, true);
  assert.deepEqual(result.objects.at(-1).path.map(p => [p.x, p.y]), object.path.map(p => [p.x, p.y]));
  assert.ok(byId(options, 'tie-bend-1') && byId(options, 'tie-bend-2'));
  for (const id of ['tie-bend-1','tie-bend-2']) assertValid(byId(options, id), scene, object);
  // After moving C, the tied bend follows it.
  const moved = render(all.source.replace('C: box "C" at (1.5,1)', 'C: box "C" at (2,1)'));
  assert.equal(moved.objects.at(-1).path[1].x, 2);
});

test('near-miss bends tie only within 0.05 in and never turn a segment diagonal', () => {
  const shapes = 'A: box "A" at (0,0)\nB: box "B" at (3,-1.5)\nC: box "C" at (1.53,1)\n';
  const { source, scene, object } = setup('arrow from A.e to (1.5,0) then to (1.5,-1.5) then to B.w', { shapes });
  const options = routeStyleCandidates(source, object, scene).options;
  // Tying bend 1 alone to C would tilt the vertical segment to the literal bend 2.
  assert.equal(byId(options, 'tie-bend-1'), undefined);
  const all = byId(options, 'tie-bends');
  assert.ok(all);
  assertValid(all, scene, object);
  const far = setup('arrow from A.e to (1.5,0) then to (1.5,-1.5) then to B.w', { shapes:shapes.replace('1.53', '1.7') });
  const farOptions = routeStyleCandidates(far.source, far.object, far.scene).options;
  assert.match(statementOf(byId(farOptions, 'tie-bends')), /right 1.5|to \(1.5,0\)/);
});

test('detours clear intermediate shapes and end at the original endpoint reference', () => {
  const shapes = 'A: box "A" at (0,0)\nM: box "M" at (1.5,0) height 1\nB: box "B" at (3,0)\n';
  const { source, scene, object } = setup('Link: arrow from A.e to B.w dashed', { shapes });
  const options = routeStyleCandidates(source, object, scene).options;
  const above = byId(options, 'detour-above');
  assert.equal(statementOf(above), 'Link: arrow from A.n up 0.45 then right until even with B.n then to B.n dashed');
  const below = byId(options, 'detour-below');
  assert.match(statementOf(below), /^Link: arrow from A\.s down [\d.]+ then right until even with B\.s then to B\.s dashed$/);
  for (const o of [above, below]) {
    const result = assertValid(o, scene, object);
    const p = result.objects.at(-1).path, m = result.objects.find(n => n.name === 'M').bbox;
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      const hit = Math.max(a.x, b.x) > m.x && Math.min(a.x, b.x) < m.x + m.width && Math.max(a.y, b.y) > m.y && Math.min(a.y, b.y) < m.y + m.height;
      assert.equal(hit, false, o.label);
    }
  }
  assert.equal(byId(options, 'detour-left'), undefined, 'ends on one row have no left/right detour');
  const back = byId(options, 'back-above');
  assert.equal(back.targetKind, 'spline');
  assert.match(statementOf(back), /^Link: spline from A\.n up [\d.]+ then right until even with B\.n then to B\.n dashed ->$/);
  assertValid(back, scene, object);
});

test('self-loops offer square, curved and outward arc presets on one shape', () => {
  const { source, scene, object } = setup('arrow from A.n to A.e');
  const options = routeStyleCandidates(source, object, scene).options;
  assert.equal(statementOf(byId(options, 'loop-ne')), 'arrow from A.ne up 0.25 then right 0.25 then down until even with A.e then to A.e');
  assert.equal(statementOf(byId(options, 'loop-se')), 'arrow from A.se down 0.25 then right 0.25 then up until even with A.e then to A.e');
  assert.equal(statementOf(byId(options, 'loop-curved')), 'spline from A.ne up 0.25 then right 0.25 then down until even with A.e then to A.e ->');
  assert.equal(statementOf(byId(options, 'loop-arc')), 'arc from A.n to A.e -> cw');
  for (const id of ['loop-ne','loop-se','loop-curved','loop-arc']) {
    const result = assertValid(byId(options, id), scene, object);
    const a = result.objects.find(n => n.name === 'A').bbox, p = result.objects.at(-1).path;
    const inside = q => q.x > a.x + 1e-3 && q.x < a.x + a.width - 1e-3 && q.y > a.y + 1e-3 && q.y < a.y + a.height - 1e-3;
    assert.equal(p.some(inside), false, id);
  }
  assert.equal(byId(options, 'detour-above'), undefined);
});

test('checkStyleResult rejects moved neighbours, lost identity and changed geometry', () => {
  const { source, scene, object } = setup('arrow from A.e to B.w');
  const option = { targetKind:'arrow', preserveOthers:true };
  assert.equal(checkStyleResult(scene, object, option, render(source)), null);
  assert.match(checkStyleResult(scene, object, option, render(source.replace('at (3,-1.5)', 'at (3,-2)'))), /move B/);
  assert.match(checkStyleResult(scene, object, { ...option, targetKind:'line' }, render(source)), /could not be identified/);
  assert.match(checkStyleResult(scene, object, { ...option, preservePath:0.01 }, render(source.replace('to B.w', 'to B.n'))), /original geometry/);
  assert.match(checkStyleResult(scene, object, option, { error:'syntax error' }), /syntax error/);
});

test('thumbnail box covers the connector and the shapes it touches in SVG units', () => {
  const { scene, object } = setup('arrow from A.e to B.w');
  const box = thumbnailBox(scene, object.id);
  const t = scene.transform, a = scene.objects[0].bbox, b = scene.objects[1].bbox;
  assert.ok(box.x <= t.a * a.x + t.e && box.x + box.width >= t.a * (b.x + b.width) + t.e);
  assert.ok(box.y <= t.d * (a.y + a.height) + t.f && box.y + box.height >= t.d * b.y + t.f);
  assert.equal(thumbnailBox(scene, 'missing'), null);
});

test('all gallery candidates for a typical diagram render and pass the guard', () => {
  const shapes = 'A: box "A" at (0,0)\nM: box "M" at (1.5,0)\nB: box "B" at (3,0)\nC: box "C" at (3,-1.5)\n';
  for (const connector of ['arrow from A.e to B.w', 'arrow from A.s to (0,-1.5) then to C.w', 'Named: line <-> from B.s to C.n', 'spline -> from A.n to (1.5,1) then to B.n', 'arc from A.e to M.w cw', 'arrow from B.n to B.e']) {
    const { source, scene, object } = setup(connector, { shapes });
    const { options } = routeStyleCandidates(source, object, scene);
    assert.ok(options.length >= 3, connector);
    assert.equal(new Set(options.map(o => o.source)).size, options.length, 'no duplicate candidates');
    for (const o of options) assertValid(o, scene, object);
  }
});
