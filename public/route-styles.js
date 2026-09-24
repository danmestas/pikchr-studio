// Route styles: every connector restyle is a whole-statement source edit that
// the caller renders and checks before showing it. Only style tokens this
// module recognises are rewritten; every other token keeps its bytes.
import { byteOffsetToIndex, applyPatch, editability } from './edits.js?v=20260923c';
import { obstacleRects } from './route-suggestions.js?v=20260923c';

const CONNECTORS = ['arrow','line','spline','arc'];
const NON_OBSTACLES = [...CONNECTORS, 'move'];
const TOKEN = /"(?:\\.|[^"\\])*"|<->|->|<-|0x[0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:cm|mm|in|px|pt|%)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*|\S/g;
const NAME = /^[A-Z][A-Za-z0-9_]*$/;
const REF = /^[A-Z][A-Za-z0-9_]*(?:\.(?:ne|nw|se|sw|c|n|s|e|w))?$/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:cm|mm|in|px|pt|%)?$/;
const PLAIN_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:in)?$/;
const HEX = /^0x[0-9a-fA-F]+$/;
const TEXT_ATTRS = new Set(['above','below','aligned','ljust','rjust','center','bold','italic','big','small','mono','monospace']);
const PLACEMENTS = ['above','below','aligned','center'];
const ANCHOR_ORDER = ['c','n','s','e','w','ne','nw','se','sw'];
export const routeColours = ['black','white','red','blue','green','yellow','gray'];
const COLOUR_WORDS = new Set([...routeColours, 'grey']);
const LOCKED = 'Another object refers to this connector, so changing its type could move that object.';
const MARGIN = 0.2, LOOP = 0.25, TIE = 0.05, EPS = 1e-6;

const fmt = v => Number((Math.round(v / 0.05) * 0.05).toFixed(2)).toString();
const up05 = v => Math.ceil(v / 0.05 - 1e-9) * 0.05;
const refText = (name, anchor) => anchor === 'c' ? name : `${name}.${anchor}`;

// Tokenise one connector statement into header, kind, style groups and path
// tokens. Anything this module cannot classify safely returns null.
export function parseConnector(source, object, scene) {
  if (!object || !CONNECTORS.includes(object.kind) || !editability(object, scene).editable) return null;
  let start, end;
  try { start = byteOffsetToIndex(source, object.span.start); end = byteOffsetToIndex(source, object.span.end); }
  catch { return null; }
  const statement = source.slice(start, end);
  const masked = statement.replace(/"(?:\\.|[^"\\])*"/g, m => ' '.repeat(m.length));
  if (/[\n\r;\[\]{}#\\]|\/\/|\/\*/.test(masked)) return null;
  const tokens = [...statement.matchAll(TOKEN)].map(m => ({ text:m[0], start:m.index, end:m.index + m[0].length, cat:'path', group:-1 }));
  let i = 0, name = null;
  if (tokens[1]?.text === ':' && NAME.test(tokens[0]?.text || '')) {
    name = tokens[0].text; tokens[0].cat = tokens[1].cat = 'header'; i = 2;
  }
  if ((name || null) !== (object.name || null) || tokens[i]?.text !== object.kind) return null;
  tokens[i].cat = 'kind';
  const kindIndex = i, styles = [];
  const take = (index, cat, extra = 0) => {
    const group = styles.length;
    for (let k = index; k <= index + extra; k++) { tokens[k].cat = cat; tokens[k].group = group; }
    styles.push({ cat, from:index, to:index + extra, text:tokens.slice(index, index + extra + 1).map(t => t.text).join(' ') });
    return index + extra;
  };
  for (i = kindIndex + 1; i < tokens.length; i++) {
    const t = tokens[i].text, next = tokens[i + 1]?.text;
    if (t === '->' || t === '<-' || t === '<->') i = take(i, 'head');
    else if (t === 'dashed' || t === 'dotted') i = take(i, 'dash', NUMBER.test(next || '') ? 1 : 0);
    else if (t === 'solid') i = take(i, 'dash');
    else if (t === 'thin' || t === 'thick') i = take(i, 'weight');
    else if (t === 'thickness') { if (!NUMBER.test(next || '')) return null; i = take(i, 'weight', 1); }
    else if (t === 'color') { if (!(COLOUR_WORDS.has(next) || HEX.test(next || '') || NUMBER.test(next || ''))) return null; i = take(i, 'color', 1); }
    else if (t === 'rad' || t === 'radius') { if (!NUMBER.test(next || '')) return null; i = take(i, 'rad', 1); }
    else if (t === 'chop') i = take(i, 'chop');
    else if (t === 'cw' || t === 'ccw') i = take(i, 'turn');
    else if (t.startsWith('"')) {
      let extra = 0;
      while (TEXT_ATTRS.has(tokens[i + extra + 1]?.text)) extra++;
      i = take(i, 'label', extra);
    }
  }
  return { source, object, statement, tokens, styles, kind:object.kind, name, kindIndex,
    path:tokens.filter(t => t.cat === 'path') };
}

const styleOf = (model, cat) => model.styles.filter(s => s.cat === cat);

export function headsOf(model) {
  const t = styleOf(model, 'head').at(-1)?.text;
  if (model.kind === 'arrow') return t === '<-' || t === '<->' ? t : '->';
  return t || 'none';
}
const headToken = (kind, heads, model) => {
  if (heads === 'none') return null;
  // An arrow's `->` is implicit; keep an explicit one only where the author wrote it.
  if (kind === 'arrow') return heads === '->' ? (model.kind === 'arrow' && styleOf(model, 'head').at(-1)?.text === '->' ? '->' : null) : heads;
  return heads;
};
// A kind that can carry these heads: an arrow without heads must become a line.
const kindFor = (kind, heads) => kind === 'arrow' && heads === 'none' ? 'line' : kind;

// Rebuild the statement. `set` replaces the first group of a category in place
// (null removes it) and appends when the category is absent; `path` replaces
// every path token, which then sits right after the kind keyword.
function compose(model, { kind = model.kind, set = {}, path = null }) {
  const { statement, tokens } = model;
  const replaced = new Map(), removed = new Set();
  for (const [cat, text] of Object.entries(set)) {
    const groups = styleOf(model, cat);
    groups.forEach((g, n) => {
      for (let k = g.from; k <= g.to; k++) removed.add(k);
      if (n === 0 && text) replaced.set(g.from, text);
    });
  }
  let out = statement.slice(0, tokens[0]?.start ?? 0), lastEmitted = -1, pathPlaced = false;
  const emit = (text, index) => {
    let gap = index > 0 ? statement.slice(tokens[index - 1].end, tokens[index].start) : '';
    // After a removed token, keep one space unless punctuation closes up.
    if (lastEmitted !== index - 1) gap = /^[),]/.test(text) || out.endsWith('(') ? '' : gap || ' ';
    out += (out.length ? gap : '') + text;
    lastEmitted = index;
  };
  tokens.forEach((t, index) => {
    if (t.cat === 'kind') { emit(kind, index); if (path !== null) { out += ' ' + path; pathPlaced = true; } return; }
    if (path !== null && t.cat === 'path') return;
    if (replaced.has(index)) { emit(replaced.get(index), index); return; }
    if (removed.has(index)) return;
    emit(t.text, index);
  });
  for (const [cat, text] of Object.entries(set)) if (text && !styleOf(model, cat).length) out += ' ' + text;
  if (path !== null && !pathPlaced) return null;
  return out.replace(/[ \t]+$/, '');
}

function makeOption(model, spec, meta) {
  const text = compose(model, spec);
  if (text === null || text === model.statement) return null;
  const { source, object, statement } = model;
  const patch = { start:object.span.start, end:object.span.end, text, expected:statement, base:source };
  return { ...meta, patch, source:applyPatch(source, patch), selectId:object.id,
    ...(object.name ? { selectName:object.name } : {}), targetKind:spec.kind || model.kind, preserveOthers:true,
    ...(spec.preservePath !== undefined ? { preservePath:spec.preservePath } : {}) };
}

const dependents = (object, scene) => (scene?.objects || []).filter(o => o.id !== object.id && (o.dependencies || []).includes(object.id));

function collector(model, scene) {
  const options = [], unavailable = [], locked = dependents(model.object, scene).length > 0;
  const add = (id, group, label, spec) => {
    const target = spec.kind || model.kind;
    if (target !== model.kind && locked) { unavailable.push({ id, group, label, reason:LOCKED }); return; }
    const option = makeOption(model, spec, { id, group, label });
    // Two presets can spell the same program; show it once, under its first name.
    if (option && !options.some(o => o.source === option.source)) options.push(option);
  };
  return { options, unavailable, add };
}

// Current style, for chips that show what is already on.
export function connectorState(source, object, scene) {
  const model = parseConnector(source, object, scene);
  if (!model) return null;
  const dash = styleOf(model, 'dash').at(-1)?.text.split(' ')[0];
  const weight = styleOf(model, 'weight').at(-1)?.text.split(' ')[0];
  const labels = styleOf(model, 'label');
  const label = labels.length === 1 ? (() => {
    const parts = model.tokens.slice(labels[0].from, labels[0].to + 1).map(t => t.text);
    const placement = parts.slice(1).find(p => ['above','below','aligned'].includes(p)) || 'center';
    return { text:parts[0].slice(1, -1).replace(/\\(.)/g, '$1'), placement };
  })() : null;
  return {
    kind:model.kind, heads:headsOf(model),
    dash:dash === 'dashed' || dash === 'dotted' ? dash : 'solid',
    weight:weight === 'thickness' ? 'custom' : weight || 'normal',
    colour:styleOf(model, 'color').at(-1)?.text.split(' ')[1] || 'default',
    chop:styleOf(model, 'chop').length > 0, rounded:styleOf(model, 'rad').length > 0,
    turn:model.kind === 'arc' ? (styleOf(model, 'turn').at(-1)?.text || 'ccw') : null,
    label, labelEditable:labels.length <= 1,
  };
}

export function strokeCandidates(source, object, scene, dash) {
  const model = parseConnector(source, object, scene);
  if (!model || !['solid','dashed','dotted'].includes(dash)) return [];
  const option = makeOption(model, { set:{ dash:dash === 'solid' ? null : dash } }, { id:'stroke-' + dash, group:'Stroke', label:dash[0].toUpperCase() + dash.slice(1) });
  return option ? [option] : [];
}
export function weightCandidates(source, object, scene, weight) {
  const model = parseConnector(source, object, scene);
  if (!model || !['thin','normal','thick'].includes(weight)) return [];
  const option = makeOption(model, { set:{ weight:weight === 'normal' ? null : weight } }, { id:'weight-' + weight, group:'Weight', label:weight[0].toUpperCase() + weight.slice(1) + ' line' });
  return option ? [option] : [];
}
export function colourCandidates(source, object, scene, colour) {
  const model = parseConnector(source, object, scene);
  if (!model || !(colour === 'default' || routeColours.includes(colour))) return [];
  const option = makeOption(model, { set:{ color:colour === 'default' ? null : 'color ' + colour } }, { id:'colour-' + colour, group:'Colour', label:colour === 'default' ? 'Default colour' : 'Colour ' + colour });
  return option ? [option] : [];
}
export function chopCandidates(source, object, scene, on) {
  const model = parseConnector(source, object, scene);
  if (!model) return [];
  const option = makeOption(model, { set:{ chop:on ? 'chop' : null } }, { id:on ? 'chop' : 'unchop', group:'Ends', label:on ? 'Chop at shape edges' : 'Remove chop' });
  return option ? [option] : [];
}
// Zero or one label. Several labels stay source-only rather than guessed.
export function labelCandidates(source, object, scene, { text = '', placement = 'above' } = {}) {
  const model = parseConnector(source, object, scene);
  if (!model || styleOf(model, 'label').length > 1 || !PLACEMENTS.includes(placement)) return [];
  if (/[\u0000-\u001f\u007f]/.test(text)) return [];
  if (!text) {
    const option = makeOption(model, { set:{ label:null } }, { id:'label-remove', group:'Label', label:'Remove label' });
    return option ? [option] : [];
  }
  const current = styleOf(model, 'label')[0];
  const kept = current ? model.tokens.slice(current.from + 1, current.to + 1).map(t => t.text).filter(p => !PLACEMENTS.includes(p)) : [];
  const literal = '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const value = [literal, ...(placement === 'center' ? [] : [placement]), ...kept].join(' ');
  const option = makeOption(model, { set:{ label:value } }, { id:'label', group:'Label', label:current ? 'Edit label' : 'Add label' });
  return option ? [option] : [];
}

function pathShape(model) {
  const words = model.path.map(t => t.text);
  return {
    simpleFromTo: words.length === 4 && words[0] === 'from' && words[2] === 'to',
    ends: words[0] === 'from' && REF.test(words[1] || '') && words.at(-2) === 'to' && REF.test(words.at(-1) || '')
      ? { from:words[1], to:words.at(-1) } : null,
  };
}

// Named shapes that may be referenced from this connector: earlier, top-level,
// unique names, never another connector.
function shapesBefore(object, scene) {
  return (scene?.objects || []).filter(o => o.id !== object.id && NAME.test(o.name || '')
    && !NON_OBSTACLES.includes(o.kind) && o.anchors && o.span?.end <= object.span.start && editability(o, scene).editable);
}
function resolve(ref, shapes) {
  const [name, anchor = 'c'] = ref.split('.');
  const matches = shapes.filter(s => s.name === name);
  return matches.length === 1 ? { name, anchor, shape:matches[0] } : null;
}

// Tuples: ( [-]num , [-]num ) with inch or bare units only.
function readTuple(tokens, k) {
  const num = () => {
    let sign = 1;
    if (tokens[k]?.text === '-') { sign = -1; k++; } else if (tokens[k]?.text === '+') k++;
    const t = tokens[k]?.text;
    if (!PLAIN_NUMBER.test(t || '')) return null;
    k++; return sign * parseFloat(t);
  };
  const first = tokens[k];
  if (first?.text !== '(') return null;
  k++; const x = num(); if (x === null || tokens[k]?.text !== ',') return null;
  k++; const y = num(); if (y === null || tokens[k]?.text !== ')') return null;
  return { point:{ x, y }, next:k + 1, start:first.start, end:tokens[k].end };
}
function literalRoute(model) {
  const p = model.path;
  let k = 0;
  if (p[k++]?.text !== 'from' || !REF.test(p[k]?.text || '')) return null;
  const from = p[k++].text, bends = [];
  for (let first = true; k < p.length; first = false) {
    if (!first && p[k++]?.text !== 'then') return null;
    if (p[k++]?.text !== 'to') return null;
    if (REF.test(p[k]?.text || '')) return k === p.length - 1 ? { from, to:p[k].text, bends } : null;
    const tuple = readTuple(p, k);
    if (!tuple) return null;
    bends.push({ ...tuple.point, text:model.statement.slice(tuple.start, tuple.end) });
    k = tuple.next;
  }
  return null;
}

// Slice 2a: a literal bend whose axis lines up with a named shape's anchor can
// say so in Pikchr, so it follows that shape when the shape later moves.
function bendOptions(model, scene, add) {
  const { object } = model;
  if (!['arrow','line','spline'].includes(model.kind)) return;
  const route = literalRoute(model), path = object.path || [];
  if (!route?.bends.length || path.length !== route.bends.length + 2) return;
  const shapes = shapesBefore(object, scene);
  const endpoints = [route.from, route.to].map(r => r.split('.')[0]);
  const anchors = shapes.flatMap(s => ANCHOR_ORDER.filter(a => s.anchors[a]).map(a => ({ s, a, p:s.anchors[a] })));
  const best = (axis, value) => anchors.map(c => ({ ...c, d:Math.abs(c.p[axis] - value) })).filter(c => c.d <= TIE + EPS)
    .sort((a, b) => Math.round((a.d - b.d) * 1e6) || (endpoints.includes(b.s.name) - endpoints.includes(a.s.name))
      || ANCHOR_ORDER.indexOf(a.a) - ANCHOR_ORDER.indexOf(b.a) || a.s.span.start - b.s.span.start)[0];
  // Per bend: the relational clause, or null when nothing lines up.
  const ties = route.bends.map((bend, i) => {
    const prev = path[i], cur = path[i + 1];
    const horizontal = Math.abs(prev.y - cur.y) < EPS && Math.abs(prev.x - cur.x) > EPS;
    const vertical = Math.abs(prev.x - cur.x) < EPS && Math.abs(prev.y - cur.y) > EPS;
    if (horizontal || vertical) {
      const axis = horizontal ? 'x' : 'y', hit = best(axis, cur[axis]);
      if (!hit || Math.abs(hit.p[axis] - prev[axis]) < EPS || Math.sign(hit.p[axis] - prev[axis]) !== Math.sign(cur[axis] - prev[axis])) return null;
      const dir = horizontal ? (cur.x > prev.x ? 'right' : 'left') : (cur.y > prev.y ? 'up' : 'down');
      return { clause:`${dir} until even with ${refText(hit.s.name, hit.a)}`, axis, value:hit.p[axis], names:[refText(hit.s.name, hit.a)] };
    }
    const hx = best('x', cur.x), hy = best('y', cur.y);
    if (!hx || !hy) return null;
    return { clause:`to (${refText(hx.s.name, hx.a)}, ${refText(hy.s.name, hy.a)})`, point:{ x:hx.p.x, y:hy.p.y }, names:[refText(hx.s.name, hx.a), refText(hy.s.name, hy.a)] };
  });
  // Simulate the new vertices so an axis-aligned segment never turns diagonal.
  const simulate = chosen => {
    const pts = [path[0]];
    route.bends.forEach((bend, i) => {
      const tie = chosen[i], prev = pts[i];
      pts.push(!tie ? { x:bend.x, y:bend.y } : tie.point ? tie.point : tie.axis === 'x' ? { x:tie.value, y:prev.y } : { x:prev.x, y:tie.value });
    });
    pts.push(path.at(-1));
    for (let i = 1; i < pts.length; i++) {
      const a = path[i - 1], b = path[i], c = pts[i - 1], d = pts[i];
      if (Math.abs(a.y - b.y) < EPS && Math.abs(c.y - d.y) > EPS) return false;
      if (Math.abs(a.x - b.x) < EPS && Math.abs(c.x - d.x) > EPS) return false;
      if (Math.hypot(d.x - b.x, d.y - b.y) > TIE + 1e-4) return false;
    }
    return true;
  };
  const text = chosen => `from ${route.from} ` + route.bends.map((bend, i) => (i ? 'then ' : '') + (chosen[i] ? chosen[i].clause : 'to ' + bend.text)).join(' ') + ` then to ${route.to}`;
  const tied = ties.map((t, i) => t ? i : -1).filter(i => i >= 0);
  const all = ties.slice();
  if (tied.length && simulate(all)) {
    const names = [...new Set(tied.flatMap(i => ties[i].names))];
    add('tie-bends', 'Bends', `Tie bends to ${names.join(', ')}`, { path:text(all), preservePath:TIE + 0.001 });
  }
  if (tied.length > 1) for (const i of tied) {
    const one = ties.map((t, j) => j === i ? t : null);
    if (simulate(one)) add('tie-bend-' + (i + 1), 'Bends', `Tie bend ${i + 1} to ${ties[i].names.join(', ')}`, { path:text(one), preservePath:TIE + 0.001 });
  }
}

const crosses = (a, b, r) => Math.max(a.x, b.x) > r.left + EPS && Math.min(a.x, b.x) < r.right - EPS
  && Math.max(a.y, b.y) > r.bottom + EPS && Math.min(a.y, b.y) < r.top - EPS;

// Orthogonal detours that clear every shape between the two ends.
function detour(from, to, side, rects) {
  const F = from.shape, T = to.shape;
  const anchor = { above:'n', below:'s', left:'w', right:'e' }[side];
  const fa = F.anchors[anchor], ta = T.anchors[anchor];
  if (!fa || !ta) return null;
  const vertical = side === 'above' || side === 'below';
  const along = vertical ? 'x' : 'y', across = vertical ? 'y' : 'x';
  if (Math.abs(fa[along] - ta[along]) <= 0.05) return null;
  const lo = Math.min(fa[along], ta[along]), hi = Math.max(fa[along], ta[along]);
  const inBand = rects.filter(r => vertical ? r.right > lo && r.left < hi : r.top > lo && r.bottom < hi);
  const outward = side === 'above' || side === 'right' ? 1 : -1;
  const edge = r => ({ above:r.top, below:r.bottom, left:r.left, right:r.right })[side];
  const extreme = outward > 0 ? Math.max(fa[across], ta[across], ...inBand.map(edge)) : Math.min(fa[across], ta[across], ...inBand.map(edge));
  const run = Math.max(up05(outward * (extreme - fa[across])), MARGIN);
  const rail = fa[across] + outward * run;
  const corner1 = vertical ? { x:fa.x, y:rail } : { x:rail, y:fa.y };
  const corner2 = vertical ? { x:ta.x, y:rail } : { x:rail, y:ta.y };
  const others = rects.filter(r => r.object !== F && r.object !== T);
  for (const [a, b] of [[fa, corner1], [corner1, corner2], [corner2, ta]]) if (others.some(r => crosses(a, b, r))) return null;
  const go = { above:'up', below:'down', left:'left', right:'right' }[side];
  const turn = vertical ? (ta.x > fa.x ? 'right' : 'left') : (ta.y > fa.y ? 'up' : 'down');
  const f = refText(from.name, anchor), t = refText(to.name, anchor);
  return { path:`from ${f} ${go} ${fmt(run)} then ${turn} until even with ${t} then to ${t}`, run };
}

function loopOptions(model, scene, add, heads) {
  const { object } = model, shape = pathShape(model), shapes = shapesBefore(object, scene);
  if (!shape.ends) return;
  const from = resolve(shape.ends.from, shapes), to = resolve(shape.ends.to, shapes);
  if (!from || !to) return;
  const rects = obstacleRects(scene, MARGIN, NON_OBSTACLES);
  const straightKind = model.kind === 'line' ? 'line' : kindFor('arrow', heads);
  if (from.name === to.name) {
    const S = from.name, h = heads;
    const square = corner => corner === 'ne'
      ? `from ${S}.ne up ${LOOP} then right ${LOOP} then down until even with ${S}.e then to ${S}.e`
      : `from ${S}.se down ${LOOP} then right ${LOOP} then up until even with ${S}.e then to ${S}.e`;
    const polyKind = ['arrow','line'].includes(model.kind) ? model.kind : straightKind;
    add('loop-ne', 'Loops', 'Square loop, top right', { kind:polyKind, path:square('ne'), set:{ head:headToken(polyKind, h, model), turn:null } });
    add('loop-se', 'Loops', 'Square loop, bottom right', { kind:polyKind, path:square('se'), set:{ head:headToken(polyKind, h, model), turn:null } });
    add('loop-curved', 'Loops', 'Curved loop', { kind:'spline', path:square('ne'), set:{ head:headToken('spline', h, model), rad:null, turn:null } });
    const n = from.shape.anchors.n, e = from.shape.anchors.e, c = from.shape.center;
    if (n && e && c) {
      const d = { x:e.x - n.x, y:e.y - n.y }, mid = { x:(n.x + e.x) / 2 - c.x, y:(n.y + e.y) / 2 - c.y };
      const cw = (-d.y * mid.x + d.x * mid.y) > 0;
      add('loop-arc', 'Loops', 'Arc loop', { kind:'arc', path:`from ${S}.n to ${S}.e`, set:{ head:headToken('arc', h, model), rad:null, turn:cw ? 'cw' : 'ccw' } });
    }
    return;
  }
  if (model.kind !== 'arc') for (const side of ['above','below','left','right']) {
    const found = detour(from, to, side, rects);
    if (found) add('detour-' + side, 'Detours', 'Route ' + side, { path:found.path });
  }
  // Curved back-edges between shapes on one row, arching over the shapes between.
  const F = from.shape, T = to.shape;
  if (Math.abs(F.center.y - T.center.y) <= 0.1) {
    const lo = Math.min(F.center.x, T.center.x), hi = Math.max(F.center.x, T.center.x);
    const between = rects.some(r => r.object !== F && r.object !== T && r.object.center.x > lo && r.object.center.x < hi
      && r.top > Math.min(F.bbox.y, T.bbox.y) && r.bottom < Math.max(F.bbox.y + F.bbox.height, T.bbox.y + T.bbox.height));
    if (between) for (const [side, label] of [['above','Curved back-edge over'], ['below','Curved back-edge under']]) {
      const found = detour(from, to, side, rects);
      if (!found) continue;
      const bumped = found.path.replace(/ (up|down) [\d.]+ /, (m, dir) => ` ${dir} ${fmt(found.run + 0.15)} `);
      add('back-' + side, 'Loops', label, { kind:'spline', path:bumped, set:{ head:headToken('spline', heads, model), rad:null, turn:null } });
    }
  }
}

// The thumbnail gallery: shape, corners, arrowheads, bends, detours, loops.
export function routeStyleCandidates(source, object, scene) {
  const model = parseConnector(source, object, scene);
  if (!model) return { options:[], unavailable:[], reason:'Route styles need a top-level connector without comments, macros or blocks.' };
  const { options, unavailable, add } = collector(model, scene);
  const heads = headsOf(model), vertices = object.path?.length || 0, shape = pathShape(model);
  const kind = model.kind;
  if (['arrow','line'].includes(kind) && vertices >= 3)
    add('curve', 'Shape', 'Curve', { kind:'spline', set:{ head:headToken('spline', heads, model), rad:null } });
  if (kind === 'spline') {
    const k = kindFor('arrow', heads);
    add('straighten', 'Shape', 'Straight segments', { kind:k, set:{ head:headToken(k, heads, model) } });
  }
  const selfLoop = shape.ends && shape.ends.from.split('.')[0] === shape.ends.to.split('.')[0];
  if (['arrow','line','spline'].includes(kind) && vertices === 2 && shape.simpleFromTo && !selfLoop)
    for (const turn of ['cw','ccw']) add('arc-' + turn, 'Shape', turn === 'cw' ? 'Arc clockwise' : 'Arc counter-clockwise',
      { kind:'arc', set:{ head:headToken('arc', heads, model), rad:null, turn } });
  if (kind === 'arc') {
    const turn = styleOf(model, 'turn').at(-1)?.text || 'ccw';
    add('flip-arc', 'Shape', 'Flip arc', { set:{ turn:turn === 'cw' ? 'ccw' : 'cw' } });
    const k = kindFor('arrow', heads);
    add('straighten', 'Shape', 'Straight line', { kind:k, set:{ head:headToken(k, heads, model), turn:null } });
  }
  if (['arrow','line'].includes(kind) && vertices >= 3) {
    if (styleOf(model, 'rad').length) add('sharp', 'Corners', 'Sharp corners', { set:{ rad:null } });
    else add('rounded', 'Corners', 'Rounded corners', { set:{ rad:'rad 0.1' } });
  }
  const headLabels = { '->':'Arrow at end', '<-':'Arrow at start', '<->':'Arrows at both ends', none:'No arrowheads' };
  for (const h of ['->','<-','<->','none']) {
    if (h === heads) continue;
    const k = kindFor(kind, h);
    add('heads-' + (h === 'none' ? 'none' : h === '->' ? 'end' : h === '<-' ? 'start' : 'both'), 'Arrowheads', headLabels[h], { kind:k, set:{ head:headToken(k, h, model) } });
  }
  bendOptions(model, scene, add);
  loopOptions(model, scene, add, heads);
  return { options, unavailable, reason:'' };
}

// Rendered-result guard: the connector keeps its identity, nothing else moves,
// and bend ties keep the route's vertices where they were.
export function checkStyleResult(baseScene, object, option, result) {
  if (!result || result.error || !result.svg) return result?.error || 'Renderer returned no diagram.';
  const before = baseScene?.objects || [], after = result.objects || [];
  if (after.length !== before.length) return 'The edit changed how many objects the diagram has.';
  const same = (a, b) => Math.abs(a - b) <= 1e-6;
  const moved = after.find(n => n.id === object.id);
  if (!moved || moved.kind !== (option.targetKind || object.kind) || (moved.name || null) !== (object.name || null))
    return 'The connector could not be identified after the edit.';
  if (option.preserveOthers !== false) for (const o of before) {
    if (o.id === object.id) continue;
    const n = after.find(m => m.id === o.id);
    if (!n || n.kind !== o.kind || (n.name || null) !== (o.name || null) || !same(n.center.x, o.center.x) || !same(n.center.y, o.center.y)
      || ['x','y','width','height'].some(k => !same(n.bbox[k], o.bbox[k]))) return `The edit would move ${o.name || o.kind}.`;
  }
  if (option.preservePath !== undefined) {
    const a = object.path || [], b = moved.path || [];
    if (a.length !== b.length || a.some((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) > option.preservePath))
      return 'The rewritten route does not keep the original geometry.';
  }
  return null;
}

// SVG viewBox for a thumbnail: the connector plus the shapes it touches.
export function thumbnailBox(result, objectId, pad = 0.15) {
  const objects = result?.objects || [], t = result?.transform;
  const o = objects.find(n => n.id === objectId);
  if (!o || !t) return null;
  const boxes = [o.bbox, ...(o.dependencies || []).map(id => objects.find(n => n.id === id)?.bbox).filter(Boolean)];
  const xs = [], ys = [];
  for (const b of boxes) { xs.push(b.x, b.x + b.width); ys.push(b.y, b.y + b.height); }
  for (const p of o.path || []) { xs.push(p.x); ys.push(p.y); }
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
  const sx = [t.a * minX + t.e, t.a * maxX + t.e], sy = [t.d * minY + t.f, t.d * maxY + t.f];
  return { x:Math.min(...sx), y:Math.min(...sy), width:Math.abs(sx[1] - sx[0]), height:Math.abs(sy[1] - sy[0]) };
}
