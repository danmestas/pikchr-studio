import {createShape,createConnector,changeShape,connectableShapes,repeatPosition,repeatShape} from './creation.js?v=20260923c';
const kinds=['box','circle','ellipse','oval','cylinder','diamond','text'];
const creationState={kind:'box',label:'New shape',fit:true,width:'',height:'',fill:'none',color:'black',thickness:'',shapeOpen:false,styleOpen:false,connectorOpen:false,fromAnchor:'e',toAnchor:'w',connector:'arrow',repeat:false,dx:'0',dy:'-1',lastName:null,pending:null,includeText:false};
const anchors=['c','n','ne','e','se','s','sw','w','nw'];
const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
function select(label,options){
  const field=node('label',label),input=node('select');
  input.setAttribute('aria-label',label);
  for(const [value,text]of options){const option=node('option',text);option.value=value;input.append(option);}
  field.append(input);return {field,input};
}
function input(label,value,type='text'){
  const field=node('label',label),control=node('input');control.type=type;control.value=value;
  control.setAttribute('aria-label',label);
  if(type==='number')control.step='any';
  field.append(control);return {field,input:control};
}
export function creationTools({scene,source,host,propose,status,valid}){
  host.replaceChildren();
  if(creationState.pending){
    if(source===creationState.pending.source)creationState.lastName=creationState.pending.selectName;
    creationState.pending=null;
  }
  const last=scene.objects.find(o=>o.name===creationState.lastName&&kinds.includes(o.kind));
  if(!last)creationState.lastName=null;
  const report=node('p');report.setAttribute('role','alert');report.className='creation-error';
  const request=fn=>{
    if(!valid()){report.textContent='Render the current source before adding objects.';return;}
    try{report.textContent='';propose([fn()]);}catch(e){report.textContent=e.message;status(e.message);}
  };
  const shapeDetails=node('details'),shapeSummary=node('summary','Add shape');shapeDetails.append(shapeSummary);shapeDetails.open=creationState.shapeOpen;shapeDetails.ontoggle=()=>{creationState.shapeOpen=shapeDetails.open;};
  const shapeForm=node('form');shapeForm.className='creation-form';
  const kind=select('Shape',kinds.map(k=>[k,k[0].toUpperCase()+k.slice(1)]));
  kind.input.value=creationState.kind;
  const label={field:node('label','Label'),input:node('textarea')};label.input.rows=2;label.input.value=creationState.label;label.input.setAttribute('aria-label','Label');label.field.append(label.input);
  const name=input('Object ID (optional)','');name.input.placeholder='For example: Manifest';
  const fitLabel=node('label','Fit label'),fit=node('input');fit.type='checkbox';fit.checked=creationState.fit;fitLabel.append(fit);
  const width=input('New shape width (inches)',creationState.width,'number'),height=input('New shape height (inches)',creationState.height,'number');
  const fill=input('New shape fill',creationState.fill),color=input('New shape stroke',creationState.color),thickness=input('New shape thickness (pixels)',creationState.thickness,'number');
  width.input.placeholder='Automatic';height.input.placeholder='Automatic';
  const style=node('details');style.open=creationState.styleOpen;style.ontoggle=()=>{if(style.isConnected)creationState.styleOpen=style.open;};style.append(node('summary','Size and style'));style.append(width.field,height.field,fill.field,color.field,thickness.field);
  const remember=()=>{
    Object.assign(creationState,{kind:kind.input.value,label:label.input.value,fit:fit.checked,width:width.input.value,height:height.input.value,fill:fill.input.value,color:color.input.value,thickness:thickness.input.value});
    for(const control of [width.input,height.input,fill.input,fit])control.disabled=kind.input.value==='text';
  };
  for(const control of [kind.input,label.input,fit,width.input,height.input,fill.input,color.input,thickness.input])control.addEventListener('input',()=>{
    if((control===width.input||control===height.input)&&control.value!=='')fit.checked=false;
    if(control===fit&&fit.checked){width.input.value='';height.input.value='';}
    remember();
  });
  remember();
  const maxX=Math.max(0,...scene.objects.map(o=>o.bbox.x+o.bbox.width));
  const x=input('X (inches)',scene.objects.length?(maxX+1).toFixed(1):'0','number'),y=input('Y (inches)','0','number');
  x.input.required=true;y.input.required=true;
  const repeatSettings=node('details');repeatSettings.append(node('summary','Repeat placement'));
  const repeatLabel=node('label','Prepare the next position after adding'),repeat=node('input');repeat.type='checkbox';repeat.checked=creationState.repeat;repeatLabel.append(repeat);
  const dx=input('Repeat X offset (inches)',creationState.dx,'number'),dy=input('Repeat Y offset (inches)',creationState.dy,'number');
  const repeatHint=node('p','X 0 keeps the same vertical lane. Negative Y moves downward. Copies keep the original text, size, and style.');
  const nextPosition=()=>repeatPosition(last.center,Number(dx.input.value),Number(dy.input.value));
  const preparePosition=()=>{if(last&&repeat.checked)try{const next=nextPosition();x.input.value=next.x;y.input.value=next.y;}catch(error){report.textContent=error.message;}};
  for(const control of [repeat,dx.input,dy.input])control.addEventListener('input',()=>{creationState.repeat=repeat.checked;creationState.dx=dx.input.value;creationState.dy=dy.input.value;preparePosition();});
  const repeatButton=node('button','Repeat last shape');repeatButton.type='button';repeatButton.disabled=!last;
  repeatButton.title=last?'Copy '+last.name+' at the repeat offset':'Add a shape first';
  repeatButton.onclick=()=>request(()=>{const next=nextPosition();const option=repeatShape(source,last,scene,{dx:next.x-last.center.x,dy:next.y-last.center.y});creationState.pending=option;return option;});
  repeatSettings.append(repeatLabel,dx.field,dy.field,repeatHint);
  preparePosition();
  const add=node('button','Add shape');add.type='submit';
  shapeForm.append(kind.field,label.field,name.field,x.field,y.field,fitLabel,style,repeatSettings,add,repeatButton);
  shapeForm.onsubmit=e=>{e.preventDefault();remember();request(()=>{
    const values={kind:kind.input.value,label:label.input.value,x:Number(x.input.value),y:Number(y.input.value),fit:kind.input.value!=='text'&&fit.checked};
    if(name.input.value.trim())values.name=name.input.value.trim();
    for(const[key,control]of [['width',width.input],['height',height.input],['fill',fill.input],['color',color.input],['thickness',thickness.input]])if(!control.disabled&&control.value.trim()!=='')values[key]=['width','height','thickness'].includes(key)?Number(control.value):control.value.trim();
    const option=createShape(source,scene,values);creationState.pending=option;return option;
  });};
  shapeDetails.append(shapeForm);
  const connectorDetails=node('details');connectorDetails.append(node('summary','Add connector'));connectorDetails.open=creationState.connectorOpen;connectorDetails.ontoggle=()=>{creationState.connectorOpen=connectorDetails.open;};
  const connectorForm=node('form');connectorForm.className='creation-form';
  const shapes=connectableShapes(source,scene,{includeText:creationState.includeText});
  const includeLabel=node('label','Include text labels as endpoints'),includeText=node('input');includeText.type='checkbox';includeText.checked=creationState.includeText;includeLabel.append(includeText);
  includeText.onchange=()=>{creationState.includeText=includeText.checked;creationTools({scene,source,host,propose,status,valid});host.querySelector('[aria-label="From shape"]')?.focus({preventScroll:true});};
  const choices=shapes.map(o=>[o.id,objectLabel(o,source)]);
  const from=select('From shape',choices),to=select('To shape',choices);
  if(choices.length>1)to.input.selectedIndex=1;
  if(choices.some(([id])=>id===creationState.from))from.input.value=creationState.from;
  if(choices.some(([id])=>id===creationState.to))to.input.value=creationState.to;
  const updateTargets=()=>{
    for(const option of to.input.options)option.disabled=option.value===from.input.value;
    if(to.input.value===from.input.value)to.input.value=choices.find(([id])=>id!==from.input.value)?.[0]||'';
  };
  from.input.onchange=()=>{updateTargets();creationState.from=from.input.value;creationState.to=to.input.value;};to.input.onchange=()=>{creationState.to=to.input.value;};updateTargets();
  const fromAnchor=select('From anchor',anchors.map(a=>[a,a.toUpperCase()])),toAnchor=select('To anchor',anchors.map(a=>[a,a.toUpperCase()]));
  fromAnchor.input.value=creationState.fromAnchor;toAnchor.input.value=creationState.toAnchor;
  const connector=select('Connector',[['arrow','Arrow'],['line','Line']]);
  connector.input.value=creationState.connector;
  for(const[key,control]of [['fromAnchor',fromAnchor.input],['toAnchor',toAnchor.input],['connector',connector.input]])control.onchange=()=>{creationState[key]=control.value;};
  const connect=node('button','Add connector');connect.type='submit';connect.disabled=shapes.length<2;
  connectorForm.append(includeLabel,from.field,fromAnchor.field,to.field,toAnchor.field,connector.field,connect);
  connectorForm.onsubmit=e=>{e.preventDefault();request(()=>createConnector(source,scene,{fromId:from.input.value,fromAnchor:fromAnchor.input.value,toId:to.input.value,toAnchor:toAnchor.input.value,kind:connector.input.value}));};
  connectorDetails.append(connectorForm);
  if(shapes.length<2)connectorDetails.append(node('p','Add two named native shapes outside groups and macros, then connect their anchors.'));
  host.append(shapeDetails,connectorDetails,report);
}
export function shapeTypeEditor({object,scene,source,inspector,propose,status,valid}){
  if(!kinds.includes(object.kind)||!object.name)return;
  // Ask the conservative edit engine before offering an active control.
  try{changeShape(source,object,scene,kinds.find(k=>k!==object.kind));}catch{return;}
  const form=node('form');form.className='shape-type-form';
  const type=select('Shape type',kinds.map(k=>[k,k[0].toUpperCase()+k.slice(1)]));type.input.value=object.kind;
  const preview=node('button','Change shape type');preview.type='submit';preview.disabled=true;
  type.input.onchange=()=>{preview.disabled=type.input.value===object.kind;};
  form.append(type.field,preview);
  form.onsubmit=e=>{
    e.preventDefault();if(!valid())return;
    try{propose([changeShape(source,object,scene,type.input.value)]);}catch(error){status(error.message);}
  };
  inspector.prepend(form);
}
function objectLabel(object,source){
  const bytes=new TextEncoder().encode(source),statement=new TextDecoder().decode(bytes.slice(object.span.start,object.span.end));
  const labels=[...statement.matchAll(/"([^"\\]*)"/g)].map(m=>m[1]);
  return labels.length?`${labels.join(' / ')} (${object.name||object.id})`:object.name||object.id;
}
