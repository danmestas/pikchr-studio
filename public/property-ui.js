import {inspectProperties} from './properties.js?v=20260923c';
import {changeAppearance} from './object-actions.js?v=20260923c';
let appearanceOpen=false;
// The inspector's Label row, Style section and error line, for the caller to
// place in order. Connector style controls join Style through its slot.
export function propertyEditor({object,scene,source,propose,status,valid}){
  let props;
  try{props=inspectProperties(source,object,scene);}catch{return null;}
  const parts={label:null,style:null,error:null};
  const error=document.createElement('p');error.className='property-error';error.setAttribute('role','alert');
  const request=fn=>{
    if(!valid()){status('Render the current source before editing properties.');return;}
    try{error.textContent='';propose([fn()]);}catch(e){error.textContent=e.message;}
  };
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
  const appearance=document.createElement('details'),summary=document.createElement('summary');appearance.className='appearance-editor';appearance.open=appearanceOpen;appearance.ontoggle=()=>{if(appearance.isConnected)appearanceOpen=appearance.open;};summary.textContent='Style';appearance.append(summary);
  const styleForm=document.createElement('form');styleForm.className='appearance-form';
  const controls={};
  // Connectors have no fill, whatever their kind, so the field never appears
  // for a spline or arc that has no single-object style editor of its own.
  const dimensioned=!['arrow','line','spline','arc','move','text'].includes(object.kind);
  const fields=[['fill','Fill color',props.fill??'none'],['color','Stroke / text color',props.color??'black'],['thickness','Line thickness (pixels)',props.thickness??'']];
  for(const[key,title,value]of fields){
    if(key==='fill'&&!dimensioned)continue;
    const label=document.createElement('label');label.textContent=title;
    const input=document.createElement('input');input.setAttribute('aria-label',title);input.value=value??'';input.dataset.initial=input.value;
    if(key==='thickness'){input.type='number';input.step='any';input.min='0';}
    else input.placeholder=key==='fill'?'none, white, or #ffffff':'black or #000000';
    controls[key]=input;label.append(input);styleForm.append(label);
  }
  const apply=document.createElement('button');apply.type='submit';apply.textContent='Update style';styleForm.append(apply);
  styleForm.onsubmit=e=>{e.preventDefault();request(()=>{
    const values={};for(const[key,input]of Object.entries(controls)){if(input.value!==input.dataset.initial&&input.value.trim()!=='')values[key]=key==='thickness'?Number(input.value):input.value.trim();}
    return changeAppearance(source,object,scene,values);
  });};
  const slot=document.createElement('div');slot.className='connector-style-slot';
  appearance.append(styleForm,slot);parts.style=appearance;
  parts.error=error;return parts;
}
