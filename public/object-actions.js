import {applyPatch,byteOffsetToIndex,candidates,editability,maskCode} from './edits.js?v=20261106i';
import {readProperties,propertyCandidate,isColour,attributeClauses,lockedMessage} from './properties.js?v=20261106i';
import {literalRoute,translateLineCandidate} from './free-lines.js?v=20261106i';
import {connectorStyleCandidate} from './route-styles.js?v=20261106i';

const bytes=s=>new TextEncoder().encode(s).length;
const masked=s=>s.replace(/"(?:\\.|[^"\\])*"/g,m=>' '.repeat(m.length));
// Replace (or with null remove) one style attribute. Every literal clause of
// the key goes, so the new value is the only one; a clause Studio cannot read
// as a literal refuses the edit with its source text (see attributeClauses).
function setAttribute(statement,key,value) {
  const {clauses,written}=attributeClauses(statement,key);
  if(written)throw new Error(lockedMessage(written));
  const matches=[...clauses];
  // A new thickness replaces Pikchr's thick/thin multipliers as well.
  if(key==='thickness')matches.push(...[...maskCode(statement).matchAll(/\b(?:thick|thin)\b/g)].map(m=>({index:m.index,end:m.index+m[0].length})));
  for(const match of matches.sort((a,b)=>b.index-a.index))statement=statement.slice(0,match.index).replace(/[ \t]+$/,'')+statement.slice(match.end);
  // null removes the property, so Pikchr's default applies again; thin and
  // thick are Pikchr's own words for the preset weights.
  return value===null?statement.trimEnd():statement.trimEnd()+(key==='thickness'&&weightWords.includes(value)?` ${value}`:` ${key} ${value}`);
}

// What each style control would refuse, as the source text it would name:
// the inspector disables just that control instead of erroring on use.
export function styleLocks(source,object,scene) {
  if(connectorKinds.includes(object.kind))return {fill:null,color:null,thickness:null};
  const {statement}=readProperties(source,object,scene);
  return Object.fromEntries(['fill','color','thickness'].map(key=>[key,attributeClauses(statement,key).written]));
}

const weightWords=['thin','thick'];
const colourError='Use a colour name Pikchr knows, such as red or lightblue, or a six-digit hex value such as #1a7f37.';
export function changeAppearance(source,object,scene,values) {
  const input={...values,color:'color' in values?values.color:values.stroke};
  for(const key of ['width','height'])if(input[key]!==undefined&&input[key]!==''&&connectorKinds.includes(object.kind))
    throw new Error('Resize shapes, not connector paths.');
  // Splines and arcs have no single-object style editor, but a group selection
  // can still restyle them. Their statement is rewritten only through the
  // guarded connector parser, never the more permissive property reader.
  if(connectorKinds.includes(object.kind)) {
    if(input.fill!==undefined&&input.fill!=='')throw new Error('Fill is not available for connector paths.');
    let color=input.color===undefined||input.color===''?undefined:input.color;
    const thickness=input.thickness===undefined||input.thickness===''?undefined:input.thickness;
    let number=thickness===null?null:undefined;
    if(color!==undefined) {
      if(!isColour(color))throw new Error(colourError);
      color=color.replace('#','0x');
    }
    if(weightWords.includes(thickness))number=thickness;
    else if(thickness!==undefined&&thickness!==null) {
      number=Number(thickness);
      if(!Number.isFinite(number)||number<=0||number>100)throw new Error('thickness must be greater than zero and at most 100.');
    }
    const option=connectorStyleCandidate(source,object,scene,{
      ...(color!==undefined?{color}:{}),
      ...(number!==undefined?{thickness:number}:{}),
    });
    if(!option)throw new Error('Studio cannot restyle this connector safely: its statement uses an expression or word Studio does not recognise, or it cannot be told apart from another object, so its style must be edited in source.');
    return {...option,label:'Change stroke and thickness'};
  }
  const {statement}=readProperties(source,object,scene);
  let replacement=statement;
  for(const key of ['width','height','fill','color','thickness']) {
    let value=input[key];if(value===undefined||value==='')continue;
    if(value===null&&key!=='width'&&key!=='height'||key==='thickness'&&weightWords.includes(value)){replacement=setAttribute(replacement,key,value);continue;}
    if(key==='fill'||key==='color') {
      if(!isColour(value))throw new Error(colourError);
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

// A group edit uses exactly the same per-object rewrite, expression checks and
// combined-patch pipeline as every other multi-object action. Fill is offered
// only when every member can carry it; sizing stays a single-object concern.
const connectorKinds=['arrow','line','spline','arc'];
const styleKinds=['box','cylinder','circle','ellipse','oval','diamond','file','text',...connectorKinds];
const filledKinds=['box','cylinder','circle','ellipse','oval','diamond','file'];
const styleKeys=['stroke','color','thickness','fill'];
export function groupStyleCapabilities(objects) {
  return {fill:objects.length>0&&objects.every(object=>filledKinds.includes(object.kind))};
}
export function changeSelectionAppearance(source,objects,scene,values) {
  if(objects.length<2||new Set(objects).size!==objects.length)throw new Error('Select at least two different objects to style together.');
  const unsupported=Object.keys(values).filter(key=>values[key]!==undefined&&values[key]!==''&&!styleKeys.includes(key));
  if(unsupported.length)throw new Error('Group style changes stroke, thickness and fill only. Resize one shape at a time.');
  const changes=Object.fromEntries(styleKeys.filter(key=>values[key]!==undefined&&values[key]!=='').map(key=>[key,values[key]]));
  if(!Object.keys(changes).length)throw new Error('Choose a stroke, thickness or fill change.');
  if(changes.fill!==undefined&&!groupStyleCapabilities(objects).fill)throw new Error('Fill is not available for every selected object. Change stroke or thickness instead.');
  // Refuse the whole selection before touching any member: a partial result
  // would leave the author with styles on some objects and no explanation.
  const failures=[];
  for(const object of objects){
    const label=object.name||object.kind;
    const reason=styleKinds.includes(object.kind)?editability(object,scene).reason:'only shapes, text and connectors can be styled';
    if(reason)failures.push(`${label}: ${reason}`);
  }
  if(failures.length)throw new Error('No style applied — '+failures.length+' of '+objects.length+' selected objects cannot be styled: '+failures.join('; '));
  const patches=[];
  for(const object of objects){
    try{patches.push(changeAppearance(source,object,scene,changes).patch);}
    catch(error){throw new Error(`No style applied — ${object.name||object.kind}: ${error.message}`);}
  }
  // Selection identity is carried by the renderer's stable ids, which survive a
  // style rewrite (object order and types do not change), so unnamed members
  // and entirely unnamed groups stay selected without naming the author's
  // objects.
  const first=objects[0];
  return {...combined(source,patches,`Style ${objects.length} objects`,first.name),
    ...(first.name?{}:{selectId:first.id,targetKind:first.kind}),
    selectionIds:objects.map(object=>object.id)};
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
    const edit=candidates(source,other,scene,other.center,{precise:true}).find(c=>!c.references.length&&!c.extended);
    if(!edit)throw new Error(`${other.name||other.kind} is positioned against a moved shape with an expression Studio cannot pin. Hold Alt to move it along, or edit its placement.`);
    pins.push({object:other,patch:edit.patch});
  }
  return pins;
}
// How the studio names an object in labels: its name, else its kind and label.
export function describe(object,source){
  if(object?.name)return object.name;
  const span=object?.spans?.label;let label='';
  // A macro-expanded object has no label span; its statement holds the label.
  try{if(span&&source!==undefined)label=source.slice(byteOffsetToIndex(source,span.start),byteOffsetToIndex(source,span.end));
    else if(object?.span?.start>=0&&source!==undefined)label=source.slice(byteOffsetToIndex(source,object.span.start),byteOffsetToIndex(source,object.span.end)).match(/"(?:\\.|[^"\\])*"/)?.[0]||'';}catch{}
  label=label.replace(/^"|"$/g,'');
  return (object?.kind==='[]'?'[ ] group':object?.kind||'object')+(label?` "${label.length>24?label.slice(0,23)+'…':label}"`:'');
}

const shapeKinds=['box','cylinder','circle','ellipse','oval','diamond','file','text'];
const same=(p,q,tolerance=1e-4)=>Math.abs(p.x-q.x)<=tolerance&&Math.abs(p.y-q.y)<=tolerance;
const shifted=(before,after)=>!same(before.center,after.center)
  ||(before.path||[]).length!==(after.path||[]).length||(before.path||[]).some((p,i)=>!same(p,after.path[i]));
// Mask strings, comments and macro bodies so brackets are only real blocks.
const code=text=>maskCode(text)
  .replace(/\bdefine\s+\w+\s*\{[^}]*\}/g,m=>' '.repeat(m.length));
// The k-th top-level [ ] block: the offsets of its brackets and of the end of
// its statement.
function blockStatement(text,k){
  const masked=code(text);let depth=0,count=-1,open=-1;
  for(let i=0;i<masked.length;i++){
    if(masked[i]==='['&&depth++===0){count++;open=i;}
    else if(masked[i]===']'&&--depth===0&&count===k)
      return {open,close:i,end:Math.min(...[masked.indexOf('\n',i),masked.indexOf(';',i),masked.length].filter(n=>n>=0))};
  }
  return null;
}
// Give a displaced [ ] block an explicit centre where it was.
function blockPin(text,scene,block,center,anchor){
  const blocks=scene.objects.filter(o=>o.kind==='[]'&&!/nested|macro/i.test(o.reason||''));
  const at=blockStatement(text,blocks.indexOf(block));
  if(!at||/\b(?:at|with)\b/.test(code(text).slice(at.close+1,at.end)))return null;
  const insert=bytes(text.slice(0,at.close+1));
  const add=anchor?` at ${anchor.name} + (${coordinate(center.x-anchor.center.x)}, ${coordinate(center.y-anchor.center.y)})`:` at (${coordinate(center.x)}, ${coordinate(center.y)})`;
  return {base:text,start:insert,end:insert,expected:'',text:add};
}
const coordinate=value=>Number(Number(value).toFixed(4)).toString();

// What follows a dragged shape. Shapes placed against it (B at A + ..., 1in
// below A, with .n at A.s) say so in their source, so they move with it and
// are not rewritten. Shapes that follow only because they come next in a
// chain stay where they are: each is pinned, by extending the connector it
// hangs from, else as an offset from the nearest earlier named shape that
// stays put, else at a literal position. bringAlong (Alt) inverts this: chain
// followers move and shapes placed against the dragged one are pinned.
// Render, pin the first shape that moved and should not have, and repeat. A
// follower that cannot be pinned (a macro use) moves along and the label says
// so. render(source) returns a scene ({objects, error}), sync or async.
export async function settleMove(source,scene,option,object,render,{bringAlong=false}={}){
  const before=new Map(scene.objects.map(o=>[o.id,o]));
  const moving=new Set([object.id]),pinned=[],carried=new Set();let text=option.source,result=null;
  for(let round=0;;round++){
    if(round>scene.objects.length+1)return null;
    result=await render(text);
    if(!result||result.error||!Array.isArray(result.objects))return null;
    const now=result.objects.find(o=>o.id===object.id);
    if(!now||!option.target||!same(now.center,option.target,1e-3))return null;
    const order=o=>o.span?.start>=0?o.span.start:blockStart(text,result,o);
    // Connectors never block: they follow the shapes they are attached to.
    // Shapes inside a [ ] block follow the block.
    const displaced=result.objects.filter(o=>before.has(o.id)&&o.id!==object.id&&!carried.has(o.id)&&!/nested/i.test(o.reason||'')
      &&(shapeKinds.includes(o.kind)||o.kind==='[]')&&shifted(before.get(o.id),o)).sort((a,b)=>order(a)-order(b));
    for(let grown=true;grown;){
      grown=false;
      for(const o of displaced)if(!moving.has(o.id)&&(o.dependencies||[]).some(id=>moving.has(id))!==bringAlong){moving.add(o.id);grown=true;}
    }
    const next=displaced.find(o=>!moving.has(o.id));
    if(!next)break;
    const origin=before.get(next.id);
    const stable=stableReference(text,result,before,moving,next,origin);
    const patch=next.kind==='[]'?blockPin(text,result,next,origin.center,stable)
      :editability(next,result).editable?candidates(text,next,result,origin.center,{precise:true,keepForm:true,anchorTo:stable?.name,absorb:'start'})[0]?.patch:null;
    if(!patch){
      carried.add(next.id);
      // Everything inside a carried block moves with it.
      if(next.kind==='[]')for(const o of result.objects)if(/nested/i.test(o.reason||'')&&o.bbox&&next.bbox
        &&o.center.x>=next.bbox.x&&o.center.x<=next.bbox.x+next.bbox.width&&o.center.y>=next.bbox.y&&o.center.y<=next.bbox.y+next.bbox.height)carried.add(o.id);
      continue;
    }
    pinned.push(describe(next,text));
    text=applyPatch(text,{...patch,base:text});
  }
  const shown=ids=>[...ids].map(id=>result.objects.find(o=>o.id===id)).filter(o=>o&&o.id!==object.id&&!/nested/i.test(o.reason||'')
    &&shifted(before.get(o.id),o)).map(o=>describe(o,text));
  const along=shown(moving),names=shown(carried),subject=describe(object,source);
  const alongText=along.length?` (and ${along.join(', ')} ${bringAlong?'following':'placed against'} it)`:'';
  const carriedText=names.length?`; ${names.join(', ')} moved with it (Studio can’t pin ${names.length===1?'it':'them'})`:'';
  const label=option.label+alongText+(pinned.length?`; pin ${pinned.join(', ')} in place`:'')
    +(names.length?`; ${names.join(', ')} move${names.length===1?'s':''} with it (Studio can’t pin ${names.length===1?'it':'them'})`:'');
  return {...option,label,source:text,patch:linePatch(source,text),selectId:object.id,targetKind:object.kind,result,
    ...(along.length||names.length?{summary:`Moved ${subject}${alongText}${carriedText}`}:{})};
}
// Where a top-level [ ] block starts in the source, in bytes (it has no span).
function blockStart(text,scene,block){
  const blocks=scene.objects.filter(o=>o.kind==='[]'&&!/nested|macro/i.test(o.reason||''));
  const at=blocks.includes(block)&&blockStatement(text,blocks.indexOf(block));
  return at?bytes(text.slice(0,at.open)):Infinity;
}
// The nearest earlier named shape that stays put, to pin a follower against.
function stableReference(text,scene,before,moving,object,origin){
  const at=object.kind==='[]'?blockStart(text,scene,object):object.span?.start;
  return scene.objects.filter(o=>o.name&&shapeKinds.includes(o.kind)&&o.span?.start>=0&&o.span.end<=at&&!moving.has(o.id)
    &&before.has(o.id)&&!shifted(before.get(o.id),o)&&editability(o,scene).editable)
    .sort((a,b)=>Math.hypot(a.center.x-origin.center.x,a.center.y-origin.center.y)-Math.hypot(b.center.x-origin.center.x,b.center.y-origin.center.y))[0]||null;
}
// One patch covering the changed lines, so the diff reads as whole statements.
function linePatch(source,text){
  let a=0;while(a<source.length&&a<text.length&&source[a]===text[a])a++;
  a=source.lastIndexOf('\n',a-1)+1;
  let b=0;while(b<source.length-a&&b<text.length-a&&source[source.length-1-b]===text[text.length-1-b])b++;
  const tail=source.indexOf('\n',source.length-b);const keep=tail<0?0:source.length-tail;
  return {base:source,start:bytes(source.slice(0,a)),end:bytes(source.slice(0,source.length-keep)),
    expected:source.slice(a,source.length-keep),text:text.slice(a,text.length-keep)};
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
    const edit=candidates(source,other,scene,other.center,{precise:true}).find(c=>!c.references.length&&!c.extended);
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
