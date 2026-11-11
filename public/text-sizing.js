import { changeText, encodeLabel, readProperties, propertyCandidate } from './properties.js';
import { candidates } from './edits.js?v=20261110a';

const LIMIT = 32;
// The bundled native PObj has aTxt[5]; additional labels cannot render.
const MAX_LINES = 5;
const lineLimit = () => new Error('This label needs more than five lines. Increase the wrap width or choose Grow to fit.');
const graphemes = text => {
  if (typeof Intl.Segmenter !== 'function') throw new Error('Text wrapping needs a browser with Unicode segmentation support. Use Grow instead.');
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(item => item.segment);
};

// Measure through Pikchr itself, including the original font/style and globals.
// The resulting patch contains ordinary Pikchr labels and literal dimensions;
// wrapping never depends on browser-only SVG or CSS changes.
export async function buildTextEdit(source, scene, object, { text, mode = 'grow', width } = {}, render) {
  encodeLabel(text);
  if (!['grow', 'fixed', 'wrap'].includes(mode)) throw new Error('Choose Grow, Wrap, or Fixed text sizing.');
  if (mode !== 'wrap') return keepInPlace(source, scene, object, changeText(source, object, scene, text, { fit: mode === 'grow', anyPlacement: typeof render === 'function' }), render);
  if (object?.kind !== 'box') throw new Error('Wrap is currently available for boxes. Choose Grow for other shapes.');
  const { statement } = readProperties(source, object, scene);
  const targetWidth = width === undefined ? object.bbox?.width : Number(width);
  if (!Number.isFinite(targetWidth) || targetWidth <= 0) throw new Error('Wrap width must be a positive number.');
  if (typeof render !== 'function') throw new Error('The Pikchr renderer is not ready.');
  if (text.length > 4096) throw new Error('Wrap supports up to 4096 text characters. Shorten the label or use Grow.');
  let renderCount = 0;
  const cache = new Map();
  const measure = async label => {
    if (cache.has(label)) return cache.get(label);
    // Reserve two renders for the complete multiline label and final source.
    if (renderCount >= LIMIT - 2) throw new Error('This label needs more wrapping work than the safe limit. Add line breaks, widen the box, or use Grow.');
    const candidate = changeText(source, object, scene, label.trim() ? label : 'x', { fit: true, anyPlacement: true });
    renderCount++;
    const result = await render(candidate.source);
    if (result.error) throw new Error('Pikchr could not measure this label: ' + result.error);
    const measured = result.objects?.[scene.objects.indexOf(object)];
    if (!measured?.bbox || measured.kind !== 'box') throw new Error('Pikchr could not identify the measured box.');
    cache.set(label, measured.bbox);
    return measured.bbox;
  };
  const lines = [];
  const addLine = line => { if(lines.length >= MAX_LINES) throw lineLimit(); lines.push(line); };
  if(text.split('\n').length > MAX_LINES) throw new Error('Pikchr supports at most five text lines per shape. Remove some line breaks before wrapping.');
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { addLine(''); continue; }
    let remaining = graphemes(paragraph);
    while (remaining.length) {
      if ((await measure(remaining.join(''))).width <= targetWidth + 1e-9) {
        addLine(remaining.join('')); break;
      }
      let low = 0, high = remaining.length;
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if ((await measure(remaining.slice(0, middle).join(''))).width <= targetWidth + 1e-9) low = middle;
        else high = middle;
      }
      if (!low) throw new Error('This box is too narrow for a character and its padding. Widen it or choose Grow.');
      // Prefer word boundaries, but split long tokens only between graphemes.
      let cut = low;
      for (let index = low; index > 0; index--) {
        if (/^\s+$/u.test(remaining[index] || '')) { cut = index; break; }
      }
      addLine(remaining.slice(0, cut).join(''));
      remaining = remaining.slice(cut);
      while (remaining.length && /^\s+$/u.test(remaining[0])) remaining.shift();
    }
  }
  const wrapped = lines.join('\n');
  // Empty labels still need a fit measurement to preserve native line padding.
  const measurementText = wrapped.trim() ? wrapped : lines.map(() => 'x').join('\n');
  const fitted = changeText(source, object, scene, measurementText, { fit: true, anyPlacement: true });
  renderCount++;
  const fittedScene = await render(fitted.source);
  if (fittedScene.error) throw new Error('Pikchr could not size the wrapped label: ' + fittedScene.error);
  const fittedObject = fittedScene.objects?.[scene.objects.indexOf(object)];
  const height = Math.max(object.bbox.height, fittedObject?.bbox?.height || 0);
  if (!(height > 0)) throw new Error('Pikchr could not measure the wrapped label height.');
  let { statement: fittedStatement, labels } = readProperties(fitted.source, fittedObject, fittedScene);
  if (measurementText !== wrapped) fittedStatement = fittedStatement.slice(0, labels[0].index)
    + encodeLabel(wrapped) + fittedStatement.slice(labels.at(-1).index + labels.at(-1)[0].length);
  let replacement = fittedStatement.replace(/ fit$/, '') + ` width ${targetWidth} height ${height}`;
  const candidate = propertyCandidate(source, object, statement, replacement, 'Wrap text to box width');
  renderCount++;
  const validated = await render(candidate.source);
  if (validated.error) throw new Error('Pikchr could not render the wrapped label: ' + validated.error);
  const kept = await keepInPlace(source, scene, object, candidate, text => { renderCount++; return render(text); });
  return { ...kept, sizing: { mode, width: targetWidth, lines: lines.length, renderCount } };
}

const SHAPES = ['box', 'circle', 'ellipse', 'oval', 'cylinder', 'diamond', 'file', 'text'];
const same = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
// A label that changes a shape's size rewrites only its own statement. A
// shape placed explicitly (at …, with …) keeps its rendered centre: its
// placement is rewritten in the same form, as a drag does. A shape placed
// implicitly in a chain keeps its implicit placement and flows from the
// connector before it, its followers flowing after it, as Pikchr authors
// expect. A placement Studio cannot rewrite refuses the size change.
export async function keepInPlace(source, scene, object, option, render) {
  if (typeof render !== 'function' || !SHAPES.includes(object.kind)) return option;
  const placed = object.spans?.placement;
  if (!placed || !(placed.end > placed.start)) return option;
  const index = scene.objects.indexOf(object);
  const result = await render(option.source);
  if (result.error) throw new Error('Pikchr could not render this label: ' + result.error);
  const now = result.objects?.[index];
  if (!now?.center || now.kind !== object.kind) throw new Error('Pikchr could not identify the resized shape.');
  if (same(now.center, object.center)) return option;
  const back = candidates(option.source, now, result, object.center, { precise: true, keepForm: true })[0];
  if (!back || back.patch.start !== now.span.start) throw new Error('Studio can’t keep this shape in place while its size changes.');
  const text = back.source, check = await render(text);
  if (check.error || !same(check.objects?.[index]?.center || {x: NaN, y: NaN}, object.center)) throw new Error('Studio can’t keep this shape in place while its size changes.');
  // One patch: the edited statement only.
  const start = object.span.start, end = object.span.end, bytes = t => new TextEncoder().encode(t);
  const tail = bytes(source).length - end, total = bytes(text);
  const replaced = new TextDecoder().decode(total.slice(start, total.length - tail));
  return { ...option, source: text, patch: { base: source, start, end, expected: new TextDecoder().decode(bytes(source).slice(start, end)), text: replaced } };
}
