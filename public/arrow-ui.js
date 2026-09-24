import {endpointCandidates,moveVertexCandidates} from './edits.js?v=20260923c';
import {routeEditor,routeStyleGallery} from './route-ui.js?v=20260923c';
const ns='http://www.w3.org/2000/svg';
let preferredMode='endpoints';
const names={n:'North',ne:'Northeast',e:'East',se:'Southeast',s:'South',sw:'Southwest',w:'West',nw:'Northwest',c:'Center'};
const element=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
export function arrowEditor({object,scene,source,svg,inspector,propose,status,valid,clear,autoApply,render,preview,accept,discard}){
  if(!['arrow','line','spline','arc'].includes(object.kind))return false;
  const routable=['arrow','line'].includes(object.kind);
  const targets=scene.objects.filter(o=>o.name&&o.id!==object.id&&o.span.start<object.span.start&&o.anchors&&!['arrow','line','spline','arc','move'].includes(o.kind));
  const available=routable?targets.filter(t=>endpointCandidates(source,object,scene,'to',t,'n').length):[];
  const vertexEditable=routable&&(object.path||[]).some((p,i)=>moveVertexCandidates(source,object,scene,i,p).length);
  const styles=render&&preview?routeStyleGallery({object,scene,source,render,preview,accept,discard,status,valid}):null;
  const styled=styles?.dataset.state==='ready';
  if(!available.length&&!vertexEditable&&!styled)return false;
  let active='to',armed=false,dragActive=false;
  const previous=inspector.querySelector('.arrow-editor');
  const position=previous?.nextSibling;previous?.remove();
  const section=document.createElement('div');section.className='arrow-editor';
  const heading=document.createElement('h3');heading.textContent='Connector';
  if(!available.length&&!vertexEditable){
    // Style-only: splines, arcs and routes the endpoint editor cannot rewrite.
    section.append(heading,styles);
    if(position?.parentNode===inspector)inspector.insertBefore(section,position);else inspector.append(section);
    return true;
  }
  const instructions=document.createElement('p');instructions.textContent='Drag an endpoint to reconnect. Or choose a target and anchor below. Canvas anchors are inactive until Reconnect is enabled.';
  const reconnect=document.createElement('button');reconnect.textContent='Reconnect on canvas';reconnect.setAttribute('aria-pressed','false');
  const side=document.createElement('div');side.className='endpoint-tabs';
  const from=document.createElement('button'),to=document.createElement('button');
  from.textContent='Start';to.textContent='Arrowhead';side.append(from,to);
  const label=document.createElement('label');label.textContent='Connect to';
  const target=document.createElement('select');target.setAttribute('aria-label','Endpoint target');
  const textLabel=document.createElement('label');
  const includeText=document.createElement('input');includeText.type='checkbox';
  textLabel.append(includeText,' Include text labels as connection targets');
  const visibleTargets=()=>available.filter(t=>includeText.checked||t.kind!=='text');
  const fillTargets=()=>{
    const selected=target.value;target.replaceChildren();
    for(const t of visibleTargets()){const option=document.createElement('option');option.value=t.id;option.textContent=objectLabel(t,source);target.append(option);}
    if([...target.options].some(o=>o.value===selected))target.value=selected;
    target.disabled=!target.options.length;
  };
  fillTargets();
  label.append(target);
  const buttons=document.createElement('div');buttons.className='anchor-grid';
  const attach=(t,a)=>{
    if(!valid())return;
    const options=endpointCandidates(source,object,scene,active,t,a);
    if(options.length){armed=false;syncTargets();propose(options);}else status('This endpoint expression cannot be safely rewritten.');
  };
  for(const a of ['nw','n','ne','w','c','e','sw','s','se']){
    const b=document.createElement('button');b.textContent=a.toUpperCase();b.title=names[a];b.setAttribute('aria-label','Connect to '+names[a]);
    b.onclick=()=>attach(available.find(t=>t.id===target.value),a);buttons.append(b);
  }
  const modes=document.createElement('div');modes.className='connector-tabs';
  const routing=document.createElement('button'),endpoints=document.createElement('button');
  routing.textContent='Routing';endpoints.textContent='Endpoints';modes.append(routing,endpoints);
  endpoints.disabled=!available.length;
  if(!available.length)endpoints.title='Endpoint reconnection is not supported for this route expression.';
  const endpointPanel=document.createElement('div');endpointPanel.className='endpoint-controls';
  endpointPanel.append(instructions,reconnect,side,label,textLabel,buttons);
  section.append(heading,...(styled?[styles]:[]),modes,endpointPanel);
  if(position?.parentNode===inspector)inspector.insertBefore(section,position);else inspector.append(section);
  const t=scene.transform,m=new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]);
  const point=p=>new DOMPoint(p.x,p.y).matrixTransform(m);
  const layer=element('g',{class:'arrow-overlay'});svg.append(layer);
  const scale=Math.hypot(svg.getScreenCTM().a,svg.getScreenCTM().b);
  const coarse=matchMedia('(pointer: coarse)').matches;
  const radius=(coarse?14:10)/scale;
  const dots=[];
  const syncTargets=()=>{
    reconnect.setAttribute('aria-pressed',String(armed));
    reconnect.textContent=armed?'Cancel reconnect':'Reconnect on canvas';
    for(const {dot,shape}of dots){const show=(armed||dragActive)&&(includeText.checked||shape.kind!=='text');dot.style.display=show?'':'none';dot.style.pointerEvents=show?'all':'none';}
    for(const b of buttons.children)b.disabled=!target.options.length;
  };
  includeText.onchange=()=>{fillTargets();syncTargets();status(includeText.checked?'Shapes and text labels are available as connection targets.':'Only shapes are available as connection targets.');};
  reconnect.onclick=()=>{armed=!armed;syncTargets();status(armed?'Choose a blue shape anchor to reconnect the selected endpoint.':'Reconnect cancelled. Select or move shapes normally.');};
  for(const shape of available)for(const [anchor,p]of Object.entries(shape.anchors)){
    if(!names[anchor])continue;
    const q=point(p),dot=element('circle',{class:'anchor-target',cx:q.x,cy:q.y,r:(coarse?9:6)/scale,fill:'#fff',stroke:'#0969da','stroke-width':1.5,'vector-effect':'non-scaling-stroke','data-anchor':shape.name+'.'+anchor});
    dot.style.pointerEvents='all';dot.style.cursor='crosshair';
    const title=element('title',{});title.textContent=shape.name+'.'+anchor;dot.append(title);
    dot.addEventListener('pointerdown',e=>{e.stopPropagation();});
    dot.addEventListener('click',e=>{if(!armed)return;e.stopPropagation();target.value=shape.id;attach(shape,anchor);});
    layer.append(dot);dots.push({shape,anchor,q,dot});
  }
  const path=object.path||[];
  syncTargets();
  if(path.length<2)return true;
  const handles=[];
  const update=()=>{
    from.setAttribute('aria-pressed',String(active==='from'));to.setAttribute('aria-pressed',String(active==='to'));
    for(const h of handles)h.element.setAttribute('fill',h.end===active?'#0969da':'#fff');
    const endpoint=point(active==='from'?path[0]:path[path.length-1]);
    const closest=dots.filter(d=>includeText.checked||d.shape.kind!=='text').sort((a,b)=>Math.hypot(a.q.x-endpoint.x,a.q.y-endpoint.y)-Math.hypot(b.q.x-endpoint.x,b.q.y-endpoint.y))[0];
    if(closest)target.value=closest.shape.id;
  };
  from.onclick=()=>{active='from';update();};to.onclick=()=>{active='to';update();};
  for(const [end,p]of [['from',path[0]],['to',path[path.length-1]]]){
    const origin=point(p);
    const handle=element('circle',{class:'endpoint-handle',cx:origin.x,cy:origin.y,r:radius,fill:'#fff',stroke:'#0969da','stroke-width':2,'vector-effect':'non-scaling-stroke',tabindex:0,role:'button','aria-label':'Drag '+(end==='from'?'start':'arrowhead')+' endpoint'});
    handle.style.pointerEvents='all';handle.style.cursor='grab';
    let dragging=false,nearest=null;
    const title=element('title',{});title.textContent=end==='from'?'Start endpoint':'Arrowhead endpoint';handle.append(title);
    handle.addEventListener('pointerdown',e=>{
      if(!valid())return;
      mode('endpoints');
      e.preventDefault();e.stopPropagation();clear();active=end;update();dragging=true;dragActive=true;syncTargets();
      handle.setPointerCapture(e.pointerId);status('Drop on a blue anchor to update the connection. Drop elsewhere to cancel.');
    });
    handle.addEventListener('pointermove',e=>{
      if(!dragging)return;
      const at=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      nearest=null;let distance=coarse?30:22;
      for(const d of dots){
        if(!includeText.checked&&d.shape.kind==='text')continue;
        const screen=d.q.matrixTransform(svg.getScreenCTM()),dist=Math.hypot(screen.x-e.clientX,screen.y-e.clientY);
        d.dot.setAttribute('fill','#fff');
        if(dist<distance){nearest=d;distance=dist;}
      }
      const pos=nearest?.q||at;handle.setAttribute('cx',pos.x);handle.setAttribute('cy',pos.y);
      if(nearest){nearest.dot.setAttribute('fill','#0969da');status('Snap to '+nearest.shape.name+'.'+nearest.anchor);}
      else status('Move closer to a blue shape anchor to snap.');
    });
    handle.addEventListener('pointerup',e=>{
      if(!dragging)return;dragging=false;dragActive=false;syncTargets();e.stopPropagation();
      handle.setAttribute('cx',origin.x);handle.setAttribute('cy',origin.y);
      if(nearest){target.value=nearest.shape.id;attach(nearest.shape,nearest.anchor);}
      else status('No anchor selected. Connection unchanged.');
    });
    handle.addEventListener('pointercancel',()=>{dragging=false;dragActive=false;syncTargets();handle.setAttribute('cx',origin.x);handle.setAttribute('cy',origin.y);});
    handle.addEventListener('keydown',e=>{if(e.key==='Escape'){dragging=false;dragActive=false;armed=false;syncTargets();handle.setAttribute('cx',origin.x);handle.setAttribute('cy',origin.y);}if(e.key==='Enter'||e.key===' '){e.preventDefault();active=end;update();target.focus();}});
    layer.append(handle);handles.push({end,element:handle});
  }
  const routePanel=routeEditor({object,scene,source,svg,layer,propose,status,valid,clear,autoApply});
  section.append(routePanel);
  const mode=value=>{
    preferredMode=value;
    if(value!=='endpoints'){armed=false;syncTargets();}
    layer.dataset.mode=value;
    endpointPanel.hidden=value!=='endpoints';routePanel.hidden=value!=='routing';
    routing.setAttribute('aria-pressed',String(value==='routing'));endpoints.setAttribute('aria-pressed',String(value==='endpoints'));
  };
  routing.onclick=()=>mode('routing');endpoints.onclick=()=>mode('endpoints');
  mode(available.length?preferredMode:'routing');update();return true;
}
function objectLabel(object,source){
  const bytes=new TextEncoder().encode(source),statement=new TextDecoder().decode(bytes.slice(object.span.start,object.span.end));
  const labels=[...statement.matchAll(/"([^"\\]*)"/g)].map(m=>m[1]);
  return labels.length?`${labels.join(' / ')} (${object.name||object.id})`:object.name||object.id;
}
