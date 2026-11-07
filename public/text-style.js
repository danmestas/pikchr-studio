// One-click text styling for text objects and labelled shapes. Pikchr text
// attributes follow each string ("A" bold big), so every label string gets
// the same managed attributes. Colour is Pikchr's statement-wide color, which
// also draws the outline, so it goes through the same rewrite as Style's
// Line & text row rather than a second, different one.
import {readProperties,propertyCandidate,attributeClauses,colourValue,lockedMessage} from './properties.js?v=20261106g';
import {changeAppearance} from './object-actions.js?v=20261106g';

export const textSizes=['small','normal','big','bigger'];
export const textAligns=['left','center','right'];
// The default plus the theme-safe inks from the Style editor (see property-ui.js INKS).
export const textColours=['default','black','firebrick','blue','darkgreen','dimgray'];
const SIZE_WORDS={small:['small'],normal:[],big:['big'],bigger:['big','big']};
const ALIGN_WORDS={left:['ljust'],center:[],right:['rjust']};
// Pikchr has one font choice, monospace, spelled mono or monospace.
const MANAGED=new Set(['small','big','bold','italic','mono','monospace','ljust','rjust','center']);
const KEPT=new Set(['above','below','aligned']);

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

// colour is the drawn color (a name or #rrggbb) or 'default'; colourLocked
// is the clause as written when it is not a literal Studio can replace.
export function textStyle(source,object,scene){
  const {statement,labels}=readProperties(source,object,scene);
  if(!labels.length)return null;
  const first=labels[0],{words}=wordsAfter(statement,first.index+first[0].length);
  const bigs=words.filter(w=>w==='big').length;
  const {clauses,written}=attributeClauses(statement,'color'),last=clauses.at(-1);
  return {
    size:words.includes('small')?'small':bigs>1?'bigger':bigs?'big':'normal',
    bold:words.includes('bold'),italic:words.includes('italic'),mono:words.includes('mono')||words.includes('monospace'),
    align:words.includes('ljust')?'left':words.includes('rjust')?'right':'center',
    colour:last?colourValue(last.value):'default',colourLocked:written,
  };
}

const same=(a,b)=>String(a).toLowerCase().replace(/^grey$/,'gray')===String(b).toLowerCase().replace(/^grey$/,'gray');

// change: {size}|{bold}|{italic}|{mono}|{align}|{colour}. Returns a candidate edit.
export function textStyleCandidate(source,object,scene,change){
  const {statement,labels}=readProperties(source,object,scene);
  if(!labels.length)throw new Error('Add text before styling it.');
  const current=textStyle(source,object,scene),key=Object.keys(change)[0],value=change[key];
  const select=option=>object.name?option:{...option,selectId:object.id,targetKind:object.kind};
  if(key==='colour'){
    if(!textColours.includes(value))throw new Error('Choose a supported text style.');
    if(current.colourLocked)throw new Error(lockedMessage(current.colourLocked));
    if(same(current.colour,value))throw new Error('That style is already applied.');
    const option=changeAppearance(source,object,scene,{color:value==='default'?null:value});
    return select({...option,label:`Text colour ${value}`});
  }
  const next={...current,...change};
  if(!textSizes.includes(next.size)||!textAligns.includes(next.align))throw new Error('Choose a supported text style.');
  const managed=[...SIZE_WORDS[next.size],...(next.bold?['bold']:[]),...(next.italic?['italic']:[]),...(next.mono?['mono']:[]),...ALIGN_WORDS[next.align]];
  let out='',last=0;
  for(const label of labels){
    const end=label.index+label[0].length,{words,end:stop}=wordsAfter(statement,end);
    const kept=words.filter(w=>KEPT.has(w));
    out+=statement.slice(last,end)+[...kept,...managed].map(w=>' '+w).join('');last=stop;
  }
  out+=statement.slice(last);
  if(out===statement)throw new Error('That style is already applied.');
  const label=key==='size'?`Text size ${value}`:key==='align'?`Align text ${value}`:key==='mono'?`${value?'Use':'Remove'} monospace`:`${value?'Add':'Remove'} ${key}`;
  return select(propertyCandidate(source,object,statement,out,label));
}
