import {candidates,snap,applyPatch,byteOffsetToIndex} from './edits.js?v=20260923c';
import {alignmentGuides,gapMarks} from './guides.js?v=20260923c';
import {constrainDrag,smartSnap} from './constrain.js?v=20260923c';
const params=new URL(location.href).searchParams;
import {arrowEditor} from './arrow-ui.js?v=20260923c';
import {creationTools,shapeTypeEditor} from './creation-ui.js?v=20260923c';
import {propertyEditor} from './property-ui.js?v=20260923c';
import {fitText,canFitText,inspectProperties,readProperties} from './properties.js?v=20260923c';
import {duplicateObject,deleteObjects,layoutObjects,moveObjects,pinMove} from './object-actions.js?v=20260923c';
import {createDocumentStore} from './documents.js?v=20260923c';
import {canvasNavigation,clampZoom} from './canvas-navigation.js?v=20260923c';
import {examplePicker} from './example-picker.js?v=20260923c';
import {canvasTools} from './canvas-tools.js?v=20260923c';
import {copySelection,pasteSelection} from './subgraph.js?v=20260923c';
import {createComponentLibrary} from './component-library.js?v=20260923c';
import {exportWorkspace,parseWorkspace} from './workspace-backup.js?v=20260923c';
import {tidyRouteCandidate} from './route-suggestions.js?v=20260923c';
import {createCandidateReview} from './candidate-review.js?v=20260923c';
import {cleanSVG,downloadPNG} from './diagram-export.js?v=20260923c';
import {readSizingPreference,writeSizingPreference} from './sizing-preferences.js?v=20260923c';
const $=id=>document.getElementById(id);
const examples={
  pipeline:'Client: box "Client" at (0,0)\nAPI: box "API" at (2,0)\nDatabase: cylinder "Database" at (4,0)\narrow from Client.e to API.w\narrow from API.e to Database.w\n',
  unicode:'# UTF-8 source offsets must preserve these labels.\nClient: box "Café ☕" at (0,0)\nStore: cylinder "資料" at (2,0)\narrow from Client.e to Store.w\n',
  nested:'Group: [\n  A: box "Inside a group"\n  arrow\n  B: cylinder "Read only"\n]\n'
};
const source=$('source');
source.value=examples.pipeline;
let worker,requests=new Map(),requestId=0,revision=0,scene=null,renderedSource='',selectedId=null,proposal=null,gesture=0,preview=null;
const undo=[],redo=[];
const draft=[];
const draftRedo=[];
let cancelCanvasEdit=()=>{},manualEditBase=null;
let draftBase=null;
let rendering=false,renderVersion=0;
const selectionHistory=new Map();
let requestedSelectionName=null;
let requestedSelectionId=null,applied=false;
let selectedIds=new Set(),zoom=1,pan={x:0,y:0},panMode=false;
let multiSelect=false;
let directTools=null;
let routeReview=null,clipboardFragment=null,pasteCount=0;
let sizingPreferences={};
let viewportDocumentId=null;
const componentLibrary=createComponentLibrary();
// Advanced tools (components, document store, arrange, shape conversion) stay
// out of the way until asked for, so the core drag-to-source loop is the product.
let advanced=params.get('advanced')==='1'||(()=>{try{return localStorage.getItem('pikchr-studio-advanced')==='1';}catch{return false;}})();
function applyAdvanced(){document.body.classList.toggle('advanced',advanced);$('advanced-mode').checked=advanced;}
$('advanced-mode').onchange=()=>{advanced=$('advanced-mode').checked;try{localStorage.setItem('pikchr-studio-advanced',advanced?'1':'0');}catch{}applyAdvanced();status(advanced?'Advanced tools shown.':'Advanced tools hidden.');};
applyAdvanced();
// inspector-open / objects-open ask the layout to open the ⋯ inspector popover.
function openInspector(){document.body.classList.remove('objects-open','creation-open');document.body.classList.add('inspector-open');$('inspector').scrollIntoView({block:'nearest'});}
$('mobile-objects').onclick=()=>{document.body.classList.remove('inspector-open','creation-open');document.body.classList.toggle('objects-open');document.querySelector('#objects').closest('details').open=true;};
$('mobile-add').onclick=()=>document.body.classList.toggle('creation-open');
$('multi-select').onclick=()=>{multiSelect=!multiSelect;$('multi-select').setAttribute('aria-pressed',String(multiSelect));status(multiSelect?'Tap objects to add or remove them from the selection.':'Single selection. Drag selected objects to move them.');};
$('clear-selection').onclick=()=>select(null);
for(const [id,dx,dy]of [['left',-.1,0],['right',.1,0],['up',0,.1],['down',0,-.1]])$('move-'+id).onclick=()=>{const o=current();if(o)suggest(o,{x:o.center.x+dx,y:o.center.y+dy});};
let storageReady=false,saveTimer=null,activeDocumentId=null,activeDocumentTitle=null;
const documents=createDocumentStore();
function persistDocument(){
  if(!storageReady)return {ok:false,error:'Document storage is not ready.'};
  clearTimeout(saveTimer);
  const result=documents.save({source:source.value,draft:[...draft],draftRedo:[...draftRedo],draftBase,undo:[...undo],redo:[...redo],autoApply:$('auto-apply').checked,applied,sizingPreferences,...(activeDocumentTitle?{title:activeDocumentTitle}:{})});
  $('save-state').textContent=result.ok?'Saved on this browser':'Not saved: '+result.error;
  $('save-state').dataset.state=result.ok?'saved':'error';
  if(result.ok)refreshDocuments();
  return result;
}
function scheduleSave(){if(!storageReady)return;$('save-state').textContent='Saving…';clearTimeout(saveTimer);saveTimer=setTimeout(persistDocument,200);}
function refreshDocuments(){
  const active=activeDocumentId;const entries=documents.list();
  $('documents').replaceChildren();for(const item of entries){const option=document.createElement('option');option.value=item.id;option.textContent=item.title;$('documents').append(option);}
  if(entries.some(item=>item.id===active))$('documents').value=active;
}
let statusTimer=null;
const status=text=>{ $('state').textContent=text;$('state').title=text;clearTimeout(statusTimer);statusTimer=setTimeout(()=>{$('canvas-feedback').textContent=text;},120); };
const announceError=text=>{$('diagnostic').textContent=text;};
function modeHint(){
  document.querySelector('.diagram-pane .hint').textContent=$('auto-apply').checked
    ?'Auto-apply is on. Accepted changes update the source immediately; Undo reverses them. Groups and macros are inspect-only.'
    :'Drag a shape to preview ranked source edits, accept one, then Apply all to commit or Discard all to restore the original. Groups and macros are inspect-only.';
}
$('auto-apply').onchange=()=>{try{localStorage.setItem('pikchr-studio.queue-mode',$('auto-apply').checked?'0':'1');}catch{}draftRedo.length=0;modeHint();historyButtons();installArrowEditor();scheduleSave();status($('auto-apply').checked?'Auto-apply enabled. Each validated change is undoable.':'Queue mode enabled. Review the draft before Apply all.');};
function startWorker(){
  worker=new Worker('worker.js');
  worker.onmessage=({data})=>{const entry=requests.get(data.id);if(!entry)return;clearTimeout(entry.timer);requests.delete(data.id);entry.resolve(data.result);};
  worker.onerror=()=>failWorker('Renderer failed to load. Check that the app has been built and reload.',true);
}
// The WebAssembly renderer could not start (offline, blocked, or a broken
// deploy). Say so on the canvas instead of calling the source invalid.
function showRendererDown(){
  const d=$('diagram');d.classList.add('renderer-down');
  if(!d.querySelector('.renderer-down-card')){
    const card=document.createElement('div');card.className='renderer-down-card';card.setAttribute('role','alert');
    const h=document.createElement('h2');h.textContent='The diagram renderer could not load';
    const p=document.createElement('p');p.textContent='Pikchr Studio draws diagrams with WebAssembly, and it did not start. Check your connection and reload. Your diagram is saved in this browser.';
    const b=document.createElement('button');b.type='button';b.textContent='Reload';b.onclick=()=>location.reload();
    card.append(h,p,b);d.append(card);
  }
  status('The diagram renderer could not load. Reload to try again.');
}
function failWorker(message,unavailable=false){
  worker.terminate();
  for(const entry of requests.values()){clearTimeout(entry.timer);entry.resolve(unavailable?{error:message,unavailable}:{error:message});}
  requests.clear();startWorker();
}
// Canvas layout renders with Pikchr's dark-mode flag when the page is dark;
// exports always re-render with the default light flags.
let renderFlags=1;
function render(text,flags=renderFlags){
  return new Promise(resolve=>{
    const id=++requestId;
    const timer=setTimeout(()=>failWorker('Rendering exceeded 5 seconds. Simplify the source and retry.'),5000);
    requests.set(id,{resolve,timer});
    worker.postMessage({id,source:text,flags});
  });
}
startWorker();
const current=()=>scene?.objects.find(o=>o.id===selectedId);
function sizingFor(object){if(!object)return null;const saved=readSizingPreference(source.value,scene,object,sizingPreferences);if(saved)return saved;try{const props=inspectProperties(source.value,object,scene);if(/\bfit\b/.test(readProperties(source.value,object,scene).statement.replace(/"[^"\n]*"/g,'')))return{mode:'grow',text:props.text,width:object.bbox.width};}catch{}return null;}
function clearProposal(){
  ++gesture;proposal=null;
  const had=preview;if(had)restoreViewBox();preview=null;
  $('preview-actions').hidden=true;$('diagram').classList.remove('previewing');
  $('suggestions').textContent='Drag a shape or reconnect an endpoint to see ranked source edits.';
  updateDraft();
  if(had&&!rendering&&scene)renderSource(scene);
}
function updateDraft(){
  const pending=draft.length>0;
  source.readOnly=pending;
  $('source-label').textContent=pending?'Draft source':'Source';
  $('download').textContent=pending?'Download draft':'Download source';
  $('queue-status').textContent=pending?`${draft.length} queued ${draft.length===1?'change':'changes'} · Not applied`:applied?'Applied · No pending changes':'No queued changes';
  $('queue-status').dataset.state=pending?'draft':applied?'applied':'clean';
  $('auto-apply').disabled=pending;
  $('accept').disabled=!pending||rendering;$('cancel').disabled=!pending||rendering;$('undo-draft').disabled=!pending||rendering;
  $('queue-list').replaceChildren();
  for(const item of draft){const li=document.createElement('li');li.textContent=item.label;$('queue-list').append(li);}
  if(!preview)$('diff').textContent=draft.at(-1)?.diff||'';
  if(pending)document.querySelector('.draft-toolbar').open=true;
  $('impact').textContent=pending?'Source and diagram include every queued change.':'';
  $('batch-diff').textContent=pending?'Before batch\n'+draftBase+'\nAfter batch\n'+source.value:'';
  document.querySelector('.draft-toolbar .actions').hidden=$('auto-apply').checked&&!pending;
  historyButtons();
  scheduleSave();
}
function dirty(){
  applied=false;
  $('fit-text').disabled=true;
  ++revision;clearProposal();$('diagram').classList.add('stale');status('Source changed. Rendering…');announceError('');
}
source.addEventListener('input',()=>{
  directTools?.cancel(false);
  if(draft.length){source.value=draft.at(-1).after;status('Apply or discard the queued changes before editing source text.');return;}
  if(manualEditBase===null)manualEditBase=renderedSource;
  draftRedo.length=0;dirty();
  clearTimeout(autoRender);autoRender=setTimeout(()=>{if(!draft.length&&!rendering&&(source.value!==renderedSource||$('diagram').classList.contains('stale')))renderSource();},300);
});
let autoRender=null;
source.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();renderSource();}});
async function renderSource(preRendered=null){
  routeReview?.cancel();
  if(directTools?.busy())directTools.cancel(false);
  const oldSvg=$('diagram').querySelector('svg');let oldViewport=null;
  if(viewportDocumentId===activeDocumentId&&scene&&oldSvg?.dataset.baseViewBox){const[x,y,w,h]=oldSvg.getAttribute('viewBox').split(/[ ,]+/).map(Number),base=oldSvg.dataset.baseViewBox.split(/[ ,]+/).map(Number);oldViewport={center:new DOMPoint(x+w/2,y+h/2).matrixTransform(matrix().inverse()),baseWidth:base[2],baseHeight:base[3],scale:Math.abs(scene.transform.a),zoom};}
  const focused=document.activeElement,focusResize=focused?.getAttribute('data-resize'),focusLabel=focused?.getAttribute('aria-label'),focusText=focused?.tagName==='BUTTON'?focused.textContent:null;
  const token=++renderVersion;rendering=true;
  const selectedNames=[...selectedIds].map(id=>scene?.objects.find(o=>o.id===id)?.name).filter(Boolean);
  clearProposal();const rev=revision,text=source.value,name=current()?.name,oldId=selectedId,oldKind=current()?.kind,oldSource=renderedSource;
  const desiredName=requestedSelectionName;requestedSelectionName=null;
  const desiredId=requestedSelectionId;requestedSelectionId=null;
  if(current())selectionHistory.set(oldSource,{id:oldId,kind:oldKind});
  status('Rendering…');const result=preRendered?.svg?preRendered:await render(text);
  if(token!==renderVersion)return;
  rendering=false;updateDraft();
  if(rev!==revision)return;
  if(result.unavailable){showRendererDown();return;}
  $('diagram').classList.remove('renderer-down');$('diagram').querySelector('.renderer-down-card')?.remove();
  if(result.error||!result.svg){announceError(result.error||'No diagram returned.');$('diagram').classList.add('stale');status('Invalid source. Last valid diagram retained; editing disabled.');return;}
  scene=result;
  if(manualEditBase!==null){if(manualEditBase!==text){undo.push(manualEditBase);redo.length=0;}manualEditBase=null;historyButtons();}
  for(const o of scene.objects){if(o.kind==='text'&&candidates(text,o,scene,o.center).length)o.editable=true;if(o.editable&&!candidates(text,o,scene,o.center).length){o.editable=false;o.reason='Placement or attributes are outside the supported literal subset.';}}
  renderedSource=text;$('diagram').innerHTML=result.svg;$('diagram').classList.remove('stale','previewing');announceError('');
  modeHint();
  const matches=scene.objects.filter(o=>o.name&&o.name===(desiredName||name));
  const saved=selectionHistory.get(text);
  selectedId=desiredName?matches[0]?.id:desiredId?scene.objects.find(o=>o.id===desiredId)?.id:saved?scene.objects.find(o=>o.id===saved.id&&o.kind===saved.kind)?.id:
    matches.length===1?matches[0].id:(!name&&(undo.at(-1)===oldSource||draft.at(-1)?.before===oldSource)?scene.objects.find(o=>o.id===oldId&&o.kind===oldKind)?.id:null);
  selectedIds=new Set(scene.objects.filter(o=>selectedNames.includes(o.name)).map(o=>o.id));
  if(desiredName||desiredId)selectedIds=new Set(selectedId?[selectedId]:[]);
  const svg=$('diagram').querySelector('svg');
  const openTools=[...$('creation-tools').querySelectorAll('details')].map(d=>d.open);
  creationTools({scene,source:text,host:$('creation-tools'),propose:options=>validateSuggestions(null,options),status,
    valid:()=>source.value===renderedSource&&!$('diagram').classList.contains('stale')});
  [...$('creation-tools').querySelectorAll('details')].forEach((d,i)=>{d.open=!!openTools[i];});
  populateObjects();select(selectedId,false,false,true);
  if(!svg){$('diagram').textContent='No objects yet. Open Add shape to start a diagram.';status('Valid empty diagram.');return;}
  svg.style.maxWidth='100%';svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  svg.dataset.exportViewBox=svg.getAttribute('viewBox');
  const [vx,vy,vw,vh]=svg.getAttribute('viewBox').split(/[ ,]+/).map(Number);
  svg.dataset.fitViewBox=fitBox(vx,vy,vw,vh);
  if(oldViewport){const ratio=Math.abs(scene.transform.a)/oldViewport.scale,w=oldViewport.baseWidth*ratio,h=oldViewport.baseHeight*ratio,center=svgPoint(oldViewport.center);svg.dataset.baseViewBox=[vx+vw/2-w/2,vy+vh/2-h/2,w,h].join(' ');pan={x:center.x-(vx+vw/2),y:center.y-(vy+vh/2)};zoom=oldViewport.zoom;}else svg.dataset.baseViewBox=svg.dataset.fitViewBox;
  viewportDocumentId=activeDocumentId;applyViewport();bindDiagram(svg);
  directTools?.sync();
  if(focusResize)svg.querySelector(`[data-resize="${focusResize}"]`)?.focus({preventScroll:true});
  status('Rendered '+scene.objects.length+' objects. Select one to inspect.');
  if(focusLabel||focusText){const replacement=[...document.querySelectorAll('#inspector input,#inspector textarea,#inspector button,#creation-tools input,#creation-tools button')].find(el=>focusLabel?el.getAttribute('aria-label')===focusLabel:el.textContent===focusText);replacement?.focus({preventScroll:true});}
}
// Fit to the stage so a diagram shows at natural size, never upscaled.
function fitBox(vx,vy,vw,vh){
  let bw=Math.max(640,vw),bh=Math.max(360,vh);
  const d=$('diagram'),cs=getComputedStyle(d);
  const w=d.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),h=d.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  if(w>0&&h>0){bw=Math.max(w,vw);bh=Math.max(h,vh);}
  return [vx-(bw-vw)/2,vy-(bh-vh)/2,bw,bh].join(' ');
}
async function exportSvgElement(){
  const svg=$('diagram').querySelector('svg');if(!svg)return null;
  if(renderFlags===1)return svg;
  const result=await render(renderedSource,1);
  if(result.error||!result.svg)throw Error(result.error||'The export render failed.');
  const light=new DOMParser().parseFromString(result.svg,'image/svg+xml').documentElement;
  if(light.nodeName!=='svg')throw Error('The export render failed.');
  light.dataset.exportViewBox=svg.dataset.exportViewBox||svg.getAttribute('viewBox');
  return light;
}
function populateObjects(){
  $('objects').replaceChildren();
  for(const o of scene.objects){
    const b=document.createElement('button'),group=$('diagram').querySelector(`[data-pikchr-id="${o.id}"]`);
    const label=[...(group?.querySelectorAll('text')||[])].map(t=>t.textContent).join(' ').replace(/\s+/g,' ').trim();
    b.textContent=(o.name||o.kind+' '+o.id)+(label?' · '+label:'');b.title=b.textContent;b.dataset.id=o.id;
    if(['arrow','line'].includes(o.kind)&&o.span){const statement=renderedSource.slice(byteOffsetToIndex(renderedSource,o.span.start),byteOffsetToIndex(renderedSource,o.span.end));const refs=[...statement.matchAll(/\b([A-Z][\w]*)\.(?:n|s|e|w|ne|nw|se|sw|c|center)\b/g)].map(m=>m[1]);if(refs.length>1)b.textContent+=' · '+refs[0]+' → '+refs.at(-1);}
    b.onclick=e=>select(o.id,false,multiSelect||e.shiftKey||e.metaKey||e.ctrlKey);$('objects').append(b);
  }
}
const fixed=n=>Number(n).toFixed(3);
function select(id,highlight=false,additive=false,preserve=false){
  if(id!==selectedId)clearProposal();
  if(additive){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);}
  else if(!preserve)selectedIds=new Set(id?[id]:[]);
  if(id&&!selectedIds.has(id)&&!additive)selectedIds.add(id);
  if(additive&&!selectedIds.has(id))id=[...selectedIds].at(-1)||null;
  selectedId=id;const o=current();
  document.body.classList.toggle('has-selection',!!o);document.body.classList.toggle('has-multiple',selectedIds.size>1);
  $('edit-selected').disabled=!o;
  $('fit-text').disabled=!o||source.value!==renderedSource||!canFitText(renderedSource,o,scene);
  $('fit-text').title=$('fit-text').disabled?'Select a supported shape with literal placement to fit its label':'Resize the selected shape to its text; connected arrows follow its anchors';
  for(const b of $('objects').children)b.setAttribute('aria-pressed',String(selectedIds.has(b.dataset.id)));
  $('selection-count').textContent=selectedIds.size?selectedIds.size+' selected':'No selection';
  $('duplicate-selected').disabled=!o;
  $('delete-selected').disabled=!selectedIds.size;
  $('appearance-selected').disabled=!o;
  $('route-selected').disabled=!o||!['arrow','line'].includes(o.kind);
  $('tidy-route').disabled=!o||!['arrow','line'].includes(o.kind);
  $('copy-selection').disabled=$('save-component').disabled=!selectedIds.size;
  $('show-source-selected').disabled=!o?.span;
  $('arrange').disabled=selectedIds.size<2;
  $('focus-selection').disabled=!selectedIds.size;
  $('inspector').replaceChildren();
  if(!o){$('inspector').textContent='Select an object in the diagram or object list.';drawOverlay();directTools?.sync();return;}
  const dl=document.createElement('dl');
  const details={
    Name:o.name||'(unnamed)',Type:o.kind,
    Center:fixed(o.center.x)+', '+fixed(o.center.y)+' in',
    Bounds:fixed(o.bbox.width)+' × '+fixed(o.bbox.height)+' in',
    Source:o.span?o.span.start+'–'+o.span.end+' UTF-8 bytes':'Origin unavailable',
    Editing:o.editable?'Placement suggestions available':o.reason||'Inspect only',
    Anchors:Object.keys(o.anchors||{}).join(', '),
    Dependencies:(o.dependencies?.map(id=>scene.objects.find(n=>n.id===id)?.name||id).join(', ')||'None')+(o.dependenciesComplete?'':' (endpoint references only)'),
    'Referenced by':scene.objects.filter(n=>n.dependencies?.includes(o.id)).map(n=>n.name||n.kind).join(', ')||'Nothing yet'
  };
  for(const [key,value]of Object.entries(details)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);}
  $('inspector').append(dl);
  shapeTypeEditor({object:o,scene,source:renderedSource,inspector:$('inspector'),propose:options=>validateSuggestions(o,options),status,
    valid:()=>source.value===renderedSource&&!$('diagram').classList.contains('stale')});
  drawOverlay();
  installArrowEditor();
  propertyEditor({object:o,scene,source:renderedSource,inspector:$('inspector'),propose:options=>validateSuggestions(o,options),status,
    valid:()=>source.value===renderedSource&&!$('diagram').classList.contains('stale')});
  directTools?.sync();
}
$('edit-selected').onclick=()=>directTools?.editText();
$('appearance-selected').onclick=()=>{openInspector();const section=$('inspector').querySelector('.appearance-editor');if(section){section.open=true;section.scrollIntoView({block:'nearest'});section.querySelector('input')?.focus({preventScroll:true});}};
$('route-selected').onclick=()=>{openInspector();const button=[...$('inspector').querySelectorAll('button')].find(b=>b.textContent==='Routing');button?.click();$('inspector').querySelector('.arrow-editor')?.scrollIntoView({block:'nearest'});};
$('show-source-selected').onclick=()=>{const o=current();if(!o?.span)return;source.focus();source.setSelectionRange(byteOffsetToIndex(source.value,o.span.start),byteOffsetToIndex(source.value,o.span.end));};
function action(fn){if(rendering||source.value!==renderedSource){status('Render the current source before editing.');return;}try{return validateSuggestions(current(),[fn()]);}catch(error){status(error.message);}}
$('duplicate-selected').onclick=()=>action(()=>duplicateObject(source.value,current(),scene));
$('delete-selected').title='Delete selected objects and attached connectors. Undo restores them.';
$('delete-selected').onclick=()=>action(()=>({...deleteObjects(source.value,scene.objects.filter(o=>selectedIds.has(o.id)),scene,{includeConnectors:true,pinDependents:true}),clearSelection:true}));
$('arrange').onclick=()=>action(()=>({...layoutObjects(source.value,scene.objects.filter(o=>selectedIds.has(o.id)),scene,$('layout-mode').value),selectionNames:scene.objects.filter(o=>selectedIds.has(o.id)).map(o=>o.name)}));
$('fit-text').onclick=()=>{
  const o=current();if(!o||source.value!==renderedSource)return;
  try{validateSuggestions(o,[fitText(renderedSource,o,scene)]);}catch(error){status(error.message);}
};
function installArrowEditor(){
  const svg=$('diagram').querySelector('svg'),o=current();
  if(!svg||!o||source.value!==renderedSource||$('diagram').classList.contains('stale'))return;
  svg.querySelector('.arrow-overlay')?.remove();
  $('inspector').querySelector('.arrow-editor')?.remove();
  const supported=arrowEditor({object:o,scene,source:source.value,svg,inspector:$('inspector'),
    autoApply:()=>$('auto-apply').checked,
    propose:options=>validateSuggestions(o,options),status,render,
    preview:(options,index,hooks)=>previewValidated(o,options,index,hooks),accept:acceptPreview,discard:discardPreview,
    valid:()=>source.value===renderedSource&&!$('diagram').classList.contains('stale'),clear:clearProposal});
  const routable=!!$('inspector').querySelector('.arrow-editor .connector-tabs');
  if(supported)for(const dt of $('inspector').querySelectorAll('dt'))if(dt.textContent==='Editing')dt.nextElementSibling.textContent=routable?'Use Route styles to restyle, Routing for paths and bends, or Endpoints to reconnect shape anchors.':'Use Route styles to restyle this connector.';
  if(!supported&&['arrow','line','spline','arc'].includes(o.kind))for(const dt of $('inspector').querySelectorAll('dt'))if(dt.textContent==='Editing')dt.nextElementSibling.textContent='Inspect only: connector editing requires explicit object references and a supported straight or Studio-generated route.';
}
const matrix=()=>{const t=scene.transform;return new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]);};
const svgPoint=p=>new DOMPoint(p.x,p.y).matrixTransform(matrix());
function svgElement(name,attrs){
  const e=document.createElementNS('http://www.w3.org/2000/svg',name);
  for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;
}
function drawOverlay(){
  const svg=$('diagram').querySelector('svg');if(!svg)return;
  svg.querySelector('.studio-overlay')?.remove();svg.querySelector('.arrow-overlay')?.remove();const o=current();if(!o)return;
  const layer=svgElement('g',{class:'studio-overlay'});
  for(const other of scene.objects.filter(n=>selectedIds.has(n.id)&&n.id!==o.id)){
    const p=svgPoint({x:other.bbox.x,y:other.bbox.y+other.bbox.height}),q=svgPoint({x:other.bbox.x+other.bbox.width,y:other.bbox.y});
    layer.append(svgElement('rect',{x:p.x-3,y:p.y-3,width:Math.max(6,q.x-p.x+6),height:Math.max(6,q.y-p.y+6),fill:'none',stroke:'#0969da','stroke-width':1.5,'vector-effect':'non-scaling-stroke','stroke-dasharray':'4 3'}));
  }
  const a=svgPoint({x:o.bbox.x,y:o.bbox.y+o.bbox.height}),b=svgPoint({x:o.bbox.x+o.bbox.width,y:o.bbox.y});
  const rect=svgElement('rect',{x:a.x-3,y:a.y-3,width:Math.max(6,b.x-a.x+6),height:Math.max(6,b.y-a.y+6),fill:'none',stroke:'#0969da','stroke-width':1.5,'vector-effect':'non-scaling-stroke','stroke-dasharray':'4 3'});
  layer.append(rect);
  if(['arrow','line'].includes(o.kind)){svg.append(layer);return;}
  if($('anchors').checked)for(const [name,point]of Object.entries(o.anchors||{})){
    if(!['n','s','e','w','c','center'].includes(name))continue;const p=svgPoint(point);
    layer.append(svgElement('circle',{cx:p.x,cy:p.y,r:3,fill:'#0969da'}));
    const text=svgElement('text',{x:p.x+6,y:p.y-6,fill:'#0969da','font-size':10});text.textContent=name;layer.append(text);
  }
  svg.append(layer);
}
$('anchors').onchange=()=>{drawOverlay();installArrowEditor();};
function applyViewport(){
  const svg=$('diagram').querySelector('svg');if(!svg?.dataset.baseViewBox)return;
  const [x,y,w,h]=svg.dataset.baseViewBox.split(/[ ,]+/).map(Number);
  svg.setAttribute('viewBox',[x+w/2-w/zoom/2+pan.x,y+h/2-h/zoom/2+pan.y,w/zoom,h/zoom].map(v=>Math.round(v*1e6)/1e6).join(' '));
  $('zoom-level').textContent=Math.round(zoom*100)+'%';
}
function panBy(dx,dy){
  const svg=$('diagram').querySelector('svg'),ctm=svg?.getScreenCTM();if(!ctm)return;
  const inv=ctm.inverse(),a=new DOMPoint(0,0).matrixTransform(inv),b=new DOMPoint(dx,dy).matrixTransform(inv);
  pan.x-=b.x-a.x;pan.y-=b.y-a.y;applyViewport();
}
function zoomAt(factor,x,y){
  const svg=$('diagram').querySelector('svg');if(!svg?.getScreenCTM()||!Number.isFinite(factor)||factor<=0)return;
  const bounds=svg.getBoundingClientRect();x??=bounds.x+bounds.width/2;y??=bounds.y+bounds.height/2;
  const point=()=>new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());
  const before=point();zoom=clampZoom(zoom*factor);applyViewport();const after=point();pan.x+=before.x-after.x;pan.y+=before.y-after.y;applyViewport();
}
const refreshHandles=()=>{drawOverlay();installArrowEditor();directTools?.sync();};
$('zoom-in').onclick=()=>{zoomAt(1.25);refreshHandles();};
$('zoom-out').onclick=()=>{zoomAt(1/1.25);refreshHandles();};
$('fit-view').onclick=()=>{const svg=$('diagram').querySelector('svg');if(svg?.dataset.fitViewBox)svg.dataset.baseViewBox=svg.dataset.fitViewBox;zoom=1;pan={x:0,y:0};applyViewport();refreshHandles();};
$('pan-mode').onclick=()=>{panMode=!panMode;$('pan-mode').setAttribute('aria-pressed',String(panMode));$('diagram').style.cursor=panMode?'grab':'';};
function selectNearby(e){
  const svg=$('diagram').querySelector('svg');if(!svg)return;
  // Containers are picked by their border only, never by a click inside them.
  const nearby=scene.objects.filter(o=>!['arrow','line','text'].includes(o.kind)).filter(o=>{
    const g=svg.querySelector(`[data-pikchr-id="${o.id}"]`);if(g?.dataset.container)return false;
    const r=g?.getBoundingClientRect();
    return r&&e.clientX>=r.left-Math.max(0,(44-r.width)/2)&&e.clientX<=r.right+Math.max(0,(44-r.width)/2)&&e.clientY>=r.top-Math.max(0,(44-r.height)/2)&&e.clientY<=r.bottom+Math.max(0,(44-r.height)/2);
  });
  if(nearby.length===1){select(nearby[0].id,false,multiSelect);return;}
  if(nearby.length>1){$('canvas-feedback').replaceChildren(document.createTextNode('Choose nearby object: '));for(const o of nearby){const b=document.createElement('button');b.textContent=o.name||o.kind;b.onclick=()=>{select(o.id,false,multiSelect);status('Selected '+(o.name||o.kind));};$('canvas-feedback').append(b);}return;}
  if(!multiSelect)select(null);
}
canvasNavigation($('diagram'),{panEnabled:()=>panMode,panBy,zoomAt,
  ownsPointer:e=>directTools?.ownsPointer()||!!e?.target?.closest?.('.cl-dots,.cl-line-handles')||false,
  cancelEdit:()=>{cancelCanvasEdit();clearProposal();},deselect:selectNearby,
  onMode:active=>$('diagram').classList.toggle('navigating',active),end:refreshHandles,
  // Drag on empty canvas with the Select tool draws a selection box. Shapes
  // and connectors fully inside are selected; Shift adds.
  marquee:{enabled:()=>true,finish:(rect,additive)=>{
    const svg=$('diagram').querySelector('svg');if(!svg||!scene)return;
    const toModel=(x,y)=>new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse()).matrixTransform(matrix().inverse());
    const a=toModel(rect.left,rect.bottom),b=toModel(rect.right,rect.top);
    const x1=Math.min(a.x,b.x),x2=Math.max(a.x,b.x),y1=Math.min(a.y,b.y),y2=Math.max(a.y,b.y);
    const hits=scene.objects.filter(o=>o.bbox&&o.bbox.x>=x1&&o.bbox.y>=y1&&o.bbox.x+o.bbox.width<=x2&&o.bbox.y+o.bbox.height<=y2).map(o=>o.id);
    selectedIds=new Set([...(additive?selectedIds:[]),...hits]);
    select([...selectedIds][0]||null,false,false,true);
    status(hits.length?hits.length+(hits.length===1?' object selected.':' objects selected.'):'Nothing inside the selection box.');
  }}});
$('focus-selection').onclick=()=>{
  const svg=$('diagram').querySelector('svg'),objects=scene?.objects.filter(o=>selectedIds.has(o.id));if(!svg||!objects?.length)return;
  const corners=objects.flatMap(o=>[svgPoint({x:o.bbox.x,y:o.bbox.y}),svgPoint({x:o.bbox.x+o.bbox.width,y:o.bbox.y+o.bbox.height})]);
  const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(...xs)-left,h=Math.max(...ys)-top;
  const [x,y,bw,bh]=svg.dataset.baseViewBox.split(/[ ,]+/).map(Number);
  zoom=clampZoom(Math.min(3,bw/Math.max(w*2,30),bh/Math.max(h*2,30)));pan={x:left+w/2-x-bw/2,y:top+h/2-y-bh/2};applyViewport();refreshHandles();
};
function bindDiagram(svg){
  svg.ondblclick=e=>{
    // Pointer capture can retarget dblclick to the SVG root. Hit-test the
    // release position so text editing still targets the actual shape.
    const target=e.target.closest('[data-pikchr-id]')||document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-pikchr-id]');
    if(!target||!svg.contains(target))return;
    select(target.getAttribute('data-pikchr-id'),false);
    directTools?.editText();
  };
  for(const group of svg.querySelectorAll('[data-pikchr-id]')){
    const object=scene.objects.find(o=>o.id===group.getAttribute('data-pikchr-id'));
    if(object){group.setAttribute('tabindex','0');group.setAttribute('role','button');group.setAttribute('aria-label',(object.name||object.kind)+(object.editable?', movable':', inspect only'));}
    if(['box','circle','ellipse','oval','cylinder','diamond'].includes(object?.kind)){
      // Pikchr's unfilled shapes otherwise only receive events on ink (the
      // stroke and label). Use the real outline, not a rectangular hit box, so
      // rounded/diamond corners do not capture clicks outside the shape.
      // A shape that encloses other objects is a container (a frame or
      // group box): it is picked by its border, and clicks inside reach the
      // shapes within it. Other shapes are picked anywhere inside.
      const inside=(q,b)=>q.x>=b.x-1e-9&&q.y>=b.y-1e-9&&q.x+q.width<=b.x+b.width+1e-9&&q.y+q.height<=b.y+b.height+1e-9;
      const container=scene.objects.some(n=>n!==object&&n.bbox&&n.bbox.width*n.bbox.height<object.bbox.width*object.bbox.height&&inside(n.bbox,object.bbox));
      for(const geometry of [...group.querySelectorAll('path,circle,ellipse,rect,polygon')]){
        if(!container){geometry.setAttribute('pointer-events','all');continue;}
        geometry.setAttribute('pointer-events','visibleStroke');
        const hit=geometry.cloneNode(false);hit.removeAttribute('style');hit.setAttribute('class','container-hit');
        hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','12');hit.setAttribute('fill','none');
        hit.setAttribute('vector-effect','non-scaling-stroke');hit.setAttribute('pointer-events','stroke');group.append(hit);
      }
      if(container)group.dataset.container='true';
      if(object.editable)group.style.cursor='grab';
    }
    if(object?.kind==='text'&&object.bbox){
      // Text only receives events on its glyphs; give it a box-sized hit area
      // so the gaps between letters and lines still select and drag it.
      const a=svgPoint({x:object.bbox.x,y:object.bbox.y+object.bbox.height}),b=svgPoint({x:object.bbox.x+object.bbox.width,y:object.bbox.y});
      const pad=3;
      group.prepend(svgElement('rect',{class:'text-hit',x:Math.min(a.x,b.x)-pad,y:Math.min(a.y,b.y)-pad,width:Math.abs(b.x-a.x)+2*pad,height:Math.abs(b.y-a.y)+2*pad,fill:'transparent',stroke:'none','pointer-events':'all'}));
      if(object.editable)group.style.cursor='grab';
    }
    if(!['arrow','line'].includes(object?.kind))continue;
    for(const path of [...group.querySelectorAll('path')]){
      const hit=path.cloneNode(false);hit.removeAttribute('style');
      hit.setAttribute('stroke','transparent');hit.setAttribute('stroke-width','14');
      hit.setAttribute('vector-effect','non-scaling-stroke');hit.setAttribute('fill','none');hit.setAttribute('pointer-events','stroke');
      group.append(hit);
    }
  }
  let drag=null;
  cancelCanvasEdit=()=>{drag=null;endLiveDrag();svg.querySelector('.studio-overlay')?.removeAttribute('transform');directTools?.cancel(false);};
  svg.onpointerdown=e=>{
    if(e.target.closest('input,textarea,select,.canvas-overlay'))return;
    // The diagram is a manipulation surface, including inspect-only objects.
    // Block native text selection before any unsupported/stale early return.
    e.preventDefault();
    if(e.button!==0)return;
    $('diagram').focus({preventScroll:true});
    const target=e.target.closest('[data-pikchr-id]');if(!target){select(null);return;}
    if(multiSelect||e.shiftKey||e.metaKey||e.ctrlKey){select(target.getAttribute('data-pikchr-id'),false,true);return;}
    const hitId=target.getAttribute('data-pikchr-id');select(hitId,false,false,selectedIds.has(hitId));const o=current();
    if(rendering||source.value!==renderedSource||$('diagram').classList.contains('stale')){
      // Typing is still debouncing: render now, then replay this press on the
      // fresh diagram so the gesture proceeds instead of being refused.
      if(!draft.length&&source.value!==renderedSource&&!e.studioReplay){flushAndReplay(e);return;}
      status('Source changed. Render to update the diagram before dragging.');return;
    }
    if(!o?.editable){
      const message=/nested/i.test(o?.reason||'')
        ?'This shape is inside a group and is inspect-only. Choose Pipeline and Load example to try dragging editable shapes.'
        :['arrow','line'].includes(o?.kind)
          ?'Use the connector handles in Routing or Endpoints; dragging the connector body only selects it.'
          :'This object is inspect-only: '+(o?.reason||'its source cannot be safely rewritten.');
      status(message);document.querySelector('.diagram-pane .hint').textContent=message;return;
    }
    document.querySelector('.diagram-pane .hint').textContent='Release to preview ranked source edits. Accept one, or press Escape to keep the original.';
    e.preventDefault();clearProposal();
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()).matrixTransform(matrix().inverse());
    drag={pointerId:e.pointerId,object:o,x:p.x,y:p.y,clientX:e.clientX,clientY:e.clientY};
    try{svg.setPointerCapture(e.pointerId);}catch{drag=null;}
  };
  svg.onpointermove=e=>{
    if(!drag||drag.pointerId!==e.pointerId)return;
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse()).matrixTransform(matrix().inverse());
    drag.raw={x:drag.object.center.x+p.x-drag.x,y:drag.object.center.y+p.y-drag.y};drag.alt=e.altKey;
    applyDragConstraint(drag,e.shiftKey||shiftHeld,svg);
    if(!drag.painted){
      const origin=svgPoint(drag.object.center),target=svgPoint(drag.target);
      svg.querySelector('.studio-overlay')?.setAttribute('transform','translate('+(target.x-origin.x)+' '+(target.y-origin.y)+')');
    }
    liveDragFrame(drag);
  };
  svg.onpointerup=e=>{
    if(!drag||drag.pointerId!==e.pointerId)return;const d=drag;drag=null;endLiveDrag();
    if(d.target&&Math.hypot(e.clientX-d.clientX,e.clientY-d.clientY)>3)suggest(d.object,d.target,!$('auto-apply').checked,{precise:!!d.precise,bringAlong:e.altKey||!!d.alt});
    // A click (no drag) on a member of a multi-selection selects just that
    // shape; dragging it moved the whole group above.
    else select(d.object.id,false,false,false);
  };
  shiftDuringDrag=e=>{
    if(!drag)return;
    // Escape cancels a shape drag: nothing is applied and the shape stays put.
    if(e.key==='Escape'&&e.type==='keydown'){const id=drag.pointerId;drag=null;endLiveDrag();try{svg.releasePointerCapture(id);}catch{}svg.querySelector('.studio-overlay')?.removeAttribute('transform');drawOverlay();status('Move cancelled.');e.preventDefault();e.stopImmediatePropagation();return;}
    if(!drag.raw||e.key!=='Shift')return;applyDragConstraint(drag,e.type==='keydown',svg);liveDragFrame(drag);
  };
  svg.onpointercancel=()=>{drag=null;endLiveDrag();clearProposal();drawOverlay();};
  svg.onlostpointercapture=()=>{if(drag){drag=null;endLiveDrag();drawOverlay();}};
}
// Capture phase, registered before the canvas tools attach their own
// Enter/Escape capture handlers, so a live preview owns these keys.
$('diagram').addEventListener('keydown',e=>{
  if(e.target.closest?.('input,textarea,select'))return;
  if(preview&&['Escape','Enter','[',']'].includes(e.key)){
    e.preventDefault();e.stopImmediatePropagation();
    if(e.key==='Escape')discardPreview();else if(e.key==='Enter')acceptPreview();else cyclePreview(e.key===']'?1:-1);
    return;
  }
  // A focused rendered object: Space selects it; Enter selects it and then
  // lets the canvas tools open its label editor.
  const group=e.target.closest?.('[data-pikchr-id]');
  if(group&&(e.key==='Enter'||e.key===' ')&&!e.target.closest('.canvas-overlay,.arrow-overlay')){
    const id=group.getAttribute('data-pikchr-id');
    if(selectedId!==id||e.shiftKey)select(id,false,e.shiftKey);
    if(e.key===' '){e.preventDefault();e.stopImmediatePropagation();}
  }
},true);
$('diagram').addEventListener('keydown',e=>{
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();$('delete-selected').click();return;}
  if(e.key==='Escape'){panMode=false;$('pan-mode').setAttribute('aria-pressed','false');$('diagram').style.cursor='';cancelCanvasEdit();clearProposal();select(null);return;}
  const delta={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}[e.key],o=current();
  // Focus on a rendered object: arrows walk the object list. Focus on the
  // canvas itself: arrows nudge the selection.
  if(delta&&e.target!==$('diagram')&&e.target.closest?.('[data-pikchr-id]')){
    e.preventDefault();const groups=[...$('diagram').querySelectorAll('[data-pikchr-id]')],i=groups.indexOf(e.target.closest('[data-pikchr-id]'));
    groups[(i+(delta[0]>0||delta[1]<0?1:-1)+groups.length)%groups.length]?.focus({preventScroll:true});return;
  }
  if(!delta||!o?.editable||source.value!==renderedSource)return;
  const step=e.shiftKey?10:e.altKey?.1:1;
  e.preventDefault();suggest(o,{x:o.center.x+delta[0]*step,y:o.center.y+delta[1]*step});
});
async function suggest(o,target,withPreview=false,{precise=!withPreview,bringAlong=false}={}){
  let options;
  try{options=selectedIds.size>1?[{...moveObjects(source.value,scene.objects.filter(n=>selectedIds.has(n.id)),scene,target.x-o.center.x,target.y-o.center.y,{pinDependents:!bringAlong}),selectionNames:scene.objects.filter(n=>selectedIds.has(n.id)).map(n=>n.name)}]:candidates(source.value,o,scene,target,{precise}).slice(0,6).map(option=>bringAlong?option:pinMove(source.value,scene,option,[o.id]));}catch(e){status(e.message);return;}
  if(!options.length){status('This placement expression is inspect-only. Try a named box with a literal at (x,y) clause.');drawOverlay();return;}
  return withPreview&&selectedIds.size<=1?previewSuggestions(o,options):validateSuggestions(o,options);
}
// Live drag: while the pointer moves, render the top-ranked candidate for the
// current pointer position so the shape, its connectors and any snapping are
// visible before release. One render in flight; the latest position wins.
// Drawn into a layer inside the current SVG so pointer capture survives, and
// nothing touches the draft.
function prefersQueue(){try{return localStorage.getItem('pikchr-studio.queue-mode')==='1';}catch{return false;}}
let liveDragState=null,shiftDuringDrag=null,shiftHeld=false;
for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(e.key==='Shift')shiftHeld=type==='keydown';shiftDuringDrag?.(e);},true);
window.addEventListener('blur',()=>{shiftHeld=false;});
function liveDragFrame(d){
  liveDragState=d;
  if(d.busy||!d.target)return;
  const target=d.target;let option;
  // A multi-selection previews the whole group move; one shape previews its
  // top-ranked placement.
  // Unselected shapes positioned against a moving one stay put (pinned)
  // unless Alt is held, which lets Pikchr carry them along.
  try{option=selectedIds.size>1
    ?moveObjects(source.value,scene.objects.filter(n=>selectedIds.has(n.id)),scene,target.x-d.object.center.x,target.y-d.object.center.y,{pinDependents:!d.alt})
    :candidates(source.value,d.object,scene,target,{precise:!!d.precise})[0];
    if(option&&selectedIds.size<=1&&!d.alt)option=pinMove(source.value,scene,option,[d.object.id]);}catch{return;}
  if(!option)return;
  d.busy=true;
  render(option.source).then(result=>{
    d.busy=false;
    if(liveDragState!==d)return;
    if(!result.error&&result.svg)paintLiveDrag(d,option,result);
    if(d.target!==target)liveDragFrame(d);
  });
}
// Paint a rendered candidate over the committed diagram (which is hidden)
// without replacing the root SVG, so pointer capture and overlays survive.
function paintLiveResult(result){
  const svg=$('diagram').querySelector('svg');if(!svg)return false;
  const t=result.transform,M=new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]);
  const doc=new DOMParser().parseFromString(result.svg,'image/svg+xml').documentElement;
  if(doc.nodeName!=='svg')return false;
  // Ids stay stable across a move, so the preview can show which shapes are
  // selected (the committed, highlighted copies are hidden while it shows).
  for(const n of doc.querySelectorAll('[data-pikchr-id]')){if(selectedIds.has(n.getAttribute('data-pikchr-id')))n.classList.add('cl-live-selected');n.removeAttribute('data-pikchr-id');}
  let layer=svg.querySelector('.live-drag');
  if(!layer){layer=svgElement('g',{class:'live-drag','aria-hidden':'true'});svg.insertBefore(layer,svg.querySelector('.studio-overlay,.canvas-overlay'));svg.classList.add('live-dragging');}
  // Candidate pixels -> model inches -> current viewport pixels.
  layer.setAttribute('transform',matrix().multiply(M.inverse()).toString());
  layer.replaceChildren(...[...doc.childNodes].map(n=>document.importNode(n,true)));
  return true;
}
// Live preview of an arbitrary candidate source (resize). One render in
// flight, the latest source wins; liveSourceClear stops it.
let liveSource={busy:false,next:null,active:false};
function liveSourcePreview(text){
  liveSource.active=true;liveSource.next=text;if(liveSource.busy)return;
  const t=liveSource.next;liveSource.next=null;liveSource.busy=true;
  render(t).then(result=>{
    liveSource.busy=false;if(!liveSource.active)return;
    if(!result.error&&result.svg)paintLiveResult(result);
    if(liveSource.next!=null)liveSourcePreview(liveSource.next);
  });
}
function liveSourceClear(){liveSource.active=false;liveSource.next=null;endLiveDrag();}
function paintLiveDrag(d,option,result){
  if(!paintLiveResult(result))return;
  const svg=$('diagram').querySelector('svg');
  d.painted=true;
  const moved=result.objects.find(n=>n.kind===d.object.kind&&n.name===d.object.name);
  if(moved){
    const from=svgPoint(d.object.center),to=svgPoint(moved.center);
    svg.querySelector('.studio-overlay')?.setAttribute('transform','translate('+(to.x-from.x)+' '+(to.y-from.y)+')');
  }
  const hint=document.querySelector('.diagram-pane .hint');
  if(hint)hint.textContent='Release to preview: '+option.label+'. Other ranked edits appear after release.';
}
// Re-dispatch a pointer press on whatever is now under it. The real pointer
// is still down, so editors can capture it as usual.
const pressedPointers=new Set();
window.addEventListener('pointerdown',e=>{if(e.isTrusted)pressedPointers.add(e.pointerId);},true);
for(const type of ['pointerup','pointercancel'])window.addEventListener(type,e=>pressedPointers.delete(e.pointerId),true);
function replayPointer(e){
  const target=document.elementFromPoint(e.clientX,e.clientY);if(!target||!$('diagram').contains(target))return;
  // Released already (a quick click): selecting is all a replay could do.
  if(!pressedPointers.has(e.pointerId)){const id=target.closest('[data-pikchr-id]')?.getAttribute('data-pikchr-id');if(id)select(id,false,false,true);return;}
  const replay=new PointerEvent('pointerdown',{bubbles:true,cancelable:true,composed:true,clientX:e.clientX,clientY:e.clientY,screenX:e.screenX,screenY:e.screenY,
    pointerId:e.pointerId,pointerType:e.pointerType,isPrimary:e.isPrimary,button:0,buttons:1,shiftKey:e.shiftKey,metaKey:e.metaKey,ctrlKey:e.ctrlKey,altKey:e.altKey});
  replay.studioReplay=true;target.dispatchEvent(replay);
}
async function flushAndReplay(e){
  clearTimeout(autoRender);status('Rendering your latest source…');
  const init={clientX:e.clientX,clientY:e.clientY,screenX:e.screenX,screenY:e.screenY,pointerId:e.pointerId,pointerType:e.pointerType,isPrimary:e.isPrimary,shiftKey:e.shiftKey,metaKey:e.metaKey,ctrlKey:e.ctrlKey,altKey:e.altKey,button:0};
  await renderSource();
  if(source.value===renderedSource&&!$('diagram').classList.contains('stale'))replayPointer(init);
}
// Shift-drag: lock to horizontal, vertical or 45 degrees from the start, and
// on a straight lock snap into line with other shapes. The free distance is
// grid-snapped here, so candidates run in precise mode and keep the angle.
function applyDragConstraint(d,shift,svg){
  d.shift=shift;
  svg.querySelector('.align-guides')?.remove();
  const start=d.object.center,others=scene.objects.filter(n=>n.id!==d.object.id&&!selectedIds.has(n.id)&&!['arrow','line','spline','arc','move'].includes(n.kind));
  if(!shift){
    // Smart snapping: edges, centers, mirror about a pivot, equal gaps. The
    // tolerance is 8 screen pixels at the current zoom.
    const pxPerInch=Math.abs(svg.getScreenCTM().a*matrix().a)||96;
    const r=smartSnap(d.raw,{size:d.object.bbox,others,tolerance:8/pxPerInch});
    d.target=r.point;d.precise=false;
    showGuides(svg,d,r.point,others,r.guides.filter(g=>g.type!=='align'));
    return;
  }
  d.precise=true;
  const r=constrainDrag(start,d.raw,{size:d.object.bbox,others});
  const t=r.point;
  if(r.axis==='x'&&!r.guide)t.x=start.x+snap(t.x-start.x);
  if(r.axis==='y'&&!r.guide)t.y=start.y+snap(t.y-start.y);
  if(r.axis==='diagonal'){const dx=snap(t.x-start.x),sign=Math.sign((t.y-start.y)*(t.x-start.x))||1;t.x=start.x+dx;t.y=start.y+sign*dx;}
  d.target=t;
  const layer=svgElement('g',{class:'align-guides','aria-hidden':'true'}),a=svgPoint(start),b=svgPoint(t);
  layer.append(svgElement('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:'lock-line'}));
  svg.insertBefore(layer,svg.querySelector('.studio-overlay'));
  showGuides(svg,d,t,others,[],layer);
}
// Figma-style guides: every line the moved shape shares with other shapes,
// drawn once across all of them with a small x where each shape meets it,
// plus mirror and labelled equal-gap marks from the snap.
function showGuides(svg,d,center,others,extra,layer=null){
  const b=d.object.bbox,box={x:center.x-b.width/2,y:center.y-b.height/2,width:b.width,height:b.height};
  const aligned=alignmentGuides(box,others);
  if(!aligned.length&&!extra.length)return;
  if(!layer){layer=svgElement('g',{class:'align-guides','aria-hidden':'true'});svg.insertBefore(layer,svg.querySelector('.studio-overlay'));}
  const px=1/Math.max(1e-6,Math.abs(svg.getScreenCTM().a*matrix().a));
  const seg=(p,q,cls)=>{const a=svgPoint(p),z=svgPoint(q);layer.append(svgElement('line',{x1:a.x,y1:a.y,x2:z.x,y2:z.y,class:cls}));};
  const mark=p=>{const r=3.5*px;seg({x:p.x-r,y:p.y-r},{x:p.x+r,y:p.y+r},'guide-mark');seg({x:p.x-r,y:p.y+r},{x:p.x+r,y:p.y-r},'guide-mark');};
  for(const g of aligned){
    // Edge guides overshoot the outermost shapes a little; center guides sit
    // exactly in the gaps between shapes.
    const over=g.feature==='center'?0:8*px,along=g.axis==='x';
    for(const [from,to] of g.segments)seg(along?{x:g.value,y:from-over}:{x:from-over,y:g.value},along?{x:g.value,y:to+over}:{x:to+over,y:g.value},'guide-line');
    for(const p of g.points)mark(p);
  }
  for(const g of extra){
    if(g.type==='mirror'){drawGuide(layer,g,center);continue;}
    if(g.type!=='gap')continue;
    for(const m of gapMarks(g.a.bbox,g.b.bbox,box,g.axis,g.gap)){
      const along=g.axis==='x',P=v=>along?{x:v,y:m.at}:{x:m.at,y:v},tick=4*px;
      seg(P(m.from),P(m.to),'gap-line');
      for(const v of [m.from,m.to])seg(along?{x:v,y:m.at-tick}:{x:m.at-tick,y:v},along?{x:v,y:m.at+tick}:{x:m.at+tick,y:v},'gap-line');
      const c=svgPoint(P((m.from+m.to)/2)),label=svgElement('text',{x:c.x,y:c.y-(along?6:0),dx:along?0:8,class:'gap-label','text-anchor':along?'middle':'start','dominant-baseline':along?'auto':'middle'});
      label.textContent=m.label;layer.append(label);
    }
  }
}
// Guide lines in viewport coordinates. align: a line through the shared
// coordinate. mirror: sibling -> pivot -> dragged shape, marking the pivot.
// gap: the two equal gaps drawn side by side.
function drawGuide(layer,g,t){
  const line=(p,q,cls='align-line')=>{const a=svgPoint(p),b=svgPoint(q);layer.append(svgElement('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:cls}));};
  const along=g.axis==='x';
  if(g.type==='mirror'){
    line(g.other.center,g.pivot.center,'mirror-line');line(g.pivot.center,t,'mirror-line');
    const c=svgPoint(g.pivot.center);layer.append(svgElement('circle',{cx:c.x,cy:c.y,r:4,class:'mirror-pivot'}));return;
  }
  if(g.type==='gap'){
    const ext=along?'width':'height',o=along?'y':'x',y=g.b.center[o];
    const aFar=g.a.center[g.axis]+g.a.bbox[ext]/2,bNear=g.b.center[g.axis]-g.b.bbox[ext]/2,bFar=g.b.center[g.axis]+g.b.bbox[ext]/2,aNear=g.a.center[g.axis]-g.a.bbox[ext]/2;
    const segs=[[aFar,bNear],g.side==='after'?[bFar,bFar+g.gap]:[aNear-g.gap,aNear]];
    for(const [p,q] of segs)line(along?{x:p,y}:{x:y,y:p},along?{x:q,y}:{x:y,y:q},'gap-line');
    return;
  }
  const o=g.other.center;
  line(along?{x:g.at,y:o.y}:{x:o.x,y:g.at},along?{x:g.at,y:t.y}:{x:t.x,y:g.at});
}
function endLiveDrag(){
  $('diagram').querySelector('svg .align-guides')?.remove();
  liveDragState=null;
  const svg=$('diagram').querySelector('svg');
  svg?.querySelector('.live-drag')?.remove();svg?.classList.remove('live-dragging');
}
// Drag preview: every candidate is a complete program rendered by Pikchr. The
// top one is shown on the canvas and in the diff, but nothing touches the
// draft until the author accepts it.
async function previewSuggestions(o,options){
  if(rendering||source.value!==renderedSource||$('diagram').classList.contains('stale')){status('Wait for a valid diagram before editing.');return false;}
  clearProposal();const g=gesture,rev=revision,base=source.value;
  status('Validating '+options.length+' placements…');
  const valid=[];let failure=null;
  for(const option of options){
    const result=await render(option.source);
    if(g!==gesture||rev!==revision)return false;
    if(result.error||!result.svg){failure??=result.error||'Renderer returned no diagram.';continue;}
    if(result.objects.filter(n=>n.kind===o.kind&&n.name===o.name).length!==1)continue;
    valid.push({...option,result,base,rev,subject:o.name||o.kind});
  }
  if(g!==gesture)return false;
  if(!valid.length){const message=failure||'No valid placement was found for that drop point.';$('suggestions').textContent=message;status('Edit not applied. '+message);drawOverlay();return false;}
  preview={options:valid,index:0,base,rev,object:o};
  showPreview();return true;
}
// Route styles arrive already rendered and checked; show them without
// re-rendering. Cycling within the same set only moves the index.
function previewValidated(o,options,index=0,hooks={}){
  if(preview&&preview.source===options){preview.index=Math.max(0,Math.min(index,preview.options.length-1));showPreview();return true;}
  if(rendering||source.value!==renderedSource||$('diagram').classList.contains('stale')){status('Wait for a valid diagram before editing.');return false;}
  const base=source.value,rev=revision;
  if(!options.length||options.some(x=>x.base!==base||!x.result)){status('These styles are out of date. Select the connector again.');return false;}
  if(preview)restoreViewBox();
  ++gesture;proposal=null;
  preview={options:options.map(x=>({...x,rev,subject:o.name||o.kind})),index:Math.max(0,Math.min(index,options.length-1)),base,rev,object:o,source:options,onIndex:hooks.onIndex};
  showPreview();return true;
}
function showPreview(){
  if(!preview)return;
  preview.onIndex?.(preview.index);
  const option=preview.options[preview.index],list=$('suggestions');
  list.replaceChildren();
  preview.options.forEach((item,i)=>{
    const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(i===preview.index));b.tabIndex=i===preview.index?0:-1;
    b.textContent=item.label;b.dataset.index=i;
    b.onclick=()=>{if(preview.index===i)acceptPreview();else{preview.index=i;showPreview();list.children[i]?.focus({preventScroll:true});}};
    list.append(b);
  });
  list.onkeydown=e=>{
    if(!preview)return;
    if(e.key==='ArrowDown'||e.key===']'){e.preventDefault();cyclePreview(1);list.children[preview.index]?.focus({preventScroll:true});}
    else if(e.key==='ArrowUp'||e.key==='['){e.preventDefault();cyclePreview(-1);list.children[preview.index]?.focus({preventScroll:true});}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();acceptPreview();}
    else if(e.key==='Escape'){e.preventDefault();discardPreview();}
  };
  $('preview-actions').hidden=false;
  $('preview-label').textContent=(preview.index+1)+'/'+preview.options.length+' '+option.label;
  const a=byteOffsetToIndex(option.base,option.patch.start),b=byteOffsetToIndex(option.base,option.patch.end);
  $('diff').textContent='- '+option.base.slice(a,b)+'\n+ '+option.patch.text;
  mountPreview(option);
  const alternatives=preview.options.length-1;
  status('Previewing: '+option.label+'. '+(alternatives?alternatives+(alternatives===1?' alternative. ':' alternatives. '):'')+'Enter or Accept applies it; Escape keeps the original.');
}
function cyclePreview(step){if(!preview)return;preview.index=(preview.index+step+preview.options.length)%preview.options.length;showPreview();}
function mountPreview(option){
  const old=$('diagram').querySelector('svg');if(!old)return;
  const data={...old.dataset},viewBox=old.getAttribute('viewBox').split(/[ ,]+/).map(Number);
  preview.viewBox??=old.getAttribute('viewBox');
  // Keep the same model-space window: the candidate render may have a new bbox.
  const inv=matrix().inverse(),t=option.result.transform,M=new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]);
  const p=new DOMPoint(viewBox[0],viewBox[1]).matrixTransform(inv).matrixTransform(M),q=new DOMPoint(viewBox[0]+viewBox[2],viewBox[1]+viewBox[3]).matrixTransform(inv).matrixTransform(M);
  $('diagram').innerHTML=option.result.svg;const svg=$('diagram').querySelector('svg');if(!svg)return;
  svg.style.maxWidth='100%';svg.setAttribute('preserveAspectRatio','xMidYMid meet');Object.assign(svg.dataset,data);
  svg.setAttribute('viewBox',[Math.min(p.x,q.x),Math.min(p.y,q.y),Math.abs(q.x-p.x),Math.abs(q.y-p.y)].join(' '));
  $('diagram').classList.add('previewing');
  const moved=option.selectId?option.result.objects.find(n=>n.id===option.selectId):option.result.objects.find(n=>n.kind===preview.object.kind&&n.name===preview.object.name);
  if(moved){const layer=svgElement('g',{class:'studio-overlay preview-overlay'});const to=pt=>new DOMPoint(pt.x,pt.y).matrixTransform(M);
    const a=to({x:moved.bbox.x,y:moved.bbox.y+moved.bbox.height}),b=to({x:moved.bbox.x+moved.bbox.width,y:moved.bbox.y});
    layer.append(svgElement('rect',{x:a.x-3,y:a.y-3,width:Math.max(6,b.x-a.x+6),height:Math.max(6,b.y-a.y+6),fill:'none',stroke:'var(--accent,#0969da)','stroke-width':2,'vector-effect':'non-scaling-stroke','stroke-dasharray':'6 3'}));svg.append(layer);}
  // Dismissing a preview must not eat the click: discard (re-renders the
  // committed diagram synchronously), then replay the press on it.
  svg.onpointerdown=e=>{e.preventDefault();discardPreview();if(e.button===0&&!e.studioReplay)replayPointer(e);};
}
// The preview SVG lives in the candidate's coordinate space; hand the
// committed viewBox back before re-rendering so the viewport math stays right.
function restoreViewBox(){const svg=$('diagram').querySelector('svg');if(svg&&preview?.viewBox)svg.setAttribute('viewBox',preview.viewBox);}
async function acceptPreview(){
  if(!preview)return;const option=preview.options[preview.index];
  restoreViewBox();preview=null;$('preview-actions').hidden=true;$('diagram').classList.remove('previewing');
  await choose(option);
}
function discardPreview(){
  if(!preview)return;restoreViewBox();preview=null;$('preview-actions').hidden=true;$('diagram').classList.remove('previewing');
  $('suggestions').textContent='Preview discarded. The source is unchanged.';
  renderSource(scene);status('Preview discarded. The source is unchanged.');
}
$('preview-accept').onclick=acceptPreview;
$('preview-prev').onclick=()=>cyclePreview(-1);$('preview-next').onclick=()=>cyclePreview(1);
$('preview-discard').onclick=discardPreview;
async function validateSuggestions(o,options){
  if(rendering||source.value!==renderedSource||$('diagram').classList.contains('stale')){status('Wait for a valid diagram before editing.');return false;}
  clearProposal();const g=gesture,rev=revision,base=source.value;
  status('Validating '+options.length+' source suggestions…');
  const valid=[],failures=[];
  for(const option of options){
    const result=await render(option.source);
    if(g!==gesture||rev!==revision)return false;
    if(result.error||!result.svg){failures.push(result.error||'Renderer returned no diagram.');continue;}
    const matches=result.objects.filter(n=>option.selectName?n.name===option.selectName:option.selectId?n.id===option.selectId&&n.kind===option.targetKind:o&&n.kind===o.kind&&(o.name?n.name===o.name:n.id===o.id));
    if(!option.clearSelection&&matches.length!==1)continue;
    valid.push({...option,result,base,rev,subject:o?.name||o?.kind||option.selectName});
  }
  if(g!==gesture)return false;
  $('suggestions').replaceChildren();
  for(const option of valid){
    const b=document.createElement('button');b.textContent=option.label;
    b.onclick=()=>choose(option);$('suggestions').append(b);
  }
  if(valid.length){
    await choose(valid[0]);
    const stage=draft.at(-1);
    if(stage&&stage.before===base&&stage.after===valid[0].source&&valid.length>1){
      $('suggestions').replaceChildren();
      for(const option of valid.slice(1)){
        const button=document.createElement('button');button.type='button';button.textContent='Use instead: '+option.label;
        button.onclick=async()=>{
          if(rendering||draft.at(-1)!==stage||source.value!==stage.after)return;
          draft.pop();source.value=stage.before;++revision;clearProposal();
          if(option.source===stage.before){
            if(!draft.length)draftBase=null;
            dirty();updateDraft();await renderSource();status('Latest change removed.');return;
          }
          await choose({...option,rev:revision});
        };
        $('suggestions').append(button);
      }
    }
    return true;
  }else{
    const message=failures[0]||'The edited object could not be identified safely.';
    $('suggestions').textContent=message;status('Edit not applied. '+message);drawOverlay();installArrowEditor();
    return false;
  }
}
async function choose(option){
  if(option.rev!==revision||option.base!==source.value)return;
  try{
    const previousSizing=scene.objects.flatMap(o=>{const preference=sizingFor(o);if(!preference)return[];try{return[{name:o.name,kind:o.kind,box:o.bbox,text:inspectProperties(source.value,o,scene).text,preference}];}catch{return[];}});
    const next=applyPatch(source.value,option.patch);
    if(next===source.value){if(option.sizingPreference&&current()){sizingPreferences=writeSizingPreference(source.value,scene,current(),sizingPreferences,option.sizingPreference);scheduleSave();status('Label behavior saved. Diagram geometry is unchanged.');}else status('No change to queue.');drawOverlay();installArrowEditor();directTools?.sync();return;}
    draftRedo.length=0;
    if(!draft.length)draftBase=source.value;
    const a=byteOffsetToIndex(option.base,option.patch.start),b=byteOffsetToIndex(option.base,option.patch.end);
    draft.push({before:source.value,after:next,label:(option.subject?option.subject+': ':'')+option.label,
      diff:'- '+option.base.slice(a,b)+'\n+ '+option.patch.text});
    requestedSelectionName=option.selectName||current()?.name||null;
    if(option.clearSelection){selectedIds.clear();selectedId=null;requestedSelectionName=null;}
    requestedSelectionId=option.selectId||null;
    source.value=next;dirty();updateDraft();
    await renderSource(option.result);
    for(const item of previousSizing){const object=scene.objects.find(o=>o.name===item.name&&o.kind===item.kind);if(!object||Math.abs(object.bbox.width-item.box.width)>.0001||Math.abs(object.bbox.height-item.box.height)>.0001)continue;try{if(inspectProperties(source.value,object,scene).text===item.text)sizingPreferences=writeSizingPreference(source.value,scene,object,sizingPreferences,item.preference);}catch{}}
    directTools?.sync();
    if(option.sizingPreference&&current()){try{sizingPreferences=writeSizingPreference(source.value,scene,current(),sizingPreferences,option.sizingPreference);directTools?.sync();scheduleSave();}catch(error){status('Size applied, but its editing preference was not saved: '+error.message);}}
    if(option.selectionNames){selectedIds=new Set(scene.objects.filter(o=>option.selectionNames.includes(o.name)).map(o=>o.id));select(selectedId,false,false,true);}
    if($('auto-apply').checked){$('accept').onclick();return;}
    status(draft.length+(draft.length===1?' change queued.':' changes queued.')+' Continue editing, Apply all, or Discard all.');
  }catch(error){status(error.message);}
}
$('accept').onclick=()=>{
  if(!draft.length||rendering)return;
  ++revision;clearProposal();
  undo.push(draftBase);redo.length=0;
  draft.length=0;draftRedo.length=0;draftBase=null;updateDraft();
  applied=true;updateDraft();
  // Handles snapshot the revision; rebuild them so the next gesture is valid.
  refreshHandles();
  status('All queued changes applied. Undo restores the whole batch.');
};
$('cancel').onclick=async()=>{
  if(!draft.length||rendering)return;
  source.value=draftBase;draft.length=0;draftRedo.length=0;draftBase=null;
  dirty();updateDraft();await renderSource();status('All queued changes discarded.');
};
$('undo-draft').onclick=async()=>{
  if(!draft.length||rendering)return;
  const last=draft.pop();source.value=last.before;
  draftRedo.push(last);
  if(!draft.length)draftBase=null;
  dirty();updateDraft();await renderSource();
  status(draft.length?draft.length+' changes remain queued.':'Last queued change undone.');
};
function historyButtons(){
  $('undo').disabled=rendering||(!draft.length&&!undo.length&&manualEditBase===null);
  $('redo').disabled=rendering||(!draftRedo.length&&(!!draft.length||!redo.length));
  $('undo').title=draft.length?'Undo latest queued change':'Undo last applied change';
  $('redo').title=draftRedo.length?'Redo queued change':'Redo applied change';
  for(const kind of ['undo','redo']){const button=$('canvas-'+kind);button.disabled=$(kind).disabled;button.title=$(kind).title+' (Ctrl/⌘ '+(kind==='undo'?'Z':'Shift+Z')+')';}
  $('render').disabled=!!draft.length;
}
$('undo').onclick=async()=>{
  if(rendering)return;cancelCanvasEdit();
  if(draft.length){await $('undo-draft').onclick();return;}
  if(manualEditBase!==null){redo.push(source.value);source.value=manualEditBase;manualEditBase=null;}
  else {if(!undo.length)return;draftRedo.length=0;redo.push(source.value);source.value=undo.pop();}
  dirty();await renderSource();status('Undone. Redo restores the change.');
};
$('redo').onclick=async()=>{
  if(rendering)return;cancelCanvasEdit();
  if(draftRedo.length){const next=draftRedo.pop();if(next.before!==source.value){draftRedo.length=0;historyButtons();return;}if(!draft.length)draftBase=source.value;draft.push(next);source.value=next.after;dirty();await renderSource();status('Queued change restored.');return;}
  if(draft.length||!redo.length)return;manualEditBase=null;undo.push(source.value);source.value=redo.pop();dirty();await renderSource();status('Redone.');
};
// Read-only handle for the optional canvas layout (canvas-layout.js). Edits
// still go through validateSuggestions, the same path as every other tool.
window.pikchrStudio={
  state:()=>({source:source.value,scene,object:current(),selectedIds:[...selectedIds],queued:draft.length,
    valid:!!scene&&!rendering&&source.value===renderedSource&&!$('diagram').classList.contains('stale')}),
  render,propose:options=>validateSuggestions(null,options),select:id=>select(id,false,false,true),
  modelToScreen:p=>{const svg=$('diagram').querySelector('svg');if(!scene||!svg?.getScreenCTM())return null;return new DOMPoint(p.x,p.y).matrixTransform(matrix()).matrixTransform(svg.getScreenCTM());},
  setDark:on=>{const flags=on?3:1;if(flags===renderFlags)return;renderFlags=flags;if(source.value.trim()||scene)renderSource();},
  refit:()=>{const svg=$('diagram').querySelector('svg');const box=svg?.dataset.exportViewBox;if(!box)return;const [x,y,w,h]=box.split(/[ ,]+/).map(Number);svg.dataset.fitViewBox=fitBox(x,y,w,h);if(zoom===1&&pan.x===0&&pan.y===0){svg.dataset.baseViewBox=svg.dataset.fitViewBox;applyViewport();refreshHandles();}},
  title:()=>activeDocumentTitle,
  editLabelDialog:()=>directTools?.editText(),
  preview:()=>{if(!preview)return null;const o=preview.options[preview.index];return {index:preview.index,count:preview.options.length,label:o.label,before:o.base.slice(byteOffsetToIndex(o.base,o.patch.start),byteOffsetToIndex(o.base,o.patch.end)),after:o.patch.text};},
  screenToModel:(x,y)=>{const svg=$('diagram').querySelector('svg');if(!scene||!svg?.getScreenCTM())return null;return new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse()).matrixTransform(matrix().inverse());},
};
$('canvas-undo').onclick=()=>$('undo').click();
$('canvas-redo').onclick=()=>$('redo').click();
document.addEventListener('keydown',e=>{
  if($('example-picker').open)return;
  if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  if(preview&&!mod&&(e.key==='['||e.key===']')&&!$('diagram').contains(document.activeElement)&&!$('suggestions').contains(document.activeElement)){e.preventDefault();cyclePreview(e.key===']'?1:-1);return;}
  if(mod&&(key==='z'||key==='y')){e.preventDefault();$(key==='y'||e.shiftKey?'redo':'undo').click();return;}
  if(mod&&key==='d'){e.preventDefault();$('duplicate-selected').click();return;}
  if(mod&&key==='a'&&$('diagram').contains(document.activeElement)){e.preventDefault();selectedIds=new Set(scene?.objects.filter(o=>!['arrow','line'].includes(o.kind)&&o.editable).map(o=>o.id));select([...selectedIds][0]||null,false,false,true);return;}
  if(!$('diagram').contains(document.activeElement))return;
  if(key==='0'||key==='1'||key==='f'){e.preventDefault();$(key==='f'?'focus-selection':'fit-view').click();}
  if(key==='+'||key==='='){e.preventDefault();$('zoom-in').click();}
  if(key==='-'){e.preventDefault();$('zoom-out').click();}
});
$('render').onclick=renderSource;
$('download').onclick=()=>{
  const url=URL.createObjectURL(new Blob([source.value],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download='diagram.pikchr';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function restoreDocument(state,preRendered=null){
  routeReview?.cancel();
  directTools?.cancel(false);
  activeDocumentTitle=state.title||null;
  sizingPreferences=state.sizingPreferences||{};
  manualEditBase=null;draftRedo.splice(0,draftRedo.length,...(state.draftRedo||[]));
  source.value=state.source;draft.splice(0,draft.length,...state.draft);draftBase=state.draftBase;
  undo.splice(0,undo.length,...state.undo);redo.splice(0,redo.length,...state.redo);
  // Changes apply immediately (undo reverts them) unless the author chose
  // queue mode on this browser. A document with queued changes keeps its mode.
  $('auto-apply').checked=state.draft.length?!!state.autoApply:!prefersQueue();applied=state.applied;selectedId=null;selectedIds.clear();
  zoom=1;pan={x:0,y:0};++revision;return renderSource(preRendered);
}
async function newDocument(text='',preRendered=null,title=null){
  const saved=persistDocument();if(!saved.ok){status('Not opened: '+saved.error+' Download your source before switching documents.');return false;}
  try{activeDocumentId=documents.create();}catch(error){status('Not opened: '+error.message);return false;}
  storageReady=true;document.body.classList.remove('inspector-open','objects-open','creation-open');
  await restoreDocument({source:text,draft:[],draftBase:null,undo:[],redo:[],autoApply:!prefersQueue(),applied:false,...(title?{title}:{})},preRendered);return true;
}
$('new-document').onclick=()=>newDocument();
$('open-document').onclick=()=>$('file-input').click();
$('file-input').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024){status('File must be smaller than 2 MB.');return;}newDocument(await file.text());e.target.value='';};
$('documents').onchange=()=>{const id=$('documents').value;const saved=persistDocument();if(!saved.ok){$('documents').value=activeDocumentId;status('Not opened: '+saved.error);return;}try{const record=documents.open(id);if(record){activeDocumentId=id;refreshDocuments();restoreDocument(record.state);}}catch(error){status(error.message);}};
$('export-svg').onclick=async()=>{
  if(source.value!==renderedSource){status('Render the latest source before exporting.');return;}
  try{const svg=await exportSvgElement();if(!svg)return;downloadFile(cleanSVG(svg),'diagram.svg','image/svg+xml');}catch(e){status(e.message);}
};
function downloadFile(data,name,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function selectedBounds(){const objects=scene?.objects.filter(o=>selectedIds.has(o.id));if(!objects?.length)throw Error('Select objects to export.');const p=objects.flatMap(o=>[svgPoint({x:o.bbox.x,y:o.bbox.y}),svgPoint({x:o.bbox.x+o.bbox.width,y:o.bbox.y+o.bbox.height})]);const xs=p.map(p=>p.x),ys=p.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
$('export-selection').onclick=async()=>{try{if(source.value!==renderedSource)throw Error('Render the current source first.');const bounds=selectedBounds();downloadFile(cleanSVG(await exportSvgElement(),{bounds}),'selection.svg','image/svg+xml');}catch(e){status(e.message);}};
$('export-png').onclick=async()=>{try{if(source.value!==renderedSource)throw Error('Render the current source first.');await downloadPNG(await exportSvgElement());status('PNG downloaded.');}catch(e){status(e.message);}};
$('copy-selection').onclick=()=>{try{clipboardFragment=copySelection(source.value,scene,[...selectedIds]);pasteCount=0;$('paste-selection').disabled=false;status('Selection copied in Studio.'+(clipboardFragment.omittedEdges.length?' External connections omitted: '+clipboardFragment.omittedEdges.join(', '):''));}catch(e){status(e.message);}};
$('paste-selection').onclick=()=>{if(!clipboardFragment)return;action(()=>pasteSelection(source.value,scene,clipboardFragment,{dx:++pasteCount*.5,dy:-pasteCount*.5}));};
function refreshComponents(){const select=$('components');select.replaceChildren();try{for(const entry of componentLibrary.list()){const o=document.createElement('option');o.value=entry.id;o.textContent=entry.name;select.append(o);}}catch(e){status(e.message);} $('insert-component').disabled=!select.options.length;}
$('save-component').onclick=()=>{try{const fragment=copySelection(source.value,scene,[...selectedIds]);componentLibrary.save($('component-name').value,fragment);refreshComponents();status('Component saved in this browser. Source is copied when inserted; there is no hidden dependency.');}catch(e){status(e.message);}};
$('insert-component').onclick=()=>action(()=>pasteSelection(source.value,scene,componentLibrary.get($('components').value),{dx:1,dy:-1}));
$('backup-workspace').onclick=()=>{const saved=persistDocument();if(!saved.ok){status('Backup stopped: '+saved.error);return;}try{downloadFile(exportWorkspace(documents.records()),'pikchr-workspace.json','application/json');status('Document backup downloaded, including queued changes and history. Components are separate local data.');}catch(e){status(e.message);}};
$('restore-workspace').onclick=()=>$('backup-input').click();
$('backup-input').onchange=async e=>{const file=e.target.files[0];if(!file)return;const originalId=activeDocumentId;let count=0;try{if(file.size>16*1024*1024)throw Error('Backup exceeds 16 MB.');const records=parseWorkspace(await file.text());const saved=persistDocument();if(!saved.ok)throw Error(saved.error);clearTimeout(saveTimer);for(const record of records){documents.create();const result=documents.save(record.state);if(!result.ok)throw Error(result.error);count++;}status('Restored '+count+' document copies. Your current diagram is unchanged.');}catch(error){status('Restored '+count+' copies. '+error.message+' Existing documents were not replaced.');}finally{try{documents.open(originalId);activeDocumentId=originalId;refreshDocuments();}catch(error){status('Reopen your current document: '+error.message);}e.target.value='';}};
directTools=canvasTools({host:$('diagram'),toolbar:$('direct-tools'),render,livePreview:liveSourcePreview,liveClear:liveSourceClear,propose:validateSuggestions,select,selectMany:ids=>{selectedIds=new Set(ids);select(ids[0]||null,false,false,true);},status,invalidate:clearProposal,
  stopPan:()=>{panMode=false;$('pan-mode').setAttribute('aria-pressed','false');$('diagram').style.cursor='';},
  getState:()=>({source:source.value,scene,object:current(),sizing:sizingFor(current()),multiple:selectedIds.size>1,key:activeDocumentId+':'+revision,
    valid:!!scene&&!rendering&&source.value===renderedSource&&!$('diagram').classList.contains('stale'),
    rebind:()=>{const svg=$('diagram').querySelector('svg');if(svg){bindDiagram(svg);refreshHandles();}}})});
routeReview=createCandidateReview({host:$('diagram'),render,propose:validateSuggestions,status,
  getState:()=>({source:source.value,scene,object:current(),key:activeDocumentId+':'+revision,valid:!!scene&&!rendering&&source.value===renderedSource&&!$('diagram').classList.contains('stale')}),
  rebind:()=>{const svg=$('diagram').querySelector('svg');if(svg){bindDiagram(svg);refreshHandles();}}});
$('tidy-route').onclick=()=>{directTools.cancel(false);try{const option=tidyRouteCandidate(source.value,scene,current());if(option.source===source.value){status('This connector already takes the tidiest route. Nothing to change.');return;}routeReview.review(option);}catch(error){status(error.message);}};
refreshComponents();
window.addEventListener('pagehide',persistDocument);
try{const record=documents.load();storageReady=true;if(record){activeDocumentId=record.id;restoreDocument(record.state);}else{activeDocumentId=documents.create();renderSource();}}catch(error){$('save-state').textContent='Recovery needed: '+error.message;renderSource();}
const sample=params.get('sample');
const samplePaths={'polished-gates':'ux-audit/polished-gates.pikchr','polished-stacks':'ux-audit/polished-stacks.pikchr','gitflow-mobile':'ux-audit/gitflow-mobile.pikchr','gitflow-guide':'examples/gitflow.pikchr'};
async function loadSample(key){if(!samplePaths[key])return;try{const response=await fetch(samplePaths[key]);if(!response.ok)throw Error('Could not load example.');await newDocument(await response.text());history.replaceState(null,'',location.pathname);}catch(error){status(error.message);}}
const catalog=[
  {key:'pipeline',title:'Pipeline',description:'Start here: client, API and database. Practice moving shapes, editing text and reconnecting arrows.'},
  {key:'gitflow-guide',title:'Gitflow explained',description:'An annotated release lifecycle. Edit shapes and anchored arrows; lane guides are edited in source.',guide:'examples/gitflow.html'},
  {key:'polished-gates',title:'Decision gates',description:'Three yes/no decisions. Practice labelled connectors and aligned boxes.'},
  {key:'polished-stacks',title:'Manifest comparison',description:'Flat and tree records with linked submanifests. Practice a larger structured diagram.'},
  {key:'unicode',title:'Unicode labels',description:'A small editable example with café and Japanese labels.'},
  {key:'nested',title:'Nested group — inspect only',description:'A grouped pipeline. Inspect its geometry; this example requires source edits rather than dragging.'}
].map(item=>({...item,load:async()=>{if(examples[item.key])return examples[item.key];const response=await fetch(samplePaths[item.key]);if(!response.ok)throw Error('Could not load '+item.title+'.');return response.text();}}));
$('choose-example').onclick=examplePicker({dialog:$('example-picker'),items:catalog,render,open:async(text,result,title)=>{const success=await newDocument(text,result,title);if(success)status('Opened a copy of '+title+'. Previous work is in Saved documents.');return success;}});
if(samplePaths[sample])loadSample(sample);
source.addEventListener('mouseup',()=>{
  if(!scene||source.value!==renderedSource)return;
  const offset=new TextEncoder().encode(source.value.slice(0,source.selectionStart)).length;
  const o=scene.objects.filter(o=>o.span&&o.span.start<=offset&&o.span.end>=offset).sort((a,b)=>(a.span.end-a.span.start)-(b.span.end-b.span.start))[0];
  if(o)select(o.id,false);
});
