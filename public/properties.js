import { applyPatch, byteOffsetToIndex, editability, safeAttributes, colourNames, isColour } from './edits.js?v=20261106f';
export { colourNames, isColour };
import { macroBlocked } from './macro-detach.js?v=20261106f';

const bytes = text => new TextEncoder().encode(text).length;
const kinds = ['box','cylinder','circle','ellipse','oval','diamond','file','line','arrow','text'];
const fail = () => { throw new Error('This object’s text and terminations are read-only. Use the source editor.'); };

export function readProperties(source, object, scene) {
  if (object?.reason === 'Macro-expanded object' && typeof source === 'string') throw new Error(macroBlocked(source, object));
  if (typeof source !== 'string' || !object?.span || !scene?.objects?.includes(object)
      || (scene.source !== undefined && scene.source !== source)
      || !kinds.includes(object.kind) || !editability(object, scene).editable) fail();
  if (scene.objects.some(other => other !== object && other.span?.start === object.span.start && other.span?.end === object.span.end)) fail();
  const start = byteOffsetToIndex(source,object.span.start);
  const end = byteOffsetToIndex(source,object.span.end);
  if (end <= start) fail();
  const statement = source.slice(start,end);
  const labels = [...statement.matchAll(/"(?:\\.|[^"\\])*"/g)];
  if (labels.some(match => /\\|[\r\n]/.test(match[0]))) fail();
  // Lines of one label may carry text attributes ("a" bold "b" bold), nothing else.
  if (labels.some((match,index)=>index && !TEXT_ATTRS_ONLY.test(statement.slice(labels[index-1].index+labels[index-1][0].length,match.index)))) fail();
  const masked = statement.replace(/"(?:\\.|[^"\\])*"/g,match=>' '.repeat(match.length));
  if (/["\[\]{};#\r\n]/.test(masked.trim())) fail();
  const header = masked.match(/^\s*(?:([A-Z][A-Za-z0-9_]*)\s*:\s*)?(box|cylinder|circle|ellipse|oval|diamond|file|line|arrow|text)\b/);
  if (!header || header[2] !== object.kind || (header[1] || '') !== (object.name || '')) fail();
  const flags = [...masked.matchAll(/<->|<-|->/g)];
  if (flags.length > 1) fail();
  return {statement,header,labels,flags};
}
const read=readProperties;
const TEXT_ATTR_WORDS='(?:bold|italic|big|small|ljust|rjust|center|above|below|aligned|mono|monospace)';
const TEXT_ATTRS_ONLY=new RegExp(`^(?:\\s+${TEXT_ATTR_WORDS}\\b)*\\s*$`);
const TEXT_ATTRS_AFTER=new RegExp(`^(?:\\s+${TEXT_ATTR_WORDS}\\b)*`);

// Pikchr's built-in line thickness, in inches; `thickness = …` overrides it.
export const PIKCHR_THICKNESS=0.015;
const UNITS={'':1,in:1,cm:1/2.54,mm:1/25.4,pt:1/72,px:1/96};
export function documentThickness(source){
  const global=[...source.replace(/"(?:\\.|[^"\\])*"|#[^\n]*/g,'').matchAll(/^\s*thickness\s*=\s*(\d+(?:\.\d*)?|\.\d+)(in|cm|mm|pt|px)?\s*$/gm)].at(-1);
  const value=global?Number(global[1])*UNITS[global[2]||'']:NaN;
  return Number.isFinite(value)&&value>0?value:PIKCHR_THICKNESS;
}
// The thickness Pikchr draws, applied in source order: `thickness N[unit]`
// sets it, `thick` multiplies by 1.5 and `thin` by 0.67. Undefined when a
// value is an expression Studio cannot evaluate.
function effectiveThickness(style,base){
  let value=base,set=false;
  const words=style.matchAll(/\b(?:thickness\s+(\S+)|thick|thin)\b/g);
  for(const match of words){
    set=true;
    if(match[0]==='thick')value*=1.5;
    else if(match[0]==='thin')value*=0.67;
    else{
      const literal=/^(\d+(?:\.\d*)?|\.\d+)(in|cm|mm|pt|px)?$/.exec(match[1]);
      if(!literal)return {value:undefined,set};
      value=Number(literal[1])*UNITS[literal[2]||''];
    }
  }
  return {value,set};
}

export function inspectProperties(source,object,scene) {
  const {labels,flags,statement} = read(source,object,scene);
  const style=maskLabels(statement);
  const weight=effectiveThickness(style,documentThickness(source));
  const color=key=>{const value=style.match(new RegExp(`\\b${key}\\s+(0x[0-9a-fA-F]{6}|[A-Za-z]+)(?![\\w.$])`))?.[1];return value&&isColour(value)?value.toLowerCase().replace('0x','#'):undefined;};
  return {
    text: labels.map(label=>label[0].slice(1,-1)).join('\n'),
    width:object.bbox?.width,height:object.bbox?.height,fill:color('fill'),color:color('color'),stroke:color('color'),thickness:weight.value,thicknessSet:weight.set,
    termination: ['line','arrow'].includes(object.kind)
      ? ({'<-':'start','->':'end','<->':'both'}[flags[0]?.[0]] || (object.kind === 'arrow' ? 'end' : 'none')) : null,
  };
}

export function propertyCandidate(source,object,statement,replacement,label) {
  // Trim the common edges so the patch touches only the changed characters.
  // Work in code points to avoid splitting a surrogate pair / UTF-8 character.
  const before = [...statement], after = [...replacement];
  let left=0,right=0;
  while (left<before.length && left<after.length && before[left]===after[left]) left++;
  while (right<before.length-left && right<after.length-left && before[before.length-1-right]===after[after.length-1-right]) right++;
  const prefix=before.slice(0,left).join('');
  const expected=before.slice(left,before.length-right).join('');
  const patch={base:source,start:object.span.start+bytes(prefix),end:object.span.start+bytes(prefix+expected),expected,text:after.slice(left,after.length-right).join('')};
  return {label,patch,source:applyPatch(source,patch),...(object.name ? {selectName:object.name} : {})};
}
const candidate=propertyCandidate;

const shapeKinds = ['box','cylinder','circle','ellipse','oval','diamond','file'];
const numeric = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const maskLabels = statement => statement.replace(/"(?:\\.|[^"\\])*"/g,match=>' '.repeat(match.length));

function fitStatement(statement,object) {
  if (!shapeKinds.includes(object.kind)) throw new Error('Fit to text is available for native shapes, not connectors.');
  const masked=maskLabels(statement);
  const header=masked.match(/^\s*(?:[A-Z][A-Za-z0-9_]*\s*:\s*)?(?:box|cylinder|circle|ellipse|oval|diamond|file)\b/);
  const body=masked.slice(header[0].length);
  const point=`\\(\\s*${numeric}\\s*,\\s*${numeric}\\s*\\)`;
  const placements=[...body.matchAll(new RegExp(`\\b(?:with\\s+\\.c\\s+)?at\\s*(?:[A-Z][A-Za-z0-9_]*\\.c\\s*\\+\\s*)?${point}`, 'g'))];
  if (placements.length!==1) throw new Error('Fit to text needs an explicit center position or supported center alignment.');
  const placement=placements[0];
  const attributes=body.slice(0,placement.index)+body.slice(placement.index+placement[0].length);
  // Reject expressions rather than accidentally changing their meaning when
  // removing explicit size overrides. Labels and numeric centers are masked.
  if (!safeAttributes(attributes)) {
    throw new Error('This shape uses expressions or attributes that cannot be safely fitted.');
  }
  const removals=[...masked.matchAll(new RegExp(`\\b(?:width|wid|height|ht|radius|diameter)\\s+${numeric}(?:cm|mm|in|px|pt|%)?(?![\\w.%])|\\bfit\\b`, 'g'))];
  let replacement=statement;
  for (const match of removals.reverse()) replacement=replacement.slice(0,match.index)+replacement.slice(match.index+match[0].length);
  // Fit follows all text/style attributes. Native anchor references to this
  // object are left untouched and re-evaluated against its new bounds.
  return replacement.trimEnd()+' fit';
}

// Fit measures the label as a block; lines placed with above/below between
// them are ambiguous, so Fit stays off for those labels.
function positionedLines(statement,labels){
  return labels.some((m,i)=>i&&/\b(?:above|below)\b/.test(statement.slice(labels[i-1].index+labels[i-1][0].length,m.index)));
}
export function canFitText(source,object,scene) {
  try { const {statement,labels}=read(source,object,scene);if(positionedLines(statement,labels))return false;fitStatement(statement,object);return true; }
  catch { return false; }
}

export function fitText(source,object,scene) {
  const {statement,labels}=read(source,object,scene);
  if (!labels.length) throw new Error('Add a text label before fitting this shape.');
  if (positionedLines(statement,labels)) throw new Error('This label places lines above and below each other. Edit its size in source.');
  return candidate(source,object,statement,fitStatement(statement,object),'Fit shape to text');
}

export function encodeLabel(text) {
  if (typeof text !== 'string' || /["\\\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw new Error('Use plain text without quotes, backslashes or control characters. Line breaks are supported.');
  return text.split('\n').map(line=>`"${line}"`).join(' ');
}
export function changeText(source,object,scene,text,{fit}={}) {
  const encoded=encodeLabel(text);
  const {statement,header,labels}=read(source,object,scene);
  const label=labels[0];
  // Keep the text attributes of the first line on every new line.
  const attrs=label?TEXT_ATTRS_AFTER.exec(statement.slice(label.index+label[0].length))[0]:'';
  const lastEnd=label?labels.at(-1).index+labels.at(-1)[0].length:0;
  const tailAttrs=label?TEXT_ATTRS_AFTER.exec(statement.slice(lastEnd))[0].length:0;
  const styled=attrs?text.split('\n').map(line=>`"${line}"`+attrs).join(' '):encoded;
  let replacement=label
    ? statement.slice(0,label.index)+styled+statement.slice(lastEnd+tailAttrs)
    : statement.slice(0,header[0].length)+` ${encoded}`+statement.slice(header[0].length);
  if (fit && text.trim()) replacement=fitStatement(replacement,object);
  else if (fit===false && /\bfit\b/.test(maskLabels(statement))) {
    // Opting out after a previous fit must really preserve the current size,
    // rather than leaving an old automatic-fit instruction active.
    const {width,height}=object.bbox||{};
    if (!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) fail();
    replacement=fitStatement(replacement,object).replace(/ fit$/,'');
    replacement+=object.kind==='circle' ? ` radius ${width/2}` : ` width ${width} height ${height}`;
  }
  return candidate(source,object,statement,replacement,fit&&text.trim()?'Change text and fit shape':'Change text');
}

export function changeTermination(source,object,scene,mode) {
  if (!['none','start','end','both'].includes(mode) || !['line','arrow'].includes(object.kind)) fail();
  const {statement,header,flags}=read(source,object,scene);
  const flag=flags[0];
  const token={none:'',start:'<-',end:'->',both:'<->'}[mode];
  let replacement=flag ? statement.slice(0,flag.index)+token+statement.slice(flag.index+flag[0].length)
    : statement.slice(0,header[0].length)+(token ? ` ${token}` : '')+statement.slice(header[0].length);
  // Pikchr has no boolean property that clears an arrow's default arrowhead.
  if (mode==='none' && object.kind==='arrow') replacement=replacement.slice(0,header[0].length-5)+'line'+replacement.slice(header[0].length);
  return {...candidate(source,object,statement,replacement,'Change line termination'),selectId:object.id,targetKind:mode==='none' ? 'line' : object.kind};
}
