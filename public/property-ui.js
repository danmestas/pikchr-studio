import {inspectProperties,isColour} from './properties.js?v=20261031a';
import {changeAppearance} from './object-actions.js?v=20261031a';
let appearanceOpen=false;
// Pikchr colour names that read well as fills or as ink. Pikchr's dark mode
// inverts colours, so light fills and dark inks both keep their contrast.
const FILLS=['none','white','lightgray','lightyellow','lightgreen','lightblue','pink','lavender'];
const INKS=['black','gray','red','orange','green','blue','purple'];
// Pikchr's built-in default, in inches; a document may set its own with
// `thickness = …`. Bare numbers in the source are inches.
const PIKCHR_THICKNESS=0.015;
const PRESETS=[['Thin',2/3],['Normal',1],['Thick',2]];
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
// A typed colour as Studio writes it: a lower-case name or #rrggbb (#rgb grows).
function typedColour(text){
  const value=text.trim().toLowerCase().replace(/^0x/,'#');
  const full=/^#[0-9a-f]{3}$/.test(value)?'#'+[...value.slice(1)].map(c=>c+c).join(''):value;
  return isColour(full)?full:null;
}
function documentThickness(source){
  const global=[...source.replace(/"(?:\\.|[^"\\])*"|#[^\n]*/g,'').matchAll(/^\s*thickness\s*=\s*([\d.]+)\s*(?:in)?\s*$/gm)].at(-1);
  const value=Number(global?.[1]);
  return Number.isFinite(value)&&value>0?value:PIKCHR_THICKNESS;
}
const el=(tag,attrs={},...children)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);e.append(...children);return e;};

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
  }
  const appearance=document.createElement('details'),summary=document.createElement('summary');appearance.className='appearance-editor';appearance.open=appearanceOpen;appearance.ontoggle=()=>{if(appearance.isConnected)appearanceOpen=appearance.open;};summary.append('Style');appearance.append(summary);
  const body=el('div',{class:'appearance-form'});
  // Connectors have no fill, whatever their kind; text has neither fill nor a
  // stroke of its own, so only its colour is offered.
  const filled=!['arrow','line','spline','arc','move','text'].includes(object.kind);
  const stroked=object.kind!=='text';
  // Each control proposes its own one-property change through the validated
  // path. Equal values are never proposed; refusals show under the control.
  const request=(note,values)=>{
    note.textContent='';note.hidden=true;
    if(!valid()){note.textContent='Render the current source before editing the style.';note.hidden=false;return false;}
    try{propose([changeAppearance(source,object,scene,values)]);return true;}
    catch(e){note.textContent=e.message;note.hidden=false;return false;}
  };
  const preview=el('span',{class:'style-preview','aria-hidden':'true'});
  const colourRow=(key,title,current,palette,hint)=>{
    const lower=title.toLowerCase();
    const note=el('p',{class:'style-error',role:'alert',hidden:''});
    const group=el('div',{class:'style-swatches',role:'group','aria-label':title});
    const custom=!palette.some(c=>same(c,current));
    for(const colour of palette){
      const b=el('button',{type:'button',class:'style-swatch','data-colour':colour,'aria-label':`${title} ${colour}`,title:colour,'aria-pressed':String(!custom&&same(colour,current))});
      if(colour!=='none')b.style.setProperty('--swatch',colour);
      b.onclick=()=>{if(!same(colour,current))request(note,{[key]:colour});};
      group.append(b);
    }
    const more=el('button',{type:'button',class:'style-custom','aria-label':`Custom ${lower} colour`,'aria-expanded':String(custom),'aria-pressed':String(custom)},'Custom…');
    group.append(more);
    const picker=el('input',{type:'color','aria-label':`${title} colour picker`});picker.value=hex(current);
    const text=el('input',{type:'text','aria-label':`${title} colour value`,placeholder:'#rrggbb or name',spellcheck:'false',autocomplete:'off',autocapitalize:'off'});
    text.value=custom?current:'';
    const fields=el('div',{class:'style-custom-fields'},picker,text);fields.hidden=!custom;
    more.onclick=()=>{fields.hidden=!fields.hidden;more.setAttribute('aria-expanded',String(!fields.hidden));if(!fields.hidden)text.focus();};
    const commit=raw=>{
      const value=typedColour(raw);
      if(!raw.trim()){text.removeAttribute('aria-invalid');note.hidden=true;return;}
      if(!value){text.setAttribute('aria-invalid','true');note.textContent='Use a colour name Pikchr knows, such as red or lightblue, or a hex value such as #1a7f37.';note.hidden=false;return;}
      text.removeAttribute('aria-invalid');
      if(!same(value,current))request(note,{[key]:value});
    };
    text.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit(text.value);}};
    text.onchange=()=>commit(text.value);
    text.oninput=()=>{if(text.hasAttribute('aria-invalid')&&(typedColour(text.value)||!text.value.trim())){text.removeAttribute('aria-invalid');note.hidden=true;}};
    picker.onchange=()=>commit(picker.value);
    const row=el('div',{class:'inspector-row style-row'},el('span',{class:'row-name'},title),group);
    const box=el('div',{class:'style-control'},row,fields);
    if(hint)box.append(el('p',{class:'style-hint'},hint));
    box.append(note);
    const dot=el('span',{class:'style-dot','data-colour':current});if(current!=='none')dot.style.setProperty('--swatch',current);
    preview.append(dot);
    return box;
  };
  if(filled)body.append(colourRow('fill','Fill',props.fill??'none',FILLS));
  body.append(colourRow('color',stroked?'Line & text':'Text',props.color??'black',INKS,
    stroked?'Pikchr’s color sets the outline and label together.':null));
  if(stroked){
    const base=documentThickness(source);
    const set=props.thickness!==undefined?Number(props.thickness):null;
    const effective=set??base;
    const note=el('p',{class:'style-error',role:'alert',hidden:''});
    const presets=el('div',{class:'cl-seg',role:'group','aria-label':'Thickness presets'});
    for(const[name,factor]of PRESETS){
      const value=round(base*factor);
      const b=el('button',{type:'button','aria-pressed':String(Math.abs(effective-value)<1e-9),title:`${value} in`},name);
      b.onclick=()=>{if(Math.abs(effective-value)>1e-9)request(note,{thickness:value});};
      presets.append(b);
    }
    const input=el('input',{type:'number',step:'0.005',min:'0.001',inputmode:'decimal','aria-label':'Thickness in inches',placeholder:String(round(base))});
    if(set!==null)input.value=String(set);
    const commit=()=>{
      const raw=input.value.trim();
      if(raw===''||Number(raw)===effective)return;
      if(request(note,{thickness:Number(raw)}))input.removeAttribute('aria-invalid');else input.setAttribute('aria-invalid','true');
    };
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commit();}};
    input.onchange=commit;
    const unit=el('span',{class:'style-unit'},set===null?'in · default':'in');
    const field=el('span',{class:'style-number'},input,unit);
    body.append(el('div',{class:'style-control'},
      el('div',{class:'inspector-row style-row'},el('span',{class:'row-name'},'Thickness'),el('div',{class:'style-thickness'},presets,field)),note));
    preview.append(el('span',{class:'style-weight'},`${round(effective)} in`));
  }
  summary.append(preview);
  const slot=document.createElement('div');slot.className='connector-style-slot';
  appearance.append(body,slot);parts.style=appearance;
  parts.error=error;return parts;
}
