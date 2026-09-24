import {routeCandidates,moveVertexCandidates,bendCandidates} from './edits.js?v=20260923c';
import {routeStyleCandidates,connectorState,strokeCandidates,weightCandidates,colourCandidates,chopCandidates,labelCandidates,checkStyleResult,thumbnailBox,routeColours} from './route-styles.js?v=20260923c';
import {lockDirection} from './constrain.js?v=20260923c';
const ns='http://www.w3.org/2000/svg';
const el=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
export function routeEditor({object,scene,source,svg,layer,propose,status,valid,clear,autoApply=()=>document.querySelector('#auto-apply')?.checked!==false}){
  const panel=document.createElement('div');panel.className='route-controls';
  const commitHint=()=>autoApply()?'Release to validate and apply. Undo reverses the change.':'Release to validate and queue. Review the draft, then Apply all.';
  const text=document.createElement('p');text.textContent='Filled handles move one literal bend and preserve the rest of the path. Outline handles and route presets replace the whole route. '+commitHint();
  panel.append(text);
  const row=document.createElement('div');row.className='route-presets';
  const t=scene.transform,m=new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]);
  const point=p=>new DOMPoint(p.x,p.y).matrixTransform(m);
  const path=object.path||[],start=path[0],end=path.at(-1);
  if(path.length<2){panel.append('No editable path vertices.');return panel;}
  const request=(mode,target,index)=>{
    if(!valid())return;
    const choices=mode==='vertex'?moveVertexCandidates(source,object,scene,index,target):routeCandidates(source,object,scene,mode,target);
    if(choices.length)propose(choices);else status('This route expression is inspect-only.');
  };
  for(const [mode,label]of [['straight','Straight'],['horizontal','Horizontal first'],['vertical','Vertical first']]){
    const button=document.createElement('button');button.textContent=label;
    button.disabled=!routeCandidates(source,object,scene,mode).length;
    button.onclick=()=>request(mode);row.append(button);
  }
  panel.append(row);
  const bendRow=document.createElement('div');bendRow.className='route-bend-controls';
  const segmentLabel=document.createElement('label');segmentLabel.textContent='Insert on segment ';
  const segment=document.createElement('select');segment.setAttribute('aria-label','Route segment');
  for(let i=0;i<path.length-1;i++){
    const option=document.createElement('option');option.value=i;option.textContent=`Segment ${i+1}`;segment.append(option);
  }
  segmentLabel.append(segment);
  const midpoint=i=>({x:(path[i].x+path[i+1].x)/2,y:(path[i].y+path[i+1].y)/2});
  const add=document.createElement('button');add.textContent='Add bend';
  add.disabled=!bendCandidates(source,object,scene,'insert',0,midpoint(0)).length;
  add.onclick=()=>{if(valid()){const i=Number(segment.value);propose(bendCandidates(source,object,scene,'insert',i,midpoint(i)));}};
  const bendLabel=document.createElement('label');bendLabel.textContent='Selected bend ';
  const bend=document.createElement('select');bend.setAttribute('aria-label','Route bend');
  for(let i=1;i<path.length-1;i++){
    const option=document.createElement('option');option.value=i;option.textContent=`Bend ${i}`;bend.append(option);
  }
  bendLabel.append(bend);
  const remove=document.createElement('button');remove.textContent='Delete bend';
  const reset=document.createElement('button');reset.textContent='Reset route';reset.title='Remove bends and connect the same endpoints directly';
  remove.disabled=!bendCandidates(source,object,scene,'delete',1).length;
  bend.disabled=remove.disabled;
  remove.onclick=()=>{if(valid())propose(bendCandidates(source,object,scene,'delete',Number(bend.value)));};
  reset.disabled=path.length<3||!routeCandidates(source,object,scene,'straight').length;
  reset.onclick=()=>request('straight');
  bendRow.append(segmentLabel,add,bendLabel,remove,reset);panel.append(bendRow);
  const bendHint=document.createElement('p');bendHint.textContent=add.disabled?'Bend insertion is unavailable for this source expression. Supported explicit routes keep their endpoint references.':'Add bend inserts a handle halfway along the selected segment. Drag the filled handle to reroute; Delete bend preserves the other waypoints.';panel.append(bendHint);
  const legend=document.createElement('p');legend.className='route-legend';legend.textContent='Square = route handle. Round = endpoint (use the Endpoints tab). Arrow keys nudge a focused handle; Escape cancels.';
  panel.append(legend);
  const scale=Math.hypot(svg.getScreenCTM().a,svg.getScreenCTM().b),r=6/scale;
  const ghost=el('polyline',{class:'route-ghost',fill:'none',stroke:'#0969da','stroke-width':2,'stroke-dasharray':'5 4','vector-effect':'non-scaling-stroke','pointer-events':'none'});
  layer.append(ghost);
  const preview=(mode,target,index)=>{
    const ps=mode==='vertex'?path.map((p,i)=>i===index?target:p):mode==='via-x'?[start,{x:target.x,y:start.y},{x:target.x,y:end.y},end]
      :mode==='via-y'?[start,{x:start.x,y:target.y},{x:end.x,y:target.y},end]:[start,target,end];
    ghost.setAttribute('points',ps.map(p=>{const q=point(p);return q.x+','+q.y;}).join(' '));
  };
  const snap=(p,mode)=>{
    const screen=svg.getScreenCTM(),modelScale=Math.hypot(m.a,m.b)*Math.hypot(screen.a,screen.b);
    const result={x:p.x,y:p.y};
    let description='';
    for(const axis of mode==='via-x'?['x']:mode==='via-y'?['y']:['x','y']){
      const grid=Math.round(p[axis]*10)/10;
      const choices=[{value:grid,name:'0.1 in grid'}];
      for(const shape of scene.objects.filter(s=>!['arrow','line','spline','move'].includes(s.kind)))for(const [a,pos]of Object.entries(shape.anchors||{})){
        choices.push({value:pos[axis],name:(shape.name||shape.kind)+'.'+a});
      }
      choices.sort((a,b)=>Math.abs(a.value-p[axis])-Math.abs(b.value-p[axis]));
      if(Math.abs(choices[0].value-p[axis])*modelScale<8){result[axis]=choices[0].value;description=' · '+axis+' aligned to '+choices[0].name;}
    }
    return {target:result,description};
  };
  const handles=[];
  function addHandle(p,mode,label,index){
    const q=point(p),h=el('rect',{class:'route-handle',x:q.x-r,y:q.y-r,width:r*2,height:r*2,rx:1,fill:'#fff',stroke:'#0969da','stroke-width':2,'vector-effect':'non-scaling-stroke',tabindex:0,role:'button','aria-label':label});
    const title=el('title',{});title.textContent=label;h.append(title);
    h.style.pointerEvents='all';h.style.cursor=mode==='via-x'?'ew-resize':mode==='via-y'?'ns-resize':'move';
    if(mode==='vertex')h.setAttribute('fill','#0969da');
    let dragging=false,last=p;
    const reset=()=>{ghost.removeAttribute('points');h.setAttribute('x',q.x-r);h.setAttribute('y',q.y-r);};
    h.onpointerdown=e=>{
      if(!valid())return;e.preventDefault();e.stopPropagation();clear();dragging=true;last=p;h.setPointerCapture(e.pointerId);
      status('Drag to change the route. '+commitHint()+' Escape cancels.');
    };
    h.onpointermove=e=>{
      if(!dragging)return;
      const at=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()).matrixTransform(m.inverse());
      // Shift: keep this bend's incoming segment horizontal, vertical or 45 degrees.
      const anchor=mode==='vertex'&&index>0?object.path?.[index-1]:null;
      const locked=e.shiftKey&&anchor?lockDirection(anchor,at):null;
      const snapped=locked?{target:locked.point,description:' · locked '+(locked.axis==='diagonal'?'45°':locked.axis==='x'?'horizontal':'vertical')}:snap(at,mode);last=snapped.target;
      const pos=point(mode==='via-x'?{x:last.x,y:p.y}:mode==='via-y'?{x:p.x,y:last.y}:last);
      h.setAttribute('x',pos.x-r);h.setAttribute('y',pos.y-r);preview(mode,last,index);
      status(label+': '+last.x.toFixed(2)+', '+last.y.toFixed(2)+' in'+snapped.description);
    };
    h.onpointerup=e=>{if(!dragging)return;dragging=false;e.stopPropagation();reset();request(mode,last,index);};
    h.onpointercancel=()=>{dragging=false;reset();status('Route drag cancelled. Source unchanged.');};
    h.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dragging=false;reset();clear();status('Route drag cancelled. Source unchanged.');return;}
      const delta={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}[e.key];
      if(!delta)return;e.preventDefault();e.stopPropagation();
      request(mode,{x:p.x+delta[0],y:p.y+delta[1]},index);
    };
    layer.append(h);handles.push(h);
  }
  for(let i=0;i<path.length-1;i++){
    const a=path[i],b=path[i+1];if(Math.hypot(a.x-b.x,a.y-b.y)<.02)continue;
    const mode=Math.abs(a.y-b.y)<.001?'via-y':Math.abs(a.x-b.x)<.001?'via-x':'via';
    const midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    if(routeCandidates(source,object,scene,mode,midpoint).length)addHandle(midpoint,mode,'Drag route segment '+(i+1));
  }
  for(let i=1;i<path.length-1;i++){
    if(moveVertexCandidates(source,object,scene,i,path[i]).length)addHandle(path[i],'vertex','Drag bend '+i,i);
    else if(routeCandidates(source,object,scene,'via',path[i]).length)addHandle(path[i],'via','Replace route through bend '+i);
  }
  return panel;
}

// Route styles: a gallery of rendered alternatives plus stroke, colour and
// label controls. Every choice is a validated whole-program candidate handed
// to the app's preview; nothing is written until the author accepts.
const validated=new Map();
function validateAll(key,options,{object,scene,render,valid}){
  if(validated.has(key))return validated.get(key);
  const job=(async()=>{
    const good=[],rejected=[];
    for(const option of options){
      if(!valid())return null;
      const result=await render(option.source);
      const problem=checkStyleResult(scene,object,option,result);
      if(problem)rejected.push({...option,problem});else good.push({...option,result,base:option.patch.base});
    }
    return {good,rejected};
  })();
  validated.set(key,job);
  if(validated.size>24)validated.delete(validated.keys().next().value);
  job.then(v=>{if(!v)validated.delete(key);});
  return job;
}
function thumbnail(option,objectId){
  const box=thumbnailBox(option.result,objectId),template=document.createElement('template');
  template.innerHTML=option.result.svg;
  const svg=template.content.querySelector('svg');if(!svg||!box)return null;
  // Thumbnails are pictures, not canvas objects: drop the ids the canvas uses.
  for(const g of svg.querySelectorAll('[data-pikchr-id]')){const id=g.getAttribute('data-pikchr-id');g.removeAttribute('data-pikchr-id');if(id!==objectId)g.setAttribute('opacity','0.35');}
  svg.setAttribute('viewBox',[box.x,box.y,box.width,box.height].join(' '));
  svg.removeAttribute('width');svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  svg.classList.add('route-style-thumb');return svg;
}
export function routeStyleGallery({object,scene,source,render,preview,accept,discard,status,valid}){
  const section=document.createElement('section');section.className='route-styles';
  const headingId='route-styles-'+object.id;
  const heading=document.createElement('h4');heading.id=headingId;heading.textContent='Route styles';
  const hint=document.createElement('p');hint.className='route-style-hint';
  hint.textContent='Each style is a Pikchr edit rendered before you see it. Choose one to preview; Enter or Accept applies it, Escape keeps the original, [ and ] cycle.';
  const list=document.createElement('div');list.className='route-style-gallery';
  list.setAttribute('role','listbox');list.setAttribute('aria-labelledby',headingId);list.setAttribute('aria-orientation','horizontal');
  const note=document.createElement('p');note.className='route-style-status';
  section.append(heading,hint,list,note);
  const state=connectorState(source,object,scene);
  const {options,unavailable,reason}=routeStyleCandidates(source,object,scene);
  section.dataset.state=state?'ready':'none';
  if(!state){note.textContent=reason;list.hidden=true;return section;}
  const ctx={object,scene,render,valid};
  let shown=[],active=-1;
  const mark=i=>{active=i;shown.forEach((b,j)=>{b.setAttribute('aria-selected',String(j===i));b.tabIndex=j===(i<0?0:i)?0:-1;});};
  const run=async(candidates,index=0,group=null)=>{
    if(!valid()){status('Wait for a valid diagram before editing.');return;}
    if(!candidates.length){status('That style is already applied or cannot be expressed for this connector.');return;}
    const key=source+'\u0000'+object.id+'\u0000'+candidates.map(c=>c.id).join(',');
    status('Rendering '+candidates.length+(candidates.length===1?' style…':' styles…'));
    const checked=await validateAll(key,candidates,ctx);
    if(!checked||!valid())return;
    if(!checked.good.length){status('Style not applied. '+(checked.rejected[0]?.problem||'Pikchr rejected it.'));return;}
    preview(checked.good,Math.min(index,checked.good.length-1),{onIndex:group?i=>mark(i):()=>mark(-1)});
  };
  // Gallery: every shape, corner, arrowhead, bend, detour and loop option.
  if(!options.length){list.hidden=true;note.textContent='No route styles apply to this connector.';}
  else{
    note.textContent='Rendering '+options.length+' styles…';
    validateAll(source+'\u0000'+object.id+'\u0000'+options.map(c=>c.id).join(','),options,ctx).then(checked=>{
      if(!checked||!section.isConnected)return;
      list.replaceChildren();
      shown=checked.good.map((option,i)=>{
        const b=document.createElement('button');b.type='button';b.className='route-style-option';
        b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.tabIndex=i===0?0:-1;
        b.dataset.styleId=option.id;b.title=option.group+': '+option.label;
        const thumb=thumbnail(option,object.id);if(thumb)b.append(thumb);
        const label=document.createElement('span');label.textContent=option.label;b.append(label);
        b.onclick=()=>{if(active===i)accept();else{mark(i);preview(checked.good,i,{onIndex:mark});}};
        list.append(b);return b;
      });
      const hidden=[...unavailable,...checked.rejected];
      note.textContent=(shown.length?shown.length+' styles.':'No style rendered cleanly.')+(hidden.length?' Not offered: '+hidden.map(h=>h.label).join(', ')+'. '+(hidden[0].reason||hidden[0].problem):'');
    });
  }
  list.onkeydown=e=>{
    const i=shown.indexOf(document.activeElement);if(i<0)return;
    const step={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key];
    if(step||e.key==='Home'||e.key==='End'){
      e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?shown.length-1:(i+step+shown.length)%shown.length;
      shown.forEach((b,j)=>b.tabIndex=j===next?0:-1);shown[next].focus();return;
    }
    if(e.key==='Enter'||e.key===' '){e.preventDefault();shown[i].click();return;}
    if(e.key==='Escape'&&active>=0){e.preventDefault();e.stopPropagation();mark(-1);discard();}
  };
  // Stroke, weight and ends: chips that show what is on now.
  const chips=document.createElement('div');chips.className='route-style-chips';
  const chipRow=(title,items)=>{
    const row=document.createElement('div');row.className='chip-row';row.setAttribute('role','group');row.setAttribute('aria-label',title);
    const name=document.createElement('span');name.textContent=title;row.append(name);
    for(const [label,on,make]of items){
      const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-pressed',String(on));
      b.onclick=()=>run(make());row.append(b);
    }
    chips.append(row);
  };
  chipRow('Stroke',['solid','dashed','dotted'].map(d=>[d[0].toUpperCase()+d.slice(1),state.dash===d,()=>strokeCandidates(source,object,scene,d)]));
  chipRow('Weight',['thin','normal','thick'].map(w=>[w[0].toUpperCase()+w.slice(1),state.weight===w,()=>weightCandidates(source,object,scene,w)]));
  chipRow('Ends',[['Chop at edges',state.chop,()=>chopCandidates(source,object,scene,!state.chop)]]);
  const colourLabel=document.createElement('label');colourLabel.className='chip-row';colourLabel.append('Colour ');
  const colour=document.createElement('select');colour.setAttribute('aria-label','Connector colour');
  for(const c of ['default',...routeColours]){const o=document.createElement('option');o.value=c;o.textContent=c==='default'?'Default':c;colour.append(o);}
  colour.value=routeColours.includes(state.colour)?state.colour:state.colour==='grey'?'gray':'default';
  if(state.colour!=='default'&&!routeColours.includes(state.colour)&&state.colour!=='grey'){const o=document.createElement('option');o.value='';o.textContent=state.colour;o.disabled=true;colour.prepend(o);colour.value='';}
  colour.onchange=()=>colour.value&&run(colourCandidates(source,object,scene,colour.value));
  colourLabel.append(colour);chips.append(colourLabel);
  // Label: one string on the connector, placed above, below or along it.
  const form=document.createElement('form');form.className='route-label-form';
  const textLabel=document.createElement('label');textLabel.append('Label ');
  const text=document.createElement('input');text.type='text';text.value=state.label?.text||'';text.setAttribute('aria-label','Connector label');text.maxLength=200;
  textLabel.append(text);
  const placeLabel=document.createElement('label');placeLabel.append('Placement ');
  const place=document.createElement('select');place.setAttribute('aria-label','Label placement');
  for(const p of ['above','below','aligned','center']){const o=document.createElement('option');o.value=p;o.textContent=p==='aligned'?'Along the line':p[0].toUpperCase()+p.slice(1);place.append(o);}
  place.value=state.label?.placement||'above';placeLabel.append(place);
  const apply=document.createElement('button');apply.type='submit';apply.textContent=state.label?'Update label':'Add label';
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove label';remove.disabled=!state.label;
  form.append(textLabel,placeLabel,apply,remove);
  form.onsubmit=e=>{e.preventDefault();if(!text.value.trim()){status('Type a label first, or use Remove label.');return;}run(labelCandidates(source,object,scene,{text:text.value,placement:place.value}));};
  remove.onclick=()=>run(labelCandidates(source,object,scene,{text:''}));
  if(!state.labelEditable){for(const el of [text,place,apply,remove])el.disabled=true;const why=document.createElement('p');why.className='route-style-hint';why.textContent='This connector has several labels; edit them in source.';form.append(why);}
  section.append(chips,form);
  return section;
}
