import {inspectProperties,isColour,documentThickness,lockedMessage} from './properties.js?v=20261110a';
import {changeAppearance} from './object-actions.js?v=20261110a';
import {textStyle,textStyleCandidate,textSizes} from './text-style.js?v=20261110a';
let appearanceOpen=false;
// Pikchr colour names for the swatches. Every ink keeps at least 4.5:1 (WCAG AA)
// against both canvases (#ffffff, #161b22) and every fill, in light mode and in
// Pikchr's dark mode, which inverts inks to light and fills to dark. A test
// renders each pair, so changing a list means re-proving that rule.
export const FILLS=['none','white','whitesmoke','lightyellow','honeydew','aliceblue','mistyrose','ghostwhite'];
export const INKS=['black','dimgray','firebrick','darkgreen','blue','purple','saddlebrown'];
const CANVAS={light:'#ffffff',dark:'#161b22'},MIN_CONTRAST=4.5;
// Presets use Pikchr's own words: thin (×0.67), the default, thick (×1.5).
const PRESETS=[['Thin','thin',0.67],['Normal',null,1],['Thick','thick',1.5]];
const round=n=>Math.round(n*10000)/10000;
const same=(a,b)=>String(a??'').toLowerCase().replace(/^grey$/,'gray')===String(b??'').toLowerCase().replace(/^grey$/,'gray');
let probe=null;
// A colour as #rrggbb for <input type=color>; Pikchr's names are CSS names.
function hex(value){
  if(/^#[0-9a-f]{6}$/i.test(value||''))return value.toLowerCase();
  if(!value||['none','off'].includes(value))return '#000000';
  probe??=document.createElement('canvas').getContext('2d');
  probe.fillStyle='#000000';probe.fillStyle=value;
  return /^#[0-9a-f]{6}$/i.test(probe.fillStyle)?probe.fillStyle:'#000000';
}
// Two spellings of one colour (darkred and #8b0000) are the same choice.
const sameColour=(a,b)=>same(a,b)||!!a&&!!b&&![a,b].some(v=>['none','off'].includes(String(v).toLowerCase()))&&hex(a)===hex(b);
// A typed colour as Studio writes it: a lower-case name or #rrggbb (#rgb grows).
function typedColour(text){
  const value=text.trim().toLowerCase().replace(/^0x/,'#');
  const full=/^#[0-9a-f]{3}$/.test(value)?'#'+[...value.slice(1)].map(c=>c+c).join(''):value;
  return isColour(full)?full:null;
}
const el=(tag,attrs={},...children)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);e.append(...children);return e;};
// Lucide paths (lucide.dev, ISC): 24-unit line art at the chrome's stroke.
const ICONS={
  pipette:['m2 22 1-1h3l9-9','M3 21v-3l9-9','m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z'],
  alignStart:['M21 5H3','M15 12H3','M17 19H3'],alignCenter:['M21 5H3','M17 12H7','M19 19H5'],alignEnd:['M21 5H3','M21 12H9','M21 19H7'],
};
const NS='http://www.w3.org/2000/svg';
function icon(name){
  const svg=document.createElementNS(NS,'svg');
  for(const[k,v]of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(k,v);
  for(const d of ICONS[name]){const path=document.createElementNS(NS,'path');path.setAttribute('d',d);svg.append(path);}
  return svg;
}

// Pikchr recolours in dark mode, so a swatch painted with its raw name would
// lie. The dark colour comes from Pikchr itself: one probe render per batch of
// colours, cached; swatches repaint when it lands or the theme changes.
const theme={dark:false,render:null},darkColours=new Map(),liveRows=new Set();
export function setSwatchTheme(dark,render){
  theme.dark=!!dark;theme.render=render;
  for(const row of [...liveRows]){if(row.box.isConnected)row.refresh();else liveRows.delete(row);}
}
const cssWord=c=>c.replace(/^#/,'0x');
async function resolveDark(role,colours){
  const todo=[...new Set(colours)].filter(c=>c&&!['none','off'].includes(c)&&!darkColours.has(role+':'+c));
  if(!todo.length||!theme.render)return;
  const attr=role==='fill'?'fill':'stroke',word=role==='fill'?'fill':'color';
  const result=await theme.render(todo.map(c=>`box ${word} ${cssWord(c)}`).join('\n'),3);
  const paths=[...(result?.svg||'').matchAll(/<path[^>]*style="([^"]*)"/g)].map(m=>m[1].match(new RegExp(attr+':rgb\\((\\d+),(\\d+),(\\d+)\\)')));
  if(paths.length!==todo.length||paths.some(m=>!m))return;
  todo.forEach((c,k)=>darkColours.set(role+':'+c,'#'+paths[k].slice(1).map(n=>(+n).toString(16).padStart(2,'0')).join('')));
}
const luminance=h=>{const v=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
export const contrast=(a,b)=>{const[x,y]=[luminance(a),luminance(b)].sort((p,q)=>q-p);return (x+.05)/(y+.05);};
// The colour a role shows in a theme, or null when it is not known yet.
function shownColour(role,colour,dark){
  if(colour==='none'||colour==='off')return role==='fill'?CANVAS[dark?'dark':'light']:null;
  return dark?darkColours.get(role+':'+colour)??null:hex(colour);
}
// Paints an element's --swatch as the canvas shows this ink or fill in the
// current theme, and repaints it when the theme changes (used by the text bar).
export function paintSwatch(node,role,colour){
  const refresh=async()=>{await resolveDark(role,[colour]);const c=shownColour(role,colour,theme.dark);if(c)node.style.setProperty('--swatch',c);};
  liveRows.add({box:node,refresh});refresh();
}
// Ink against the fill behind it (or the canvas) in both themes; the message
// names each theme where it falls short.
function readability(ink,fill){
  if(!ink||['none','off'].includes(ink))return '';
  const bad=[];
  for(const dark of [false,true]){
    const i=shownColour('color',ink,dark),f=fill&&fill!=='none'?shownColour('fill',fill,dark):CANVAS[dark?'dark':'light'];
    if(!i||!f)continue;
    const ratio=contrast(i,f);
    if(ratio<MIN_CONTRAST)bad.push(`${dark?'dark':'light'} mode (${ratio.toFixed(1)}:1)`);
  }
  return bad.length?'Hard to read in '+bad.join(' and '):'';
}

// The inspector's Label row, Style section and error line, for the caller to
// place in order. Connector style controls join Style through its slot.
export function propertyEditor({object,scene,source,propose,status,valid}){
  let props;
  try{props=inspectProperties(source,object,scene);}catch{return null;}
  const parts={label:null,style:null,error:null};
  const error=document.createElement('p');error.className='property-error';error.setAttribute('role','alert');
  if(props.text!==null){
    const label=document.createElement('div');label.className='inspector-row label-row';
    const heading=document.createElement('span');heading.className='row-name';heading.textContent='Label';
    const preview=document.createElement('span');preview.className='label-preview';preview.setAttribute('aria-label','Current label');
    const compact=props.text.replace(/\s+/g,' ').trim(),characters=[...compact];
    preview.textContent=compact?characters.length>160?characters.slice(0,157).join('')+'…':compact:'None';
    preview.classList.toggle('cl-muted',!compact);
    preview.title=props.text;
    const button=document.createElement('button');button.type='button';
    button.textContent=compact?'Edit':'Add label';button.setAttribute('aria-label',compact?'Edit label':'Add label');
    button.onclick=()=>{
      if(!valid()){status('Render the current source before editing the label.');return;}
      document.getElementById('edit-selected')?.click();
    };
    label.append(heading,preview,button);parts.label=label;
    parts.text=textControls({object,scene,source,propose,status,valid});
  }
  const appearance=document.createElement('details'),summary=document.createElement('summary');appearance.className='appearance-editor';appearance.open=appearanceOpen;appearance.ontoggle=()=>{if(appearance.isConnected)appearanceOpen=appearance.open;};summary.append('Style');appearance.append(summary);
  // Connectors have no fill, whatever their kind; text has neither fill nor a
  // stroke of its own, so only its colour is offered.
  const {body,preview}=styleControls({
    fill:!['arrow','line','spline','arc','move','text'].includes(object.kind),stroke:object.kind!=='text',
    current:props,base:documentThickness(source),locked:props.locked,
    reveal:()=>document.getElementById('show-source-selected')?.click(),
    apply:values=>{if(!valid())throw new Error('Render the current source before editing the style.');propose([changeAppearance(source,object,scene,values)]);},
  });
  summary.append(preview);
  const slot=document.createElement('div');slot.className='connector-style-slot';
  appearance.append(body,slot);parts.style=appearance;
  parts.error=error;return parts;
}

// The Text group under Label: size, weight, slant, Pikchr's one font choice
// (monospace) and alignment, the same rewrites as the canvas text bar. Text
// colour is Pikchr's color, which also draws the outline, so it stays in
// Style's Line & text row instead of appearing twice.
const TEXT_KINDS=['box','cylinder','circle','ellipse','oval','diamond','file','text','arrow','line','spline','arc'];
const LINE_KINDS=['arrow','line','spline','arc'];
const SIZE_NAMES={small:['S','Small'],normal:['M','Medium'],big:['L','Large'],bigger:['XL','Extra large']};
function textControls({object,scene,source,propose,status,valid}){
  if(!TEXT_KINDS.includes(object.kind))return null;
  let style;try{style=textStyle(source,object,scene);}catch{return null;}
  if(!style)return null;
  const apply=change=>{
    if(!valid()){status('Render the current source before styling the text.');return;}
    try{propose([textStyleCandidate(source,object,scene,change)]);}catch(error){status(error.message);}
  };
  const toggle=(label,text,pressed,change,css)=>{
    const b=el('button',{type:'button',class:'text-style-toggle','aria-pressed':String(pressed),'aria-label':label,title:label},text);
    if(css)b.style.cssText=css;b.onclick=()=>apply(change(!pressed));return b;
  };
  const sizes=el('div',{class:'cl-seg',role:'group','aria-label':'Text size'});
  for(const size of textSizes){
    const [text,title]=SIZE_NAMES[size];
    const b=el('button',{type:'button','aria-pressed':String(style.size===size),title},text);
    b.onclick=()=>{if(style.size!==size)apply({size});};sizes.append(b);
  }
  const faces=el('div',{class:'text-style-faces',role:'group','aria-label':'Font'},
    toggle('Bold','B',style.bold,bold=>({bold}),'font-weight:700'),
    toggle('Italic','I',style.italic,italic=>({italic}),'font-style:italic'),
    toggle('Monospace','Mono',style.mono,mono=>({mono}),'font-family:ui-monospace,SFMono-Regular,Menlo,monospace'));
  // A shape's label is justified; a connector's sits above, on or below the
  // line, optionally turned along it.
  let aligns;
  if(LINE_KINDS.includes(object.kind)){
    aligns=el('div',{class:'text-style-faces'});
    const places=el('div',{class:'cl-seg',role:'group','aria-label':'Label placement'});
    for(const [place,text,title] of [['above','Above','Above the line'],['center','On line','On the line'],['below','Below','Below the line']]){
      const b=el('button',{type:'button','aria-pressed':String(style.placement===place),title},text);
      b.onclick=()=>{if(style.placement!==place)apply({placement:place});};places.append(b);
    }
    aligns.append(places,toggle('Along the line','Along',style.aligned,aligned=>({aligned})));
  }else{
    aligns=el('div',{class:'cl-seg',role:'group','aria-label':'Text alignment'});
    for(const [align,name,label] of [['left','alignStart','Align left'],['center','alignCenter','Align center'],['right','alignEnd','Align right']]){
      const b=el('button',{type:'button','aria-pressed':String(style.align===align),'aria-label':label,title:label},icon(name));
      b.onclick=()=>{if(style.align!==align)apply({align});};aligns.append(b);
    }
  }
  const hint=el('p',{class:'style-hint'},object.kind==='text'?'Colour: Text under Style.':'Colour: Line & text under Style sets the label and outline together.');
  return el('div',{class:'text-style-group',role:'group','aria-label':'Text style'},
    el('div',{class:'inspector-row'},el('span',{class:'row-name'},'Text'),sizes),
    el('div',{class:'inspector-row'},el('span',{class:'row-name'}),el('div',{class:'text-style-line'},faces,aligns)),hint);
}

// Colour swatches, a custom colour and thickness presets, shared by the
// single-object and group Style sections. `current` holds fill, color,
// thickness (effective inches) and thicknessSet; null means the selection
// disagrees. Each choice calls apply(values) at once, which proposes through
// the validated path or throws; a value equal to the current one does nothing.
export function styleControls({fill,stroke,current,base,apply,locked={},reveal=null}){
  const body=el('div',{class:'appearance-form'}),preview=el('span',{class:'style-preview','aria-hidden':'true'});
  // A value written as an expression disables only its own control, with a
  // calm note naming the source text and a way to it. Never an error.
  const lockNote=written=>{
    const note=el('p',{class:'style-locked',role:'note'},lockedMessage(written));
    if(reveal){const b=el('button',{type:'button',class:'style-reveal'},'Show in source');b.onclick=reveal;note.append(' ',b);}
    return note;
  };
  const request=(note,values)=>{
    note.textContent='';note.hidden=true;
    try{apply(values);return true;}catch(e){note.textContent=e.message;note.hidden=false;return false;}
  };
  const colourRow=(key,title,value,palette,hint,partner)=>{
    const role=key==='fill'?'fill':'color',lock=locked?.[key]||null;
    const lower=title.toLowerCase(),mixed=value===null||!!lock;
    const note=el('p',{class:'style-error',role:'alert',hidden:''}),warning=el('p',{class:'style-warning',role:'status',hidden:''});
    const group=el('div',{class:'style-swatches',role:'group','aria-label':title});
    const custom=!mixed&&!palette.some(c=>same(c,value));
    for(const colour of palette){
      const b=el('button',{type:'button',class:'style-swatch','data-colour':colour,'aria-label':`${title} ${colour}`,title:colour,'aria-pressed':String(!mixed&&!custom&&same(colour,value))});
      b.disabled=!!lock;
      b.onclick=()=>{if(mixed||!same(colour,value))request(note,{[key]:colour});};
      group.append(b);
    }
    const more=el('button',{type:'button',class:'style-swatch style-custom','aria-label':`Custom ${lower} colour`,title:'Custom colour','aria-expanded':String(custom),'aria-pressed':String(custom)},icon('pipette'));
    more.disabled=!!lock;
    group.append(more);
    const picker=el('input',{type:'color','aria-label':`${title} colour picker`});picker.value=hex(mixed?'':value);
    const text=el('input',{type:'text','aria-label':`${title} colour value`,placeholder:mixed?'mixed: #rrggbb or name':'#rrggbb or name',spellcheck:'false',autocomplete:'off',autocapitalize:'off'});
    text.value=custom?value:'';
    const fields=el('div',{class:'style-custom-fields'},picker,text);fields.hidden=!custom;
    // Opening Custom shows the picker and field; focus stays on the button.
    more.onclick=()=>{fields.hidden=!fields.hidden;more.setAttribute('aria-expanded',String(!fields.hidden));};
    const commit=raw=>{
      const typed=typedColour(raw);
      if(!raw.trim()){text.removeAttribute('aria-invalid');note.hidden=true;return;}
      if(!typed){text.setAttribute('aria-invalid','true');note.textContent='Use a colour name Pikchr knows, such as red or lightblue, or a hex value such as #1a7f37.';note.hidden=false;return;}
      text.removeAttribute('aria-invalid');
      if(mixed||!sameColour(typed,value))request(note,{[key]:typed});
    };
    text.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit(text.value);}};
    text.onchange=()=>commit(text.value);
    text.oninput=()=>{if(text.hasAttribute('aria-invalid')&&(typedColour(text.value)||!text.value.trim())){text.removeAttribute('aria-invalid');note.hidden=true;}};
    picker.onchange=()=>commit(picker.value);
    const row=el('div',{class:'inspector-row style-row'},el('span',{class:'row-name'},title),group);
    const box=el('div',{class:'style-control'},row,fields);
    if(lock)box.append(lockNote(lock));
    if(hint)box.append(el('p',{class:'style-hint'},hint));
    box.append(warning,note);
    const dot=el('span',{class:'style-dot','data-colour':mixed?'mixed':value});
    preview.append(dot);
    // Paint each swatch in the colour the canvas shows in this theme, and warn
    // when a custom colour is hard to read against what sits behind it.
    const paint=()=>{
      for(const target of [...group.querySelectorAll('[data-colour]'),dot]){
        const colour=target.dataset.colour;
        if(colour==='none'||colour==='mixed')continue;
        target.style.setProperty('--swatch',(theme.dark&&darkColours.get(role+':'+colour))||colour);
      }
      const other=partner?.();
      let text='';
      if(custom&&!mixed&&other!==undefined)text=role==='color'?readability(value,other):readability(other,value);
      warning.textContent=text;warning.hidden=!text;
    };
    const refresh=async()=>{
      paint();
      const other=partner?.();
      await resolveDark(role,[...palette,...(mixed?[]:[value])]);
      if(role==='color'&&other)await resolveDark('fill',[other]);
      if(role==='fill'&&other)await resolveDark('color',[other]);
      if(box.isConnected)paint();
    };
    liveRows.add({box,refresh});refresh();
    return box;
  };
  // A partner is the other colour the ink sits on or the fill carries; null
  // (mixed) has no partner, and no fill control means the canvas is behind.
  if(fill)body.append(colourRow('fill','Fill',current.fill===null?null:current.fill??'none',FILLS,null,()=>current.color===null?undefined:current.color??'black'));
  body.append(colourRow('color',stroke?'Line & text':'Text',current.color===null?null:current.color??'black',INKS,
    stroke?'Pikchr’s color sets the outline and label together.':null,()=>fill?(current.fill===null?'none':current.fill??'none'):'none'));
  if(stroke){
    // effective is undefined when the source uses an expression Studio cannot read.
    const effective=current.thickness,known=typeof effective==='number',lock=locked?.thickness||null;
    const note=el('p',{class:'style-error',role:'alert',hidden:''});
    const presets=el('div',{class:'cl-seg',role:'group','aria-label':'Thickness presets'});
    for(const[name,word,factor]of PRESETS){
      // Compare unrounded: thin is 0.01005 in, which the title shows as 0.0101.
      const value=round(base*factor),on=known&&Math.abs(effective-base*factor)<1e-6;
      const b=el('button',{type:'button','aria-pressed':String(on),title:word?`${word}: ${value} in`:`Default: ${value} in`},name);
      // Normal removes thickness, thick and thin so the default applies.
      b.onclick=()=>{if(!on)request(note,{thickness:word});};
      b.disabled=!!lock;presets.append(b);
    }
    const input=el('input',{type:'number',step:'0.005',min:'0.001',inputmode:'decimal','aria-label':'Thickness in inches',
      placeholder:effective===null?'mixed':String(round(base))});
    if(known&&current.thicknessSet)input.value=String(round(effective));
    input.disabled=!!lock;
    const commit=()=>{
      const raw=input.value.trim();
      if(raw===''||known&&Math.abs(Number(raw)-effective)<1e-9)return;
      if(request(note,{thickness:Number(raw)}))input.removeAttribute('aria-invalid');else input.setAttribute('aria-invalid','true');
    };
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit();}};
    input.onchange=commit;
    const unit=el('span',{class:'style-unit'},known&&!current.thicknessSet?'in · default':'in');
    const field=el('span',{class:'style-number'},input,unit);
    body.append(el('div',{class:'style-control'},
      el('div',{class:'inspector-row style-row'},el('span',{class:'row-name'},'Thickness'),el('div',{class:'style-thickness'},presets,field)),...(lock?[lockNote(lock)]:[]),note));
    if(known)preview.append(el('span',{class:'style-weight'},`${round(effective)} in`));
  }
  return {body,preview};
}
