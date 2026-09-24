// Source-preserving movement suggestions. Geometry and validity are checked by
// Pikchr in the caller; this module never rewrites a whole document.
const encoder = new TextEncoder();
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const tuple = `\\(\\s*${number}\\s*,\\s*${number}\\s*\\)`;
const movableKinds = ['box','cylinder','circle','ellipse','oval','diamond','text'];

export function byteOffsetToIndex(source, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid source byte offset');
  let bytes = 0, index = 0;
  for (const character of source) {
    if (bytes === offset) return index;
    bytes += encoder.encode(character).length;
    index += character.length;
    if (bytes > offset) throw new Error('Source offset splits a UTF-8 character');
  }
  if (bytes === offset) return index;
  throw new Error('Source offset is outside the document');
}

export function applyPatch(source, patch) {
  if (patch.base !== source) throw new Error('Source changed. Generate a new suggestion.');
  const start = byteOffsetToIndex(source, patch.start);
  const end = byteOffsetToIndex(source, patch.end);
  if (end < start || source.slice(start, end) !== patch.expected) {
    throw new Error('Source changed. Generate a new suggestion.');
  }
  return source.slice(0, start) + patch.text + source.slice(end);
}

function maskedText(text) {
  // Preserve string length so all offsets still refer to the original text.
  return text.replace(/"(?:\\.|[^"\\])*"/g, match => ' '.repeat(match.length));
}

const anchorNames = ['c','n','s','e','w','ne','nw','se','sw'];
const anchorPattern = '(?:ne|nw|se|sw|c|n|s|e|w)';
const unit = '(?:cm|mm|in|px|pt|%)?';
const namePattern = '[A-Z][A-Za-z0-9_]*';
// One placement grammar for every studio rewrite: literal centers, center
// offsets, edge-to-edge attachments, and axis-aligned gaps. Anything else is
// inspect-only rather than guessed.
const placementPattern = new RegExp(
  `\\b(?:with\\s+\\.(${anchorPattern})\\s+)?at\\s+(?:(${number}${unit})\\s+(above|below|left\\s+of|right\\s+of)\\s+)?(${namePattern})\\.(${anchorPattern})(?:\\s*\\+\\s*(${tuple}))?(?![\\w.])`
  + `|\\b(?:with\\s+\\.c\\s+)?at\\s*(${tuple})`, 'g');

export function parsePlacement(masked) {
  const matches = [...masked.matchAll(placementPattern)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  return {start:m.index, end:m.index+m[0].length, text:m[0],
    referenceName:m[4]||null, ownAnchor:m[1]||(m[4]?'c':null), referenceAnchor:m[5]||null,
    gap:m[2]||null, direction:m[3]?m[3].replace(/\s+/g,' '):null, offset:m[6]||null, literal:m[7]||null};
}

function placementRange(statement, object) {
  const masked = maskedText(statement);
  const header = masked.match(/^\s*([A-Z][A-Za-z0-9_]*):\s*(box|cylinder|circle|ellipse|oval|diamond|text)\b/);
  if (!header || header[1] !== object.name || header[2] !== object.kind) return null;
  // Blocks, comments, macros, multi-statements, and chained placement have no
  // safe local rewrite in this deliberately small first editing surface.
  if (/[\[\]{};#\n\r]/.test(masked.trim())) return null;
  const body = masked.slice(header[0].length);
  if (/\b(?:define|same|at|with|from|to|then|above|below|left|right|of)\b/.test(body)) {
    const placement = parsePlacement(masked);
    if (!placement) return null;
    const rest = masked.slice(header[0].length, placement.start) + masked.slice(placement.end);
    if (/\b(?:at|with|from|to|then|left|right|of)\b|[()+*/]/.test(rest) || !safeAttributes(rest)) return null;
    return {start:placement.start, end:placement.end, referenceName:placement.referenceName};
  }
  // Numeric style attributes and quoted labels remain byte-for-byte intact.
  // Expression-valued attributes are valid Pikchr but intentionally read-only.
  if (/[()+*/$]/.test(body)) return null;
  if (!safeAttributes(body)) return null;
  return { start: statement.trimEnd().length, end: statement.trimEnd().length };
}

// The one attribute vocabulary every rewrite module shares. Text-position words
// (above/below) are attributes only when they do not start a placement.
export const permittedAttributes = new Set(['fit','width','wid','height','ht','radius','rad','diameter','fill','color','thickness','dashed','dotted','invis','invisible','bold','italic','small','big','thin','thick','solid','behind','black','white','red','blue','green','yellow','gray','grey','none','ljust','rjust','above','below','chop','aligned','center']);
export const numericToken = new RegExp(`^${number}${unit}$`);
export function safeAttributes(body) {
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  return !tokens.some((token,index) => {
    if (['<-','->','<->'].includes(token) || /^0x[0-9a-f]{6}$/i.test(token) || numericToken.test(token)) return false;
    if (!permittedAttributes.has(token)) return true;
    if ((token==='above'||token==='below') && /^[A-Z]/.test(tokens[index+1]||'')) return true;
    return false;
  });
}

// Coordinates snap to a 0.05 inch grid and stay bounded so Pikchr never sees
// exponent notation. Drag noise must not accumulate in the author's source.
const GRID = 0.05, LIMIT = 1000;
export const snap = value => Math.max(-LIMIT, Math.min(LIMIT, Math.round(value / GRID) * GRID));
const coordinate = value => Number(snap(value).toFixed(2)).toString();
const rawCoordinate = value => Number(Math.max(-LIMIT, Math.min(LIMIT, value)).toFixed(4)).toString();
const pathCoordinate = rawCoordinate;

const objectName = /^[A-Z][A-Za-z0-9_]*$/;
const endpointAnchor = /^(?:c|n|s|e|w|ne|nw|se|sw)$/;

// Single editability rule for rewrites: a top-level object with a real source
// span, outside macros and groups, whose name (if any) resolves uniquely.
export function editability(object, scene) {
  const no = reason => ({editable:false, reason});
  if (!object) return no('No object selected.');
  if (!object.span || !Number.isSafeInteger(object.span.start) || object.span.start < 0
      || !Number.isSafeInteger(object.span.end) || object.span.end <= object.span.start) return no('Source origin is unavailable for this object.');
  if (object.depth > 0 || object.parent || object.macro || object.studioMacro || /macro/i.test(object.reason||'')) return no('Macro-expanded objects are inspect-only.');
  if (/nested/i.test(object.reason||'')) return no('Objects inside a group are inspect-only.');
  const others = (scene?.objects || []).filter(other => other !== object && other.id !== object.id);
  if (others.some(parent => parent.span?.start < object.span.start && parent.span?.end >= object.span.end)) return no('Objects inside a group are inspect-only.');
  if (object.name && others.some(other => other.name === object.name)) return no('Repeated names are ambiguous; rename the object in source.');
  return {editable:true, reason:''};
}
const topLevel = (object, scene) => editability(object, scene).editable;

const reference = '[A-Z][A-Za-z0-9_]*(?:\\.(?:ne|nw|se|sw|c|n|s|e|w))?';
const escapeRE = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function routeText(from, to, mode, target) {
  const point = target && `(${pathCoordinate(target.x)}, ${pathCoordinate(target.y)})`;
  switch (mode) {
    case 'straight': return `from ${from} to ${to}`;
    case 'horizontal': return `from ${from} to (${to}, ${from}) then to ${to}`;
    case 'vertical': return `from ${from} to (${from}, ${to}) then to ${to}`;
    case 'via': return `from ${from} to ${point} then to ${to}`;
    case 'via-x': return `from ${from} to (${point}, ${from}) then to (${point}, ${to}) then to ${to}`;
    case 'via-y': return `from ${from} to (${from}, ${point}) then to (${to}, ${point}) then to ${to}`;
  }
}

// Recognize only our explicit endpoint routes. Never infer a route from SVG
// coordinates: doing so would discard the author's expressions and dependencies.
function readRoute(source, object, scene) {
  if (!['arrow','line'].includes(object?.kind) || !topLevel(object, scene)) return null;
  let statement;
  try { statement = source.slice(byteOffsetToIndex(source, object.span.start), byteOffsetToIndex(source, object.span.end)); }
  catch { return null; }
  const masked = maskedText(statement);
  const header = masked.match(/^\s*(?:([A-Z][A-Za-z0-9_]*)\s*:\s*)?(arrow|line)\b/);
  if (!header || (header[1] || '') !== (object.name || '') || header[2] !== object.kind
      || /[\[\]{};#\n\r]/.test(masked.trim())) return null;
  const fromMatch = new RegExp(`\\bfrom\\s+(${reference})(?![\\w.])`).exec(masked);
  const ends = [...masked.matchAll(new RegExp(`\\bto\\s+(${reference})(?![\\w.])`, 'g'))];
  if (!fromMatch || ends.length !== 1) return null;
  const toMatch = ends[0], from = fromMatch[1], to = toMatch[1];
  const start = fromMatch.index, end = toMatch.index + toMatch[0].length;
  if (start < header[0].length || end < start
      || !safeAttributes(masked.slice(header[0].length, start) + masked.slice(end))) return null;
  // Labels within the route would be removed by replacement; leave them alone.
  if (statement.slice(start, end).includes('"')) return null;
  for (const ref of [from, to]) {
    const matches = (scene.objects || []).filter(other => other.name === ref.split('.')[0]
      && other.span?.end <= object.span.start && topLevel(other, scene));
    if (matches.length !== 1) return null;
  }
  const actual = masked.slice(start, end).replace(/\s+/g, '');
  for (const mode of ['straight','horizontal','vertical']) {
    if (actual === routeText(from,to,mode).replace(/\s+/g,'')) {
      if (mode === 'straight' && object.path && object.path.length !== 2) return null;
      return { statement,start,end,from,to,mode };
    }
  }
  const point = `\\((${number}),(${number})\\)`;
  const f = escapeRE(from), t = escapeRE(to);
  const patterns = {
    via: `^from${f}to${point}thento${t}$`,
    'via-x': `^from${f}to\\(${point},${f}\\)thento\\(${point},${t}\\)thento${t}$`,
    'via-y': `^from${f}to\\(${f},${point}\\)thento\\(${t},${point}\\)thento${t}$`,
  };
  for (const [mode, pattern] of Object.entries(patterns)) {
    const match = actual.match(new RegExp(pattern));
    if (!match || (match.length > 3 && (Number(match[1]) !== Number(match[3]) || Number(match[2]) !== Number(match[4])))) continue;
    const target = {x:Number(match[1]),y:Number(match[2])};
    if (Number.isFinite(target.x) && Number.isFinite(target.y)) return {statement,start,end,from,to,mode,target};
  }
  // Explicit waypoint chains may mix literal bends with the reference-based
  // elbows emitted above. Keep those expressions, never flatten SVG geometry.
  const positions = statement.slice(start,end).replace(new RegExp(`^from\\s+${f}\\s+to\\s+`),'').split(/\s+then\s+to\s+/);
  const bends = positions.slice(0,-1);
  const literal = new RegExp(`^${tuple}$`);
  const mixed = new RegExp(`^\\((?:${f},${t}|${t},${f}|${point},(?:${f}|${t})|(?:${f}|${t}),${point})\\)$`);
  if (positions.at(-1)?.trim() === to && bends.length && object.path?.length === bends.length + 2
      && bends.every(p => literal.test(p.trim()) || mixed.test(p.replace(/\s+/g,'')))) {
    return {statement,start,end,from,to,mode:'explicit',bends};
  }
  return null;
}

function routePatch(source, object, route, text, label, target) {
  const patch = {
    base: source, expected: route.statement.slice(route.start, route.end), text,
    start: object.span.start + encoder.encode(route.statement.slice(0, route.start)).length,
    end: object.span.start + encoder.encode(route.statement.slice(0, route.end)).length,
  };
  return {label, patch, source:applyPatch(source,patch), ...(target ? {target} : {})};
}

export function routeCandidates(source, object, scene, mode, target) {
  const labels = {straight:'Straight route',horizontal:'Horizontal first',vertical:'Vertical first',via:'Move bend','via-x':'Move vertical segment','via-y':'Move horizontal segment'};
  if (!Object.hasOwn(labels,mode) || (mode.startsWith('via') && (!Number.isFinite(target?.x) || !Number.isFinite(target?.y)))) return [];
  const route = readRoute(source,object,scene);
  if (!route) return [];
  return [routePatch(source,object,route,routeText(route.from,route.to,mode,target),labels[mode],target)];
}

// Segment and bend indices refer to rendered vertices only when syntax and the
// compiler agree one-to-one. Unsupported constructs remain inspect-only.
export function bendCandidates(source, object, scene, action, index, target) {
  const route = readRoute(source,object,scene);
  if (!route || !['insert','delete'].includes(action) || !Number.isInteger(index)) return [];
  const positions = route.statement.slice(route.start,route.end)
    .replace(new RegExp(`^from\\s+${escapeRE(route.from)}\\s+to\\s+`),'').split(/\s+then\s+to\s+/);
  const bends = positions.slice(0,-1);
  if (!Array.isArray(object.path) || object.path.length !== bends.length + 2) return [];
  if (action === 'insert') {
    if (index < 0 || index > bends.length || !Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return [];
    bends.splice(index,0,`(${pathCoordinate(target.x)}, ${pathCoordinate(target.y)})`);
  } else {
    if (index < 1 || index > bends.length) return [];
    bends.splice(index-1,1);
  }
  const text = `from ${route.from} to ${[...bends,route.to].join(' then to ')}`;
  return [routePatch(source,object,route,text,action==='insert'?`Add bend on segment ${index+1}`:`Delete bend ${index}`,target)];
}

// A literal bend is independent source geometry. Change its tuple only, never
// flatten reference expressions into coordinates inferred from rendered SVG.
export function moveVertexCandidates(source, object, scene, index, target) {
  if (!['arrow','line'].includes(object?.kind) || !topLevel(object,scene)
      || !Number.isInteger(index) || index < 1
      || !Number.isFinite(target?.x) || !Number.isFinite(target?.y)) return [];
  const route = readRoute(source,object,scene);
  if (!route) return [];
  const raw = route.statement.slice(route.start,route.end);
  const markers = [...raw.matchAll(/\bto\s+/g)];
  const vertices = markers.slice(0,-1).map((mark,i) => {
    const start = mark.index + mark[0].length;
    const end = raw.lastIndexOf('then',markers[i+1].index);
    return {start,text:raw.slice(start,end).trimEnd()};
  });
  // No guessed correspondence when the compiler's path differs from syntax.
  if (!Array.isArray(object.path) || object.path.length !== vertices.length + 2
      || index > vertices.length) return [];
  const vertex = vertices[index - 1];
  if (!new RegExp(`^${tuple}$`).test(vertex.text)) return [];
  return [routePatch(source,object,{
    statement:route.statement,start:route.start + vertex.start,end:route.start + vertex.start + vertex.text.length,
  },`(${pathCoordinate(target.x)}, ${pathCoordinate(target.y)})`,`Move bend ${index}`,target)];
}

// Change one explicit endpoint of a straight path. The compiler remains the
// authority on validity; unsupported expressions never receive a guessed edit.
export function endpointCandidates(source, object, scene, endpoint, targetObject, anchor) {
  if (!['arrow', 'line'].includes(object?.kind) || !['from', 'to'].includes(endpoint)
      || !endpointAnchor.test(anchor || '') || !objectName.test(targetObject?.name || '')
      || !topLevel(object, scene) || !topLevel(targetObject, scene)
      || targetObject.span.end > object.span.start
      || !(scene?.objects || []).some(other => other.id === targetObject.id
        && other.name === targetObject.name && other.span?.start === targetObject.span.start)
      ) return [];
  // A repeated name may resolve to another object. Offer no ambiguous targets.
  if ((scene.objects || []).filter(other => other.name === targetObject.name
      && other.span?.start < object.span.start && topLevel(other, scene)).length !== 1) return [];
  const route = readRoute(source,object,scene);
  if (!route) return [];
  if (route.mode !== 'straight') {
    const ref = `${targetObject.name}.${anchor}`;
    const from = endpoint === 'from' ? ref : route.from, to = endpoint === 'to' ? ref : route.to;
    const text = route.mode === 'explicit' ? `from ${from} to ${[...route.bends,to].join(' then to ')}`
      : routeText(from,to,route.mode,route.target);
    return [routePatch(source,object,route,text,
      `${endpoint === 'from' ? 'Start' : 'End'} at ${ref}`,targetObject.anchors?.[anchor])];
  }
  let start, end;
  try {
    start = byteOffsetToIndex(source, object.span.start);
    end = byteOffsetToIndex(source, object.span.end);
  } catch { return []; }
  const statement = source.slice(start, end);
  const masked = maskedText(statement);
  const header = masked.match(/^\s*(?:([A-Z][A-Za-z0-9_]*)\s*:\s*)?(arrow|line)\b/);
  if (!header || (header[1] || '') !== (object.name || '') || header[2] !== object.kind
      || /[\[\]{};#\n\r]/.test(masked.trim())) return [];
  const references = [...masked.matchAll(/\b(from|to)\s+([A-Z][A-Za-z0-9_]*(?:\.(?:ne|nw|se|sw|c|n|s|e|w))?)(?![\w.])/g)];
  if (references.length !== 2 || references[0][1] !== 'from' || references[1][1] !== 'to') return [];
  let rest = masked.slice(header[0].length);
  for (const match of [...references].reverse()) {
    const offset = match.index - header[0].length;
    rest = rest.slice(0, offset) + rest.slice(offset + match[0].length);
  }
  if (!safeAttributes(rest)) return [];
  const match = references.find(item => item[1] === endpoint);
  const localStart = match.index + match[0].length - match[2].length;
  const expected = statement.slice(localStart, localStart + match[2].length);
  const text = `${targetObject.name}.${anchor}`;
  const patch = {
    start: object.span.start + encoder.encode(statement.slice(0, localStart)).length,
    end: object.span.start + encoder.encode(statement.slice(0, localStart + expected.length)).length,
    expected, text, base: source,
  };
  const target = targetObject.anchors?.[anchor];
  return [{ label: `${endpoint === 'from' ? 'Start' : 'End'} at ${text}`,
    source: applyPatch(source, patch), patch,
    ...(Number.isFinite(target?.x) && Number.isFinite(target?.y) ? { target } : {}),
  }];
}

const opposite = {n:'s',s:'n',e:'w',w:'e',ne:'sw',nw:'se',se:'nw',sw:'ne'};
const gapDirection = {n:'below', s:'above', w:'right of', e:'left of'};
const point = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
const literals = text => (text.match(new RegExp(number,'g'))||[]).length;

// Rank without a renderer: structure first (keep every referenced name), then
// the fewest numeric literals, then predicted distance, then source growth.
export function rankCandidates(list, target, referencedNames = []) {
  const score = c => [
    referencedNames.every(name => c.references.includes(name)) ? 0 : 1,
    c.arbitrary && !referencedNames.some(name => c.references.includes(name)) ? 1 : 0,
    c.literals,
    Math.round(Math.hypot((c.target?.x??target.x)-target.x, (c.target?.y??target.y)-target.y) * 1000),
    c.patch.text.length - (c.patch.expected?.length ?? 0),
  ];
  return list.map((c,i)=>({c,i,s:score(c)})).sort((a,b)=>{
    for (let k=0;k<a.s.length;k++) if (a.s[k]!==b.s[k]) return a.s[k]-b.s[k];
    return a.i-b.i;
  }).map(x=>x.c);
}

// `precise` marks exact input (keyboard nudges, layout) where snapping and
// alignment tolerances would silently discard the requested position.
export function candidates(source, object, scene, target, {precise=false}={}) {
  if (!object || (object.editable === false && object.kind!=='text') || !topLevel(object,scene) || !movableKinds.includes(object.kind)
      || !/^[A-Z][A-Za-z0-9_]*$/.test(object.name || '')
      || !point(target)) return [];
  let start, end;
  try {
    start = byteOffsetToIndex(source, object.span.start);
    end = byteOffsetToIndex(source, object.span.end);
  } catch { return []; }
  if (end < start) return [];
  const statement = source.slice(start, end);
  const range = placementRange(statement, object);
  if (!range) return [];
  const make = (label, placement, position, references=[]) => {
    const text = statement.slice(0, range.start)
      + (range.start === range.end ? ' ' : '') + placement + statement.slice(range.end);
    const patch = { start: object.span.start, end: object.span.end, text, expected: statement, base: source };
    return { label, source: applyPatch(source, patch), patch, target: position, references, literals: literals(placement), relational: references.length>0 };
  };
  const earlier = (scene?.objects || []).filter(other => other.id !== object.id
    && /^[A-Z][A-Za-z0-9_]*$/.test(other.name || '') && other.span?.start < object.span.start
    && point(other.center) && !['arrow','line'].includes(other.kind));
  if (range.referenceName && !earlier.some(other => other.name === range.referenceName)) return [];
  // Snap the drop point to the grid and to nearby neighbour centers and edges.
  const snapped = precise ? { x: target.x, y: target.y } : { x: snap(target.x), y: snap(target.y) };
  const tolerance = precise ? 1e-6 : 0.2, touchTolerance = precise ? 1e-6 : 0.15;
  for (const other of precise ? [] : earlier) {
    const xs = [other.center.x, other.bbox?.x, other.bbox && other.bbox.x + other.bbox.width].filter(Number.isFinite);
    const ys = [other.center.y, other.bbox?.y, other.bbox && other.bbox.y + other.bbox.height].filter(Number.isFinite);
    for (const x of xs) if (Math.abs(target.x - x) <= GRID) snapped.x = x;
    for (const y of ys) if (Math.abs(target.y - y) <= GRID) snapped.y = y;
  }
  const position = { x: Number(rawCoordinate(snapped.x)), y: Number(rawCoordinate(snapped.y)) };
  const result = [make('Place here', `at (${coordinate(position.x)}, ${coordinate(position.y)})`, position)];
  const near = [...earlier].sort((a,b) => Math.hypot(a.center.x-target.x,a.center.y-target.y)
    - Math.hypot(b.center.x-target.x,b.center.y-target.y) || a.span.start-b.span.start);
  const neighbours = near.slice(0, 3);
  const original = range.referenceName && near.find(other => other.name === range.referenceName);
  if (original && !neighbours.includes(original)) neighbours.push(original);
  const own = object.anchors || {};
  const ownOffset = name => point(own[name]) && point(object.center) ? { x: object.center.x - own[name].x, y: object.center.y - own[name].y } : null;
  for (const other of neighbours) {
    // A center offset with both components non-zero ties this shape to a
    // neighbour for no visible reason; it is marked so ranking prefers a plain
    // position (aligned offsets, attachments and gaps are real relations).
    const relative = (label, p) => { const dx = p.x-other.center.x, dy = p.y-other.center.y;
      result.push({...make(label, `with .c at ${other.name}.c + (${coordinate(dx)}, ${coordinate(dy)})`, p, [other.name]),
        arbitrary: Math.abs(dx) > 1e-9 && Math.abs(dy) > 1e-9}); };
    relative(`Position relative to ${other.name}`, position);
    if (Math.abs(target.x-other.center.x) <= tolerance) relative(`Align centers vertically with ${other.name}`, { x: other.center.x, y: position.y });
    if (Math.abs(target.y-other.center.y) <= tolerance) relative(`Align centers horizontally with ${other.name}`, { x: position.x, y: other.center.y });
    const theirs = other.anchors || {};
    for (const [mine, ref] of Object.entries(opposite)) {
      const offset = ownOffset(mine);
      if (!offset || !point(theirs[ref])) continue;
      const touching = { x: theirs[ref].x + offset.x, y: theirs[ref].y + offset.y };
      if (Math.hypot(touching.x-target.x, touching.y-target.y) <= touchTolerance) {
        result.push(make(`Attach .${mine} to ${other.name}.${ref}`, `with .${mine} at ${other.name}.${ref}`, touching, [other.name]));
      }
      const direction = gapDirection[mine];
      if (!direction) continue;
      const vertical = mine==='n' || mine==='s';
      const aligned = vertical ? Math.abs(target.x - touching.x) <= tolerance : Math.abs(target.y - touching.y) <= tolerance;
      const gap = (precise ? v => Math.max(-LIMIT, Math.min(LIMIT, v)) : snap)(vertical ? (mine==='n' ? touching.y - target.y : target.y - touching.y)
                                : (mine==='w' ? target.x - touching.x : touching.x - target.x));
      if (!aligned || gap <= 0) continue;
      const gapped = vertical ? { x: touching.x, y: touching.y + (mine==='n' ? -gap : gap) }
                              : { x: touching.x + (mine==='w' ? gap : -gap), y: touching.y };
      result.push(make(`${coordinate(gap)} in ${direction} ${other.name}`, `with .${mine} at ${coordinate(gap)} ${direction} ${other.name}.${ref}`, gapped, [other.name]));
    }
  }
  const unique = result.filter((candidate,index,all) => all.findIndex(item => item.source === candidate.source) === index);
  return rankCandidates(unique, target, range.referenceName ? [range.referenceName] : []);
}
