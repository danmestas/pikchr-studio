import { applyPatch, byteOffsetToIndex, editability, safeAttributes } from './edits.js?v=20260923c';
import {encodeLabel} from './properties.js?v=20260923c';
import {duplicateObject} from './object-actions.js?v=20260923c';

const encoder = new TextEncoder();
const bytes = text => encoder.encode(text).length;
export const shapeKinds = ['box', 'circle', 'ellipse', 'oval', 'cylinder', 'diamond','text'];
const names = /^[A-Z][A-Za-z0-9_]*$/;
const anchors = /^(?:n|ne|e|se|s|sw|w|nw|c)$/;
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const mask = text => text.replace(/"(?:\\.|[^"\\])*"/g, value => ' '.repeat(value.length));

function requireKind(kind) {
  if (!shapeKinds.includes(kind)) throw new Error('Choose a supported shape.');
}

function coordinate(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw new Error('Position must be a finite number between -1000000 and 1000000.');
  return Number(value.toFixed(4)).toString();
}

function uniqueName(source, scene, prefix) {
  // Reserve every capitalized identifier, including macro names and references.
  // Reserving too much is harmless; accidentally shadowing a name is not.
  const used = new Set(source.match(/\b[A-Z][A-Za-z0-9_]*\b/g) || []);
  for (const object of scene?.objects || []) used.add(object.name);
  let index = 1;
  while (used.has(`${prefix}${index}`)) index++;
  return `${prefix}${index}`;
}

function append(source, statement, label, selectName) {
  if (/\\\s*$/.test(source)) throw new Error('Finish the continued source line before adding an object.');
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const patch = {base: source, start: bytes(source), end: bytes(source), expected: '',
    text: (source && !source.endsWith('\n') ? newline : '') + statement + newline};
  return {label, selectName, patch, source: applyPatch(source, patch)};
}

function realShape(source, object, scene) {
  if (!object || !shapeKinds.includes(object.kind) || !names.test(object.name || '')
      || !(scene?.objects || []).includes(object) || !editability(object, scene).editable) throw new Error('Choose a uniquely named top-level shape, outside macros and groups.');
  const start = byteOffsetToIndex(source, object.span.start);
  const end = byteOffsetToIndex(source, object.span.end);
  const statement = source.slice(start, end);
  const header = mask(statement).match(/^\s*([A-Z][A-Za-z0-9_]*)\s*:\s*(box|circle|ellipse|oval|cylinder|diamond|text)\b/);
  if (!header || header[1] !== object.name || header[2] !== object.kind) throw new Error('Source changed. Render it before editing.');
  return {statement, header};
}

export function createShape(source, scene, {kind, label = '', x, y, fit = false,name,width,height,fill,color,stroke,thickness}) {
  requireKind(kind);
  const encoded=encodeLabel(label);
  const selectName = name || uniqueName(source, scene, kind === 'text' ? 'T' : 'Shape');
  if(!names.test(selectName)||new RegExp(`\\b${selectName}\\b`).test(source)) throw new Error('Choose an unused name starting with a capital letter.');
  let attrs='';
  for(const [key,value] of Object.entries({width,height,thickness})) if(value!==undefined&&value!=='') {
    if(!Number.isFinite(Number(value))||Number(value)<=0||Number(value)>100) throw new Error(`${key} must be between 0 and 100.`);
    attrs+=` ${key} ${Number(value)}`;
  }
  for(const [key,value] of Object.entries({fill,color:color??stroke})) if(value!==undefined&&value!=='') {
    if(!/^(?:#[0-9a-f]{6}|0x[0-9a-f]{6}|black|white|red|blue|green|yellow|gray|grey|none)$/i.test(value)) throw new Error('Use a six-digit hex color or a supported named color.');
    attrs+=` ${key} ${value.replace('#','0x')}`;
  }
  return append(source, `${selectName}: ${kind}${label ? ` ${encoded}` : ''}${attrs}${fit&&kind!=='text'&&width===undefined&&height===undefined?' fit':''} at (${coordinate(x)}, ${coordinate(y)})`, `Add ${kind}`, selectName);
}

export function connectableShapes(source, scene, {includeText=false}={}) {
  return (scene?.objects || []).filter(object => {
    if(object.kind==='text'&&!includeText)return false;
    try { realShape(source,object,scene);return true; } catch { return false; }
  });
}

export function repeatPosition(center, dx, dy) {
  const x=Number(coordinate(center.x+dx)),y=Number(coordinate(center.y+dy));
  if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new Error('Repeat offsets must be finite numbers.');
  if(dx===0&&dy===0)throw new Error('Choose a nonzero repeat offset so the new shape is not hidden underneath the original.');
  return {x,y};
}

export function repeatShape(source,object,scene,{dx=0,dy=-1}={}) {
  const position=repeatPosition(object.center,dx,dy);
  const option=duplicateObject(source,object,scene,{dx:position.x-object.center.x,dy:position.y-object.center.y});
  const name=uniqueName(source,scene,object.name.replace(/\d+$/,''));
  const patch={...option.patch,text:option.patch.text.replace(new RegExp(`^(\\s*)${option.selectName}\\s*:`),`$1${name}:`)};
  return {...option,label:`Repeat ${object.name}`,selectName:name,patch,source:applyPatch(source,patch)};
}

export function createConnector(source, scene, {fromId, fromAnchor, toId, toAnchor, kind = 'arrow'}) {
  if (!['arrow', 'line'].includes(kind)) throw new Error('Choose arrow or line.');
  if (!anchors.test(fromAnchor || '') || !anchors.test(toAnchor || '')) throw new Error('Choose a valid anchor for both endpoints.');
  const from = scene?.objects?.find(object => object.id === fromId);
  const to = scene?.objects?.find(object => object.id === toId);
  realShape(source, from, scene);
  realShape(source, to, scene);
  if (fromId === toId) throw new Error('Choose two different shapes. Self-loops need a routed path.');
  const selectName = uniqueName(source, scene, 'Link');
  return append(source, `${selectName}: ${kind} from ${from.name}.${fromAnchor} to ${to.name}.${toAnchor}`, `Add ${kind}`, selectName);
}

export function changeShape(source, object, scene, kind) {
  requireKind(kind);
  const {statement, header} = realShape(source, object, scene);
  const body = mask(statement).slice(header[0].length);
  const placements = [...body.matchAll(new RegExp(`\\b(?:with\\s+\\.c\\s+)?at\\s*\\(\\s*${number}\\s*,\\s*${number}\\s*\\)`, 'g'))];
  if (placements.length !== 1) throw new Error('Shape conversion needs one explicit numeric center position.');
  const placement = placements[0];
  const rest = body.slice(0, placement.index) + body.slice(placement.index + placement[0].length);
  if (!safeAttributes(rest)) {
    throw new Error('This shape uses expressions or attributes that cannot be safely converted.');
  }
  const localStart = header[0].length - header[2].length;
  const start = object.span.start + bytes(statement.slice(0, localStart));
  const patch = {base: source, start, end: start + bytes(object.kind), expected: object.kind, text: kind};
  return {label: `Change to ${kind}`, selectName: object.name, patch, source: applyPatch(source, patch)};
}
