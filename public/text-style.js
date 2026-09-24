// One-click text styling for text objects and labelled shapes. Pikchr text
// attributes follow each string ("A" bold big), so every label string gets
// the same managed attributes; colour is a statement attribute.
import {readProperties,propertyCandidate} from './properties.js?v=20260923c';

export const textSizes=['small','normal','big','bigger'];
export const textAligns=['left','center','right'];
export const textColours=['default','black','red','blue','green','gray'];
const SIZE_WORDS={small:['small'],normal:[],big:['big'],bigger:['big','big']};
const ALIGN_WORDS={left:['ljust'],center:[],right:['rjust']};
const MANAGED=new Set(['small','big','bold','italic','ljust','rjust','center']);
const KEPT=new Set(['above','below','aligned','mono','monospace']);
const COLOUR=/(\s+)color\s+(0x[0-9a-fA-F]{6}|#[0-9a-fA-F]{6}|black|white|red|blue|green|yellow|gray|grey)\b/;

// The attribute words right after one label string.
function wordsAfter(statement,from){
  const words=[];let at=from;
  for(;;){
    const m=/^\s+([a-z]+)\b/.exec(statement.slice(at));
    if(!m||!(MANAGED.has(m[1])||KEPT.has(m[1])))break;
    words.push(m[1]);at+=m[0].length;
  }
  return {words,end:at};
}

export function textStyle(source,object,scene){
  const {statement,labels}=readProperties(source,object,scene);
  if(!labels.length)return null;
  const first=labels[0],{words}=wordsAfter(statement,first.index+first[0].length);
  const bigs=words.filter(w=>w==='big').length;
  return {
    size:words.includes('small')?'small':bigs>1?'bigger':bigs?'big':'normal',
    bold:words.includes('bold'),italic:words.includes('italic'),
    align:words.includes('ljust')?'left':words.includes('rjust')?'right':'center',
    colour:COLOUR.exec(statement.replace(/"(?:\\.|[^"\\])*"/g,m=>' '.repeat(m.length)))?.[2]||'default',
  };
}

// change: {size}|{bold}|{italic}|{align}|{colour}. Returns a candidate edit.
export function textStyleCandidate(source,object,scene,change){
  const {statement,labels}=readProperties(source,object,scene);
  if(!labels.length)throw new Error('Add text before styling it.');
  const current=textStyle(source,object,scene),next={...current,...change};
  if(!textSizes.includes(next.size)||!textAligns.includes(next.align)||!textColours.includes(next.colour))throw new Error('Choose a supported text style.');
  const managed=[...SIZE_WORDS[next.size],...(next.bold?['bold']:[]),...(next.italic?['italic']:[]),...ALIGN_WORDS[next.align]];
  let out='',last=0;
  for(const label of labels){
    const end=label.index+label[0].length,{words,end:stop}=wordsAfter(statement,end);
    const kept=words.filter(w=>KEPT.has(w));
    out+=statement.slice(last,end)+[...kept,...managed].map(w=>' '+w).join('');last=stop;
  }
  out+=statement.slice(last);
  const masked=out.replace(/"(?:\\.|[^"\\])*"/g,m=>' '.repeat(m.length)),m=COLOUR.exec(masked);
  if(m)out=out.slice(0,m.index)+out.slice(m.index+m[0].length);
  if(next.colour!=='default')out=out.replace(/\s*$/,'')+` color ${next.colour}`+(out.match(/\s*$/)?.[0]||'');
  if(out===statement)throw new Error('That style is already applied.');
  const key=Object.keys(change)[0],value=change[key];
  const label=key==='size'?`Text size ${value}`:key==='align'?`Align text ${value}`:key==='colour'?`Text colour ${value}`:`${value?'Add':'Remove'} ${key}`;
  const option=propertyCandidate(source,object,statement,out,label);
  return object.name?option:{...option,selectId:object.id,targetKind:object.kind};
}
