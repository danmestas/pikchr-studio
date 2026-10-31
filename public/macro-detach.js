// Detach a macro use: replace one call site (or every one) with the macro's
// body, arguments substituted, as ordinary source. The define itself is never
// touched. Pikchr expands macros textually, so every candidate is rendered and
// must reproduce the original diagram exactly before it is offered.
const encoder = new TextEncoder();
const bytes = text => encoder.encode(text).length;
const MAX_SITES = 64, EPS = 1e-6, MACRO_REASON = 'Macro-expanded object';

// Comments, strings, identifiers and numbers are atomic; anything else is one
// character. Offsets are JavaScript string indices.
function lex(source) {
  const out = [], n = source.length;
  for (let i = 0; i < n;) {
    const c = source[i], start = i;
    if (/\s/.test(c)) { i++; continue; }
    let type;
    if (c === '#' || (c === '/' && source[i+1] === '/')) { while (i < n && source[i] !== '\n') i++; type = 'comment'; }
    else if (c === '/' && source[i+1] === '*') { const e = source.indexOf('*/', i+2); i = e < 0 ? n : e+2; type = 'comment'; }
    else if (c === '"') { i++; while (i < n && source[i] !== '"') i += source[i] === '\\' ? 2 : 1; i = Math.min(n, i+1); type = 'string'; }
    else if (/[A-Za-z_$@]/.test(c)) { i++; while (i < n && /\w/.test(source[i])) i++; type = 'id'; }
    else if (/[0-9.]/.test(c) && /[0-9]/.test(c === '.' ? source[i+1] || '' : c)) { i++; while (i < n && /[\w.]/.test(source[i])) i++; type = 'number'; }
    else { i++; type = 'punct'; }
    out.push({type, start, end:i, text:source.slice(start, i)});
  }
  return out;
}
const code = tokens => tokens.filter(t => t.type !== 'comment');
const span = (source, start, end) => ({start:bytes(source.slice(0, start)), end:bytes(source.slice(0, end))});

function definitions(source) {
  const list = [], toks = code(lex(source));
  for (let k = 0; k + 2 < toks.length; k++) {
    if (toks[k].text !== 'define' || toks[k+1].type !== 'id' || toks[k+2].text !== '{') continue;
    let depth = 0, j = k + 2;
    for (; j < toks.length; j++) { if (toks[j].text === '{') depth++; else if (toks[j].text === '}' && --depth === 0) break; }
    if (j >= toks.length) break;
    list.push({name:toks[k+1].text, start:toks[k].start, end:toks[j].end, bodyStart:toks[k+2].end, bodyEnd:toks[j].start,
      body:source.slice(toks[k+2].end, toks[j].start)});
    k = j;
  }
  return list;
}

export function macroDefinitions(source) {
  return definitions(source).map(d => ({name:d.name, body:d.body,
    span:span(source, d.start, d.end), bodySpan:span(source, d.bodyStart, d.bodyEnd)}));
}

// Call sites outside every define, after NAME's own define: `name` or
// `name(args)` with the parenthesis touching the name, as Pikchr requires.
function sites(source, name, defs = definitions(source)) {
  const def = defs.find(d => d.name === name);
  if (!def) return [];
  const toks = code(lex(source)), found = [];
  for (let k = 0, parens = 0; k < toks.length; k++) {
    const t = toks[k];
    parens += t.text === '(' ? 1 : t.text === ')' ? -1 : 0;
    if (t.type !== 'id' || t.text !== name || t.start < def.end) continue;
    if (defs.some(d => t.start >= d.start && t.start < d.end)) continue;
    if (toks[k-1]?.text === '.' || toks[k-1]?.text === 'define' || toks[k+1]?.text === ':') continue;
    let end = t.end, args = [];
    if (toks[k+1]?.text === '(' && toks[k+1].start === t.end) {
      let depth = 0, from = toks[k+1].end, j = k + 1;
      for (; j < toks.length; j++) {
        const x = toks[j].text;
        if ('([{'.includes(x)) depth++;
        else if (')]}'.includes(x) && --depth === 0) break;
        else if (x === ',' && depth === 1) { args.push(source.slice(from, toks[j].start).trim()); from = toks[j].end; }
      }
      if (j >= toks.length) continue;
      args.push(source.slice(from, toks[j].start).trim());
      if (args.length === 1 && !args[0]) args = [];
      end = toks[j].end;
    }
    found.push({name, start:t.start, end, args, enclosed:parens > 0, text:source.slice(t.start, end), span:span(source, t.start, end)});
  }
  return found;
}

export function macroCallSites(source, name) { return sites(source, name); }

// The body with $1..$9 replaced outside strings and comments, dedented, then
// laid out at the call site: on its own line it gets a leading comment and the
// call's indentation; mid-line or inside parentheses it is inserted verbatim.
function expansion(source, site, def) {
  let body = '', at = 0;
  for (const t of lex(def.body)) {
    if (t.type !== 'id' || !/^\$[1-9]$/.test(t.text)) continue;
    body += def.body.slice(at, t.start) + (site.args[t.text[1] - 1] ?? ''); at = t.end;
  }
  body += def.body.slice(at);
  const lines = body.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const common = Math.min(...lines.slice(1).filter(l => l.trim()).map(l => l.match(/^[ \t]*/)[0].length));
  const trimmed = lines.map((l, i) => (i ? l.slice(Number.isFinite(common) ? common : 0) : l.trimStart()).trimEnd());
  const lineStart = source.lastIndexOf('\n', site.start - 1) + 1;
  const indent = source.slice(lineStart, site.start).match(/^[ \t]*/)[0];
  const ownLine = !site.enclosed && !source.slice(lineStart, site.start).trim();
  const last = lex(trimmed.join('\n')).at(-1);
  const eol = source.includes('\r\n') ? '\r\n' : '\n', nl = l => l ? eol + indent + l : eol;
  const tail = last?.type === 'comment' && !last.text.startsWith('/*') && source.slice(site.end).split('\n')[0].trim() ? eol + indent : '';
  return (ownLine ? `# detached from ${site.name}` + trimmed.map(nl).join('') : trimmed[0] + trimmed.slice(1).map(nl).join('')) + tail;
}

export function inlineCall(source, site, def) {
  return source.slice(0, site.start) + expansion(source, site, def) + source.slice(site.end);
}

// Inline several non-overlapping sites as one patch over the region they span.
function inlineAll(source, list, def) {
  let text = source.slice(list[0].start, list.at(-1).end);
  for (const site of [...list].reverse()) {
    const a = site.start - list[0].start, b = site.end - list[0].start;
    text = text.slice(0, a) + expansion(source, site, def) + text.slice(b);
  }
  const start = list[0].start, end = list.at(-1).end;
  return {source:source.slice(0, start) + text + source.slice(end),
    patch:{base:source, start:bytes(source.slice(0, start)), end:bytes(source.slice(0, end)), expected:source.slice(start, end), text}};
}

// Per-object text from the native SVG groups.
function texts(svg) {
  const map = new Map();
  for (const m of (svg || '').matchAll(/<g data-pikchr-id="([^"]+)">([\s\S]*?)<\/g>/g))
    map.set(m[1], [...m[2].matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(t => t[1]).join('\n'));
  return map;
}
const near = (a, b) => Math.abs(a - b) <= EPS;
const sameShape = (a, ta, b, tb) => a.kind === b.kind && near(a.center.x, b.center.x) && near(a.center.y, b.center.y)
  && near(a.bbox.width, b.bbox.width) && near(a.bbox.height, b.bbox.height) && ta === tb;

function difference(scene, result) {
  if (result?.error || !result?.objects) return 'it does not render: ' + (result?.error || 'no diagram returned').trim().split('\n').at(-1);
  if (result.objects.length !== scene.objects.length) return `it would draw ${result.objects.length} objects instead of ${scene.objects.length}`;
  const ta = texts(scene.svg), tb = texts(result.svg);
  const k = scene.objects.findIndex((o, i) => !sameShape(o, ta.get(o.id), result.objects[i], tb.get(result.objects[i].id)));
  return k < 0 ? null : `object ${k + 1} (${scene.objects[k].kind}) would change`;
}

// Which macro generated an object: the define whose body holds its span, or
// else the call whose arguments do.
function origin(source, object, defs) {
  const at = object?.span?.start;
  if (!Number.isSafeInteger(at)) return null;
  const index = (() => { let b = 0, i = 0; for (const ch of source) { if (b >= at) break; b += bytes(ch); i += ch.length; } return i; })();
  const def = defs.find(d => index >= d.bodyStart && index < d.bodyEnd);
  if (def) return def;
  const calls = defs.flatMap(d => sites(source, d.name, defs)).filter(s => index >= s.start && index < s.end);
  return calls.length ? defs.find(d => d.name === calls.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0].name) : null;
}

const nestedNote = (def, defs) => {
  const inner = [...new Set(code(lex(def.body)).filter(t => t.type === 'id' && t.text !== def.name && defs.some(d => d.name === t.text)).map(t => t.text))];
  return inner.length ? ` The inlined text still calls ${inner.join(', ')}; those shapes stay macro-generated.` : '';
};

// Cheap and synchronous, for the inspector: the macro and its uses.
export function macroUses(source, object) {
  const defs = definitions(source), def = origin(source, object, defs);
  return def ? {name:def.name, uses:sites(source, def.name, defs).length} : null;
}

// Options {id,label,note,source,patch,base,result,selectId,selectionIds,targetKind} that
// the caller previews; refusals {id,reason} say why an action is unavailable.
export async function detachCandidates(source, object, scene, render, {only} = {}) {
  const options = [], refusals = [], refuse = (id, reason) => { refusals.push({id, reason}); };
  const out = (macro = null, uses = 0) => ({macro, uses, options, refusals});
  if (object?.reason !== MACRO_REASON) { refuse('detach', 'This shape is not generated by a macro.'); return out(); }
  const defs = definitions(source), def = origin(source, object, defs);
  if (!def) { refuse('detach', 'Studio cannot tell which macro generated this shape.'); return out(); }
  const name = def.name, all = sites(source, name, defs), note = nestedNote(def, defs);
  if (!all.length) {
    const callers = defs.filter(o => o !== def && code(lex(o.body)).some(t => t.type === 'id' && t.text === name)).map(o => o.name);
    refuse('detach', `${name} is only used inside other macro definitions${callers.length ? ' (' + callers.join(', ') + ')' : ''}. Detach the outer macro first.`);
    return out(name, 0);
  }
  if (only !== 'detach-all') {
    if (all.length > MAX_SITES) refuse('detach', `${name} has ${all.length} uses; Studio checks at most ${MAX_SITES} to find this shape's.`);
    else {
      const ta = texts(scene.svg), text = ta.get(object.id), hits = [];
      let failure = null;
      for (const site of all) {
        const next = inlineCall(source, site, def), result = await render(next);
        if (result?.error || !result?.objects) { failure ??= difference(scene, result); continue; }
        const tb = texts(result.svg);
        const twin = result.objects.filter(o => o.reason !== MACRO_REASON && sameShape(object, text, o, tb.get(o.id)));
        if (twin.length === 1) hits.push({site, next, result, twin:twin[0]});
        else if (twin.length > 1) failure ??= 'several identical shapes would remain';
      }
      if (!hits.length) refuse('detach', `No use of ${name} could be identified as producing this shape${failure ? ' (' + failure + ')' : ''}.`);
      else if (hits.length > 1) refuse('detach', `${hits.length} uses of ${name} draw an identical shape here, so Studio cannot tell which one to detach.`);
      else {
        const {site, next, result, twin} = hits[0], wrong = difference(scene, result);
        if (wrong) refuse('detach', `Detaching this use of ${name} is not offered: ${wrong}.`);
        else options.push({id:'detach', label:`Detach from macro ${name}`, note:`Inlines this use of ${name}; the define is unchanged.` + note,
          source:next, base:source, result, selectId:twin.id, selectionIds:[twin.id], targetKind:twin.kind,
          patch:{base:source, start:site.span.start, end:site.span.end, expected:site.text, text:next.slice(site.start, next.length - (source.length - site.end))}});
      }
    }
  }
  // Pikchr rejects recursive macros, so uses of one name never overlap.
  if (only !== 'detach' && all.length > 1) {
    const {source:next, patch} = inlineAll(source, all, def), result = await render(next), wrong = difference(scene, result);
    if (wrong) refuse('detach-all', `Detaching every use of ${name} is not offered: ${wrong}.`);
    else {
      const twin = result.objects[scene.objects.findIndex(o => o.id === object.id)];
      options.push({id:'detach-all', label:`Detach all ${all.length} uses of ${name}`, note:`Inlines every use of ${name}; the define is unchanged.` + note,
        source:next, base:source, result, patch, ...(twin ? {selectId:twin.id, selectionIds:[twin.id], targetKind:twin.kind} : {})});
    }
  }
  return out(name, all.length);
}
