import {endpointCandidates,moveVertexCandidates,routeCandidates,byteOffsetToIndex} from './edits.js?v=20260923c';
import {routeEditor,routeStyleGallery} from './route-ui.js?v=20260923c';
import {connectorState,routeStyleCandidates} from './route-styles.js?v=20260923c';
import {inspectProperties,changeTermination} from './properties.js?v=20260923c';
import {reverseConnector} from './reverse-connector.js?v=20260923c';
const ns='http://www.w3.org/2000/svg';
let preferredMode='endpoints';
const names={n:'North',ne:'Northeast',e:'East',se:'Southeast',s:'South',sw:'Southwest',w:'West',nw:'Northwest',c:'Center'};
const element=(tag,attrs)=>{const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
// What this connector can actually do, from the same predicates the editors
// use. Labels and status text read this, so they never promise an operation
// that the source expression cannot express.
export function connectorCapabilities({object,scene,source}){
  if(!object||!['arrow','line','spline','arc'].includes(object.kind))return null;
  const routable=['arrow','line'].includes(object.kind);
  const targets=scene.objects.filter(o=>o.name&&o.id!==object.id&&o.anchors&&!['arrow','line','spline','arc','move'].includes(o.kind));
  const endpoints=routable&&targets.some(t=>endpointCandidates(source,object,scene,'to',t,'n').length);
  const path=object.path||[];
  const route=routable&&(routeCandidates(source,object,scene,'straight').length>0
    ||path.some((p,i)=>i>0&&i<path.length-1&&moveVertexCandidates(source,object,scene,i,p).length>0));
  let styles=false;
  try{styles=connectorState(source,object,scene)!==null&&routeStyleCandidates(source,object,scene).options.length>0;}catch{}
  return {endpoints,route,styles};
}
// Each end as the source writes it ("Client.e", "(1,2)"), so the inspector
// shows code rather than the arrowhead-shortened rendered point. An end the
// source does not spell (no "to") falls back to that rendered point.
const fmt=n=>String(Number(n.toFixed(2)));
export function connectorEnds({object,scene,source}){
  if(!object||!['arrow','line','spline','arc'].includes(object.kind))return null;
  let text='';try{text=source.slice(byteOffsetToIndex(source,object.span.start),byteOffsetToIndex(source,object.span.end));}catch{}
  const masked=text.replace(/"(?:[^"\\]|\\.)*"/g,m=>' '.repeat(m.length)),term='([A-Z]\\w*(?:\\.\\w+)?|\\([^()"]*\\))';
  const code=m=>m?text.slice(m.index+m[0].length-m[1].length,m.index+m[0].length):null;
  const path=object.path||[];
  const end=(m,p)=>{
    const c=code(m);if(!c)return p?{code:'('+fmt(p.x)+', '+fmt(p.y)+')',name:null}:null;
    const name=/^[A-Z]/.test(c)?c.split('.')[0]:null;
    return {code:c,name:name&&scene.objects.some(o=>o.name===name)?name:null};
  };
  return {from:end(new RegExp('\\bfrom\\s+'+term).exec(masked),path[0]),to:end([...masked.matchAll(new RegExp('\\bto\\s+'+term,'g'))].at(-1),path.at(-1))};
}
export function connectorTitle({object,scene,source}){
  const kind=object.kind[0].toUpperCase()+object.kind.slice(1),ends=connectorEnds({object,scene,source});
  return ends?.from?.name&&ends?.to?.name?kind+' · '+ends.from.name+' → '+ends.to.name:kind;
}
// The inspector speaks about editing only when it is blocked, and then says why.
export function editingBlocked(object,capabilities){
  if(!object)return null;
  if(object.reason==='Macro-expanded object')return 'Editing is blocked: this object is expanded from a macro. Its source may be shared by other instances, so direct canvas edits are disabled. Inspect the generating source to change the program.';
  if(object.reason==='Nested object')return 'Editing is blocked: this object is inside a [ ] block. Edit it in source.';
  if(capabilities)return capabilities.endpoints||capabilities.route||capabilities.styles?null:'Editing is blocked: Studio cannot safely rewrite this connector’s source expression. Edit it in source.';
  if(object.editable)return null;
  if(['box','circle','ellipse','oval','cylinder','diamond','text'].includes(object.kind)&&!object.name)return 'Moving is blocked: this shape has no name. Name it in source (for example A: box) to move it here.';
  return 'Editing is blocked: Studio moves boxes, circles, ellipses, ovals, cylinders, diamonds and text. Edit this '+object.kind+' in source.';
}
// Inspector rows for one connector: Start and End as code with Reconnect,
// Reverse direction, and Heads. Every change is one validated candidate.
const lineIcon=paths=>{const svg=element('svg',{viewBox:'0 0 24 24',width:18,height:18,'aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round'});for(const d of paths)svg.append(element('path',{d}));return svg;};
const row=(name,...items)=>{const r=document.createElement('div');r.className='inspector-row';const n=document.createElement('span');n.className='row-name';n.textContent=name;r.append(n,...items);return r;};
export function segmented(label,items,current,choose){
  const group=document.createElement('div');group.className='cl-seg';group.setAttribute('role','group');group.setAttribute('aria-label',label);
  for(const [value,text,title]of items){const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.value=value;b.setAttribute('aria-pressed',String(value===current));if(title)b.title=title;b.onclick=()=>{if(b.getAttribute('aria-pressed')!=='true')choose(value);};group.append(b);}
  return group;
}
export function connectorRows({object,scene,source,capabilities,propose,status,valid,reconnect}){
  if(!['arrow','line','spline','arc'].includes(object.kind))return null;
  const routable=['arrow','line'].includes(object.kind),ends=connectorEnds({object,scene,source});
  const box=document.createElement('div');box.className='connector-rows';
  const request=make=>{if(!valid()){status('Render the current source before editing.');return;}try{propose([make()]);}catch(error){status(error.message);}};
  for(const [name,end,which]of [['Start',ends.from,'start'],['End',ends.to,'end']]){
    const code=document.createElement('code');code.textContent=end?.code||'—';
    const b=document.createElement('button');b.type='button';b.textContent='Reconnect';b.setAttribute('aria-label','Reconnect '+which);
    b.disabled=!capabilities?.endpoints;b.title=b.disabled?'This connector has no shape endpoint to reconnect. Edit it in source.':'Choose the shape for the '+which+' on the canvas';
    b.onclick=()=>{if(valid())reconnect(which);else status('Render the current source before editing.');};
    box.append(row(name,code,b));
  }
  if(!routable)return box;
  const reverse=document.createElement('button');reverse.type='button';reverse.className='connector-reverse';
  reverse.append(lineIcon(['M5 8h13','m15 5 3 3-3 3','M19 16H6','m9 13-3 3 3 3']),'Reverse direction');
  try{reverseConnector(source,scene,object);}catch(error){reverse.disabled=true;reverse.title=error.message;}
  reverse.onclick=()=>request(()=>reverseConnector(source,scene,object));
  box.append(reverse);
  let termination=null;try{termination=inspectProperties(source,object,scene).termination;}catch{}
  if(termination!==null)box.append(row('Heads',segmented('Heads',[['none','None'],['end','End'],['start','Start'],['both','Both']],termination,
    mode=>request(()=>changeTermination(source,object,scene,mode)))));
  return box;
}
export function connectorLabel(capabilities){
  if(!capabilities)return 'inspect only';
  const parts=[];
  if(capabilities.endpoints)parts.push('endpoints editable');
  if(capabilities.route)parts.push('route editable');
  if(capabilities.styles)parts.push('styles editable');
  return parts.join(', ')||'inspect only';
}
// The editor fills the inspector's slots: suggested routes, the connector's
// style controls (inside Style) and the endpoint/routing panels (inside
// Advanced). Each slot is replaced whole, so a refresh never duplicates.
export function arrowEditor({object,scene,source,svg,slots,propose,status,valid,clear,autoApply,render,preview,accept,discard}){
  if(!['arrow','line','spline','arc'].includes(object.kind)||!slots)return false;
  const routable=['arrow','line'].includes(object.kind);
  const targets=scene.objects.filter(o=>o.name&&o.id!==object.id&&o.anchors&&!['arrow','line','spline','arc','move'].includes(o.kind));
  const available=routable?targets.filter(t=>endpointCandidates(source,object,scene,'to',t,'n').length):[];
  const vertexEditable=routable&&(object.path||[]).some((p,i)=>moveVertexCandidates(source,object,scene,i,p).length);
  const styles=render&&preview?routeStyleGallery({object,scene,source,render,preview,accept,discard,status,valid}):null;
  const styled=!!styles?.ready;
  slots.routes?.replaceChildren(...(styled?[styles.routes]:[]));
  slots.style?.replaceChildren(...(styled?[styles.style]:[]));
  slots.editor?.replaceChildren();
  if(!available.length&&!vertexEditable)return styled;
  let active='to',armed=false,dragActive=false;
  const section=document.createElement('div');section.className='arrow-editor';
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
  section.append(modes,endpointPanel);slots.editor?.append(section);
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
