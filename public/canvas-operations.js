import {createShape, connectableShapes} from './creation.js?v=20260923c';
import {applyPatch, safeAttributes, byteOffsetToIndex} from './edits.js?v=20260923c';
import {readProperties, propertyCandidate} from './properties.js?v=20260923c';

const mask = value => value.replace(/"(?:\\.|[^"\\])*"/g, label => ' '.repeat(label.length));
const numeric = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const tuple = `\\(\\s*${numeric}\\s*,\\s*${numeric}\\s*\\)`;
const shapeKinds = ['box','cylinder','circle','ellipse','oval','diamond'];
export const minimumShapeSize = 0.1;
const dimension = value => {
  if (!Number.isFinite(value) || value < minimumShapeSize || value > 100) {
    throw new Error('Shape size must be between 0.1 and 100 diagram units.');
  }
  return Number(value.toFixed(4));
};
function point(value) {
  if (!value || !['x','y'].every(axis => Number.isFinite(value[axis]) && Math.abs(value[axis]) <= 1000000)) {
    throw new Error('Choose a finite center position within the diagram limits.');
  }
  return `(${Number(value.x.toFixed(4))}, ${Number(value.y.toFixed(4))})`;
}

// One insertion means adding a neighbor and its connector is one undo step.
// Append rather than reorder: Pikchr references must follow their definitions.
export function createConnectedNeighbor(source, scene, object, {type = 'box', label = '', direction = 'right', gap = 0.5} = {}) {
  readProperties(source,object,scene);
  if (!connectableShapes(source,scene).includes(object)) throw new Error('Select a named, editable shape first.');
  if (!shapeKinds.includes(type)) throw new Error('Choose a supported native shape.');
  const directions = {right:[1,0,'e','w'],left:[-1,0,'w','e'],up:[0,1,'n','s'],down:[0,-1,'s','n']};
  const vector = directions[direction];
  if (!vector || !Number.isFinite(gap) || gap <= 0 || gap > 100) throw new Error('Choose a direction and a gap greater than zero and at most 100.');
  const originalWidth = dimension(object.bbox?.width), originalHeight = dimension(object.bbox?.height);
  let width = originalWidth, height = originalHeight;
  if (type === 'circle') width = height = Math.max(width,height);
  point(object.center);
  const x = object.center.x + vector[0] * ((originalWidth + width) / 2 + gap);
  const y = object.center.y + vector[1] * ((originalHeight + height) / 2 + gap);
  const node = createShape(source,scene,{kind:type,label,x,y,width,height});
  const reserved = new Set(node.source.match(/\b[A-Z][A-Za-z0-9_]*\b/g) || []);
  for (const item of scene.objects) reserved.add(item.name);
  let index = 1;
  while (reserved.has(`Link${index}`)) index++;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const patch = {...node.patch,text:node.patch.text + `Link${index}: arrow from ${object.name}.${vector[2]} to ${node.selectName}.${vector[3]}${newline}`};
  return {label:'Add connected shape',selectName:node.selectName,patch,source:applyPatch(source,patch)};
}

export function resizeShape(source, scene, object, {width,height,center} = {}) {
  const {statement,header} = readProperties(source,object,scene);
  if (!shapeKinds.includes(object.kind)) throw new Error('Resize a native shape, not a connector or text label.');
  width = dimension(width ?? object.bbox?.width);
  height = dimension(height ?? object.bbox?.height);
  if (object.kind === 'circle') width = height = Math.max(width,height);
  const masked = mask(statement);
  const placementPattern = new RegExp(`\\b(?:with\\s+\\.c\\s+)?at\\s*(?:[A-Z][A-Za-z0-9_]*\\.c(?:\\s*\\+\\s*${tuple})?|${tuple})`,'g');
  const placements = [...masked.matchAll(placementPattern)];
  let placement = placements.length === 1 ? placements[0] : null, keepPlacement = false;
  // Attached placements (`with .n at 0.6 below API.s`) are kept as written:
  // only the size changes and Pikchr grows the shape around that attachment.
  if (!placement && placements.length === 0 && object.spans?.placement) {
    const base = byteOffsetToIndex(source, object.span.start);
    const a = byteOffsetToIndex(source, object.spans.placement.start) - base, b = byteOffsetToIndex(source, object.spans.placement.end) - base;
    if (a >= 0 && b > a && b <= statement.length) { placement = {index:a, 0:masked.slice(a,b)}; keepPlacement = true; }
  }
  if (!placement) throw new Error('Resizing needs an explicit center position or supported center reference.');
  const attributes = masked.slice(header[0].length,placement.index) + masked.slice(placement.index+placement[0].length);
  if (!safeAttributes(attributes)) throw new Error('This shape uses expressions that must be resized in source.');
  // Reject malformed/compound sizing instead of removing only part of an expression.
  const sizeKeys = /\b(?:width|wid|height|ht|radius|diameter)\b/g;
  const dimensions = [...masked.matchAll(new RegExp(`\\b(?:width|wid|height|ht|radius|diameter)\\s+${numeric}(?:cm|mm|in|px|pt|%)?(?=\\s|$)(?!\\s*[+*/-])`,'g'))];
  if (dimensions.length !== [...masked.matchAll(sizeKeys)].length) throw new Error('Dimension expressions must be resized in source.');
  const replacements = dimensions.map(match => ({start:match.index,end:match.index+match[0].length,text:''}));
  for (const match of masked.matchAll(/\bfit\b/g)) replacements.push({start:match.index,end:match.index+3,text:''});
  if (center !== undefined && !keepPlacement) replacements.push({start:placement.index,end:placement.index+placement[0].length,text:`at ${point(center)}`});
  let replacement = statement;
  for (const edit of replacements.sort((a,b)=>b.start-a.start)) replacement = replacement.slice(0,edit.start)+edit.text+replacement.slice(edit.end);
  replacement = replacement.trimEnd() + (object.kind === 'circle' ? ` diameter ${width}` : ` width ${width} height ${height}`);
  return propertyCandidate(source,object,statement,replacement,'Resize shape');
}
