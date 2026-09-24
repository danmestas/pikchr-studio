import {applyPatch,byteOffsetToIndex,candidates} from './edits.js?v=20260923c';
import {readProperties,propertyCandidate} from './properties.js?v=20260923c';
import {literalRoute,translateLineCandidate} from './free-lines.js?v=20260923c';

const bytes=s=>new TextEncoder().encode(s).length;
const masked=s=>s.replace(/"(?:\\.|[^"\\])*"/g,m=>' '.repeat(m.length));
const number='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const aliases={width:'(?:width|wid)',height:'(?:height|ht)',fill:'fill',color:'color',thickness:'thickness'};

function setAttribute(statement,key,value) {
  const mask=masked(statement), keyword=new RegExp(`\\b${aliases[key]}\\b`,'g');
  const literal=key==='fill'||key==='color'?'(?:0x[0-9a-fA-F]{6}|black|white|red|blue|green|yellow|gray|grey|none)':`${number}(?:cm|mm|in|px|pt|%)?`;
  const matches=[...mask.matchAll(new RegExp(`\\b${aliases[key]}\\s+${literal}(?=\\s|$)(?!\\s*[+*/-])`,'g'))];
  if(matches.length!==[...mask.matchAll(keyword)].length) throw new Error(`The ${key} expression must be edited in source.`);
  for(const match of matches.reverse())statement=statement.slice(0,match.index)+statement.slice(match.index+match[0].length);
  return statement.trimEnd()+` ${key} ${value}`;
}

export function changeAppearance(source,object,scene,values) {
  const {statement}=readProperties(source,object,scene);
  let replacement=statement;
  const input={...values,color:values.color??values.stroke};
  for(const key of ['width','height','fill','color','thickness']) {
    let value=input[key];if(value===undefined||value==='')continue;
    if(['width','height'].includes(key)&&['arrow','line'].includes(object.kind))throw new Error('Resize shapes, not connector paths.');
    if(key==='fill'||key==='color') {
      if(!/^(?:#[0-9a-f]{6}|0x[0-9a-f]{6}|black|white|red|blue|green|yellow|gray|grey|none)$/i.test(value))throw new Error('Use a six-digit hex color or a supported named color.');
      value=value.replace('#','0x');
    } else {
      value=Number(value);if(!Number.isFinite(value)||value<=0||value>100)throw new Error(`${key} must be greater than zero and at most 100.`);
    }
    replacement=setAttribute(replacement,key,value);
  }
  if(input.width!==undefined&&input.width!==''||input.height!==undefined&&input.height!=='') {
    const match=[...masked(replacement).matchAll(/\bfit\b/g)];
    for(const m of match.reverse())replacement=replacement.slice(0,m.index)+replacement.slice(m.index+3);
  }
  return propertyCandidate(source,object,statement,replacement,'Change size and style');
}

export function duplicateObject(source,object,scene,{dx=0.4,dy=-0.4}={}) {
  readProperties(source,object,scene);
  if(!object.name||!Number.isFinite(dx)||!Number.isFinite(dy))throw new Error('Choose a named shape to duplicate.');
  const moved=candidates(source,object,scene,{x:object.center.x+dx,y:object.center.y+dy})[0];
  if(!moved)throw new Error('This object cannot be safely duplicated; use explicit center placement.');
  let suffix=2,name=object.name+suffix;
  while(new RegExp(`\\b${name}\\b`).test(source))name=object.name+(++suffix);
  const statement=moved.patch.text.replace(new RegExp(`^(\\s*)${object.name}\\s*:`),`$1${name}:`);
  const patch={base:source,start:bytes(source),end:bytes(source),expected:'',text:(source.endsWith('\n')?'':'\n')+statement+'\n'};
  return {label:`Duplicate ${object.name}`,selectName:name,patch,source:applyPatch(source,patch)};
}

function combined(source,patches,label,selectName) {
  let replacement=source;
  for(const patch of patches.sort((a,b)=>b.start-a.start)) replacement=applyPatch(replacement,{...patch,base:replacement});
  const patch={base:source,start:0,end:bytes(source),expected:source,text:replacement};
  return {label,selectName,patch,source:replacement};
}

// Shapes that are not moving but are positioned against something that is.
// Each is pinned with an absolute `at (x, y)` at its current center so a move
// never drags unselected shapes along. Connectors are left to follow.
const isConnector=object=>['arrow','line','spline','arc','move'].includes(object.kind);
function pinPatches(source,scene,movedIds){
  const pins=[];
  for(const other of scene.objects){
    if(movedIds.has(other.id)||isConnector(other)||!other.dependencies?.some(id=>movedIds.has(id)))continue;
    const edit=candidates(source,other,scene,other.center,{precise:true}).find(c=>!c.references.length);
    if(!edit)throw new Error(`${other.name||other.kind} is positioned against a moved shape with an expression Studio cannot pin. Hold Alt to move it along, or edit its placement.`);
    pins.push({object:other,patch:edit.patch});
  }
  return pins;
}
// Wrap a single-shape move candidate with pins for its unselected dependents.
export function pinMove(source,scene,option,movedIds){
  const pins=pinPatches(source,scene,new Set(movedIds));
  if(!pins.length)return option;
  const names=pins.map(p=>p.object.name||p.object.kind).join(', ');
  return {...option,...combined(source,[option.patch,...pins.map(p=>p.patch)],`${option.label}; pin ${names} in place`,option.selectName),
    selectId:option.selectId,selectName:option.selectName,target:option.target};
}

// pinDependents: a remaining shape positioned against a deleted one is
// rewritten to an absolute `at (x, y)` at its current center, so deleting a
// shape never moves anything else. The pins are part of the same queued edit.
export function deleteObjects(source,objects,scene,{includeConnectors=false,pinDependents=false}={}) {
  if(!objects.length)throw new Error('Select objects to delete.');
  const deleting=new Set(objects);
  for(const object of objects)readProperties(source,object,scene);
  const references=(object,target)=>target.name&&new RegExp(`\\b${target.name}\\b`).test(masked(source.slice(byteOffsetToIndex(source,object.span.start),byteOffsetToIndex(source,object.span.end))).replace(/^\s*[A-Z][A-Za-z0-9_]*\s*:/,''));
  const pins=new Map();
  const pin=other=>{
    const edit=candidates(source,other,scene,other.center,{precise:true}).find(c=>!c.references.length);
    if(!edit)throw new Error(`${other.name||other.kind} is positioned relative to this selection with an expression Studio cannot pin. Edit its placement first.`);
    pins.set(other,edit.patch);
  };
  for(const other of scene.objects)if(!deleting.has(other)&&objects.some(object=>references(other,object))) {
    if(['line','arrow'].includes(other.kind)){
      if(!includeConnectors)throw new Error(`${other.name||other.kind} connects to this selection. Delete its connectors too, or reconnect them first.`);
      readProperties(source,other,scene);deleting.add(other);
    }
    else if(pinDependents)pin(other);
    else throw new Error(`${other.name||other.kind} is positioned relative to this selection. Pin it in place or edit its placement first.`);
  }
  // A statement that fills its whole line also takes its line ending, so
  // deletion does not leave blank lines behind.
  const removal=object=>{
    const a=byteOffsetToIndex(source,object.span.start);let b=byteOffsetToIndex(source,object.span.end),end=object.span.end;
    const eol=source.startsWith('\r\n',b)?2:source[b]==='\n'?1:0;
    if(eol&&(a===0||source[a-1]==='\n')){b+=eol;end+=eol;}
    return {base:source,start:object.span.start,end,expected:source.slice(a,b),text:''};
  };
  const patches=[...deleting].map(removal);
  const firstRemoved=Math.min(...[...deleting].map(object=>object.span.start));
  // Later shapes with implicit placement would shift once earlier ones vanish.
  for(const other of scene.objects)if(!deleting.has(other)&&!pins.has(other)&&other.span.start>firstRemoved&&!['arrow','line'].includes(other.kind)) {
    const text=masked(source.slice(byteOffsetToIndex(source,other.span.start),byteOffsetToIndex(source,other.span.end)));
    if(!/\bat\b/.test(text)){
      if(pinDependents)pin(other);
      else throw new Error('A later shape uses implicit placement. Give it an explicit position before deleting.');
    }
  }
  patches.push(...pins.values());
  // References outside object statements (variables, macros) are also unsafe.
  const remaining=combined(source,patches,'').source.replace(/"(?:\\.|[^"\\])*"|#[^\n]*/g,'');
  if([...deleting].some(object=>object.name&&new RegExp(`\\b${object.name}\\b`).test(remaining)))throw new Error('Source outside the selection still refers to these objects.');
  if(/\b(?:last|previous|first|same|[1-9][0-9]*(?:st|nd|rd|th))\b/.test(remaining))throw new Error('Positional references remain in source. Edit them explicitly before deleting objects.');
  const pinned=[...pins.keys()].map(o=>o.name||o.kind);
  return combined(source,patches,`Delete ${deleting.size} object${deleting.size===1?'':'s'}`+(pinned.length?`; pin ${pinned.join(', ')} in place`:''));
}

export function layoutObjects(source,objects,scene,mode) {
  if(objects.length<2||new Set(objects).size!==objects.length)throw new Error('Select at least two different shapes.');
  for(const object of objects)readProperties(source,object,scene);
  let edits=[];
  if(['equal-width','equal-height'].includes(mode)) {
    const key=mode==='equal-width'?'width':'height';
    const size=Math.max(...objects.map(object=>object.bbox[key]));
    edits=objects.map(object=>changeAppearance(source,object,scene,{[key]:size}));
  } else {
    if(!['align-x','align-y','distribute-x','distribute-y'].includes(mode))throw new Error('Choose a supported layout action.');
    const axis=mode.endsWith('x')?'x':'y', sorted=[...objects].sort((a,b)=>a.center[axis]-b.center[axis]);
    if(mode.startsWith('distribute')&&objects.length<3)throw new Error('Select at least three shapes to distribute.');
    edits=sorted.map((object,index)=>{
      const position={...object.center};
      position[axis]=mode.startsWith('align')?objects[0].center[axis]:sorted[0].center[axis]+index*(sorted.at(-1).center[axis]-sorted[0].center[axis])/(sorted.length-1);
      const edit=independent(candidates(source,object,scene,position,{precise:true}),new Set(objects.map(o=>o.name)));if(!edit)throw new Error('Layout needs movable shapes with supported center placement.');return edit;
    });
  }
  return combined(source,edits.map(edit=>edit.patch),mode.replaceAll('-',' '),objects[0].name);
}

// Group operations must not chain a moved object to another moved object,
// except for a bare relative center the author already wrote.
function independent(list,selectedNames,keep=null){
  return list.find(edit=>(edit.references||[]).every(name=>!selectedNames.has(name)||name===keep))||null;
}

export function moveObjects(source,objects,scene,dx,dy,{pinDependents=false}={}) {
  if(!objects.length||new Set(objects).size!==objects.length||!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>1000000||Math.abs(dy)>1000000)throw new Error('Choose shapes and a finite movement offset.');
  const selectedNames=new Set(objects.map(object=>object.name));
  // Connectors attached to shapes follow those shapes; only free lines with
  // literal points are translated. A shape positioned only against other
  // selected objects follows them too, so it is left as written (moving it
  // again would double the offset or break the link).
  const ids=new Set(objects.map(object=>object.id));
  const connector=object=>['arrow','line','spline','arc','move'].includes(object.kind);
  const follows=object=>object.dependencies?.length>0&&object.dependencies.every(id=>ids.has(id));
  const lines=objects.filter(object=>connector(object)&&literalRoute(source,object)).map(object=>translateLineCandidate(source,scene,object,dx,dy));
  const shapes=objects.filter(object=>!connector(object)&&!follows(object));
  if(!shapes.length&&!lines.length)throw new Error('Nothing in the selection can be moved directly. Move the shapes its connectors attach to.');
  const edits=shapes.map(object=>{
    const {statement}=readProperties(source,object,scene);
    const target={x:object.center.x+dx,y:object.center.y+dy};
    // For a bare relative center inside the selection, the reference itself
    // moves. Keep its existing offset rather than adding the group delta twice.
    const reference=masked(statement).match(/\bat\s+([A-Z][A-Za-z0-9_]*)\.c\s*$/);
    if(reference&&selectedNames.has(reference[1])){target.x-=dx;target.y-=dy;}
    const edit=independent(candidates(source,object,scene,target,{precise:true}),selectedNames,reference&&selectedNames.has(reference[1])?reference[1]:null);
    if(!edit)throw new Error('Every selected object must have supported editable placement.');
    return edit;
  });
  edits.push(...lines);
  // Everything selected moves (followers move with their anchors); pin the rest.
  const pins=pinDependents?pinPatches(source,scene,new Set(objects.map(object=>object.id))):[];
  const pinned=pins.length?`; pin ${pins.map(p=>p.object.name||p.object.kind).join(', ')} in place`:'';
  return combined(source,[...edits.map(edit=>edit.patch),...pins.map(p=>p.patch)],`Move ${objects.length} objects${pinned}`,(shapes[0]||objects[0]).name);
}
