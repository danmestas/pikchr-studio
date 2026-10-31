import {createShape,createConnector,connectableShapes,shapeKinds} from './creation.js?v=20261031a';
import {inspectProperties} from './properties.js?v=20261031a';
import {endpointCandidates} from './edits.js?v=20261031a';
import {buildTextEdit} from './text-sizing.js?v=20261031a';
import {createConnectedNeighbor,resizeShape} from './canvas-operations.js?v=20261031a';
import {snapResize,resizeBox} from './resize-guides.js?v=20261031a';

const ns='http://www.w3.org/2000/svg';
const element=(tag,attrs={})=>{const node=document.createElement(tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;};
const svgElement=(tag,attrs)=>{const node=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;};
const button=(label,action)=>{const b=element('button');b.textContent=label;b.onclick=action;return b;};
const pick=(label,items)=>{const field=element('label'),select=element('select',{'aria-label':label});field.append(label+' ',select);for(const[value,text]of items){const option=element('option',{value});option.textContent=text;select.append(option);}return {field,select};};

// The canvas controller does not own source, history, or document persistence.
// It submits one validated candidate through the app's existing edit pipeline.
export function canvasTools({clearSelection,host,toolbar,getState,render,propose,select,selectMany,status,stopPan,invalidate,livePreview,liveClear}){
  let mode='select',modeKey=null,startShape=null,pending=null,resize=null,dialogSession=null,epoch=0;
  const snapshot=()=>({...getState(),toolEpoch:epoch});
  const kinds=pick('Shape',shapeKinds.map(k=>[k,k[0].toUpperCase()+k.slice(1)]));
  kinds.field.className='active-shape-kind';
  // Changing the kind while placing (e.g. Text → Box) updates the tool state.
  kinds.select.addEventListener('change',()=>sync());
  const repeat=element('input',{type:'checkbox',id:'keep-adding','aria-label':'Keep placing shapes'}),repeatLabel=element('label');repeatLabel.append(repeat,' Keep adding');
  const directions=pick('Direction',[['right','Right'],['down','Down'],['left','Left'],['up','Up']]);directions.select.id='neighbor-direction';
  const place=button('Place shape',()=>setMode(mode==='place'?'select':'place'));
  const connect=button('Connect shapes',()=>setMode(mode==='connect'?'select':'connect'));
  const marquee=button('Select area',()=>setMode(mode==='marquee'?'select':'marquee'));
  const neighbor=button('Add connected shape',async()=>{const s=getState();if(!s.valid||!s.object)return;try{await submit(createConnectedNeighbor(s.source,s.scene,s.object,{type:kinds.select.value,label:'',direction:directions.select.value}),s); }catch(e){status(e.message);}});
  const center=button('Place at view center',()=>{const svg=host.querySelector('svg'),r=svg?.getBoundingClientRect()||host.getBoundingClientRect();placeAt({clientX:r.x+r.width/2,clientY:r.y+r.height/2});});
  center.id='place-center';neighbor.id='add-neighbor';
  const toolState=element('span',{'role':'status'});
  const selectTool=button('Select',()=>setMode('select'));
  const panTool=button('Pan',()=>{cancel(false);document.querySelector('#pan-mode')?.click();sync();});
  const textTool=button('Text',()=>{kinds.select.value='text';setMode('place');});
  const palette=element('div',{class:'mode-palette',role:'toolbar','aria-label':'Canvas modes'});
  // Lucide paths (lucide.dev, ISC license): 24-unit, round joins, one stroke weight with the layout chrome.
  const icons={
    Select:[['path',{d:'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z',fill:'currentColor'}]],
    Pan:[['path',{d:'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2'}],['path',{d:'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2'}],['path',{d:'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8'}],['path',{d:'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'}]],
    Shape:[['rect',{x:'3',y:'3',width:'18',height:'18',rx:'2'}]],
    Connector:[['path',{d:'M13 5h6v6'}],['path',{d:'M19 5 5 19'}]],
    Text:[['path',{d:'M12 4v16'}],['path',{d:'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2'}],['path',{d:'M9 20h6'}]],
    'Select area':[['path',{d:'M5 3a2 2 0 0 0-2 2'}],['path',{d:'M19 3a2 2 0 0 1 2 2'}],['path',{d:'M21 19a2 2 0 0 1-2 2'}],['path',{d:'M5 21a2 2 0 0 1-2-2'}],['path',{d:'M9 3h1'}],['path',{d:'M9 21h1'}],['path',{d:'M14 3h1'}],['path',{d:'M14 21h1'}],['path',{d:'M3 9v1'}],['path',{d:'M21 9v1'}],['path',{d:'M3 14v1'}],['path',{d:'M21 14v1'}]],
  };
  for(const [control,name] of [[selectTool,'Select'],[panTool,'Pan'],[place,'Shape'],[connect,'Connector'],[textTool,'Text'],[marquee,'Select area']]){control.textContent='';control.title=name;control.setAttribute('aria-label',name==='Shape'?'Place shape':name==='Connector'?'Connect shapes':name);const icon=svgElement('svg',{viewBox:'0 0 24 24',width:20,height:20,'aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round'});for(const [tag,attrs] of icons[name])icon.append(svgElement(tag,attrs));control.append(icon);palette.append(control);}
  place.onclick=()=>{const alreadyShape=mode==='place'&&kinds.select.value!=='text';if(kinds.select.value==='text')kinds.select.value='box';setMode(alreadyShape?'select':'place');};
  document.querySelector('#pan-mode')?.addEventListener('click',()=>sync());
  // The placement and neighbor controls are created here; the layout moves them into its own popovers.
  toolbar.append(palette,kinds.field,center,repeatLabel,directions.field,neighbor,toolState);
  toolbar.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();cancel();selectTool.focus();}});
  // A direct reconnect is a canvas gesture: close the inspector so the
  // destination shapes are reachable, and say what is being picked.
  const closeInspector=()=>{for(const panel of document.querySelectorAll('.cl-popover:not([hidden])'))panel.opener?.click();host.focus({preventScroll:true});};
  const snap=element('input',{type:'checkbox',id:'snap-resize',checked:''}),snapLabel=element('label');snapLabel.append(snap,' Snap resize to 0.1 in');toolbar.append(snapLabel);
  // Sizing rows for the inspector: Text fit applies on click; Size applies on
  // Enter or when focus leaves the pair, never per keystroke. The app places
  // this group in the inspector; sync() keeps it truthful.
  const sizing=element('div',{'class':'canvas-sizing',role:'group','aria-label':'Shape size'});
  const row=(name,...items)=>{const r=element('div',{class:'inspector-row'}),n=element('span',{class:'row-name'});n.textContent=name;r.append(n,...items);return r;};
  const fitGroup=element('div',{class:'cl-seg',role:'group','aria-label':'Text fit'});
  const fitButtons=[['grow','Grow shape','The shape grows to fit its label'],['wrap','Wrap','The label wraps to the shape width; the height grows'],['fixed','Fixed','The size stays; the label may overflow']].map(([value,text,title])=>{const b=button(text,()=>fit(value));b.type='button';b.dataset.value=value;b.title=title;fitGroup.append(b);return b;});
  const sizeWidth=element('input',{type:'number',min:'.1',max:'100',step:'.1','aria-label':'Shape width',inputmode:'decimal'}),sizeHeight=element('input',{type:'number',min:'.1',max:'100',step:'.1','aria-label':'Shape height',inputmode:'decimal'});
  const times=element('span',{class:'cl-muted','aria-hidden':'true'});times.textContent='×';
  const lockIcon=open=>{const svg=svgElement('svg',{viewBox:'0 0 24 24',width:18,height:18,'aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round'});svg.append(svgElement('rect',{x:'5',y:'11',width:'14',height:'9',rx:'2'}),svgElement('path',{d:open?'M8 11V8a4 4 0 0 1 7.6-1.7':'M8 11V8a4 4 0 0 1 8 0v3'}));return svg;};
  let locked=false;
  const lock=element('button',{type:'button',class:'size-lock','aria-label':'Lock aspect ratio','aria-pressed':'false',title:'Keep the width-to-height ratio'});lock.append(lockIcon(true));
  lock.onclick=()=>{locked=!locked;syncLock(getState().object);};
  const syncLock=o=>{const on=locked||o?.kind==='circle';if(lock.getAttribute('aria-pressed')!==String(on)){lock.setAttribute('aria-pressed',String(on));lock.replaceChildren(lockIcon(!on));}lock.disabled=o?.kind==='circle';lock.title=lock.disabled?'A circle always keeps its ratio':'Keep the width-to-height ratio';};
  const fields=element('div',{class:'size-fields'});fields.append(sizeWidth,times,sizeHeight,lock);
  const sizeError=element('p',{class:'size-error',role:'alert'});sizeError.hidden=true;
  const sizeWarning=element('span',{'class':'size-warning','role':'status'});sizeWarning.hidden=true;
  sizing.append(row('Text fit',fitGroup),row('Size (in)',fields),sizeError,sizeWarning);
  // typed: the object whose fields hold an unapplied (or rejected) value, so
  // a sync never overwrites what the author is still correcting.
  let typed=null,applying=false;
  const fieldKey=s=>s.key+':'+s.object?.id;
  const showError=text=>{sizeError.textContent=text||'';sizeError.hidden=!text;for(const f of [sizeWidth,sizeHeight])f.toggleAttribute('aria-invalid',!!text);};
  const restoreSize=()=>{const o=getState().object;typed=null;showError('');if(o){sizeWidth.value=Number(o.bbox.width.toFixed(3));sizeHeight.value=Number(o.bbox.height.toFixed(3));}};
  async function applySize(){
    const s=snapshot(),o=s.object;if(applying||!s.valid||!o||sizing.hidden)return;
    const width=Number(sizeWidth.value),height=Number(sizeHeight.value);
    if(width===Number(o.bbox.width.toFixed(3))&&height===Number(o.bbox.height.toFixed(3))){restoreSize();return;}
    applying=true;let reason='';
    try{if(await submit(await sizedCandidate(s,{width,height}),s,text=>{reason=text;})){typed=null;showError('');}else showError(reason||'Size not applied.');}
    catch(error){showError(error.message);status('Size not applied. '+error.message);}
    finally{applying=false;}
  }
  async function fit(mode){
    const s=snapshot(),o=s.object;if(!s.valid||!o){status('Render the current source before changing text fit.');return;}
    restoreSize();
    try{await submit(await sizedCandidate(s,{width:o.bbox.width,height:o.bbox.height},mode),s,showError);}catch(error){showError(error.message);status(error.message);}
  }
  for(const field of [sizeWidth,sizeHeight]){
    field.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();applySize();}
      else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();restoreSize();}
    });
    // Moving between the two fields is still one edit; leaving the pair applies it.
    field.addEventListener('blur',e=>{if(e.relatedTarget!==sizeWidth&&e.relatedTarget!==sizeHeight&&typed===fieldKey(snapshot()))applySize();});
  }
  sizeWidth.addEventListener('input',()=>{const o=getState().object;typed=fieldKey(snapshot());if(o&&(locked||o.kind==='circle'))sizeHeight.value=(Number(sizeWidth.value)*o.bbox.height/o.bbox.width).toFixed(3);});
  sizeHeight.addEventListener('input',()=>{const o=getState().object;typed=fieldKey(snapshot());if(o&&(locked||o.kind==='circle'))sizeWidth.value=(Number(sizeHeight.value)*o.bbox.width/o.bbox.height).toFixed(3);});

  const dialog=element('dialog',{'class':'label-dialog','aria-labelledby':'canvas-label-title'});
  const heading=element('h2',{id:'canvas-label-title'});heading.textContent='Edit label';
  const label=element('label');label.textContent='Text';
  const input=element('textarea',{'aria-label':'Canvas label',rows:'3'});label.append(input);
  const policy=pick('Text sizing',[['grow','Grow to fit'],['wrap','Wrap to width (boxes)'],['fixed','Fixed size']]);
  const widthLabel=element('label');widthLabel.textContent='Width (inches) ';
  const width=element('input',{type:'number',min:'0.1',max:'100',step:'0.1','aria-label':'Wrap width'});widthLabel.append(width);
  const message=element('p',{'role':'status'}),help=element('p');help.textContent='Enter adds a line. Ctrl/⌘ Enter saves. Escape cancels. Preview is not saved until Done.';
  const done=button('Done',()=>finishText()),close=button('Cancel',()=>closeText());
  dialog.append(heading,label,policy.field,widthLabel,message,help,done,close);document.body.append(dialog);
  dialog.addEventListener('cancel',e=>{e.preventDefault();closeText();});
  input.addEventListener('keydown',e=>{if(!e.isComposing&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();finishText();}});
  let timer;
  for(const control of [input,policy.select,width])control.addEventListener('input',()=>{clearTimeout(timer);if(dialogSession){dialogSession.version++;dialogSession.candidate=null;}done.disabled=true;timer=setTimeout(previewText,180);widthLabel.hidden=policy.select.value!=='wrap';});

  function validSnapshot(s){const now=getState();return (s.toolEpoch===undefined||s.toolEpoch===epoch)&&now.valid&&now.key===s.key&&now.source===s.source;}
  async function submit(option,s,reject){if(!validSnapshot(s)){status('The document changed. Select the object again.');reject?.('The document changed. Select the object again.');return false;}return propose(s.object,[option],{reject});}
  async function sizedCandidate(s,dimensions,mode=s.sizing?.mode||'fixed'){
    const original=s.sizing?.text??inspectProperties(s.source,s.object,s.scene).text;
    if(mode==='grow'){const result=await buildTextEdit(s.source,s.scene,s.object,{text:original,mode},render);return {...result,sizingPreference:{mode,text:original}};}
    let option=resizeShape(s.source,s.scene,s.object,dimensions);
    if(mode==='wrap'){
      const measured=await render(option.source);if(measured.error)throw Error(measured.error);
      const object=measured.objects.find(o=>o.name===s.object.name&&o.kind===s.object.kind);if(!object)throw Error('Could not identify the resized shape.');
      const wrapped=await buildTextEdit(option.source,measured,object,{text:original,mode:'wrap',width:dimensions.width},render);
      // Compose into one atomic patch against the original document.
      let after=wrapped.source;
      if(dimensions.center){const finalScene=await render(after);if(finalScene.error)throw Error(finalScene.error);const finalObject=finalScene.objects.find(o=>o.name===s.object.name&&o.kind===s.object.kind);if(!finalObject)throw Error('Could not identify the wrapped shape.');const b=finalObject.bbox;after=resizeShape(after,finalScene,finalObject,{width:b.width,height:b.height,center:{x:s.object.bbox.x+b.width/2,y:s.object.bbox.y+s.object.bbox.height-b.height/2}}).source;}
      option={...option,label:'Resize and wrap label',source:after,patch:{base:s.source,start:0,end:new TextEncoder().encode(s.source).length,expected:s.source,text:after}};
    }
    return {...option,sizingPreference:{mode,text:original}};
  }
  const horizontalOnly=handle=>handle==='e'||handle==='w';
  const dragPolicy=(s,handle)=>s.sizing?.mode==='grow'?(horizontalOnly(handle)&&s.object.kind==='box'?'wrap':'fixed'):s.sizing?.mode==='wrap'&&!horizontalOnly(handle)?'fixed':s.sizing?.mode||'fixed';
  function reconnectStart(which){closeInspector();setMode(which);}
  function setMode(next){cancel(false);if(next!=='select'&&!getState().valid){status('Render valid source before using canvas tools.');return;}mode=next;modeKey=getState().key;stopPan();sync();status(next==='marquee'?'Drag a rectangle around shapes. Escape cancels; the object list is a tap/keyboard alternative.':next==='place'?'Tap the canvas to place a '+kinds.select.value+'. Escape cancels.':next==='connect'?'Choose the first shape, then the destination.':next==='from'?'Reconnecting the start. Choose the destination shape; Escape cancels.':next==='to'?'Reconnecting the arrowhead. Choose the destination shape; Escape cancels.':'Select and drag shapes.');}
  function cancel(announce=true){if(dialogSession)closeText();++epoch;invalidate?.();pending=null;if(resize)liveClear?.();resize=null;startShape=null;mode='select';modeKey=null;if(announce)stopPan();host.querySelectorAll('.canvas-preview').forEach(n=>n.remove());sync();if(announce)status('Cancelled. No change applied.');}
  function point(event){const s=getState(),svg=host.querySelector('svg');if(!svg?.getScreenCTM())return {x:0,y:0};const t=s.scene.transform;return new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse()).matrixTransform(new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]).inverse());}
  function drawPoint(p){const t=getState().scene.transform;return new DOMPoint(p.x,p.y).matrixTransform(new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]));}
  function nearestAnchor(object,p){return Object.entries(object.anchors||{}).filter(([a])=>['n','s','e','w'].includes(a)).sort((a,b)=>Math.hypot(a[1].x-p.x,a[1].y-p.y)-Math.hypot(b[1].x-p.x,b[1].y-p.y))[0]?.[0]||'c';}
  async function placeAt(e){const s=getState();if(!s.valid)return;const raw=point(e),p={x:Math.round(raw.x*20)/20,y:Math.round(raw.y*20)/20};try{const ok=await submit(createShape(s.source,s.scene,{kind:kinds.select.value,label:'',x:p.x,y:p.y}),s);if(ok&&!repeat.checked)setMode('select');}catch(error){status(error.message);}}
  function sync(){
    const s=getState(),o=s.object,arrow=['arrow','line'].includes(o?.kind);
    if(['connect','from','to'].includes(mode)&&modeKey!==s.key){mode='select';startShape=null;pending=null;}
    const panning=document.querySelector('#pan-mode')?.getAttribute('aria-pressed')==='true';
    selectTool.setAttribute('aria-pressed',String(mode==='select'&&!panning));panTool.setAttribute('aria-pressed',String(panning));textTool.setAttribute('aria-pressed',String(mode==='place'&&kinds.select.value==='text'));
    place.setAttribute('aria-pressed',String(mode==='place'&&kinds.select.value!=='text'));connect.setAttribute('aria-pressed',String(mode==='connect'));
    marquee.setAttribute('aria-pressed',String(mode==='marquee'));
    kinds.field.hidden=mode!=='place'||kinds.select.value==='text';
    toolState.textContent=panning?'Pan':mode==='select'?'Select':mode==='marquee'?'Drag a selection area':mode==='connect'?(startShape?'Choose destination':'Choose first shape'):mode==='place'?'Place '+kinds.select.value:'Choose '+mode+' target';
    toolbar.dataset.mode=mode;host.dataset.tool=mode;
    neighbor.disabled=!s.valid||!o||arrow||!o.name;place.disabled=connect.disabled=!s.valid;
    // Sizing edits one object: with a group selected it would silently act on
    // the last-clicked member, so it is offered only for a single selection.
    let resizable=false;if(s.valid&&o&&!s.multiple){try{resizeShape(s.source,s.scene,o,{width:o.bbox.width,height:o.bbox.height});resizable=true;}catch{}}
    sizing.hidden=!resizable;
    if(resizable){
      const key=fieldKey(s),mode=s.sizing?.mode||'fixed';
      if(typed!==key){typed=null;showError('');sizeWidth.value=Number(o.bbox.width.toFixed(3));sizeHeight.value=Number(o.bbox.height.toFixed(3));}
      for(const b of fitButtons){b.setAttribute('aria-pressed',String(b.dataset.value===mode));b.disabled=b.dataset.value==='wrap'&&o.kind!=='box';}
      fitButtons[1].title=o.kind==='box'?'The label wraps to the shape width; the height grows':'Only boxes wrap their label';
      sizeWidth.disabled=mode==='grow';sizeHeight.disabled=mode!=='fixed';syncLock(o);
    }
    sizeWarning.hidden=true;if(resizable){const a=drawPoint({x:o.bbox.x,y:o.bbox.y+o.bbox.height}),b=drawPoint({x:o.bbox.x+o.bbox.width,y:o.bbox.y});try{const overflow=[...host.querySelectorAll(`[data-pikchr-id="${o.id}"] text`)].some(text=>{const r=text.getBBox();return r.x<a.x-.5||r.y<a.y-.5||r.x+r.width>b.x+.5||r.y+r.height>b.y+.5;});if(overflow){sizeWarning.hidden=false;sizeWarning.textContent='Text exceeds shape: choose Grow or Wrap.';}}catch{}}
    drawHandles();
  }
  function drawHandles(){
    const svg=host.querySelector('svg'),s=snapshot(),o=s.object;svg?.querySelector('.canvas-overlay')?.remove();
    if(!svg||!s.valid||!o||mode!=='select'||s.multiple||dialogSession)return;
    try{resizeShape(s.source,s.scene,o,{width:o.bbox.width,height:o.bbox.height});}catch{return;}
    const layer=svgElement('g',{class:'canvas-overlay'}),scale=Math.hypot(svg.getScreenCTM()?.a||1,svg.getScreenCTM()?.b||0);
    // Four visible corner handles plus a grab strip along each edge. The
    // edge midpoints stay free for the connector attach dots.
    const B=o.bbox,L=B.x,R=B.x+B.width,Bot=B.y,T=B.y+B.height,hit=(matchMedia('(pointer:coarse)').matches?44:18)/scale;
    const cursors={n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize',ne:'nesw-resize',sw:'nesw-resize',nw:'nwse-resize',se:'nwse-resize'};
    const labels={n:'top edge',s:'bottom edge',e:'right edge',w:'left edge',ne:'top-right corner',nw:'top-left corner',se:'bottom-right corner',sw:'bottom-left corner'};
    const at={n:[o.center.x,T],s:[o.center.x,Bot],e:[R,o.center.y],w:[L,o.center.y],ne:[R,T],nw:[L,T],se:[R,Bot],sw:[L,Bot]};
    const make=name=>{
      const handle=svgElement('g',{'data-resize':name,role:'button',tabindex:0,'aria-label':'Resize from '+labels[name]});
      handle.style.pointerEvents='all';handle.style.cursor=cursors[name];
      handle.addEventListener('keydown',async e=>{
        const d={ArrowRight:[.1,0],ArrowLeft:[-.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}[e.key];if(!d)return;e.stopPropagation();e.preventDefault();
        const s2=snapshot();if(!s2.valid)return;
        const r=resizeBox({box:o.bbox,handle:name,pointer:{x:at[name][0]+d[0],y:at[name][1]+d[1]},grid:0,ratio:o.kind==='circle'?1:locked?o.bbox.width/o.bbox.height:null});
        try{await submit(await sizedCandidate(s2,{width:r.width,height:r.height,center:r.center},dragPolicy(s2,name)),s2);}catch(error){status(error.message);}
      });
      return handle;
    };
    for(const name of ['nw','ne','se','sw']){
      const p=drawPoint({x:at[name][0],y:at[name][1]}),handle=make(name);
      handle.append(svgElement('rect',{x:p.x-hit/2,y:p.y-hit/2,width:hit,height:hit,fill:'transparent'}),
        svgElement('rect',{class:'resize-corner',x:p.x-5/scale,y:p.y-5/scale,width:10/scale,height:10/scale,rx:2/scale,'vector-effect':'non-scaling-stroke'}));
      layer.append(handle);
    }
    // Edge strips run the full edge between the corner hit zones. Attach dots
    // (canvas layout) are drawn above this layer, so they still win.
    const a=drawPoint({x:L,y:T}),z=drawPoint({x:R,y:Bot}),band=(matchMedia('(pointer:coarse)').matches?44:10)/scale;
    const strips={n:[a.x,a.y,z.x,a.y],s:[a.x,z.y,z.x,z.y],w:[a.x,a.y,a.x,z.y],e:[z.x,a.y,z.x,z.y]};
    for(const [name,[x1,y1,x2,y2]] of Object.entries(strips)){
      const handle=make(name),horiz=y1===y2;
      const x=horiz?Math.min(x1,x2)+hit/2:x1-band/2,y=horiz?y1-band/2:Math.min(y1,y2)+hit/2;
      handle.append(svgElement('rect',{x,y,width:horiz?Math.max(0,Math.abs(x2-x1)-hit):band,height:horiz?band:Math.max(0,Math.abs(y2-y1)-hit),fill:'transparent'}));
      layer.prepend(handle);
    }
    const dots=svg.querySelector('.cl-dots');if(dots)svg.insertBefore(layer,dots);else svg.append(layer);
  }
  host.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('input,textarea,select'))return;
    const handle=e.target.closest('[data-resize]');if(!handle&&mode==='select')return;
    e.preventDefault();e.stopPropagation();const s=snapshot();if(!s.valid)return;
    if(handle){resize={pointerId:e.pointerId,s,handle:handle.dataset.resize,p:point(e)};host.setPointerCapture(e.pointerId);}
    else pending={pointerId:e.pointerId,x:e.clientX,y:e.clientY,target:e.target.closest('[data-pikchr-id]')?.getAttribute('data-pikchr-id'),p:point(e),s};
  },true);
  host.addEventListener('pointermove',e=>{
    if(mode==='marquee'&&pending?.pointerId===e.pointerId){const p=point(e),a=drawPoint(pending.p),b=drawPoint(p);pending.end=p;host.querySelector('.canvas-preview')?.remove();host.querySelector('svg')?.append(svgElement('rect',{class:'canvas-preview',x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y),fill:'#ddf4ff','fill-opacity':'.3',stroke:'#0969da','vector-effect':'non-scaling-stroke','pointer-events':'none'}));e.preventDefault();e.stopPropagation();return;}
    if(!resize||resize.pointerId!==e.pointerId)return;e.preventDefault();e.stopPropagation();
    const {s,handle}=resize,o=s.object,p=point(e),b=o.bbox;
    // Opposite side stays fixed; Shift keeps the aspect ratio, Alt resizes
    // from the center. Moving edges snap to other shapes, else to the grid.
    const others=s.scene.objects.filter(n=>n.id!==o.id&&n.bbox&&!['arrow','line','spline','arc','move'].includes(n.kind));
    const ratio=o.kind==='circle'?1:(e.shiftKey||locked)?b.width/b.height:null;
    const r=resizeBox({box:b,handle,pointer:p,ratio,fromCenter:e.altKey,others:snap.checked?others:[],grid:snap.checked?.05:0});
    const w=r.width,h=r.height;
    resize.dimensions={width:w,height:h,center:r.center};
    host.querySelectorAll('.canvas-preview').forEach(node=>node.remove());const a=drawPoint({x:r.x,y:r.y+h}),z=drawPoint({x:r.x+w,y:r.y});
    host.querySelector('svg')?.append(svgElement('rect',{class:'canvas-preview',x:a.x,y:a.y,width:z.x-a.x,height:z.y-a.y,fill:'none',stroke:'var(--accent,#0969da)','stroke-dasharray':'5 3','vector-effect':'non-scaling-stroke','pointer-events':'none'}));
    for(const g of r.guides){const q=g.other.bbox,along=g.axis==='x',lo=along?Math.min(r.y,q.y):Math.min(r.x,q.x),hi=along?Math.max(r.y+h,q.y+q.height):Math.max(r.x+w,q.x+q.width);
      const p1=drawPoint(along?{x:g.value,y:lo}:{x:lo,y:g.value}),p2=drawPoint(along?{x:g.value,y:hi}:{x:hi,y:g.value});
      host.querySelector('svg')?.append(svgElement('line',{class:'canvas-preview resize-guide',x1:p1.x,y1:p1.y,x2:p2.x,y2:p2.y,stroke:'var(--danger,#cf222e)','stroke-dasharray':'4 3','vector-effect':'non-scaling-stroke','pointer-events':'none'}));}
    if(livePreview){try{livePreview(resizeShape(s.source,s.scene,o,{width:w,height:h,center:r.center}).source);}catch{}}
    toolState.textContent=w.toFixed(2)+' × '+h.toFixed(2)+' in · '+(dragPolicy(s,handle)==='wrap'?'label will rewrap':'fixed size')+' · release to validate';
  },true);
  host.addEventListener('pointerup',async e=>{
    if(resize?.pointerId===e.pointerId){e.preventDefault();e.stopPropagation();const r=resize;resize=null;liveClear?.();host.querySelectorAll('.canvas-preview').forEach(node=>node.remove());try{if(r.dimensions)await submit(await sizedCandidate(r.s,r.dimensions,dragPolicy(r.s,r.handle)),r.s);}catch(error){status(error.message);}sync();return;}
    if(pending?.pointerId!==e.pointerId)return;const p=pending;pending=null;e.preventDefault();e.stopPropagation();
    if(mode==='marquee'){const z=p.end||p.p,x1=Math.min(z.x,p.p.x),x2=Math.max(z.x,p.p.x),y1=Math.min(z.y,p.p.y),y2=Math.max(z.y,p.p.y);const ids=p.s.scene.objects.filter(o=>!['line','arrow'].includes(o.kind)&&o.bbox.x>=x1&&o.bbox.y>=y1&&o.bbox.x+o.bbox.width<=x2&&o.bbox.y+o.bbox.height<=y2).map(o=>o.id);setMode('select');selectMany(ids);status(ids.length+' shapes selected. Copy selection includes their internal connectors.');return;}
    if(Math.hypot(p.x-e.clientX,p.y-e.clientY)>8)return;
    if(mode==='place'){await placeAt(e);return;}
    const target=p.s.scene.objects.find(o=>o.id===p.target);if(!target){setMode('select');status('Choose a named shape, not empty canvas.');return;}
    const available=connectableShapes(p.s.source,p.s.scene);
    if(!available.includes(target)){setMode('select');status((mode==='from'||mode==='to'?'Reconnecting cancelled. ':'')+'This object cannot be used as a connection target. Choose a named top-level shape.');return;}
    try{
      if(mode==='connect'){
        if(!startShape){startShape=target;select(target.id);sync();status('Start: '+target.name+'. Choose the destination.');return;}
        const start=startShape;const option=createConnector(p.s.source,p.s.scene,{fromId:start.id,fromAnchor:nearestAnchor(start,target.center),toId:target.id,toAnchor:nearestAnchor(target,start.center)});
        const connected=await submit(option,p.s);setMode('select');
        if(connected)status('Connected '+(start.name||start.kind)+' to '+(target.name||target.kind)+'. Select the connector to restyle or reconnect it.');
      }else if(mode==='from'||mode==='to'){
        const which=mode;
        const options=endpointCandidates(p.s.source,p.s.object,p.s.scene,which,target,nearestAnchor(target,p.p));
        setMode('select');
        if(!options.length){
          const later=target.span?.start>=p.s.object.span?.end;
          status('Reconnecting cancelled. '+(target.name||target.kind)+(later?' is defined later in the source and this route cannot be moved past it.':' cannot be used as an endpoint target here.')+' Edit the connector in source.');
          return;
        }
        // The status names the change, not the tool it returned to.
        if(await propose(p.s.object,options.slice(0,1)))status('Reconnected the '+(which==='from'?'start':'arrowhead')+' to '+(target.name||target.kind)+'.');
      }
    }catch(error){status(error.message);}
  },true);
  host.addEventListener('pointercancel',()=>cancel(false));
  host.addEventListener('lostpointercapture',()=>{if(resize){resize=null;liveClear?.();host.querySelectorAll('.canvas-preview').forEach(node=>node.remove());sync();}});
  host.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();const idle=mode==='select'&&!resize&&!pending&&!dialogSession;cancel();if(idle)clearSelection?.();}else if(e.key==='Enter'&&mode==='select'&&!e.target.closest('[data-resize]')){e.preventDefault();editText();}},true);
  window.addEventListener('blur',()=>{if(resize||pending)cancel(false);});

  function editText(){
    cancel(false);const s=snapshot();if(!s.valid||!s.object)return;
    let props;try{props=inspectProperties(s.source,s.object,s.scene);}catch(error){status(error.message);return;}
    const canGrow=!['line','arrow','text'].includes(s.object.kind);
    policy.select.querySelector('[value="grow"]').disabled=!canGrow;
    policy.select.querySelector('[value="wrap"]').disabled=s.object.kind!=='box';
    input.value=s.sizing?.text??props.text;policy.select.value=s.sizing?.mode||(canGrow?'grow':'fixed');width.value=s.object.bbox.width.toFixed(3);widthLabel.hidden=policy.select.value!=='wrap';
    dialogSession={s,version:0,candidate:null,original:host.innerHTML,viewBox:host.querySelector('svg')?.getAttribute('viewBox')};message.textContent='Preparing preview…';done.disabled=true;
    document.body.classList.remove('inspector-open','objects-open','creation-open');dialog.showModal();input.focus();input.select();previewText();
  }
  async function previewText(){
    const session=dialogSession;if(!session)return;const version=++session.version;done.disabled=true;
    const isCurrent=()=>dialogSession===session&&version===session.version&&validSnapshot(session.s);
    try{
      const measured=async text=>{if(!isCurrent())throw Error('Preview superseded.');return render(text);};
      const candidate=await buildTextEdit(session.s.source,session.s.scene,session.s.object,{text:input.value,mode:policy.select.value,width:Number(width.value)},measured);
      const result=await measured(candidate.source);if(!isCurrent())return;if(result.error||!result.svg)throw Error(result.error||'No diagram returned.');
      session.candidate={...candidate,sizingPreference:{mode:policy.select.value,text:input.value}};host.innerHTML=result.svg;host.querySelector('svg')?.setAttribute('preserveAspectRatio','xMidYMid meet');
      // Native output may have a different origin after text grows. Fit its
      // own viewBox for preview; restore the exact user's view on cancel.
      const svg=host.querySelector('svg');
      // The canvas layout keeps the author's current view: map the old viewBox
      // through model space into the candidate's pixel space.
      const t0=session.s.scene?.transform,t1=result.transform;
      if(svg&&session.viewBox&&t0?.a&&t0?.d&&t1){
        const[x,y,w,h]=session.viewBox.split(/[ ,]+/).map(Number),map=(px,py)=>({x:t1.a*(px-t0.e)/t0.a+t1.e,y:t1.d*(py-t0.f)/t0.d+t1.f});
        const p=map(x,y),q=map(x+w,y+h);svg.setAttribute('viewBox',[Math.min(p.x,q.x),Math.min(p.y,q.y),Math.abs(q.x-p.x),Math.abs(q.y-p.y)].join(' '));
      }else if(svg){const[x,y,w,h]=svg.getAttribute('viewBox').split(/[ ,]+/).map(Number),cw=Math.max(640,w),ch=Math.max(360,h);svg.setAttribute('viewBox',[x-(cw-w)/2,y-(ch-h)/2,cw,ch].join(' '));}
      message.textContent=policy.select.value==='fixed'?'Preview only. Fixed size can overflow; choose Grow or Wrap to contain the label.':'Preview only. Done validates and saves one change.';
      done.disabled=false;
    }catch(error){if(isCurrent()){message.textContent=error.message;session.candidate=null;}}
  }
  function closeText(){clearTimeout(timer);const session=dialogSession;if(!session)return;dialogSession=null;dialog.close();if(validSnapshot(session.s))host.innerHTML=session.original;host.focus({preventScroll:true});getState().rebind?.();sync();}
  async function finishText(){const session=dialogSession;if(!session?.candidate||done.disabled)return;const candidate=session.candidate;closeText();await submit(candidate,session.s);host.focus({preventScroll:true});}
  sync();
  return {sync,cancel,editText,sizing,reconnect:which=>reconnectStart(which==='start'?'from':'to'),ownsPointer:()=>mode!=='select'||!!dialogSession,busy:()=>!!dialogSession};
}
