import {applyPatch,routeCandidates,safeAttributes} from './edits.js?v=20260923c';
import {readProperties} from './properties.js?v=20260923c';

const bytes = value => new TextEncoder().encode(value).length;
const mask = value => value.replace(/"(?:\\.|[^"\\])*"/g,label=>' '.repeat(label.length));
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const tuple = `\\(\\s*${number}\\s*,\\s*${number}\\s*\\)`;
const shapeKinds = ['box','cylinder','circle','ellipse','oval','diamond','text'];
const edge = object => ['arrow','line'].includes(object.kind);
const identifiers = statement => [...mask(statement).replace(/^\s*[A-Z][A-Za-z0-9_]*\s*:/,'').matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)].map(match=>match[0]);
function supported(source,scene,object) {
  const {statement,header}=readProperties(source,object,scene);
  if ((!edge(object)||object.name)&&!/^[A-Z][A-Za-z0-9_]*$/.test(object.name||'')) throw new Error('Copy needs uniquely named top-level shapes.');
  if (edge(object)) {
    if (!routeCandidates(source,object,scene,'straight').length) throw new Error('This connector route cannot be safely copied.');
  } else {
    if (!shapeKinds.includes(object.kind)) throw new Error('This object cannot be copied.');
    const masked=mask(statement);
    const placements=[...masked.matchAll(new RegExp(`\\b(?:with\\s+\\.c\\s+)?at\\s*(?:[A-Z][A-Za-z0-9_]*\\.c(?:\\s*\\+\\s*${tuple})?|${tuple})`,'g'))];
    if (placements.length!==1) throw new Error('Copied shapes need explicit centers or internal center references.');
    const p=placements[0],attributes=masked.slice(header[0].length,p.index)+masked.slice(p.index+p[0].length);
    if (!safeAttributes(attributes) || /[+*/]/.test(attributes.replace(new RegExp(number,'g'),''))) throw new Error('Shape expressions cannot be safely copied.');
    const keys='(?:width|wid|height|ht|radius|diameter|thickness)';
    const literals=[...attributes.matchAll(new RegExp(`\\b${keys}\\s+${number}(?:cm|mm|in|px|pt|%)?(?=\\s|$)(?!\\s*[+*/-])`,'g'))];
    if (literals.length!==[...attributes.matchAll(new RegExp(`\\b${keys}\\b`,'g'))].length) throw new Error('Dimension expressions cannot be safely copied.');
    if (!Number.isFinite(object.center?.x)||!Number.isFinite(object.center?.y)) throw new Error('Render the shape before copying it.');
  }
  return statement;
}

export function copySelection(source,scene,ids) {
  const requested=new Set(ids);
  if (!requested.size) throw new Error('Select shapes to copy.');
  const selected=(scene.objects||[]).filter(object=>requested.has(object.id));
  if (selected.length!==requested.size) throw new Error('The selection changed. Select objects again.');
  const names=new Set(selected.map(object=>object.name));
  const omittedEdges=[];
  for (const object of scene.objects) {
    if (!edge(object)||requested.has(object.id)) continue;
    let statement;
    try { statement=readProperties(source,object,scene).statement; } catch { continue; }
    const references=identifiers(statement);
    if (!references.some(name=>names.has(name))) continue;
    if (references.length && references.every(name=>names.has(name))) {
      try { supported(source,scene,object); selected.push(object); } catch { omittedEdges.push(object.name||object.id); }
    } else omittedEdges.push(object.name||object.id);
  }
  const included=new Set(selected.map(object=>object.name));
  const reserved=new Set(source.match(/\b[A-Z][A-Za-z0-9_]*\b/g)||[]);
  for(const object of scene.objects)if(object.name)reserved.add(object.name);
  const objects=selected.sort((a,b)=>a.span.start-b.span.start).map(object=>{
    let statement=supported(source,scene,object);
    if (identifiers(statement).some(name=>!included.has(name))) throw new Error(`${object.name} depends on an unselected object. Select that object too.`);
    let name=object.name;
    if(!name){
      let index=1;while(reserved.has(`CopiedLink${index}`))index++;
      name=`CopiedLink${index}`;reserved.add(name);
      // Naming happens only inside the portable fragment. Original source and
      // render-local IDs remain untouched, including when Copy is cancelled.
      statement=statement.replace(/^(\s*)/,`$1${name}: `);
    }
    return {name,kind:object.kind,statement,center:object.center?{...object.center}:undefined,path:object.path?.map(p=>({...p}))};
  });
  return {version:1,objects,omittedEdges};
}

export function pasteSelection(source,scene,fragment,{dx=1,dy=-1}={}) {
  if (fragment?.version!==1 || !Array.isArray(fragment.objects) || !fragment.objects.length || fragment.objects.length>1000) throw new Error('Choose a valid copied selection.');
  if (![dx,dy].every(value=>Number.isFinite(value)&&Math.abs(value)<=1000000)) throw new Error('Paste offsets must be finite diagram coordinates.');
  if (/\\\s*$/.test(source)) throw new Error('Finish the continued source line before pasting.');
  // Rebuild spans and revalidate portable fragments rather than trusting stored offsets.
  let original='';
  const objects=fragment.objects.map((item,index)=>{
    if (typeof item.statement!=='string'||item.statement.length>100000) throw new Error('Invalid copied statement.');
    const start=bytes(original);original+=item.statement+'\n';
    return {...item,id:`copy${index}`,span:{start,end:start+bytes(item.statement)}};
  });
  copySelection(original,{source:original,objects},objects.map(object=>object.id));
  const used=new Set(source.match(/\b[A-Z][A-Za-z0-9_]*\b/g)||[]);
  for (const object of scene?.objects||[]) used.add(object.name);
  const names=new Map();
  for (const object of objects) {
    let i=2,name=object.name;
    while (used.has(name)) name=object.name+i++;
    used.add(name);names.set(object.name,name);
  }
  const format=value=>{
    if (!Number.isFinite(value)||Math.abs(value)>1000000) throw new Error('Pasted coordinates exceed diagram limits.');
    return Number(value.toFixed(4));
  };
  const statements=objects.map(object=>{
    let statement=object.statement;
    // Protect strings from both identifier remapping and coordinate movement.
    statement=statement.split(/("(?:\\.|[^"\\])*")/g).map((piece,index)=>{
      if (index%2) return piece;
      const relative=!edge(object)&&/\bat\s+[A-Z][A-Za-z0-9_]*\.c/.test(mask(object.statement));
      if (!relative) piece=piece.replace(new RegExp(`\\(\\s*(${number})\\s*,\\s*(${number})\\s*\\)`,'g'),(_,x,y)=>`(${format(Number(x)+dx)}, ${format(Number(y)+dy)})`);
      return piece.replace(/\b[A-Z][A-Za-z0-9_]*\b/g,name=>names.get(name)||name);
    }).join('');
    return statement;
  });
  const newline=source.includes('\r\n')?'\r\n':'\n';
  const text=(source&&!source.endsWith('\n')?newline:'')+statements.join(newline)+newline;
  const patch={base:source,start:bytes(source),end:bytes(source),expected:'',text};
  const selectionNames=objects.filter(object=>!edge(object)).map(object=>names.get(object.name));
  return {label:`Paste ${objects.length} objects`,patch,source:applyPatch(source,patch),selectName:selectionNames[0]||names.values().next().value,selectionNames,omittedEdges:[...(fragment.omittedEdges||[])]};
}
