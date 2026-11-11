import { applyPatch, byteOffsetToIndex, editability, safeAttributes, colourNames, isColour, maskCode } from './edits.js?v=20261110a';
export { colourNames, isColour };
import { macroBlocked } from './macro-detach.js?v=20261110a';

const bytes = text => new TextEncoder().encode(text).length;
const kinds = ['box','cylinder','circle','ellipse','oval','diamond','file','line','arrow','text'];
// Splines and arcs are read for the inspector (style and label text) but not
// offered to the structural actions (delete, duplicate, layout) that share
// this reader.
const lineKinds = ['spline','arc'];
const fail = reason => { throw new Error(`This object’s text and terminations are read-only${reason ? ` (${reason.replace(/\.$/,'').replace(/^./,c=>c.toLowerCase())})` : ''}. Use the source editor.`); };

export function readProperties(source, object, scene, {lines=false}={}) {
  if (object?.reason === 'Macro-expanded object' && typeof source === 'string') throw new Error(macroBlocked(source, object));
  if (typeof source !== 'string' || !object?.span || !scene?.objects?.includes(object)
      || (scene.source !== undefined && scene.source !== source)
      || !(kinds.includes(object.kind) || lines && lineKinds.includes(object.kind))) fail();
  const {editable,reason}=editability(object, scene);
  if (!editable) fail(reason);
  if (scene.objects.some(other => other !== object && other.span?.start === object.span.start && other.span?.end === object.span.end)) fail();
  const start = byteOffsetToIndex(source,object.span.start);
  const end = byteOffsetToIndex(source,object.span.end);
  if (end <= start) fail();
  const statement = source.slice(start,end);
  const labels = [...statement.matchAll(/"(?:\\.|[^"\\])*"/g)];
  if (labels.some(match => /[\r\n]/.test(match[0]))) fail();
  // Lines of one label may carry text attributes ("a" bold "b" bold), nothing else.
  if (labels.some((match,index)=>index && !TEXT_ATTRS_ONLY.test(statement.slice(labels[index-1].index+labels[index-1][0].length,match.index)))) fail();
  const masked = statement.replace(/"(?:\\.|[^"\\])*"/g,match=>' '.repeat(match.length));
  if (/["\[\]{};#\r\n]/.test(masked.trim())) fail();
  const header = masked.match(/^\s*(?:([A-Z][A-Za-z0-9_]*)\s*:\s*)?(box|cylinder|circle|ellipse|oval|diamond|file|line|arrow|text|spline|arc)\b/);
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

// A style clause Studio can rewrite is the keyword and one literal. Pikchr
// takes any expression after fill, color and thickness; a colour literal is
// a colour name in any case, a hex number of any length (0xdfd is the number
// 0x000dfd, not CSS shorthand) or a decimal number. Anything else (a variable,
// arithmetic, another object's property) is reported with its source text,
// so the one control it belongs to can say so instead of guessing.
const KEYWORDS={width:'(?:width|wid)',height:'(?:height|ht)',fill:'fill',color:'color',thickness:'thickness'};
const COLOUR_TOKEN='[+-]?(?:0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d*)?|\\.\\d+)|[A-Za-z][A-Za-z0-9_]*';
const LENGTH_TOKEN='[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:cm|mm|in|px|pt|%)?';
export function colourValue(token){
  if(typeof token!=='string')return null;
  const hex=/^([+-]?)0x([0-9a-f]+)$/i.exec(token);
  const number=hex?(hex[1]==='-'?-1:1)*parseInt(hex[2],16):/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)?Number(token):null;
  if(number===null)return colourNames.has(token.toLowerCase())?token.toLowerCase():null;
  if(!Number.isFinite(number))return null;
  if(number<0)return 'none';
  return '#'+(Math.round(number)%0x1000000).toString(16).padStart(6,'0');
}
export function attributeClauses(statement,key){
  // Strings and comments are masked: a keyword inside either is not a clause.
  const masked=maskCode(statement),colour=key==='fill'||key==='color',clauses=[];
  // A keyword after a dot or an opening parenthesis reads another value
  // (B.fill, (thickness)); it belongs to some other clause's expression.
  for(const m of masked.matchAll(new RegExp(`(?<![.(\\w$@])${KEYWORDS[key]}\\b`,'g'))){
    const clause=new RegExp(`^${KEYWORDS[key]}\\s+(${colour?COLOUR_TOKEN:LENGTH_TOKEN})(?=\\s|$)(?!\\s*(?:[+*/(]|-(?!>)))`).exec(masked.slice(m.index));
    if(!clause||colour&&colourValue(clause[1])===null)return {clauses:[],written:writtenClause(statement,masked,m.index)};
    clauses.push({index:m.index,end:m.index+clause[0].length,value:clause[1]});
  }
  return {clauses,written:null};
}
// The keyword and its whole expression as written, for the explanation.
function writtenClause(statement,masked,index){
  const operand='(?:\\([^()]*\\)|[^\\s()]+)';
  const m=new RegExp(`^\\S+(?:\\s+${operand}(?:\\s*[-+*/]\\s*${operand})*)?`).exec(masked.slice(index));
  return statement.slice(index,index+m[0].length).trim();
}
export const lockedMessage=written=>`Written as "${written}" in source, which Studio can’t rewrite. Edit it in Source (S).`;

export function inspectProperties(source,object,scene) {
  const {labels,flags,statement} = read(source,object,scene,{lines:true});
  const style=maskCode(statement);
  const weight=effectiveThickness(style,documentThickness(source));
  const clauses=Object.fromEntries(['fill','color','thickness'].map(key=>[key,attributeClauses(statement,key)]));
  // Pikchr applies attributes in order, so the last clause is the one drawn.
  const color=key=>{const last=clauses[key].clauses.at(-1);return last?colourValue(last.value):undefined;};
  return {
    text: labels.map(label=>decodeLabel(label[0])).join('\n'),
    width:object.bbox?.width,height:object.bbox?.height,fill:color('fill'),color:color('color'),stroke:color('color'),thickness:weight.value,thicknessSet:weight.set,
    locked:{fill:clauses.fill.written,color:clauses.color.written,thickness:clauses.thickness.written},
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
  // An unnamed object is followed by its render id: a property rewrite never
  // adds or removes objects, so the id survives.
  return {label,patch,source:applyPatch(source,patch),...(object.name ? {selectName:object.name} : {selectId:object.id,targetKind:object.kind})};
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

// Pikchr strings escape a quote and a backslash with a backslash; any other
// escaped character stands for itself.
const quoteLine = line => '"' + line.replace(/[\\"]/g, '\\$&') + '"';
export const decodeLabel = token => token.slice(1, -1).replace(/\\(.)/g, '$1');
export function encodeLabel(text) {
  if (typeof text !== 'string' || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw new Error('Use plain text without control characters. Line breaks are supported.');
  return text.split('\n').map(quoteLine).join(' ');
}
export function changeText(source,object,scene,text,{fit}={}) {
  const encoded=encodeLabel(text);
  const {statement,header,labels}=read(source,object,scene,{lines:true});
  const label=labels[0];
  // Each line keeps the text attributes of the string it replaces; added
  // lines take those of the last string.
  const attrs=labels.map(m=>TEXT_ATTRS_AFTER.exec(statement.slice(m.index+m[0].length))[0]);
  const lastEnd=label?labels.at(-1).index+labels.at(-1)[0].length:0;
  const tailAttrs=label?attrs.at(-1).length:0;
  const styled=label?text.split('\n').map((line,i)=>quoteLine(line)+attrs[Math.min(i,attrs.length-1)]).join(' '):encoded;
  let replacement=label
    ? statement.slice(0,label.index)+styled+statement.slice(lastEnd+tailAttrs)
    : statement.slice(0,header[0].length)+` ${encoded}`+statement.slice(header[0].length);
  // A statement that already fits keeps its fit: Pikchr refits the new text
  // around the same placement, whatever form that placement takes.
  const fitted=/\bfit\b/.test(maskLabels(statement));
  if (fit && text.trim()) {
    try { replacement=fitStatement(replacement,object); } catch (error) { if (!fitted) throw error; }
  }
  // A text object is always as big as its text: its fit just stays.
  else if (fit===false && shapeKinds.includes(object.kind) && /\bfit\b/.test(maskLabels(statement))) {
    // Opting out after a previous fit must really preserve the current size,
    // rather than leaving an old automatic-fit instruction active.
    const {width,height}=object.bbox||{};
    if (!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) fail();
    replacement=fitStatement(replacement,object).replace(/ fit$/,'');
    replacement+=object.kind==='circle' ? ` radius ${width/2}` : ` width ${width} height ${height}`;
  }
  return candidate(source,object,statement,replacement,fit&&text.trim()&&!fitted?'Change text and fit shape':'Change text');
}

export function changeTermination(source,object,scene,mode) {
  if (!['none','start','end','both'].includes(mode) || !['line','arrow'].includes(object.kind)) fail();
  const {statement,header,flags}=read(source,object,scene);
  const flag=flags[0];
  const token={none:'',start:'<-',end:'->',both:'<->'}[mode];
  // Removing the flag takes one side's spacing with it.
  const joined=(left,right)=>token?left+token+right:left.replace(/[ \t]+$/,'')+(/\S$/.test(left.trimEnd())&&/^\S/.test(right)?' ':'')+right;
  let replacement=flag ? joined(statement.slice(0,flag.index),statement.slice(flag.index+flag[0].length))
    : statement.slice(0,header[0].length)+(token ? ` ${token}` : '')+statement.slice(header[0].length);
  // Pikchr has no boolean property that clears an arrow's default arrowhead.
  if (mode==='none' && object.kind==='arrow') replacement=replacement.slice(0,header[0].length-5)+'line'+replacement.slice(header[0].length);
  return {...candidate(source,object,statement,replacement,'Change line termination'),selectId:object.id,targetKind:mode==='none' ? 'line' : object.kind};
}

// What Pikchr drew for one object, read from its SVG group: the values the
// author sees, whatever produced them (a macro body, its $n arguments,
// attributes after the call). Colours are #rrggbb (null for none); thickness
// is inches, through the scene's pixels-per-inch transform.
export function drawnProperties(svg, id, transform) {
  const group = new RegExp(`<g data-pikchr-id="${id}">([\\s\\S]*?)</g>`).exec(svg || '')?.[1];
  if (group === undefined) return null;
  const hex = rgb => { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(rgb || ''); return m ? '#' + m.slice(1).map(n => (+n).toString(16).padStart(2, '0')).join('') : null; };
  const style = /<(?:path|polygon|ellipse|circle)[^>]*style="([^"]*)"/.exec(group)?.[1] || '';
  const texts = [...group.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)];
  const first = texts[0]?.[1] || '', ppi = Math.abs(transform?.a || 144);
  const width = /stroke-width:([\d.]+)/.exec(style);
  const unescape = t => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return {
    text: texts.map(t => unescape(t[2])).join('\n'),
    fill: hex(/fill:([^;]*)/.exec(style)?.[1]),
    color: hex(/stroke:([^;]*)/.exec(style)?.[1]) ?? hex(/fill="([^"]*)"/.exec(first)?.[1]),
    thickness: width ? Math.round(Number(width[1]) / ppi * 10000) / 10000 : null,
    words: [...(/font-weight="bold"/.test(first) ? ['bold'] : []), ...(/font-style="italic"/.test(first) ? ['italic'] : []), ...(/font-family="monospace"/.test(first) ? ['mono'] : [])],
  };
}
