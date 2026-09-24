import {applyPatch,byteOffsetToIndex} from './edits.js?v=20260923c';
import {encodeLabel} from './properties.js?v=20260923c';
const bytes=value=>new TextEncoder().encode(value).length;
const format=value=>{if(!Number.isFinite(value)||Math.abs(value)>1000000)throw new Error('Choose finite diagram coordinates.');return Number(value.toFixed(4));};
function parameters({kind,width=1.5,height=1,label=''}){
  if(!['triangle','trapezoid'].includes(kind))throw new Error('Choose triangle or trapezoid.');
  if(![width,height].every(n=>Number.isFinite(n)&&n>=0.1&&n<=100))throw new Error('Composite dimensions must be between 0.1 and 100.');
  encodeLabel(label);
  return {kind,width:format(width),height:format(height),label};
}
function statement(name,options,x,y,newline='\n'){
  const p=parameters(options),w=p.width/2,h=p.height/2,point=(x,y)=>`(${format(x)}, ${format(y)})`;
  const vertices=p.kind==='triangle'?[[-w,-h],[0,h],[w,-h]]:[[-w,-h],[-w/2,h],[w/2,h],[w,-h]];
  const outline='  Outline: line from '+vertices.map(([x,y])=>point(x,y)).join(' to ')+' close';
  return [`${name}: [`,`  # studio-composite-v1 ${JSON.stringify(p)}`,`  Bounds: box invis width ${p.width} height ${p.height} at (0, 0)`,outline,...(p.label?[`  Caption: text ${encodeLabel(p.label)} at (0, 0)`]:[]),`] at (${format(x)}, ${format(y)})`].join(newline);
}
export function createComposite(source,scene,{kind,x,y,width=1.5,height=1,label=''}={}){
  const p=parameters({kind,width,height,label});
  if(/\\\s*$/.test(source))throw new Error('Finish the continued source line before adding a composite.');
  const used=new Set(source.match(/\b[A-Z][A-Za-z0-9_]*\b/g)||[]);for(const object of scene?.objects||[])used.add(object.name);
  let index=1;while(used.has(`Composite${index}`))index++;
  const name=`Composite${index}`,newline=source.includes('\r\n')?'\r\n':'\n';
  const patch={base:source,start:bytes(source),end:bytes(source),expected:'',text:(source&&!source.endsWith('\n')?newline:'')+statement(name,p,x,y,newline)+newline};
  return {label:`Add ${kind} composite`,selectName:name,patch,source:applyPatch(source,patch),ports:['n','e','s','w'].map(anchor=>`${name}.Bounds.${anchor}`)};
}

// This is deliberately not a general group parser. Only a byte-for-byte
// recognized Studio template can move; edited children require source editing.
export function moveGeneratedGroup(source,scene,object,target){
  if(!object||!scene?.objects?.includes(object)||(scene.source!==undefined&&scene.source!==source)||object.depth>0||object.parent||object.macro||object.studioMacro||/macro|nested/i.test(object.reason||'')||!/^[A-Z][A-Za-z0-9_]*$/.test(object.name||'')||scene.objects.filter(o=>o.name===object.name).length!==1||scene.objects.some(o=>o!==object&&o.span?.start<object.span?.start&&o.span?.end>=object.span?.end))throw new Error('Choose a generated top-level composite.');
  const start=byteOffsetToIndex(source,object.span?.start),end=byteOffsetToIndex(source,object.span?.end),original=source.slice(start,end);
  const newline=original.includes('\r\n')?'\r\n':'\n',lines=original.split(newline);
  if(lines[0]!==`${object.name}: [`||!lines[1]?.startsWith('  # studio-composite-v1 '))throw new Error('Only unchanged generated composites support direct movement.');
  let p;try{p=parameters(JSON.parse(lines[1].slice('  # studio-composite-v1 '.length)));}catch{throw new Error('Composite metadata is invalid; edit this group in source.');}
  const position=lines.at(-1).match(/^\] at \(([+-]?(?:\d+(?:\.\d*)?|\.\d+)), ([+-]?(?:\d+(?:\.\d*)?|\.\d+))\)$/);
  if(!position||statement(object.name,p,Number(position[1]),Number(position[2]),newline)!==original)throw new Error('The composite has custom source changes; move it in source.');
  const tail=lines.at(-1),text=`] at (${format(target?.x)}, ${format(target?.y)})`;
  const patch={base:source,start:object.span.end-bytes(tail),end:object.span.end,expected:tail,text};
  return {label:'Move composite',selectName:object.name,patch,source:applyPatch(source,patch)};
}
