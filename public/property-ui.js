import {inspectProperties,changeTermination} from './properties.js?v=20260923c';
import {changeAppearance} from './object-actions.js?v=20260923c';
let appearanceOpen=false;
export function propertyEditor({object,scene,source,inspector,propose,status,valid}){
  inspector.querySelector('.property-editor')?.remove();
  let props;
  try{props=inspectProperties(source,object,scene);}catch{return;}
  const panel=document.createElement('section');panel.className='property-editor';
  const error=document.createElement('p');error.className='property-error';error.setAttribute('role','alert');
  const request=fn=>{
    if(!valid()){status('Render the current source before editing properties.');return;}
    try{error.textContent='';propose([fn()]);}catch(e){error.textContent=e.message;}
  };
  if(props.text!==null){
    const label=document.createElement('div'),heading=document.createElement('strong'),preview=document.createElement('p');
    heading.textContent='Label';preview.className='label-preview';preview.setAttribute('aria-label','Current label');
    const compact=props.text.replace(/\s+/g,' ').trim(),characters=[...compact];
    preview.textContent=compact?characters.length>160?characters.slice(0,157).join('')+'…':compact:'No label';
    preview.style.overflowWrap='anywhere';
    preview.title=props.text;
    const button=document.createElement('button');button.textContent='Edit label';button.type='button';
    button.onclick=()=>{
      if(!valid()){status('Render the current source before editing the label.');return;}
      document.getElementById('edit-selected')?.click();
    };
    label.append(heading,preview,button);panel.append(label);
  }
  const appearance=document.createElement('details'),summary=document.createElement('summary');appearance.className='appearance-editor';appearance.open=appearanceOpen;appearance.ontoggle=()=>{if(appearance.isConnected)appearanceOpen=appearance.open;};summary.textContent='Style';appearance.append(summary);
  const styleForm=document.createElement('form');styleForm.className='appearance-form';
  const controls={};
  const dimensioned=!['arrow','line','spline','move','text'].includes(object.kind);
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
  appearance.append(styleForm);panel.append(appearance);
  if(props.termination!==null){
    const label=document.createElement('label');label.textContent='Arrowheads';
    const select=document.createElement('select');select.setAttribute('aria-label','Arrowheads');
    for(const [value,text]of [['none','None — plain line'],['start','Start only'],['end','End only'],['both','Both ends']]){
      const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);
    }
    select.value=props.termination;
    select.onchange=()=>request(()=>changeTermination(source,object,scene,select.value));
    label.append(select);panel.append(label);
  }
  panel.append(error);inspector.prepend(panel);
}
