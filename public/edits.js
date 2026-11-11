// Source-preserving movement suggestions. Geometry and validity are checked by
// Pikchr in the caller; this module never rewrites a whole document.
const encoder = new TextEncoder();
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const tuple = `\\(\\s*${number}\\s*,\\s*${number}\\s*\\)`;
const movableKinds = ['box','cylinder','circle','ellipse','oval','diamond','file','text'];

// Spans are UTF-8 byte offsets; strings index UTF-16 units. Every render and
// edit converts many offsets of one source, so each source gets its table
// once (index for each byte offset, -1 inside a character), not a scan per call.
const offsetTables = [];
function offsetTable(source) {
  const hit = offsetTables.find(entry => entry.source === source);
  if (hit) return hit.table;
  let table = null;
  if (/[^\x00-\x7f]/.test(source)) {
    table = new Int32Array(encoder.encode(source).length + 1).fill(-1);
    let bytes = 0, index = 0;
    for (const character of source) {
      table[bytes] = index;
      const code = character.codePointAt(0);
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      index += character.length;
    }
    table[bytes] = index;
  }
  offsetTables.unshift({source, table});
  offsetTables.length = Math.min(offsetTables.length, 8);
  return table;
}
export function byteOffsetToIndex(source, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid source byte offset');
  const table = offsetTable(source);
  // An all-ASCII source (table null) indexes bytes directly.
  const size = table ? table.length - 1 : source.length;
  if (offset > size) throw new Error('Source offset is outside the document');
  const index = table ? table[offset] : offset;
  if (index < 0) throw new Error('Source offset splits a UTF-8 character');
  return index;
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

// Strings and comments (#, //, /* */) blanked, newlines kept, so placement
// words inside them never count and offsets still refer to the original text.
export function maskCode(text) {
  return text.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|#[^\n]*|\/\/[^\n]*/g, match => match.replace(/[^\n]/g, ' '));
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
    return {start:placement.start, end:placement.end, referenceName:placement.referenceName, placement};
  }
  // Numeric style attributes and quoted labels remain byte-for-byte intact.
  // Expression-valued attributes are valid Pikchr but intentionally read-only.
  if (/[()+*/$]/.test(body)) return null;
  if (!safeAttributes(body)) return null;
  return { start: statement.trimEnd().length, end: statement.trimEnd().length };
}

// Why candidates() has no move for an object, as a clause for the inspector
// ("Moving is blocked: …"); '' when it can move. It follows placementRange's
// rules step by step and quotes the source that stopped it.
const MOVE_WORDS = /\b(?:define|same|at|with|from|to|then|above|below|left|right|of)\b/;
const quoteSource = text => { const t = text.replace(/\s+/g, ' ').trim(); return t.length > 60 ? t.slice(0, 59) + '…' : t; };
function unsafeToken(statement, masked, from) {
  const tokens = [...masked.slice(from).matchAll(/\S+/g)];
  const words = tokens.map(t => t[0]);
  for (let i = 0; i < tokens.length; i++) {
    const token = words[i];
    const bad = /[()+*/$]/.test(token) || !safeAttributes(token) && !(colourNames.has(token.toLowerCase()) && ['fill','color'].includes(words[i-1]))
      || (token === 'above' || token === 'below') && /^[A-Z]/.test(words[i+1] || '');
    if (!bad) continue;
    const start = from + (['fill','color','thickness','width','wid','height','ht','radius','rad','diameter'].includes(words[i-1]) ? tokens[i-1].index : tokens[i].index);
    return statement.slice(start, from + tokens[i].index + token.length);
  }
  return null;
}
export function movementBlocked(source, object, scene) {
  if (object?.kind === '[]') return 'Studio moves boxes, circles, ellipses, ovals, cylinders, diamonds, files and text, not [ ] groups';
  const why = editability(object, scene);
  if (!why.editable) return why.reason.replace(/\.$/, '').replace(/^./, c => c.toLowerCase());
  if (!movableKinds.includes(object.kind)) return `Studio moves boxes, circles, ellipses, ovals, cylinders, diamonds, files and text, not ${object.kind}s`;
  // Every placement form is movable now; what remains is a statement Studio
  // cannot locate or read, so the diagnostics below are a last resort.
  const refusal = moveRefusal(source, object, scene);
  if (!refusal) return '';
  let statement;
  try { statement = source.slice(byteOffsetToIndex(source, object.span.start), byteOffsetToIndex(source, object.span.end)); }
  catch { return 'Studio can’t find where it is written'; }
  const masked = maskedText(statement), trimmed = masked.trim();
  if (/#/.test(trimmed)) return 'it has a comment on the same line';
  if (/[\n\r]/.test(trimmed)) return 'its statement continues over several lines';
  if (/;/.test(trimmed)) return 'it shares its line with another statement';
  if (/[\[\]{}]/.test(trimmed)) return 'it contains a [ ] or { } block';
  const header = masked.match(/^\s*(?:([A-Z][A-Za-z0-9_]*):\s*)?(box|cylinder|circle|ellipse|oval|diamond|file|text)\b/);
  if (!header) return 'its statement does not start with its type';
  const body = masked.slice(header[0].length);
  const placed = MOVE_WORDS.exec(body);
  if (placed) {
    const placement = parsePlacement(masked);
    const rest = placement ? masked.slice(0, placement.start) + ' '.repeat(placement.end - placement.start) + masked.slice(placement.end) : null;
    // A position Studio reads only in part (at A.n + (0, 2*h)) is still one
    // expression to the author: quote all of it, from at or with onwards.
    const operatorAfter = placement && /^\s*[-+*/(]/.test(masked.slice(placement.end));
    if (!placement || operatorAfter || /\b(?:at|with|from|to|then|left|right|of|same|define)\b/.test(rest.slice(header[0].length))) {
      const start = header[0].length + (/\b(?:with|at)\b/.exec(body) || placed).index;
      let end = masked.length;
      const stop = /\s(?=\b(?:fill|color|thickness|width|wid|height|ht|radius|rad|diameter|fit|dashed|dotted|invis|invisible|thin|thick|solid|behind|bold|italic|small|big|ljust|rjust|chop|aligned|mono|monospace)\b)/.exec(masked.slice(start));
      if (stop) end = start + stop.index;
      return `its position is an expression Studio can’t rewrite (\`${quoteSource(statement.slice(start, end))}\`)`;
    }
    const token = unsafeToken(statement, rest, header[0].length);
    if (token) return `its attribute \`${quoteSource(token)}\` is an expression Studio can’t rewrite`;
  } else {
    const token = unsafeToken(statement, masked, header[0].length);
    if (token) return `its attribute \`${quoteSource(token)}\` is an expression Studio can’t rewrite`;
  }
  return 'its placement is outside the forms Studio can rewrite';
}

// The one attribute vocabulary every rewrite module shares. Text-position words
// (above/below) are attributes only when they do not start a placement.
export const permittedAttributes = new Set(['fit','width','wid','height','ht','radius','rad','diameter','fill','color','thickness','dashed','dotted','invis','invisible','bold','italic','small','big','thin','thick','solid','behind','black','white','red','blue','green','yellow','gray','grey','none','ljust','rjust','above','below','chop','aligned','center','mono','monospace']);
export const numericToken = new RegExp(`^${number}${unit}$`);
// Pikchr's colour names (the CSS names plus none and off), case-insensitive.
export const colourNames=new Set('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray grey green greenyellow honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen none off'.split(' '));
// A colour value Studio can write: a known name, #rrggbb or 0xrrggbb.
export const isColour=value=>typeof value==='string'&&(/^(?:#|0x)[0-9a-f]{6}$/i.test(value)||colourNames.has(value.toLowerCase()));
export function safeAttributes(body) {
  const tokens = body.trim().split(/\s+/).filter(Boolean);
  return !tokens.some((token,index) => {
    if (['<-','->','<->'].includes(token) || /^0x[0-9a-f]{6}$/i.test(token) || numericToken.test(token)) return false;
    // Any Pikchr colour name may follow fill or color, as the basic ones may anywhere.
    if (colourNames.has(token.toLowerCase()) && ['fill','color'].includes(tokens[index-1])) return false;
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

// Relocation is deliberately bounded: every statement from the connector on
// must have explicit placement and named dependencies. Unknown syntax, aliases,
// ordinal references and implicit placement could observe the changed order.
function laterEndpointCandidates(source, object, scene, endpoint, targetObject, anchor) {
  if (!movableKinds.includes(targetObject.kind)) return [];
  let start, end, targetEnd;
  try {
    start = byteOffsetToIndex(source,object.span.start);
    end = byteOffsetToIndex(source,object.span.end);
    targetEnd = byteOffsetToIndex(source,targetObject.span.end);
  } catch { return []; }
  const tail = scene.objects.filter(o=>o.span?.start >= object.span.start).sort((a,b)=>a.span.start-b.span.start);
  const trivia = text => /^(?:\s|#[^\r\n]*(?:\r?\n|$))*$/.test(text);
  let cursor = start;
  for (const other of tail) {
    if (!topLevel(other,scene)) return [];
    let a,b;
    try { a=byteOffsetToIndex(source,other.span.start); b=byteOffsetToIndex(source,other.span.end); }
    catch { return []; }
    if (a < cursor || !trivia(source.slice(cursor,a))) return [];
    cursor = b;
    if (['arrow','line'].includes(other.kind)) {
      const route = readRoute(source,other,scene);
      if (!route || [route.from,route.to].some(ref=>!movableKinds.includes(scene.objects.find(o=>o.name===ref.split('.')[0])?.kind))) return [];
    } else {
      const statement = source.slice(a,b), placement = placementRange(statement,other);
      if (!placement || !parsePlacement(maskedText(statement))) return [];
      if (placement.referenceName) {
        const refs = scene.objects.filter(o=>o.name===placement.referenceName && topLevel(o,scene));
        if (refs.length!==1 || !movableKinds.includes(refs[0].kind)
            || refs[0].span.end > other.span.start) return [];
      }
    }
  }
  if (!tail.includes(targetObject) || !trivia(source.slice(cursor))) return [];
  // Move only the edited connector, including its indentation and trailing
  // comment. Every unrelated object's source and painter order stay intact.
  const lineStart = source.lastIndexOf('\n',start-1)+1;
  const afterLine = index => {const next=source.indexOf('\n',index);return next<0 ? source.length : next+1;};
  const lineEnd = afterLine(end), insertAt = afterLine(targetEnd);
  if (!/^[ \t]*$/.test(source.slice(lineStart,start))
      || !/^[ \t]*(?:#[^\r\n]*)?\r?\n?$/.test(source.slice(end,lineEnd))
      || !/^[ \t]*(?:#[^\r\n]*)?\r?\n?$/.test(source.slice(targetEnd,insertAt))) return [];
  const line = source.slice(lineStart,lineEnd), newline = source.includes('\r\n') ? '\r\n' : '\n';
  const separator = source[insertAt-1]==='\n' ? '' : newline;
  const relocated = source.slice(0,lineStart)+source.slice(lineEnd,insertAt)+separator+line+source.slice(insertAt);
  // Rebase spans, then reuse the ordinary endpoint rewrite and route grammar.
  const removed = encoder.encode(line).length, added = encoder.encode(separator).length;
  const lineByteStart = encoder.encode(source.slice(0,lineStart)).length;
  const insertByte = encoder.encode(source.slice(0,insertAt)).length;
  const movedStart = insertByte-removed+added+object.span.start-lineByteStart;
  const objects = scene.objects.map(other=>{
    const shift = other===object ? movedStart-object.span.start : other.span.start<object.span.start ? 0
      : other.span.start<insertByte ? -removed : added;
    return {...other,span:{start:other.span.start+shift,end:other.span.end+shift}};
  });
  const nextScene = {...scene,objects};
  const options = endpointCandidates(relocated,objects[scene.objects.indexOf(object)],nextScene,endpoint,objects[scene.objects.indexOf(targetObject)],anchor);
  return options.map(option=>{
    const patch = {base:source,start:lineByteStart,end:insertByte,expected:source.slice(lineStart,insertAt),
      text:option.source.slice(lineStart,option.source.length-(source.length-insertAt))};
    return {...option,patch,source:applyPatch(source,patch),selectId:targetObject.id};
  });
}

// The compiler remains the authority on validity; unsupported expressions never
// receive a guessed edit. Earlier targets retain their minimal local patch.
export function endpointCandidates(source, object, scene, endpoint, targetObject, anchor) {
  if (!['arrow', 'line'].includes(object?.kind) || !['from', 'to'].includes(endpoint)
      || !endpointAnchor.test(anchor || '') || !objectName.test(targetObject?.name || '')
      || !topLevel(object, scene) || !topLevel(targetObject, scene)
      || !(scene?.objects || []).some(other => other.id === targetObject.id
        && other.name === targetObject.name && other.span?.start === targetObject.span.start)
      ) return [];
  if (targetObject.span.start >= object.span.end) return laterEndpointCandidates(source,object,scene,endpoint,targetObject,anchor);
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

// Where a shape's statement says where it goes: the native placement span when
// the scene has one, otherwise the small grammar above. `implicit` means the
// statement has no placement and Pikchr chains it after the previous object.
function ownPlacement(source, object, statement) {
  const masked = maskCode(statement);
  // A text object may be written as a bare string.
  const kind = object.kind === 'text' ? '(?:text\\b|(?="))' : `${object.kind}\\b`;
  const header = statement.match(new RegExp(`^\\s*(?:(${namePattern})\\s*:\\s*)?${kind}`));
  if (!header || (header[1] || '') !== (object.name || '')) return null;
  const native = object.spans?.placement;
  if (native && Number.isSafeInteger(native.start) && native.end > native.start) {
    let a, b;
    try {
      const base = byteOffsetToIndex(source, object.span.start);
      a = byteOffsetToIndex(source, native.start) - base; b = byteOffsetToIndex(source, native.end) - base;
    } catch { return null; }
    if (a < header[0].length || b > statement.length) return null;
    return {start:a, end:b, text:statement.slice(a, b), masked:masked.slice(a, b)};
  }
  if (object.spans && 'placement' in object.spans && !/\b(?:at|with)\b/.test(masked.slice(header[0].length)))
    return {implicit:true, start:statement.trimEnd().length, end:statement.trimEnd().length};
  if (/\b(?:at|with)\b/.test(masked.slice(header[0].length))) {
    // Without the renderer's span, only the grammar above is trusted, and
    // nothing placement-like may remain outside it.
    const parsed = parsePlacement(masked);
    if (!parsed || parsed.start < header[0].length) return null;
    const rest = masked.slice(header[0].length, parsed.start) + masked.slice(parsed.end);
    if (/\b(?:at|with|from|to|then|of)\b|[()+*/]/.test(rest)) return null;
    return {start:parsed.start, end:parsed.end, text:statement.slice(parsed.start, parsed.end), masked:parsed.text};
  }
  return {implicit:true, start:statement.trimEnd().length, end:statement.trimEnd().length};
}

const longAnchor = {north:'n',south:'s',east:'e',west:'w',top:'n',bottom:'s',left:'w',right:'e',center:'c',
  ne:'ne',nw:'nw',se:'se',sw:'sw',n:'n',s:'s',e:'e',w:'w',c:'c'};
const unitInches = {'':1, in:1, cm:1/2.54, mm:1/25.4, pt:1/72, px:1/96};
const gapAxis = {'right of':['x',1], 'left of':['x',-1], above:['y',1], below:['y',-1]};
const fmt = rawCoordinate;
const offsetText = (x, y) => `(${fmt(x)}, ${fmt(y)})`;
const pairPattern = new RegExp(`^\\(?\\s*(${number})\\s*,\\s*(${number})\\s*\\)?$`);

// Split `(e1, e2)` at its one top-level comma.
function coordinatePair(masked) {
  const inner = masked.trim().match(/^\(([\s\S]*)\)$/)?.[1];
  if (inner === undefined) return null;
  let depth = 0, comma = -1;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (inner[i] === ',' && depth === 0) { if (comma >= 0) return null; comma = i; }
    if (depth < 0) return null;
  }
  return comma < 0 ? null : [inner.slice(0, comma), inner.slice(comma + 1)];
}
// `e + d`, folding d into a trailing literal term when there is one. Returns
// the text and how far rounding moved the result from e + d.
function shifted(expression, d, round) {
  const e = expression.trim();
  if (Math.abs(d) < 1e-9) return {text:e, shift:0};
  if (new RegExp(`^${number}$`).test(e)) { const exact = Number(e) + d, value = round(exact); return {text:fmt(value), shift:value - exact}; }
  const tail = e.match(new RegExp(`^([\\s\\S]*?\\S)\\s*([+-])\\s*(${number})$`));
  if (tail && !/[*/]\s*$/.test(tail[1])) {
    const exact = (tail[2] === '-' ? -1 : 1) * Number(tail[3]) + d, value = round(exact);
    return {shift:value - exact, text:Math.abs(value) < 1e-9 ? tail[1] : `${tail[1]} ${value < 0 ? '-' : '+'} ${fmt(Math.abs(value))}`};
  }
  const value = round(d);
  return {shift:value - d, text:Math.abs(value) < 1e-9 ? e : `${e} ${value < 0 ? '-' : '+'} ${fmt(Math.abs(value))}`};
}

// The current placement, same form, rewritten so the shape's centre moves by
// `delta`. Every form Pikchr allows has an answer here: literals and offsets
// get new numbers, a bare reference gains an offset, a gap keeps its unit
// while the move runs along its axis, a coordinate pair adjusts each term.
// Anything else becomes an offset from the first earlier shape it names.
// Null only when no reference can be read (the caller then places literally).
function keptPlacement(placement, object, earlier, delta, round = value => value) {
  const ownName = name => name ? longAnchor[name] : 'c';
  const ownPoint = name => name === 'c' ? object.center : object.anchors?.[name];
  // Where a named reference is, when the placement names one directly.
  const referencePoint = place => {
    const m = place.match(new RegExp(`^(${namePattern})(?:\\.([a-z]+))?$`));
    const reference = m && earlier.find(other => other.name === m[1]);
    const anchor = m && longAnchor[m[2] || 'c'];
    return reference && anchor ? (anchor === 'c' ? reference.center : reference.anchors?.[anchor]) : null;
  };
  // An offset (x, y), rounded for a drag; shift is how far rounding moves the shape.
  const vector = (x, y, sign = 1) => { const v = {x:round(x), y:round(y)};
    return {v, shift:{x:sign * (v.x - x), y:sign * (v.y - y)}}; };
  if (!placement || placement.implicit) return null;
  const raw = placement.text, masked = placement.masked;
  const head = masked.match(/^with\s+\.([A-Za-z]+)\s+at\s+|^at\s+/);
  if (!head) return null;
  // The raw and masked texts align character for character; trim both alike.
  const rest = masked.slice(head[0].length), lead = rest.length - rest.trimStart().length, trail = rest.length - rest.trimEnd().length;
  const prefix = raw.slice(0, head[0].length), cut = text => text.slice(head[0].length + lead, text.length - trail);
  const pos = cut(raw), mpos = cut(masked);
  const pair = mpos.match(pairPattern);
  if (pair) { const {v, shift} = vector(Number(pair[1]) + delta.x, Number(pair[2]) + delta.y);
    return {text:`${prefix}${offsetText(v.x, v.y)}`, shift, kept:true, literal:!head[1] || longAnchor[head[1]] === 'c'}; }
  const offset = mpos.match(new RegExp(`^([\\s\\S]*?\\S)\\s*([+-])\\s*\\(\\s*(${number})\\s*,\\s*(${number})\\s*\\)$`));
  if (offset && !/[+\-*/,(]/.test(offset[1])) {
    const sign = offset[2] === '-' ? -1 : 1, place = pos.slice(0, offset[1].length);
    let x = Number(offset[3]) + sign * delta.x, y = Number(offset[4]) + sign * delta.y;
    // A named reference gives the exact offset from the rendered anchors.
    const from = referencePoint(offset[1]), own = ownPoint(ownName(head[1]));
    if (point(from) && point(own)) { x = sign * (own.x + delta.x - from.x); y = sign * (own.y + delta.y - from.y); }
    const {v, shift} = vector(x, y, sign);
    return {shift, kept:true, text:Math.abs(v.x) < 1e-9 && Math.abs(v.y) < 1e-9 ? `${prefix}${place}` : `${prefix}${place} ${offset[2]} ${offsetText(v.x, v.y)}`};
  }
  const gap = mpos.match(new RegExp(`^(${number})(cm|mm|in|px|pt)?\\s+(above|below|left\\s+of|right\\s+of)\\s+(\\S[\\s\\S]*)$`));
  if (gap && !/[+\-*/,()]/.test(gap[4])) {
    const factor = unitInches[gap[2] || ''], direction = gap[3].replace(/\s+/g, ' '), [axis, sign] = gapAxis[direction];
    const across = axis === 'x' ? 'y' : 'x', old = Number(gap[1]) * factor, now = old + delta[axis] * sign;
    const place = pos.slice(pos.length - gap[4].length);
    const value = Number(round(now / factor).toFixed(4));
    if (Math.abs(delta[across]) < 1e-9 && value * factor > 1e-9 && old > 1e-9) {
      const shift = {x:0, y:0}; shift[axis] = (value * factor - now) * sign;
      return {text:`${prefix}${value}${gap[2] || ''} ${direction} ${place}`, shift, kept:true};
    }
    const base = {x:0, y:0}; base[axis] = old * sign;
    const {v, shift} = vector(base.x + delta.x, base.y + delta.y);
    return {text:`${prefix}${place} + ${offsetText(v.x, v.y)}`, shift, kept:true};
  }
  if (!/[+\-*/,()]|\b(?:of|above|below|between|way|heading|and)\b/.test(mpos.replace(/\.\s*[a-z]+\b/g, '')) && /^[A-Za-z]/.test(mpos)) {
    const {v, shift} = vector(delta.x, delta.y);
    return {text:`${prefix}${pos} + ${offsetText(v.x, v.y)}`, shift, kept:true};
  }
  const terms = coordinatePair(mpos);
  if (terms) {
    const x = shifted(pos.slice(1, 1 + terms[0].length), delta.x, round), y = shifted(pos.slice(2 + terms[0].length, pos.length - 1), delta.y, round);
    return {text:`${prefix}(${x.text}, ${y.text})`, shift:{x:x.shift, y:y.shift}, kept:true};
  }
  // `F [of the] way between P and Q` keeps both ends, each moved by the drag.
  const between = mpos.match(/^([\s\S]*?\bbetween)\s+([\s\S]+?)\s+and\s+([\s\S]+)$/);
  if (between) {
    const d = {x:round(delta.x), y:round(delta.y)}, moved = [];
    let at = between[1].length;
    for (const part of [between[2], between[3]]) {
      const start = mpos.indexOf(part, at); at = start + part.length;
      const text = pos.slice(start, start + part.length), m = part;
      const p = m.match(pairPattern), o = m.match(new RegExp(`^([\\s\\S]*?\\S)\\s*([+-])\\s*\\(\\s*(${number})\\s*,\\s*(${number})\\s*\\)$`));
      if (p) moved.push(offsetText(Number(p[1]) + d.x, Number(p[2]) + d.y));
      else if (o && !/[+\-*/,(]/.test(o[1])) { const sign = o[2] === '-' ? -1 : 1;
        moved.push(`${text.slice(0, o[1].length)} ${o[2]} ${offsetText(Number(o[3]) + sign * d.x, Number(o[4]) + sign * d.y)}`); }
      else if (!/[+\-*/,()]/.test(m) && /^[A-Za-z]/.test(m)) moved.push(`${text} + ${offsetText(d.x, d.y)}`);
      else break;
    }
    if (moved.length === 2)
      return {text:`${prefix}${pos.slice(0, between[1].length)} ${moved[0]} and ${moved[1]}`, shift:{x:d.x - delta.x, y:d.y - delta.y}, kept:true};
  }
  // Nearest readable form: an offset from the same reference.
  for (const match of mpos.matchAll(new RegExp(`\\b(${namePattern})(?:\\.(${Object.keys(longAnchor).join('|')})\\b)?`, 'g'))) {
    const reference = earlier.find(other => other.name === match[1]);
    if (!reference) continue;
    const anchor = longAnchor[match[2] || 'c'], from = anchor === 'c' ? reference.center : reference.anchors?.[anchor];
    const name = ownName(head[1]), own = name ? ownPoint(name) : object.center;
    if (!point(from) || !point(own)) continue;
    const keep = name && name !== 'c' ? `with .${name} ` : '';
    const ref = match[2] ? `${match[1]}.${anchor}` : match[1];
    const {v, shift} = vector(own.x + delta.x - from.x, own.y + delta.y - from.y);
    return {text:`${keep}at ${ref} + ${offsetText(v.x, v.y)}`, shift, kept:false, reference:match[1]};
  }
  return null;
}

// An unplaced shape sits where the connector before it ends. Moving the shape
// can then extend that connector, so both stay attached and the shape keeps
// its implicit placement. Only a bare connector qualifies.
function connectorExtension(source, object, scene, delta, absorb = 'end') {
  const before = (scene?.objects || []).filter(other => other.span?.end <= object.span.start && other.span.start >= 0)
    .sort((a, b) => b.span.end - a.span.end)[0];
  if (!before || !['arrow','line','move'].includes(before.kind) || !topLevel(before, scene)
      || !Array.isArray(before.path) || before.path.length < 2) return null;
  let a, b, gapStart;
  try {
    a = byteOffsetToIndex(source, before.span.start); b = byteOffsetToIndex(source, before.span.end);
    gapStart = byteOffsetToIndex(source, object.span.start);
  } catch { return null; }
  if (!/^(?:\s|;|\b(?:up|down|left|right)\b)*$/.test(maskCode(source.slice(b, gapStart)))) return null;
  const statement = source.slice(a, b), masked = maskCode(statement);
  const header = masked.match(new RegExp(`^\\s*(?:(${namePattern})\\s*:\\s*)?(arrow|line|move)\\b`));
  if (!header || (header[1] || '') !== (before.name || '')
      || /\b(?:from|to|at|heading|same|close|with|chop)\b|[\[\]{}]/.test(masked)) return null;
  // The drawn path stops short of an arrowhead; the shape's entry anchor is
  // where the connector really ends. A then-path's last leg goes to it too.
  const last = before.path.at(-1);
  const entry = ['w','e','n','s'].filter(name => point(object.anchors?.[name]))
    .map(name => ({name, gap:Math.hypot(object.anchors[name].x - last.x, object.anchors[name].y - last.y)}))
    .sort((x, y) => x.gap - y.gap)[0];
  if (!entry || entry.gap > 0.1) return null;
  const end = object.anchors[entry.name];
  if (before.path.length > 2) {
    const text = legsMoved(statement, masked, header[0].length, [...before.path.slice(0, -1), end], delta, absorb);
    return text && {start:before.span.start, end:before.span.end, expected:statement, text, kind:before.kind};
  }
  // A bare length (arrow 1) would still apply after `to`; the end replaces it.
  const length = masked.slice(header[0].length).match(new RegExp(`^\\s+${number}${unit}(?=\\s|$)`));
  const kept = length ? statement.slice(0, header[0].length) + statement.slice(header[0].length + length[0].length) : statement;
  const text = kept.trimEnd() + ` to ${offsetText(end.x + delta.x, end.y + delta.y)}` + kept.slice(kept.trimEnd().length);
  return {start:before.span.start, end:before.span.end, expected:statement, text, kind:before.kind};
}

// A routed connector (right then down then right) keeps its legs: the end
// moves by `delta` while each leg stays horizontal or vertical. The change on
// each axis goes to the leg nearest the moved end (absorb: 'start' or 'end')
// that can take it without vanishing or flipping, else is shared by all legs
// on that axis in proportion. Null when the legs cannot absorb it.
function legsMoved(statement, masked, from, points, delta, absorb) {
  const parts = [], splitter = /\bthen\b/g;
  let at = from, m;
  while ((m = splitter.exec(masked))) { parts.push([at, m.index]); at = m.index + m[0].length; }
  parts.push([at, masked.length]);
  if (parts.length !== points.length - 1) return null;
  const legs = [];
  for (const [i, [a, b]] of parts.entries()) {
    const words = [...masked.slice(a, b).matchAll(new RegExp(`\\b(up|down|left|right)\\b(?:\\s+(${number})(in)?(?![\\w.%]))?`, 'g'))];
    if (words.length !== 1 || new RegExp(`(?:^|\\s)${number}`).test(masked.slice(a, b).replace(words[0][0], ''))) return null;
    const [dx, dy] = [points[i + 1].x - points[i].x, points[i + 1].y - points[i].y];
    const axis = /left|right/.test(words[0][1]) ? 'x' : 'y', sign = /right|up/.test(words[0][1]) ? 1 : -1;
    if (Math.abs(axis === 'x' ? dy : dx) > 1e-6) return null;
    legs.push({start:a + words[0].index, end:a + words[0].index + words[0][0].length, word:words[0][1], axis, sign, length:sign * (axis === 'x' ? dx : dy)});
  }
  for (const axis of ['x', 'y']) {
    const change = delta[axis];
    if (Math.abs(change) < 1e-9) continue;
    const mine = legs.filter(leg => leg.axis === axis);
    if (!mine.length) return null;
    const near = (absorb === 'start' ? mine : [...mine].reverse()).find(leg => leg.length + leg.sign * change > 1e-6);
    if (near) { near.length += near.sign * change; near.changed = true; continue; }
    const total = mine.reduce((sum, leg) => sum + leg.length, 0), sign = mine[0].sign;
    if (mine.some(leg => leg.sign !== sign) || total + sign * change <= 1e-6) return null;
    for (const leg of mine) { leg.length *= (total + sign * change) / total; leg.changed = true; }
  }
  let text = statement;
  for (const leg of [...legs].reverse()) if (leg.changed)
    text = text.slice(0, leg.start) + `${leg.word} ${fmt(leg.length)}` + text.slice(leg.end);
  return text;
}

// `precise` marks exact input (keyboard nudges, layout) where snapping and
// alignment tolerances would silently discard the requested position.
// `keepForm` (keyboard nudges) puts first the current placement rewritten
// for the new position (see keptPlacement), then the candidates that
// reference exactly what the current placement does, so a nudge never ties
// the shape to a new neighbour or drops its existing reference. A drag keeps
// a relational form first too; literal and implicit placements rank freely.
// `anchorTo` names a shape that stays put: an unplaced shape is then pinned as
// an offset from it rather than at a literal position.
// `absorb` says which end of a routed connector before the shape moved:
// 'end' (the shape itself is dragged) or 'start' (pinning a follower).
// The statement and its placement range when Studio can rewrite where the
// object sits, else null. Every candidate list starts from this, and a
// non-null result always yields at least "Place here".
function placement(source, object, scene) {
  if (!object || !topLevel(object,scene) || !movableKinds.includes(object.kind)) return null;
  let start, end;
  try {
    start = byteOffsetToIndex(source, object.span.start);
    end = byteOffsetToIndex(source, object.span.end);
  } catch { return null; }
  if (end < start) return null;
  const statement = source.slice(start, end);
  const range = ownPlacement(source, object, statement);
  return range ? {statement, range} : null;
}
export function candidates(source, object, scene, target, {precise=false, keepForm=false, anchorTo=null, absorb='end'}={}) {
  const placed = point(target) && placement(source, object, scene);
  if (!placed) return [];
  const {statement, range} = placed;
  const make = (label, placement, position, references=[]) => {
    const text = statement.slice(0, range.start)
      + (range.implicit ? ' ' : '') + placement + statement.slice(range.end);
    const patch = { start: object.span.start, end: object.span.end, text, expected: statement, base: source };
    return { label, source: applyPatch(source, patch), patch, target: position, references, literals: literals(placement), relational: references.length>0 };
  };
  const earlier = (scene?.objects || []).filter(other => other.id !== object.id
    && /^[A-Z][A-Za-z0-9_]*$/.test(other.name || '') && other.span?.start < object.span.start
    && point(other.center) && !['arrow','line'].includes(other.kind));
  const placedName = range.implicit ? null
    : (range.masked || '').match(new RegExp(`\\b(${namePattern})\\b`))?.[1] || null;
  const referenceName = placedName && earlier.some(other => other.name === placedName) ? placedName : null;
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
  const result = [make('Place here', `at ${offsetText(position.x, position.y)}`, position)];
  const near = [...earlier].sort((a,b) => Math.hypot(a.center.x-target.x,a.center.y-target.y)
    - Math.hypot(b.center.x-target.x,b.center.y-target.y) || a.span.start-b.span.start);
  const neighbours = near.slice(0, 3);
  const original = referenceName && near.find(other => other.name === referenceName);
  if (original && !neighbours.includes(original)) neighbours.push(original);
  const own = object.anchors || {};
  const ownOffset = name => point(own[name]) && point(object.center) ? { x: object.center.x - own[name].x, y: object.center.y - own[name].y } : null;
  for (const other of neighbours) {
    // A center offset with both components non-zero ties this shape to a
    // neighbour for no visible reason; it is marked so ranking prefers a plain
    // position (aligned offsets, attachments and gaps are real relations).
    const relative = (label, p) => { const dx = p.x-other.center.x, dy = p.y-other.center.y;
      result.push({...make(label, `with .c at ${other.name}.c + ${offsetText(dx, dy)}`, p, [other.name]),
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
  const ranked = rankCandidates(unique, target, referenceName ? [referenceName] : []);
  const delta = point(object.center) ? { x: position.x - object.center.x, y: position.y - object.center.y } : null;
  const first = [];
  const extension = range.implicit && delta && connectorExtension(source, object, scene, delta, absorb);
  if (extension) {
    const patch = {start:extension.start, end:extension.end, text:extension.text, expected:extension.expected, base:source};
    first.push({label:`Move with its ${extension.kind}`, source:applyPatch(source, patch), patch, target:position,
      references:[], literals:2, relational:false, extended:true});
  }
  const anchor = range.implicit && anchorTo && earlier.find(other => other.name === anchorTo);
  if (anchor) first.push(make(`Place against ${anchor.name}`,
    `at ${anchor.name} + ${offsetText(position.x - anchor.center.x, position.y - anchor.center.y)}`, position, [anchor.name]));
  // A drag rounds the kept numbers to the grid; the target follows them.
  const kept = delta && keptPlacement(range, object, earlier, delta, precise ? undefined : snap);
  // A literal position ranks with the other plain candidates; every other
  // form the author wrote comes first.
  if (kept && (keepForm || referenceName || !kept.literal))
    first.push(make(keepForm ? 'Nudge' : kept.kept ? 'Keep placement' : `Offset from ${kept.reference}`, kept.text,
      {x:Number(rawCoordinate(position.x + kept.shift.x)), y:Number(rawCoordinate(position.y + kept.shift.y))}, referenceName ? [referenceName] : []));
  if (!keepForm) return [...first, ...ranked].filter((candidate,index,all) => all.findIndex(item => item.source === candidate.source) === index);
  const same = c => c.references.join() === (referenceName || '');
  return [...first, ...ranked.filter(same), ...ranked.filter(c => !same(c))]
    .filter((candidate,index,all) => all.findIndex(item => item.source === candidate.source) === index);
}

// Why a shape cannot be dragged, or '' when it can. The reason names the
// real cause and the way out; the drag gesture shows it before the drop.
export function moveRefusal(source, object, scene) {
  if (!object) return 'Nothing is selected.';
  if (object.kind === '[]') return 'A [ ] group can’t be dragged yet. Give it an at clause in the source (S).';
  const {editable, reason} = editability(object, scene);
  if (!editable) {
    if (/macro/i.test(reason)) return 'This shape comes from a macro. Choose Detach from macro in the inspector to move it on its own.';
    if (/group/i.test(reason)) return 'This shape is inside a group (a [ ] block). Move the group by editing its placement in the source (S).';
    if (/repeated/i.test(reason)) return `Another object is also named ${object.name}. Rename one in the source (S) so Studio knows which to move.`;
    return 'Studio can’t find where this object is written. Edit it in the source (S).';
  }
  if (object.kind === '[]') return 'A [ ] group can’t be dragged yet. Give it an at clause in the source (S).';
  if (!movableKinds.includes(object.kind)) return `A ${object.kind} is moved by its ends, not dragged. Edit it in the source (S).`;
  if (!point(object.center)) return 'Studio has no position for this shape. Edit it in the source (S).';
  if (!placement(source, object, scene))
    return 'Studio can’t find this shape’s placement in its statement. Edit it in the source (S).';
  return '';
}
