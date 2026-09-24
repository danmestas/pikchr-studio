// Free (ad-hoc) lines and arrows. Pure source edits; the caller validates each
// candidate by rendering it, like every other canvas tool.
//
// An end is either {object, anchor} (attach to a named shape's side) or
// {point} (a literal position in Pikchr inches, y up).
import {applyPatch,byteOffsetToIndex} from './edits.js?v=20260923c';
import {connectCandidate} from './connect-drag.js?v=20260923c';

const encoder=new TextEncoder();
const bytes=text=>encoder.encode(text).length;
const GRID=0.05;
const NUMBER='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const TUPLE=new RegExp(`\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)`,'g');
const NAME=/^[A-Z][A-Za-z0-9_]*$/;
const lineKinds=['arrow','line','spline'];
const finite=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);
const mask=text=>text.replace(/"(?:\\.|[^"\\])*"/g,v=>' '.repeat(v.length));

export const snapToGrid=v=>Math.round(v/GRID)*GRID;
const trim=v=>{const r=Math.round(v*1000)/1000;return String(Object.is(r,-0)?0:r);};
export function pointText(p){
  if(!finite(p)||Math.abs(p.x)>100000||Math.abs(p.y)>100000)throw new Error('Point is out of range.');
  return `(${trim(p.x)}, ${trim(p.y)})`;
}

function endPoint(end){
  if(end?.object){
    const a=end.object.anchors?.[end.anchor];
    if(!NAME.test(end.object.name||''))throw new Error('Attach lines to named shapes only.');
    if(!finite(a))throw new Error('That shape has no such anchor.');
    return a;
  }
  if(!finite(end?.point))throw new Error('Choose where the line starts and ends.');
  return {x:snapToGrid(end.point.x),y:snapToGrid(end.point.y)};
}
function endText(end){return end.object?`${end.object.name}.${end.anchor}`:pointText(endPoint(end));}

function uniqueName(source,scene,prefix){
  const used=new Set(source.match(/\b[A-Z][A-Za-z0-9_]*\b/g)||[]);
  for(const o of scene?.objects||[])if(o.name)used.add(o.name);
  let i=1;while(used.has(`${prefix}${i}`))i++;return `${prefix}${i}`;
}
function append(source,statement){
  if(/\\\s*$/.test(source))throw new Error('Finish the continued source line before adding a line.');
  const nl=source.includes('\r\n')?'\r\n':'\n';
  const patch={base:source,start:bytes(source),end:bytes(source),expected:'',text:(source&&!source.endsWith('\n')?nl:'')+statement+nl};
  return {patch,source:applyPatch(source,patch)};
}

// A new line or arrow between two ends. Two shape ends reuse drag-to-connect
// so the route gets the same elbow; anything with a literal end is straight.
export function freeLineCandidate(source,scene,{start,end,kind='arrow'}){
  if(!['arrow','line'].includes(kind))throw new Error('Choose arrow or line.');
  if(start?.object&&end?.object){
    if(start.object.id===end.object.id)throw new Error('Drop on a different shape, or on empty canvas.');
    return connectCandidate(source,scene,{from:start.object,fromAnchor:start.anchor,to:end.object,toAnchor:end.anchor,kind});
  }
  const a=endPoint(start),b=endPoint(end);
  if(Math.hypot(a.x-b.x,a.y-b.y)<GRID)throw new Error('Drag farther to draw a line.');
  const name=uniqueName(source,scene,'Link');
  const {patch,source:next}=append(source,`${name}: ${kind} from ${endText(start)} to ${endText(end)}`);
  return {label:`Draw ${kind}`,selectName:name,patch,source:next};
}

// The statement of a connector and the byte-safe patch helper for it.
function statementOf(source,object){
  if(!object||!lineKinds.includes(object.kind)||!object.span)throw new Error('Select a line or arrow.');
  const a=byteOffsetToIndex(source,object.span.start),b=byteOffsetToIndex(source,object.span.end);
  return {a,b,text:source.slice(a,b)};
}
function patchStatement(source,object,text){
  const {text:expected}=statementOf(source,object);
  const patch={base:source,start:object.span.start,end:object.span.end,expected,text};
  return {patch,source:applyPatch(source,patch)};
}
function selection(object){return object.name?{selectName:object.name}:{selectId:object.id,targetKind:object.kind};}

// Body drag: every point of the route is a literal tuple (relative moves
// like "right 1" travel along), so moving the line shifts each tuple.
export function literalRoute(source,object){
  const {text}=statementOf(source,object),masked=mask(text);
  const body=masked.replace(/^\s*[A-Z][A-Za-z0-9_]*\s*:/,'');
  if(!/\bfrom\b/.test(body))return false;
  if(/\b[A-Z][A-Za-z0-9_]*\b|\b(?:until|even|heading|last|previous|first|same|with|at)\b/.test(body.replace(/\b(?:from|to|then)\b/g,'')))return false;
  const tuples=[...body.matchAll(TUPLE)].length;
  return tuples>0&&tuples===(body.match(/\(/g)||[]).length;
}
export function translateLineCandidate(source,scene,object,dx,dy){
  if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new Error('Invalid move.');
  if(!literalRoute(source,object))throw new Error('Only lines with free ends can be dragged. Drag an endpoint instead.');
  const {text}=statementOf(source,object),masked=mask(text);
  const sx=snapToGrid(dx),sy=snapToGrid(dy);
  if(!sx&&!sy)throw new Error('Drag farther to move the line.');
  let out='',last=0;
  for(const m of masked.matchAll(TUPLE)){
    out+=text.slice(last,m.index)+pointText({x:Number(m[1])+sx,y:Number(m[2])+sy});last=m.index+m[0].length;
  }
  out+=text.slice(last);
  const {patch,source:next}=patchStatement(source,object,out);
  return {label:'Move line',patch,source:next,...selection(object)};
}

// Where the from / final to expression sits inside the statement.
function endpointRange(masked,which){
  const expr=`(\\([^()]*\\)|[A-Z][A-Za-z0-9_]*(?:\\.[a-z]+)?)`;
  if(which==='from'){const m=new RegExp(`\\bfrom\\s+${expr}`).exec(masked);return m&&{start:m.index+m[0].length-m[1].length,end:m.index+m[0].length};}
  let found=null;for(const m of masked.matchAll(new RegExp(`\\bto\\s+${expr}`,'g')))found={start:m.index+m[0].length-m[1].length,end:m.index+m[0].length};
  return found;
}
// Endpoint drag: replace just that end. Attaching needs a shape defined
// before the line, because Pikchr resolves names in source order.
export function moveEndpointCandidate(source,scene,object,which,end){
  if(which!=='from'&&which!=='to')throw new Error('Choose the start or the end.');
  const {text}=statementOf(source,object),range=endpointRange(mask(text),which);
  if(!range)throw new Error('This line has no editable '+(which==='from'?'start':'end')+'.');
  if(end?.object){
    if(!(end.object.span?.start<object.span.start))throw new Error(`${end.object.name||'That shape'} is defined after this line. Attach to an earlier shape.`);
  }
  const replacement=endText(end);
  const out=text.slice(0,range.start)+replacement+text.slice(range.end);
  if(out===text)throw new Error('The endpoint is already there.');
  const {patch,source:next}=patchStatement(source,object,out);
  return {label:(which==='from'?'Move start':'Move end')+(end.object?` to ${replacement}`:''),patch,source:next,...selection(object)};
}

// The two ends of a line as written: each is a literal point or a shape
// anchor, with its current position. Null when an end is an expression
// Studio cannot edit (the endpoint handles are then not offered).
export function lineEnds(source,scene,object){
  let text;try{({text}=statementOf(source,object));}catch{return null;}
  const masked=mask(text),ends={};
  for(const which of ['from','to']){
    const range=endpointRange(masked,which);if(!range)return null;
    const expr=text.slice(range.start,range.end),tuple=new RegExp(`^\\(\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\)$`).exec(expr);
    if(tuple){ends[which]={literal:true,point:{x:Number(tuple[1]),y:Number(tuple[2])}};continue;}
    const ref=/^([A-Z][A-Za-z0-9_]*)(?:\.([a-z]+))?$/.exec(expr),shape=ref&&scene?.objects?.find(o=>o.name===ref[1]);
    const at=shape&&(ref[2]?shape.anchors?.[ref[2]]:shape.center);
    if(!finite(at))return null;
    ends[which]={literal:false,object:shape,anchor:ref[2]||'c',point:at};
  }
  return ends;
}
