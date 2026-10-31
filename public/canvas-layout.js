// The Studio layout: a full-viewport canvas with floating chrome. It gathers
// the controls declared in index.html into chips, menus and popovers; every
// control keeps its own handler. It also adds drag-to-connect, which submits
// ordinary candidate edits.
import {attachPoints,nearestAnchor,targetAnchor,hitShape,connectCandidate,connectionLabel,elbowRoute} from './connect-drag.js?v=20260923c';
import {connectableShapes} from './creation.js?v=20260923c';
import {connectorCapabilities} from './arrow-ui.js?v=20260923c';
import {freeLineCandidate,pointText,snapToGrid,literalRoute,lineEnds,translateLineCandidate,moveEndpointCandidate} from './free-lines.js?v=20260923c';
import {lockDirection} from './constrain.js?v=20260923c';
import {inspectProperties} from './properties.js?v=20260923c';
import {buildTextEdit} from './text-sizing.js?v=20260923c';
import {textStyle,textStyleCandidate,textSizes,textColours} from './text-style.js?v=20260923c';


const $=id=>document.getElementById(id);
const q=selector=>document.querySelector(selector);
const SVG='http://www.w3.org/2000/svg';
function el(tag,attrs={},...children){
  const node=document.createElement(tag);
  for(const[k,v]of Object.entries(attrs))if(v!==undefined&&v!==null)node.setAttribute(k,v);
  node.append(...children.filter(c=>c!==null&&c!==undefined));return node;
}
function svgEl(tag,attrs={}){const node=document.createElementNS(SVG,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;}

// Forget the retired layout switch.
try{localStorage.removeItem('pikchr-studio-layout');}catch{}
if(window.pikchrStudio)install(window.pikchrStudio);

function install(studio){
  document.body.classList.add('layout-canvas');
  const diagram=$('diagram');
  const stage=el('div',{class:'cl-stage'});document.body.prepend(stage);stage.append(diagram);

  // ---- theme: Pikchr draws light ink on the dark canvas ------------------------
  const darkQuery=matchMedia('(prefers-color-scheme: dark)');
  const isDark=()=>{const t=document.documentElement.dataset.theme;return t==='dark'||(t!=='light'&&darkQuery.matches);};
  const syncTheme=()=>{document.body.classList.toggle('cl-dark',isDark());studio.setDark?.(isDark());};
  darkQuery.addEventListener?.('change',syncTheme);
  new MutationObserver(syncTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  syncTheme();

  // ---- popovers -------------------------------------------------------------
  const popovers=[];
  function popover(className,label){
    const panel=el('div',{class:'cl-float cl-popover '+className,role:'dialog','aria-label':label,hidden:''});
    document.body.append(panel);popovers.push(panel);return panel;
  }
  function toggle(panel,button,force){
    const open=force??panel.hidden;
    for(const other of popovers)if(other!==panel&&open){other.hidden=true;other.opener?.setAttribute('aria-expanded','false');}
    panel.hidden=!open;panel.opener=button;button?.setAttribute('aria-expanded',String(open));
    if(open){panel.returnFocus=button;layout();}
  }
  document.addEventListener('pointerdown',e=>{
    for(const panel of popovers)if(!panel.hidden&&!panel.contains(e.target)&&!panel.opener?.contains(e.target)&&!e.target.closest?.('dialog'))toggle(panel,panel.opener,false);
  },true);
  // Every popover shares one head shape: a title, an optional kind and a Close
  // that returns focus to whatever opened it. In the inspector it is sticky,
  // so the panel scrolls under a heading that never leaves the screen.

  // ---- document chip + menu --------------------------------------------------
  // Chrome icons: 24-unit line art in currentColor, like the selection toolbar.
  // Paths are Lucide (lucide.dev, ISC license): 24-unit, round caps and joins,
  // drawn at the one stroke weight iconMarkup sets.
  const CHROME_ICONS={
    menu:[['path',{d:'M4 5h16'}],['path',{d:'M4 12h16'}],['path',{d:'M4 19h16'}]],
    source:[['path',{d:'m18 16 4-4-4-4'}],['path',{d:'m6 8-4 4 4 4'}],['path',{d:'m14.5 4-5 16'}]],
    export:[['path',{d:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'}],['path',{d:'m7 10 5 5 5-5'}],['path',{d:'M12 15V3'}]],
    out:[['path',{d:'M5 12h14'}]],
    in:[['path',{d:'M5 12h14'}],['path',{d:'M12 5v14'}]],
    help:[['circle',{cx:'12',cy:'12',r:'10'}],['path',{d:'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'}],['path',{d:'M12 17h.01'}]],
    focus:[['circle',{cx:'12',cy:'12',r:'3'}],['path',{d:'M3 7V5a2 2 0 0 1 2-2h2'}],['path',{d:'M17 3h2a2 2 0 0 1 2 2v2'}],['path',{d:'M21 17v2a2 2 0 0 1-2 2h-2'}],['path',{d:'M7 21H5a2 2 0 0 1-2-2v-2'}]],
    find:[['circle',{cx:'11',cy:'11',r:'8'}],['path',{d:'m21 21-4.3-4.3'}]],
    chevron:[['path',{d:'m6 9 6 6 6-6'}]],
    box:[['rect',{x:'2',y:'6',width:'20',height:'12',rx:'2'}]],
    circle:[['circle',{cx:'12',cy:'12',r:'10'}]],
    cylinder:[['ellipse',{cx:'12',cy:'5',rx:'9',ry:'3'}],['path',{d:'M3 5v14a9 3 0 0 0 18 0V5'}]],
    diamond:[['path',{d:'M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0z'}]],
    line:[['path',{d:'M5 19 19 5'}]],
    multi:[['rect',{x:'3',y:'3',width:'12',height:'12',rx:'2'}],['rect',{x:'9',y:'9',width:'12',height:'12',rx:'2'}]],
  };

  const menuButton=el('button',{type:'button',class:'cl-icon','aria-label':'Menu',title:'Menu','aria-expanded':'false'},iconMarkup(CHROME_ICONS.menu));
  const sourceButton=el('button',{type:'button',class:'cl-icon','aria-label':'Source','aria-pressed':'false',title:'Source (S)'},iconMarkup(CHROME_ICONS.source));
  const title=el('strong',{class:'cl-title'},'Untitled');
  const exportButton=el('button',{type:'button',class:'cl-icon','aria-label':'Export',title:'Export','aria-expanded':'false'},iconMarkup(CHROME_ICONS.export));
  const chip=el('div',{class:'cl-float cl-doc'},menuButton,title,el('span',{class:'cl-sep'}),sourceButton,exportButton);
  document.body.append(chip);
  const menu=popover('cl-menu','Document menu');
  const help=q('header a[href="help.html"]');
  const nav=q('.document-menu nav');
  const statusText=$('state');
  // The menu is built as flat sections from controls declared in index.html. Elements
  // are moved, not cloned, so every id and handler keeps working.
  const section=(name,...nodes)=>el('section',{class:'cl-section','aria-label':name},name&&el('h3',{class:'cl-section-title'},name),...nodes.filter(Boolean));
  const row=(...nodes)=>el('div',{class:'cl-row'},...nodes.filter(Boolean));
  const labelled=(id,text)=>{const input=$(id);if(!input)return null;const label=input.closest('label')||el('label',{},input);label.classList.add('cl-check-row');label.replaceChildren(input,el('span',{},text));return label;};
  // Saved documents: the select stays (off-stage, in nav) as the source of
  // truth for app.js; the menu shows it as recent rows that drive the same
  // change event.
  const documents=$('documents');
  const recent=el('div',{class:'cl-recent','aria-label':'Saved documents'});
  const ago=t=>{const s=Math.max(0,(Date.now()-t)/1000);return s<45?'just now':s<3600?Math.round(s/60)+' min ago':s<86400?Math.round(s/3600)+' h ago':s<604800?Math.round(s/86400)+' d ago':new Date(t).toLocaleDateString();};
  function syncRecent(){
    if(!documents)return;
    const all=[...documents.options],keep=all.slice(0,5);
    const active=all.find(o=>o.value===documents.value);if(active&&!keep.includes(active))keep.push(active);
    recent.replaceChildren(...keep.map(o=>{
      const on=o===active,b=el('button',{type:'button','data-id':o.value,'aria-current':on?'true':null},el('span',{class:'cl-recent-name'},o.textContent),el('span',{class:'cl-muted'},o.dataset.updated?ago(+o.dataset.updated):''));
      b.onclick=()=>{toggle(menu,menuButton,false);if(on)return;documents.value=o.value;documents.dispatchEvent(new Event('change',{bubbles:true}));};
      return b;
    }));
  }
  const saveState=$('save-state');saveState?.classList.add('cl-muted','cl-save-state');
  const newDoc=$('new-document'),openDoc=$('open-document');
  if(newDoc)newDoc.textContent='New';if(openDoc)openDoc.textContent='Open file…';
  const examples=$('choose-example');if(examples)examples.textContent='Examples…';
  const docSection=section('Document',row(newDoc,openDoc,examples,$('file-input')),recent,saveState);
  const prefsSection=section('Preferences',labelled('anchors','Show anchors'),labelled('auto-apply','Apply accepted changes immediately'),labelled('snap-resize','Snap resize to 0.1 in'),labelled('advanced-mode','Advanced tools'));
  const view=q('.canvas-view-options');if(view)view.hidden=true;
  // Changes live in a popover opened from the status chip (see syncStatus).
  const draft=q('.draft-toolbar'),queueStatus=$('queue-status');
  const applyAll=$('accept'),discardAll=$('cancel'),undoDraft=$('undo-draft');
  if(applyAll)applyAll.textContent='Apply all';if(discardAll)discardAll.textContent='Discard all';if(undoDraft)undoDraft.textContent='Undo last';
  const queuePanel=q('main aside .queue-panel');
  if(queuePanel){for(const h of queuePanel.querySelectorAll(':scope>h2,:scope>h3'))h.remove();const latest=$('diff');if(latest)latest.before(el('div',{class:'cl-field-name'},'Latest change'));}
  const changes=popover('cl-changes','Queued changes');
  changes.append(section('Changes',row(queueStatus&&el('span',{class:'cl-queue-text'},queueStatus),applyAll,discardAll,undoDraft),queuePanel));
  if(draft)draft.hidden=true;
  // Components open in a dialog (styled like the example picker) with the
  // existing controls laid out as two aligned rows.
  const components=q('.component-tools');
  const componentsDialog=el('dialog',{id:'components-dialog','aria-labelledby':'components-title'});
  if(components){
    components.open=true;components.classList.add('cl-components');
    const field=(text,control)=>el('label',{class:'cl-field'},el('span',{class:'cl-field-name'},text),control);
    const sum=components.querySelector(':scope>summary');
    components.replaceChildren(sum,
      el('div',{class:'cl-component-row'},field('Name',$('component-name')),$('save-component')),
      el('div',{class:'cl-component-row'},field('Components',$('components')),$('insert-component')));
    const closeComponents=el('button',{type:'button'},'Close');closeComponents.onclick=()=>componentsDialog.close();
    componentsDialog.append(el('div',{class:'example-heading'},el('h2',{id:'components-title'},'Reusable components'),closeComponents),el('p',{},'Saved on this browser, separately from document backups. Save the current selection, then insert it into any document.'),components);
    document.body.append(componentsDialog);
  }
  const componentsButton=el('button',{type:'button',id:'open-components'},'Components…');
  componentsButton.onclick=()=>{toggle(menu,menuButton,false);componentsDialog.showModal();};
  const backup=$('backup-workspace'),restore=$('restore-workspace');
  if(backup)backup.textContent='Back up documents…';if(restore)restore.textContent='Restore…';
  const advancedSection=section('Advanced',row(componentsButton,backup,restore,$('backup-input')));
  advancedSection.classList.add('cl-advanced-only');
  // Footer: where the code lives, and credit for the Pikchr renderer.
  const link=(href,text)=>{const a=el('a',{href,class:'cl-link'},text);if(/^https?:/.test(href)){a.target='_blank';a.rel='noopener';}return a;};
  if(help){help.textContent='How it works';help.classList.add('cl-link');}
  const shortcutsLink=el('button',{type:'button',class:'cl-link'},'Shortcuts');
  const footer=section('',el('div',{class:'cl-footer-links'},help,shortcutsLink,link('licenses.html','Licenses'),link('https://zeitforge.app/r/dmestas/pikchr-studio','Source')),
    el('p',{class:'cl-about'},'Rendered by ',link('https://pikchr.org','Pikchr'),', 0BSD.'));
  footer.setAttribute('aria-label','About');footer.classList.add('cl-footer');
  menu.append(docSection,prefsSection,advancedSection,footer);
  // Remaining toolbar controls (render, undo, redo, downloads, the documents
  // select) stay reachable by id but off-stage; the export menu takes the downloads.
  if(nav){nav.classList.add('cl-offstage');document.body.append(nav);}
  menuButton.onclick=()=>{syncRecent();toggle(menu,menuButton);};
  const exportMenu=popover('cl-export','Export');
  exportMenu.append(el('strong',{},'Export'),...['export-svg','export-png','export-selection','download'].map(id=>$(id)).filter(Boolean));
  exportButton.onclick=()=>toggle(exportMenu,exportButton);
  const syncTitle=()=>{const own=studio.title?.();const text=own||documents?.selectedOptions?.[0]?.textContent?.trim();const next=text&&text!=='Current diagram'?text:'Untitled';if(title.textContent!==next)title.textContent=next;};
  documents?.addEventListener('change',()=>{syncTitle();syncRecent();});syncTitle();syncRecent();
  if(documents)new MutationObserver(()=>{syncTitle();syncRecent();}).observe(documents,{childList:true,subtree:true,characterData:true});

  // ---- source drawer ---------------------------------------------------------
  const drawer=el('section',{class:'cl-drawer','aria-label':'Source drawer'});
  const closeDrawer=el('button',{type:'button',class:'cl-icon','aria-label':'Close source',title:'Close (S)'},'×');
  const renderNow=el('button',{type:'button',title:'Source renders as you type; use this if a render was interrupted'},'Render');
  renderNow.onclick=()=>$('render')?.click();
  const sourcePane=q('.source-pane');
  drawer.append(el('div',{class:'cl-drawer-head'},el('strong',{},'Source'),el('span',{class:'cl-muted'},'The source is the document.'),renderNow,closeDrawer));
  if(sourcePane)drawer.append(sourcePane);
  document.body.append(drawer);
  const setDrawer=open=>{
    if(open)for(const panel of popovers)if(!panel.hidden)toggle(panel,panel.opener,false);
    drawer.classList.toggle('open',open);sourceButton.setAttribute('aria-pressed',String(open));
    if(open)$('source')?.focus({preventScroll:true});else diagram.focus({preventScroll:true});
  };
  sourceButton.onclick=()=>setDrawer(!drawer.classList.contains('open'));
  closeDrawer.onclick=()=>setDrawer(false);

  // ---- status chip -----------------------------------------------------------
  const dot=el('i',{class:'cl-dot-state','aria-hidden':'true'});
  const summary=el('button',{type:'button',class:'cl-summary','aria-haspopup':'dialog','aria-expanded':'false',title:'Queued changes'},'Loading');summary.onclick=()=>toggle(changes,summary);
  const apply=el('button',{type:'button',disabled:''},'Apply');apply.onclick=()=>$('accept')?.click();
  const discard=el('button',{type:'button',disabled:''},'Discard');discard.onclick=()=>$('cancel')?.click();
  const statusChip=el('div',{class:'cl-float cl-status'},el('div',{class:'cl-status-line'},dot,summary,apply,discard));
  // The detailed status line stays in the DOM for assistive tech and scripts,
  // but shows as a short-lived toast instead of inside the chip.
  const statusHost=el('div',{class:'cl-offstage'});if(statusText)statusHost.append(statusText);document.body.append(statusHost);
  const toast=el('div',{class:'cl-note','aria-hidden':'true',hidden:''});document.body.append(toast);
  let toastTimer=0;
  const quiet=/^(Rendering|Rendered \d+ objects|Source changed\. Rendering|Previewing|Validating)/;
  if(statusText)new MutationObserver(()=>{
    const text=statusText.textContent.trim();if(!text||quiet.test(text))return;
    toast.textContent=text;toast.hidden=false;toast.classList.remove('cl-fade');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.classList.add('cl-fade');toastTimer=setTimeout(()=>{toast.hidden=true;},400);},3000);
  }).observe(statusText,{childList:true,characterData:true,subtree:true});
  const diagnostic=$('diagnostic');if(diagnostic){diagnostic.setAttribute('aria-live','assertive');statusChip.append(diagnostic);}
  document.body.append(statusChip);
  function syncStatus(){
    const s=studio.state(),invalid=diagram.classList.contains('stale')&&!!diagnostic?.textContent.trim();
    const queued=s.queued;
    summary.textContent=diagram.classList.contains('renderer-down')?'Renderer unavailable':invalid?'Invalid':queued?'Rendered · '+queued+' queued':s.valid?'Rendered':'Rendering…';
    statusChip.dataset.state=invalid||diagram.classList.contains('renderer-down')?'invalid':queued?'queued':'ok';
    apply.disabled=$('accept')?.disabled??true;discard.disabled=$('cancel')?.disabled??true;
    apply.hidden=discard.hidden=!queued;
    // The queue and Undo last are reachable only while there is something to review.
    const review=!!queued||!$('auto-apply')?.checked;
    if(summary.disabled===review)summary.disabled=!review;
    if(!review&&!changes.hidden)toggle(changes,summary,false);
  }

  // ---- tool palette ----------------------------------------------------------
  const palette=el('div',{class:'cl-float cl-palette',role:'toolbar','aria-label':'Tools'});
  document.body.append(palette);
  const tool=label=>q(`#direct-tools .mode-palette button[aria-label="${label}"]`);
  const selectTool=tool('Select'),panTool=tool('Pan'),placeTool=tool('Place shape'),connectTool=tool('Connect shapes'),textTool=tool('Text'),marquee=tool('Select area');
  const kindSelect=q('#direct-tools .active-shape-kind select');
  const key=(button,letter)=>{if(button){button.dataset.key=letter;button.title=(button.title||button.getAttribute('aria-label'))+' ('+letter+')';}return button;};
  const glyph=(label,letter,icon)=>key(el('button',{type:'button','aria-label':label,class:'cl-tool','aria-pressed':'false'},iconMarkup(CHROME_ICONS[icon])),letter);
  const shapeButtons={box:glyph('Box','B','box'),circle:glyph('Circle','C','circle'),cylinder:glyph('Cylinder','D','cylinder'),diamond:glyph('Diamond','R','diamond')};
  let connectKind='arrow';
  const lineButton=glyph('Line','L','line');
  function placeShape(kind){
    if(!kindSelect||!placeTool)return;
    const on=placeTool.getAttribute('aria-pressed')==='true';
    // The Text tool is place mode with kind 'text': switching from it only
    // changes the kind (clicking the place button would toggle it off).
    const texting=textTool?.getAttribute('aria-pressed')==='true';
    if(on&&kindSelect.value===kind){selectTool?.click();return;}
    kindSelect.value=kind;kindSelect.dispatchEvent(new Event('change',{bubbles:true}));
    if(!on&&!texting)placeTool.click();
    syncPalette();
  }
  for(const [kind,button] of Object.entries(shapeButtons))button.onclick=()=>placeShape(kind);
  function setConnect(kind){
    const on=connectTool?.getAttribute('aria-pressed')==='true';
    if(on&&connectKind===kind){selectTool?.click();return;}
    if(!on)connectTool?.click();
    connectKind=kind;syncPalette();
  }
  lineButton.onclick=()=>setConnect('line');
  key(selectTool,'V');key(marquee,'M');key(panTool,'H');key(textTool,'T');key(connectTool,'A');
  if(connectTool)connectTool.setAttribute('aria-label','Arrow');
  const sep=()=>el('span',{class:'cl-sep','aria-hidden':'true'});
  // Select multiple is a touch aid (no Shift-click): CSS shows it on coarse pointers only.
  const multi=$('multi-select');
  if(multi){multi.replaceChildren(iconMarkup(CHROME_ICONS.multi));multi.setAttribute('aria-label','Select multiple');multi.title='Select multiple';multi.classList.add('cl-tool','cl-multi');}
  // The chevron opens "Adding shapes": placement and connected-shape options
  // that used to sit in the menu's Tool options.
  const adding=popover('cl-adding','Adding shapes');
  const chevron=el('button',{type:'button',class:'cl-chevron','aria-label':'Adding shapes',title:'Adding shapes','aria-haspopup':'dialog','aria-expanded':'false'},iconMarkup(CHROME_ICONS.chevron));
  chevron.onclick=()=>toggle(adding,chevron);
  const addCoords=$('mobile-add');if(addCoords)addCoords.textContent='Add by coordinates…';
  adding.append(el('h3',{class:'cl-section-title'},'Adding shapes'),row($('place-center')),row($('mobile-add')),$('creation-tools'),el('div',{class:'cl-row'},$('add-neighbor'),$('neighbor-direction')?.closest('label')),labelled('keep-adding','Keep adding'));
  palette.append(...[selectTool,marquee,panTool,sep(),shapeButtons.box,shapeButtons.circle,shapeButtons.cylinder,shapeButtons.diamond,chevron,textTool,sep(),connectTool,lineButton,multi].filter(Boolean));
  // Shift-drag on empty canvas with the Select tool also selects an area.
  q('#direct-tools .tool-options')?.remove();
  // The canvas-tools status text and shape select stay available but off-stage.
  const toolsHost=$('direct-tools');if(toolsHost){toolsHost.classList.add('cl-offstage');palette.append(toolsHost);}
  if(placeTool)placeTool.classList.add('cl-offstage');
  // Write only on change: this runs from a MutationObserver on the same
  // attribute, and an unconditional write would re-trigger it forever.
  const press=(button,on)=>{const value=String(on);if(button.getAttribute('aria-pressed')!==value)button.setAttribute('aria-pressed',value);};
  function syncPalette(){
    const placing=placeTool?.getAttribute('aria-pressed')==='true';
    for(const [kind,button] of Object.entries(shapeButtons))press(button,placing&&kindSelect?.value===kind);
    const connecting=connectTool?.getAttribute('aria-pressed')==='true';
    if(!connecting)connectKind='arrow';
    press(lineButton,connecting&&connectKind==='line');
  }
  // canvas-tools sets aria-pressed on its own buttons; mirror that.
  new MutationObserver(syncPalette).observe(palette,{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
  // A direct click on the Arrow button always means an arrow; the Line button
  // and L shortcut set the kind after entering connect mode.
  connectTool?.addEventListener('click',()=>{connectKind='arrow';},true);

  // ---- history, zoom, help, feedback -----------------------------------------
  const history=q('.canvas-history');if(history){history.classList.add('cl-float','cl-history');document.body.append(history);}
  const zoom=q('.canvas-navigation');
  const helpButton=el('button',{type:'button','aria-label':'Shortcuts',title:'Shortcuts (?)','aria-expanded':'false'},iconMarkup(CHROME_ICONS.help));
  const iconButton=(id,name,title,icon)=>{const b=$(id);if(!b)return null;b.replaceChildren(iconMarkup(CHROME_ICONS[icon]));b.setAttribute('aria-label',name);b.title=title;return b;};
  iconButton('zoom-out','Zoom out','Zoom out (−)','out');iconButton('zoom-in','Zoom in','Zoom in (+)','in');
  const focusButton=iconButton('focus-selection','Focus selection','Focus selection (F)','focus');
  const findButton=iconButton('mobile-objects','Find object','Find object (/)','find');
  if(zoom){
    zoom.classList.add('cl-float','cl-zoom');
    $('fit-view')?.after(...[sep(),focusButton,findButton,sep()].filter(Boolean));
    zoom.append(helpButton);document.body.append(zoom);
  }
  const helpPanel=popover('cl-help','Shortcuts');
  // One list under three headings; keep in step with public/help.html.
  const keys=[
    ['Tools',[['V  M  H','Select, area, pan'],['B  C  D  R  T','Box, circle, cylinder, diamond, text'],['A  L','Arrow, line (drag to draw)']]],
    ['Editing',[['Enter · double-click','Edit text (Shift+Enter: new line)'],['⌘D  Del','Duplicate, delete'],['⌘A  Shift-drag','Select all, select area'],['Arrows','Nudge 0.1 in (Shift 1 in, Alt 0.01 in)'],['[  ]  Enter  Esc','Cycle, accept, discard a preview'],['⌘Z  ⇧⌘Z','Undo, redo']]],
    ['View',[['+  −  0  F','Zoom in, out, fit, focus selection'],['Space-drag','Pan over shapes'],['⌘-scroll · pinch','Zoom at pointer'],['/','Find object'],['S  ?','Source drawer, this panel']]],
  ];
  helpPanel.append(el('h2',{},'Shortcuts'),...keys.flatMap(([name,rows])=>[el('h3',{},name),el('dl',{},...rows.flatMap(([k,v])=>[el('dt',{},k),el('dd',{},v)]))]));
  helpButton.onclick=()=>toggle(helpPanel,helpButton);
  shortcutsLink.onclick=()=>{toggle(menu,menuButton,false);toggle(helpPanel,helpButton,true);};
  const feedback=$('canvas-feedback');if(feedback){feedback.classList.add('cl-toast');document.body.append(feedback);}

  // ---- contextual toolbar ----------------------------------------------------
  const context=el('div',{class:'cl-float cl-context',role:'toolbar','aria-label':'Selection actions'});
  const selection=q('.selection-toolbar');
  // One icon language for the toolbar: 24-unit line art drawn in currentColor.
  // Each button keeps its accessible name and tooltip; the SVG is decorative.
  const ICONS={
    'edit-selected':[['path',{d:'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z'}],['path',{d:'m14 6 4 4'}]],
    'fit-text':[['rect',{x:'3',y:'4',width:'18',height:'16',rx:'2'}],['path',{d:'M7 12h10'}],['path',{d:'m10 9-3 3 3 3'}],['path',{d:'m14 9 3 3-3 3'}]],
    'appearance-selected':[['path',{d:'M20 4 9.5 14.5'}],['path',{d:'m14.5 4.5 5 5'}],['path',{d:'M8.5 13.5a3 3 0 0 0-3 3c0 1.5-.5 2.5-1.5 3 1 .6 2 .9 3 .9a3 3 0 0 0 3-3 3 3 0 0 0-1.5-3.9z'}]],
    'route-selected':[['path',{d:'M5 18c0-7 4-11 14-11'}],['circle',{cx:'5',cy:'18',r:'2',fill:'currentColor',stroke:'none'}],['circle',{cx:'19',cy:'7',r:'2',fill:'currentColor',stroke:'none'}]],
    'tidy-route':[['path',{d:'M5 18h6a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h4'}],['circle',{cx:'5',cy:'18',r:'2',fill:'currentColor',stroke:'none'}],['circle',{cx:'19',cy:'6',r:'2',fill:'currentColor',stroke:'none'}]],
    'copy-selection':[['rect',{x:'8',y:'8',width:'12',height:'12',rx:'2'}],['path',{d:'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2'}]],
    'paste-selection':[['path',{d:'M9 4h6v3H9z'}],['path',{d:'M15 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2'}],['path',{d:'M9 12h6M9 16h4'}]],
    'duplicate-selected':[['rect',{x:'4',y:'4',width:'11',height:'11',rx:'2'}],['rect',{x:'9',y:'9',width:'11',height:'11',rx:'2'}],['path',{d:'M14.5 12v5M12 14.5h5'}]],
    'delete-selected':[['path',{d:'M4 7h16'}],['path',{d:'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'}],['path',{d:'M6.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7'}],['path',{d:'M10 11v6M14 11v6'}]],
    'show-source-selected':[['path',{d:'m8 8-4 4 4 4'}],['path',{d:'m16 8 4 4-4 4'}],['path',{d:'m13.5 5-3 14'}]],
  };
  const MORE_ICON=[['circle',{cx:'5',cy:'12',r:'1.7',fill:'currentColor',stroke:'none'}],['circle',{cx:'12',cy:'12',r:'1.7',fill:'currentColor',stroke:'none'}],['circle',{cx:'19',cy:'12',r:'1.7',fill:'currentColor',stroke:'none'}]];
  function iconMarkup(marks){
    const svg=svgEl('svg',{viewBox:'0 0 24 24',width:'20',height:'20','aria-hidden':'true',focusable:'false',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round'});
    for(const [tag,attrs] of marks)svg.append(svgEl(tag,attrs));
    return svg;
  }
  if(selection){
    for(const [id,marks] of Object.entries(ICONS)){
      const b=$(id);if(!b)continue;
      const name=b.textContent.trim();
      if(name){b.setAttribute('aria-label',name);b.title=name+(b.title&&b.title!==name?' — '+b.title:'');}
      b.replaceChildren(iconMarkup(marks));
    }
    context.append(selection);
  }
  const moreButton=el('button',{type:'button',class:'cl-more-button','aria-label':'More options',title:'Inspector and more','aria-expanded':'false'},iconMarkup(MORE_ICON));
  // Direct reconnect actions for a selected connector: they arm the same
  // canvas anchors the inspector offers, without opening it over the target.
  const changeStart=el('button',{type:'button',class:'cl-endpoint-action',title:'Reconnect the connector start'},'Change start');
  const changeEnd=el('button',{type:'button',class:'cl-endpoint-action',title:'Reconnect the connector end'},'Change end');
  changeStart.onclick=()=>changeEndpoint('from');
  changeEnd.onclick=()=>changeEndpoint('to');
  context.append(changeStart,changeEnd,moreButton);document.body.append(context);
  const more=popover('cl-more','Inspector');
  const moreTitle=el('strong',{class:'cl-more-title','aria-live':'polite','aria-atomic':'true'},'Selection');
  const moreKind=el('span',{class:'cl-muted cl-popover-kind'});
  const closeMore=el('button',{type:'button',class:'cl-icon cl-close','aria-label':'Close inspector',title:'Close (Esc)'},'×');
  function restoreFocus(panel){
    const button=panel.returnFocus||panel.opener;
    const fallback=moreButton.getClientRects().length?moreButton:menuButton;
    (button?.isConnected&&button.getClientRects().length?button:fallback).focus();
  }
  closeMore.onclick=()=>{toggle(more,more.opener,false);restoreFocus(more);};
  more.append(el('div',{class:'cl-popover-head'},moreTitle,moreKind,closeMore));
  // Two views, one bounded panel: properties for the selection, and an
  // outline for finding objects. The panel never stacks both at once.
  const propertiesView=el('div',{class:'cl-view cl-view-properties'});
  const objectsView=el('div',{class:'cl-view cl-view-objects',hidden:''});
  more.append(propertiesView,objectsView);
  const backButton=el('button',{type:'button',class:'cl-back'},'Back to properties');
  const objectSearch=el('input',{type:'search',id:'object-search','aria-label':'Find an object',placeholder:'Name, label or type',autocomplete:'off'});
  const objectCount=el('span',{class:'cl-muted',id:'objects-count'});
  const objectEmpty=el('p',{class:'cl-empty',id:'objects-empty',role:'status',hidden:''});
  objectsView.append(backButton,el('label',{class:'cl-field'},el('span',{class:'cl-field-name'},'Find an object'),objectSearch),el('div',{class:'cl-objects-head'},el('span',{},'Drawing order'),objectCount),objectEmpty);
  const propertiesHead=moreTitle,kindHead=moreKind;
  function showMoreView(name){
    const objects=name==='objects';
    if(propertiesView.hidden!==objects)more.scrollTop=0;
    propertiesView.hidden=objects;objectsView.hidden=!objects;
    if(propertiesHead.textContent!==(objects?'Objects':syncMoreTitle()))propertiesHead.textContent=objects?'Objects':syncMoreTitle();
    kindHead.hidden=objects;
    if(objects){
      // Filtering belongs to app.js, which owns the outline rows; one input
      // event refreshes the count and empty state from the same code path.
      objectSearch.dispatchEvent(new Event('input',{bubbles:true}));
      requestAnimationFrame(()=>objectSearch.focus({preventScroll:true}));
    }
  }
  backButton.onclick=()=>{showMoreView('properties');syncMoreHead();closeMore.focus();};
  // Label text is edited on the canvas; this dialog adds the sizing choice
  // (grow the shape, wrap inside it, or keep a fixed size).
  const labelOptions=el('button',{type:'button',class:'cl-label-options'},'Label options…');
  labelOptions.onclick=()=>{toggle(more,moreButton,false);studio.editLabelDialog?.();};
  propertiesView.append(labelOptions);
  // Group actions keep their shared editor in the properties view.
  // Style uses the same guarded group form as the contextual action.
  const groupCount=el('span',{class:'cl-muted'});
  const groupStyle=el('button',{type:'button',class:'cl-group-style'},'Style…');
  groupStyle.onclick=()=>{$('appearance-selected')?.click();};
  const groupSection=el('section',{class:'cl-group','aria-label':'Group actions',hidden:''},
    el('div',{class:'cl-group-head'},el('strong',{},'Group'),groupCount),
    selection?.querySelector('.move-selection')||null,
    el('div',{class:'cl-group-arrange'},selection?.querySelector('.arrange-selection')||null,$('arrange')||null,groupStyle));
  propertiesView.append(groupSection);
  const dock=q('.canvas-context-dock');if(dock)propertiesView.append(dock);
  const aside=q('main aside');
  // Search and properties never compete for the same panel height.
  const objectsSection=aside?.querySelector('#objects')?.closest('section');
  if(objectsSection){
    objectsView.append($('objects'));
    objectsSection.remove();
  }
  if(aside)propertiesView.append(aside);
  // Runs from layout() too, so a selection made while the popover is open
  // switches it between the object inspector and the group section. Every
  // write is conditional: layout() is driven by DOM observers.
  const syncMoreTitle=()=>{
    const s=studio.state(),o=s.object,count=(s.selectedIds||[]).length;
    return count>1?count+' selected':o?.name||(o?o.kind:'Selection');
  };
  const syncMoreHead=()=>{
    const s=studio.state(),o=s.object,count=(s.selectedIds||[]).length,group=count>1;
    const title=syncMoreTitle(),kind=group?'':o&&o.name?o.kind:'';
    if(!objectsView.hidden)return;
    if(moreTitle.textContent!==title)moreTitle.textContent=title;
    if(moreKind.textContent!==kind)moreKind.textContent=kind;
    if(groupSection.hidden!==!group)groupSection.hidden=!group;
    if(labelOptions.hidden!==group)labelOptions.hidden=group;
    const note=group?'Move, arrange or style every selected object as one change.':'';
    if(groupCount.textContent!==note)groupCount.textContent=note;
  };
  moreButton.onclick=()=>{showMoreView('properties');syncMoreHead();toggle(more,moreButton);};
  // Classic buttons (Style, Route) open the inspector by adding a body class;
  // Objects opens the outline view. Each keeps its trigger as the opener so
  // Escape and Close return focus there.
  new MutationObserver(()=>{
    const cls=document.body.classList;
    const wanted=cls.contains('inspector-open')||cls.contains('objects-open');if(!wanted)return;
    const objects=cls.contains('objects-open');
    cls.remove('inspector-open','objects-open');
    showMoreView(objects?'objects':'properties');syncMoreHead();
    const focus=objects?menuButton:(document.activeElement?.closest('.cl-context button')||more.returnFocus||moreButton);
    toggle(more,moreButton,true);more.returnFocus=focus;
    if(objects)return;
    const s=$('inspector')?.querySelector('.appearance-editor[open]');if(s){s.scrollIntoView({block:'nearest'});s.querySelector('input,select')?.focus({preventScroll:true});}
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
  // Choosing an object from the outline returns to its properties, so the
  // list is a way in rather than a place to get stuck.
  $('objects')?.addEventListener('click',e=>{if(e.target.closest('button')){showMoreView('properties');syncMoreHead();closeMore.focus();}});
  $('show-source-selected')?.addEventListener('click',()=>setDrawer(true));

  // ---- candidate chip ----------------------------------------------------------
  const previewActions=$('preview-actions');
  const check=el('span',{class:'cl-check','aria-hidden':'true'},'✓'),code=el('code',{class:'cl-code'}),count=el('small',{class:'cl-count'});
  if(previewActions){
    previewActions.classList.add('cl-float','cl-candidate');document.body.append(previewActions);
    previewActions.prepend(check,code,count);
    const keep=$('preview-discard');if(keep){keep.textContent='Esc';keep.title='Keep the original (Escape)';keep.setAttribute('aria-label','Keep the original');}
    $('preview-accept')?.setAttribute('title','Accept (Enter)');
    $('preview-prev')?.setAttribute('title','Previous ([)');$('preview-next')?.setAttribute('title','Next (])');
  }
  // Show only the changed words of the statement, as in "with .n at 0.6 below API.s".
  function changedWords(before,after){
    let a=0;while(a<before.length&&a<after.length&&before[a]===after[a])a++;
    let z=0;while(z<before.length-a&&z<after.length-a&&before[before.length-1-z]===after[after.length-1-z])z++;
    while(a>0&&!/\s/.test(after[a-1]))a--;
    // Widen to the start of the placement clause so "at (4,0)" reads whole.
    const head=after.slice(0,a),clause=Math.max(head.lastIndexOf(' at '),head.lastIndexOf(' with '));
    if(clause>=0&&!head.slice(clause).includes('"'))a=clause+1;
    while(z>0&&!/\s/.test(after[after.length-z]))z--;
    return after.slice(a,after.length-z).trim()||after.trim();
  }
  function syncCandidate(){
    const p=studio.preview?.();if(!p)return;
    const text=changedWords(p.before,p.after);
    if(code.textContent!==text){code.textContent=text;code.title=p.label;}
    const n=(p.index+1)+' / '+p.count;if(count.textContent!==n)count.textContent=n;
  }

  // ---- positioning -------------------------------------------------------------
  let frame=0;
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;layout();});}
  function boxOnScreen(object){
    const b=object?.bbox;if(!b)return null;
    const a=studio.modelToScreen({x:b.x,y:b.y+b.height}),z=studio.modelToScreen({x:b.x+b.width,y:b.y});
    if(!a||!z)return null;return {left:Math.min(a.x,z.x),top:Math.min(a.y,z.y),right:Math.max(a.x,z.x),bottom:Math.max(a.y,z.y)};
  }
  function place(node,box,gap=12){
    const w=node.offsetWidth,h=node.offsetHeight,vw=innerWidth,vh=innerHeight;
    let left=(box.left+box.right)/2-w/2;left=Math.max(8,Math.min(vw-w-8,left));
    let top=box.top-h-gap;if(top<64)top=box.bottom+gap;top=Math.max(64,Math.min(vh-h-64,top));
    node.style.left=left+'px';node.style.top=top+'px';
  }
  function markSelection(){
    const svg=svgNow(),ids=new Set(studio.state().selectedIds||[]);
    if(!svg)return;
    for(const g of svg.querySelectorAll('[data-pikchr-id]')){const on=ids.has(g.getAttribute('data-pikchr-id'));if(g.classList.contains('cl-selected')!==on)g.classList.toggle('cl-selected',on);}
  }
  function layout(){
    syncStatus();syncTitle();markSelection();syncCandidate();syncMoreHead();
    if(!more.hidden){
      const padding=(more.querySelector('.cl-popover-head').offsetHeight+8)+'px';
      if(more.style.scrollPaddingTop!==padding)more.style.scrollPaddingTop=padding;
    }
    const s=studio.state(),object=s.object;
    const previewing=!!previewActions&&!previewActions.hidden;
    const dragging=stage.classList.contains('cl-pressing')||!!connect||targeting||previewing;
    const box=object&&!dragging?boxOnScreen(object):null;
    const visible=!inline&&!targeting&&!!box&&box.right>0&&box.left<innerWidth&&box.bottom>0&&box.top<innerHeight;
    const connector=!!selectedLine();
    const endpoints=connector&&s.valid&&connectorCapabilities(s)?.endpoints;
    changeStart.hidden=changeEnd.hidden=!connector;
    changeStart.disabled=changeEnd.disabled=!endpoints;
    changeStart.title=changeEnd.title=endpoints?'':'This connector has no editable shape endpoint.';
    context.hidden=!visible;
    if(visible)place(context,box,30);
    syncTextBar(visible&&!inline);
    if(pendingText&&!inline)maybeEditNewText();
    if(previewActions&&!previewActions.hidden){
      const overlay=diagram.querySelector('.preview-overlay rect')?.getBoundingClientRect();
      const target=overlay?{left:overlay.left,top:overlay.top,right:overlay.right,bottom:overlay.bottom}:box;
      if(target){
        const w=previewActions.offsetWidth,h=previewActions.offsetHeight;
        let left=Math.max(8,Math.min(innerWidth-w-8,(target.left+target.right)/2-w/2));
        let top=target.bottom+14;if(top+h>innerHeight-64)top=Math.max(64,target.top-h-14);
        if(!more.hidden){
          const panel=more.getBoundingClientRect();
          if(left<panel.right&&left+w>panel.left&&top<panel.bottom&&top+h>panel.top){
            // Keep confirmation beside the inspector, not over its choices.
            if(panel.top-h-8>=64)top=panel.top-h-8;
            else if(panel.left-w-8>=8)left=panel.left-w-8;
            else if(panel.bottom+h+8<=innerHeight-8)top=panel.bottom+8;
          }
        }
        previewActions.style.left=left+'px';previewActions.style.top=top+'px';
      }
      if(!context.hidden&&previewActions.getBoundingClientRect().top<context.getBoundingClientRect().bottom+4&&previewActions.getBoundingClientRect().bottom>context.getBoundingClientRect().top)context.hidden=true;
    }
    drawDots();drawLineHandles();
  }
  new MutationObserver(schedule).observe(diagram,{childList:true,subtree:true,attributes:true,attributeFilter:['viewBox','class']});
  // The count updates on every selection change, and the toggle's pressed
  // state changes outside the toolbar; either re-syncs the ⋯ head.
  for(const node of [selection,$('selection-count'),$('multi-select'),$('queue-status'),diagnostic,previewActions,$('accept')].filter(Boolean))
    new MutationObserver(schedule).observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','disabled','aria-pressed']});
  let refitTimer=0;
  addEventListener('resize',()=>{schedule();clearTimeout(refitTimer);refitTimer=setTimeout(()=>{studio.refit?.();schedule();},120);});
  requestAnimationFrame(()=>studio.refit?.());
  stage.addEventListener('pointerdown',()=>{stage.classList.add('cl-pressing');schedule();},true);
  addEventListener('pointerup',()=>{if(stage.classList.contains('cl-pressing')){stage.classList.remove('cl-pressing');schedule();}},true);

  // ---- drag to connect -------------------------------------------------------
  let hovered=null,connect=null,targeting=false,armedObserver=null,cache={scene:null,source:null,list:[]};
  // While an endpoint is being dragged or its anchors are armed, chrome that
  // could cover the intended target (selection toolbar, inspector, text bar)
  // steps out of the way. This is the layout's own layer to hide.
  let targetingDrag=false;
  function setTargeting(on,dragging=false){
    if(targeting===on&&targetingDrag===dragging)return;
    targeting=on;targetingDrag=dragging;
    document.body.classList.toggle('cl-targeting',on);
    document.body.classList.toggle('cl-targeting-drag',on&&dragging);
    schedule();
    // A drag from the canvas may have left a popover open where the pointer
    // now needs to go; an armed reconnect started inside the inspector keeps
    // it open so its own Cancel reconnect stays usable.
    if(on&&dragging)for(const panel of popovers)if(!panel.hidden)toggle(panel,panel.opener,false);
  }
  function noteReconnectArmed(){
    const armed=[...document.querySelectorAll('.arrow-overlay .anchor-target')].some(d=>d.style.pointerEvents==='all');
    setTargeting(armed||!!endpointDrag,!!endpointDrag);
  }
  function watchReconnect(){
    if(armedObserver)return;
    armedObserver=new MutationObserver(noteReconnectArmed);
    armedObserver.observe(diagram,{subtree:true,attributes:true,attributeFilter:['style','class']});
  }
  let endpointDrag=null;
  watchReconnect();
  // An endpoint drag is a targeting gesture too. The arrow editor owns the
  // drag; the layout only observes it so chrome clears, and relays Escape as a
  // pointercancel so the cancel path is the editor's own.
  diagram.addEventListener('pointerdown',e=>{
    const handle=endpointHandle(e);if(!handle)return;
    endpointDrag={handle,pointerId:e.pointerId};setTargeting(true,true);
  },true);
  const endEndpointDrag=()=>{endpointDrag=null;noteReconnectArmed();};
  addEventListener('pointerup',e=>{if(endpointDrag&&e.pointerId===endpointDrag.pointerId)endEndpointDrag();},true);
  addEventListener('pointercancel',endEndpointDrag,true);
  addEventListener('keydown',e=>{
    if(e.key!=='Escape'||!endpointDrag)return;
    e.preventDefault();e.stopImmediatePropagation();
    const {handle,pointerId}=endpointDrag;endpointDrag=null;
    handle.dispatchEvent(new PointerEvent('pointercancel',{pointerId,bubbles:true}));
    noteReconnectArmed();
  },true);
  const svgNow=()=>diagram.querySelector('svg');
  const sceneMatrix=scene=>{const t=scene.transform;return new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]);};
  const toSvg=(scene,p)=>new DOMPoint(p.x,p.y).matrixTransform(sceneMatrix(scene));
  function connectable(){
    const s=studio.state();if(!s.valid||!s.scene)return [];
    if(cache.scene!==s.scene||cache.source!==s.source){let list=[];try{list=connectableShapes(s.source,s.scene);}catch{}cache={scene:s.scene,source:s.source,list};}
    return cache.list;
  }
  const connectMode=()=>connectTool?.getAttribute('aria-pressed')==='true';
  // The arrow editor draws the connector endpoint handles. They are drawn by
  // another module, so recognise them by their own attribute and let the
  // endpoint gesture own the press: no creation dot or shape drag may start.
  const endpointHandle=e=>e.target.closest?.('.arrow-overlay .endpoint-handle')||null;
  function changeEndpoint(which){
    const s=studio.state();if(!s.valid||!selectedLine())return;
    for(const panel of popovers)if(!panel.hidden)toggle(panel,panel.opener,false);
    const editor=document.querySelector('.arrow-overlay');
    if(!editor)return;
    const tab=[...document.querySelectorAll('.arrow-editor .endpoint-tabs button')][which==='from'?0:1];
    tab?.click();
    const reconnect=[...document.querySelectorAll('.arrow-editor button')].find(b=>b.textContent==='Reconnect on canvas');
    if(reconnect&&reconnect.getAttribute('aria-pressed')!=='true')reconnect.click();
    toggle(more,moreButton,false);setTargeting(true);
  }
  let dotsKey=null;
  function drawDots(){
    const svg=svgNow();
    const previewing=!!previewActions&&!previewActions.hidden;
    const s=studio.state();
    // A selected connector's endpoint handles own the anchors they sit on, and
    // an armed reconnect owns the canvas: never put a creation dot over them.
    const line=!targeting&&!previewing?selectedLine():null;
    const ends=line?lineEnds(s.source,s.scene,line):null;
    const owned=ends?['from','to'].map(w=>ends[w].point).filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)):[];
    const list=svg&&!connect&&!previewing&&!targeting&&s.valid?connectable():[];
    const targets=[hovered,s.object].filter((o,i,all)=>o&&all.indexOf(o)===i&&list.includes(o));
    const scale=svg?Math.hypot(svg.getScreenCTM()?.a||1,svg.getScreenCTM()?.b||0)||1:1;
    const pointsOf=object=>attachPoints(object).filter(point=>!owned.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<1e-6));
    // Redraw only when something visible changed; the layer itself is inside
    // the observed diagram, so an unconditional redraw would loop.
    const key=targets.length?[targets.map(o=>o.id+':'+pointsOf(o).map(p=>p.anchor).join(',')).join(';'),svg.getAttribute('viewBox'),scale.toFixed(4),s.source.length].join('|'):null;
    const existing=svg?.querySelector('.cl-dots');
    if(key===dotsKey&&(!key||existing))return;
    dotsKey=key;existing?.remove();
    if(!key)return;
    const layer=svgEl('g',{class:'cl-dots'});
    for(const object of targets){
      // A dot's hit zone never covers more than 30% of the shape's shorter
      // side, so a tap on a small shape (phones, zoomed out) still hits it.
      const lo=toSvg(s.scene,{x:object.bbox.x,y:object.bbox.y}),hi=toSvg(s.scene,{x:object.bbox.x+object.bbox.width,y:object.bbox.y+object.bbox.height});
      const hitR=Math.min(10/scale,.3*Math.min(Math.abs(hi.x-lo.x),Math.abs(hi.y-lo.y)));
      for(const point of pointsOf(object)){
      // On the edge midpoint, as in the mockup; resize handles sit on corners.
      const p=toSvg(s.scene,point),attrs={'data-id':object.id,'data-anchor':point.anchor};
      layer.append(svgEl('circle',{...attrs,class:'cl-dot-hit',cx:p.x,cy:p.y,r:hitR,fill:'transparent'}),
        svgEl('circle',{...attrs,class:'cl-dot',cx:p.x,cy:p.y,r:5/scale,'vector-effect':'non-scaling-stroke'}));
    }
    }
    // The endpoint handles are the older, more specific affordance: keep them
    // above creation dots so a press there always drags the endpoint.
    const overlay=svg.querySelector('.arrow-overlay');
    if(overlay)svg.insertBefore(layer,overlay);else svg.append(layer);
  }
  diagram.addEventListener('pointermove',e=>{
    if(connect||e.buttons)return;
    if(endpointHandle(e)){if(hovered){hovered=null;drawDots();}return;}
    const s=studio.state();if(!s.valid){if(hovered){hovered=null;drawDots();}return;}
    const onDot=e.target.closest?.('.cl-dots');if(onDot)return;
    const p=studio.screenToModel(e.clientX,e.clientY);if(!p)return;
    const next=hitShape(connectable(),p,{margin:0.12});
    if(next!==hovered){hovered=next;drawDots();}
  });
  diagram.addEventListener('pointerleave',()=>{if(!connect&&hovered){hovered=null;drawDots();}});

  // Shift+drag on empty canvas selects an area (the tool is in the palette).
  diagram.addEventListener('pointerdown',e=>{
    if(e.button!==0||!e.shiftKey||connect||!marquee||e.target.closest?.('[data-pikchr-id],.cl-dots,.canvas-overlay,.arrow-overlay'))return;
    if(selectTool?.getAttribute('aria-pressed')!=='true'||!studio.state().valid)return;
    marquee.click();
  },true);
  diagram.addEventListener('pointerdown',e=>{
    if(e.button!==0||connect)return;
    const s=studio.state();if(!s.valid)return;
    if(endpointHandle(e))return;
    const handle=e.target.closest?.('.cl-dots [data-anchor]');
    let from=null,anchor=null,startPoint=null;
    if(handle){from=s.scene.objects.find(o=>o.id===handle.dataset.id);anchor=handle.dataset.anchor;}
    // Arrow/Line tool: a press on a shape attaches to its nearest side; a
    // press on empty canvas starts a free line at that point.
    else if(connectMode()){const p=studio.screenToModel(e.clientX,e.clientY);if(!p)return;from=hitShape(connectable(),p,{margin:0.05});anchor=from&&nearestAnchor(from,p);if(!from)startPoint={x:snapToGrid(p.x),y:snapToGrid(p.y)};}
    if(!(from&&anchor)&&!startPoint)return;
    e.preventDefault();e.stopPropagation();
    connect={pointerId:e.pointerId,from,anchor,startPoint,free:connectMode(),x:e.clientX,y:e.clientY,moved:false,target:null,targetAnchor:null,at:null,kind:connectKind,busy:false,key:null,painted:null,scene:s.scene,source:s.source};
    try{diagram.setPointerCapture(e.pointerId);}catch{}
    badge.hidden=false;badge.textContent=labelFor(connect);schedule();
  },true);
  const badge=el('div',{class:'cl-badge',role:'status','aria-live':'polite',hidden:''});document.body.append(badge);
  // The badge sits beside the middle of the longest guide segment, off the line.
  const moveBadge=()=>{
    const svg=svgNow(),c=connect;if(!svg||!c?.screen?.length)return;
    let best=null;for(let i=1;i<c.screen.length;i++){const a=c.screen[i-1],b=c.screen[i],len=Math.hypot(b.x-a.x,b.y-a.y);if(!best||len>best.len)best={a,b,len};}
    if(!best)return;
    const mx=(best.a.x+best.b.x)/2,my=(best.a.y+best.b.y)/2,horizontal=Math.abs(best.b.x-best.a.x)>=Math.abs(best.b.y-best.a.y);
    const w=badge.offsetWidth,h=badge.offsetHeight;
    let left=horizontal?mx-w/2:mx+12,top=horizontal?my-h-10:my-h/2;
    left=Math.max(8,Math.min(innerWidth-w-8,left));top=Math.max(8,Math.min(innerHeight-h-8,top));
    badge.style.left=left+'px';badge.style.top=top+'px';
  };
  diagram.addEventListener('pointermove',e=>{
    if(!connect||connect.pointerId!==e.pointerId)return;
    e.stopPropagation();
    if(Math.hypot(e.clientX-connect.x,e.clientY-connect.y)>4)connect.moved=true;
    let p=studio.screenToModel(e.clientX,e.clientY);if(!p)return;
    const origin=startOf(connect);
    const target=hitShape(connectable(),p,{margin:0.05,exclude:connect.from});
    // Shift: when not over a shape, keep the line horizontal, vertical or 45°.
    if(!target&&(e.shiftKey||shiftDown))p=lockDirection(origin,p).point;
    connect.target=target;connect.targetAnchor=target?targetAnchor(target,p,origin):null;connect.at=target?null:p;connect.pointer=p;
    badge.textContent=labelFor(connect);
    drawRubber();moveBadge();
  },true);
  function startOf(c){return c.from?c.from.anchors[c.anchor]:c.startPoint;}
  function labelFor(c){
    const start=c.from?`${c.from.name}.${c.anchor}`:pointText(c.startPoint);
    const end=c.target?`${c.target.name}.${c.targetAnchor}`:c.free?(c.pointer?pointText({x:snapToGrid(c.pointer.x),y:snapToGrid(c.pointer.y)}):'…'):'new shape';
    return `${start} → ${end}`;
  }
  let shiftDown=false;
  for(const type of ['keydown','keyup'])addEventListener(type,e=>{if(e.key==='Shift')shiftDown=type==='keydown';},true);
  addEventListener('blur',()=>{shiftDown=false;});
  function candidateFor(c){
    if(c.free||!c.from)return freeLineCandidate(c.source,c.scene,{start:c.from?{object:c.from,anchor:c.anchor}:{point:c.startPoint},end:c.target?{object:c.target,anchor:c.targetAnchor}:{point:c.pointer},kind:c.kind});
    return connectCandidate(c.source,c.scene,{from:c.from,fromAnchor:c.anchor,to:c.target,toAnchor:c.targetAnchor,at:c.target?null:{x:Math.round(c.at.x*20)/20,y:Math.round(c.at.y*20)/20},kind:c.kind});
  }
  // The guide is an overlay only: a dashed accent path with the same bends the
  // created connector will have. The real connector appears in the candidate
  // preview after release.
  function drawRubber(){
    const svg=svgNow(),c=connect;if(!svg||!c)return;
    svg.querySelector('.cl-rubber')?.remove();
    for(const g of svg.querySelectorAll('.cl-target-shape'))g.classList.remove('cl-target-shape');
    const start=startOf(c);if(!c.pointer)return;
    const model=c.target&&c.from?elbowRoute(start,c.anchor,c.target.anchors[c.targetAnchor],c.targetAnchor).points:[start,c.target?c.target.anchors[c.targetAnchor]:c.pointer];
    const pts=model.map(p=>toSvg(c.scene,p));
    const ctm=svg.getScreenCTM();c.screen=ctm?pts.map(p=>new DOMPoint(p.x,p.y).matrixTransform(ctm)):[];
    const layer=svgEl('g',{class:'cl-rubber','aria-hidden':'true'});
    const scale=ctm?Math.hypot(ctm.a,ctm.b)||1:1;
    layer.append(svgEl('path',{d:'M'+pts.map(p=>p.x+' '+p.y).join(' L'),class:'cl-rubber-line','vector-effect':'non-scaling-stroke','marker-end':'url(#cl-head)'}));
    if(!svg.querySelector('#cl-head')){
      const defs=svgEl('defs',{}),marker=svgEl('marker',{id:'cl-head',markerWidth:10,markerHeight:8,refX:9,refY:4,orient:'auto',markerUnits:'userSpaceOnUse'});
      marker.append(svgEl('path',{d:'M0 0L10 4L0 8z',class:'cl-head'}));defs.append(marker);svg.prepend(defs);
    }
    if(c.target){
      svg.querySelector(`[data-pikchr-id="${c.target.id}"]`)?.classList.add('cl-target-shape');
      for(const point of attachPoints(c.target)){const p=toSvg(c.scene,point),on=point.anchor===c.targetAnchor;
        layer.append(svgEl('circle',{cx:p.x,cy:p.y,r:(on?6:5)/scale,class:on?'cl-dot cl-snap':'cl-dot','vector-effect':'non-scaling-stroke'}));}
    }
    const origin=toSvg(c.scene,start);layer.append(svgEl('circle',{cx:origin.x,cy:origin.y,r:5/scale,class:'cl-dot cl-snap','vector-effect':'non-scaling-stroke'}));
    svg.append(layer);
  }
  function clearLive(){const svg=svgNow();for(const g of svg?.querySelectorAll('.cl-target-shape')||[])g.classList.remove('cl-target-shape');}
  function endConnect(){
    const svg=svgNow();svg?.querySelector('.cl-rubber')?.remove();svg?.querySelector('#cl-head')?.closest('defs')?.remove();clearLive();
    connect=null;badge.hidden=true;hovered=null;schedule();
  }
  diagram.addEventListener('pointerup',async e=>{
    if(!connect||connect.pointerId!==e.pointerId)return;
    e.stopPropagation();const c=connect;endConnect();
    try{diagram.releasePointerCapture(e.pointerId);}catch{}
    if(!c.moved)return;
    let option;try{option=candidateFor(c);}catch(error){$('state').textContent=error.message;return;}
    const s=studio.state();if(!s.valid||s.source!==c.source){$('state').textContent='The diagram changed. Try the connection again.';return;}
    await studio.propose([option]);
    // The Arrow/Line tool stays active for the next line until Escape or V.
    if(c.free&&!connectMode()){connectTool?.click();connectKind=c.kind;syncPalette();}
  },true);
  const cancelConnect=()=>{if(connect)endConnect();};
  diagram.addEventListener('pointercancel',cancelConnect,true);
  diagram.addEventListener('lostpointercapture',e=>{if(connect&&connect.pointerId===e.pointerId)cancelConnect();});
  addEventListener('blur',cancelConnect);


  // ---- on-canvas text ------------------------------------------------------------
  // Text is edited where it sits: T places a text object and opens an editor
  // over it; double-click or Enter edits any label. Enter commits, Shift+Enter
  // adds a line, Escape cancels. Commits go through the normal validated path.
  const textKinds=['box','cylinder','circle','ellipse','oval','diamond','text'];
  let inline=null,pendingText=0;
  function labelText(o){const s=studio.state();if(!o||!textKinds.includes(o.kind))return null;try{return inspectProperties(s.source,o,s.scene).text;}catch{return null;}}
  function maybeEditNewText(){
    if(Date.now()-pendingText>4000){pendingText=0;return;}
    const s=studio.state(),o=s.object;
    if(s.valid&&o?.kind==='text'&&labelText(o)===''){pendingText=0;openInline(o,{created:true});}
  }
  function openInline(object,{created=false}={}){
    const s=studio.state();if(!s.valid||inline||!object)return false;
    const text=labelText(object);if(text===null)return false;
    const box=boxOnScreen(object);if(!box)return false;
    const svg=svgNow(),group=svg?.querySelector(`[data-pikchr-id="${object.id}"]`);
    const sample=group?.querySelector('text')||svg?.querySelector('text');
    const ctm=svg?.getScreenCTM(),scale=ctm?Math.hypot(ctm.a,ctm.b)||1:1;
    const cs=sample?getComputedStyle(sample):null;
    const fontPx=Math.max(12,(cs?parseFloat(cs.fontSize)||16:16)*scale);
    const ta=el('textarea',{class:'cl-inline-text','aria-label':created?'New text':'Edit text',spellcheck:'false',rows:'1'});
    ta.value=text;
    Object.assign(ta.style,{fontFamily:cs?.fontFamily||'sans-serif',fontWeight:cs?.fontWeight||'normal',fontStyle:cs?.fontStyle||'normal',fontSize:fontPx+'px',lineHeight:'1.25'});
    const cx=(box.left+box.right)/2,cy=(box.top+box.bottom)/2,width=Math.max(140,box.right-box.left);
    const fit=()=>{ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';ta.style.left=(cx-width/2)+'px';ta.style.top=(cy-ta.offsetHeight/2)+'px';};
    ta.style.width=width+'px';
    const hidden=[...(group?.querySelectorAll('text')||[])];for(const t of hidden)t.style.visibility='hidden';
    document.body.append(ta);fit();ta.focus();if(created)ta.select();else ta.setSelectionRange(ta.value.length,ta.value.length);
    inline={object,ta,created,original:text,source:s.source,hidden};context.hidden=true;textBar.hidden=true;
    ta.addEventListener('input',fit);
    ta.addEventListener('keydown',e=>{
      e.stopPropagation();
      if(e.key==='Escape'){e.preventDefault();closeInline(false);}
      else if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();closeInline(true);}
    });
    ta.addEventListener('blur',()=>closeInline(true));
    return true;
  }
  async function closeInline(commit){
    const d=inline;if(!d)return;inline=null;
    d.ta.remove();for(const t of d.hidden)t.style.visibility='';
    diagram.focus({preventScroll:true});schedule();
    const text=d.ta.value.replace(/\r/g,'').replace(/\s+$/,'');
    // A new text that ends up empty is removed again (undo the creation).
    if(d.created&&(!commit||!text.trim())){$('canvas-undo')?.click();return;}
    if(!commit||text===d.original)return;
    const s=studio.state();
    if(!s.valid||s.source!==d.source){$('state').textContent='The diagram changed. Edit the text again.';return;}
    const kind=d.object.kind,mode=kind==='text'?'fixed':kind==='box'?'wrap':'grow';
    let option;
    try{option=await buildTextEdit(s.source,s.scene,d.object,{text,mode,width:d.object.bbox?.width},studio.render);}
    catch(error){
      if(mode!=='wrap'){$('state').textContent=error.message;return;}
      try{option=await buildTextEdit(s.source,s.scene,d.object,{text,mode:'grow'},studio.render);}catch(e2){$('state').textContent=e2.message;return;}
    }
    await studio.propose([{...option,...(d.object.name?{selectName:d.object.name}:{selectId:d.object.id,targetKind:d.object.kind})}]);
  }
  diagram.addEventListener('dblclick',e=>{
    // Pointer capture on the canvas retargets the event to the SVG root, so
    // find the object under the pointer instead of trusting e.target.
    const g=e.target.closest?.('[data-pikchr-id]')||document.elementsFromPoint(e.clientX,e.clientY).map(n=>n.closest?.('#diagram [data-pikchr-id]')).find(Boolean),s=studio.state();
    if(!g||!s.valid)return;
    const o=s.scene.objects.find(n=>n.id===g.getAttribute('data-pikchr-id'));
    if(openInline(o)){e.preventDefault();e.stopPropagation();}
  },true);
  // The T tool: remember the press; the new text opens its editor once rendered.
  diagram.addEventListener('pointerdown',e=>{if(e.button===0&&textTool?.getAttribute('aria-pressed')==='true')pendingText=Date.now();},true);
  // In this layout, Edit label and Enter edit on the canvas instead of in a dialog.
  $('edit-selected')?.addEventListener('click',e=>{if(openInline(studio.state().object)){e.preventDefault();e.stopImmediatePropagation();}},true);
  addEventListener('keydown',e=>{
    if(e.key!=='Enter'||inline||e.shiftKey||e.ctrlKey||e.metaKey||e.altKey)return;
    if(!e.target.closest?.('#diagram')||e.target.closest('input,textarea,select,[data-resize]'))return;
    if(selectTool?.getAttribute('aria-pressed')!=='true'||(previewActions&&!previewActions.hidden))return;
    if(openInline(studio.state().object)){e.preventDefault();e.stopImmediatePropagation();}
  },true);

  // ---- text style bar ------------------------------------------------------------
  // One-click size, weight, slant, alignment and colour for the selected label.
  const textBar=el('div',{class:'cl-float cl-textbar',role:'toolbar','aria-label':'Text style',hidden:''});
  const tb=(label,title,change,extra={})=>{const b=el('button',{type:'button',class:'cl-tb','aria-label':title,title,'aria-pressed':'false',...extra},label);b.onclick=()=>applyTextStyle(change());return b;};
  const sizeButtons=Object.fromEntries(textSizes.map((size,i)=>[size,tb(['S','M','L','XL'][i],`Text size ${size==='bigger'?'extra large':size}`,()=>({size}))]));
  const boldButton=tb('B','Bold',()=>({bold:!textBar.dataset.bold})),italicButton=tb('I','Italic',()=>({italic:!textBar.dataset.italic}));
  boldButton.style.fontWeight='700';italicButton.style.fontStyle='italic';
  const alignButtons={left:tb('⇤','Align left',()=>({align:'left'})),center:tb('↔','Align center',()=>({align:'center'})),right:tb('⇥','Align right',()=>({align:'right'}))};
  const colourButtons=Object.fromEntries(textColours.map(colour=>[colour,tb('',colour==='default'?'Default colour':`Colour ${colour}`,()=>({colour}),{class:'cl-tb cl-swatch','data-colour':colour})]));
  const tsep=()=>el('span',{class:'cl-sep','aria-hidden':'true'});
  textBar.append(...Object.values(sizeButtons),tsep(),boldButton,italicButton,tsep(),...Object.values(alignButtons),tsep(),...Object.values(colourButtons));
  document.body.append(textBar);
  let textBarKey='';
  function syncTextBar(visible){
    const s=studio.state(),o=s.object;
    let style=null;
    if(visible&&s.valid&&o&&(s.selectedIds||[]).length<=1&&textKinds.includes(o.kind)){try{style=textStyle(s.source,o,s.scene);}catch{style=null;}}
    if(!style){textBar.hidden=true;textBarKey='';return;}
    const key=o.id+'|'+s.source;
    if(key!==textBarKey){
      textBarKey=key;
      for(const [size,b] of Object.entries(sizeButtons))b.setAttribute('aria-pressed',String(style.size===size));
      boldButton.setAttribute('aria-pressed',String(style.bold));italicButton.setAttribute('aria-pressed',String(style.italic));
      textBar.dataset.bold=style.bold?'1':'';textBar.dataset.italic=style.italic?'1':'';
      if(!style.bold)delete textBar.dataset.bold;if(!style.italic)delete textBar.dataset.italic;
      for(const [align,b] of Object.entries(alignButtons))b.setAttribute('aria-pressed',String(style.align===align));
      for(const [colour,b] of Object.entries(colourButtons))b.setAttribute('aria-pressed',String(style.colour===colour));
    }
    textBar.hidden=false;
    const c=context.getBoundingClientRect(),w=textBar.offsetWidth,h=textBar.offsetHeight;
    // Opposite side of the selection from the toolbar, so neither covers the
    // other or stacks over neighbouring shapes.
    const box=boxOnScreen(o)||{left:c.left,right:c.right,top:c.top,bottom:c.bottom};
    const toolbarAbove=c.bottom<=box.top+1;
    let top=toolbarAbove?box.bottom+12:box.top-h-12;
    if(top<64||top+h>innerHeight-64)top=toolbarAbove?c.top-h-6:c.bottom+6;
    textBar.style.left=Math.max(8,Math.min(innerWidth-w-8,(box.left+box.right)/2-w/2))+'px';textBar.style.top=Math.max(64,Math.min(innerHeight-h-64,top))+'px';
  }
  async function applyTextStyle(change){
    const s=studio.state(),o=s.object;if(!s.valid||!o)return;
    let option;try{option=textStyleCandidate(s.source,o,s.scene,change);}catch(error){$('state').textContent=error.message;return;}
    await studio.propose([option]);
  }
  // ---- free lines: body drag and endpoint handles ----------------------------
  // A line whose route is all literal points drags as a whole; any literal
  // end gets a round handle that moves it, or attaches it to a shape.
  let lineDrag=null,handleKey='';
  const lineKinds=['arrow','line','spline'];
  function selectedLine(){const s=studio.state(),o=s.object;return s.valid&&o&&lineKinds.includes(o.kind)&&(s.selectedIds||[]).length<=1?o:null;}
  function drawLineHandles(){
    const svg=svgNow();if(!svg)return;
    const s=studio.state(),o=selectedLine();
    const ends=o&&!lineDrag&&!connect?lineEnds(s.source,s.scene,o):null;
    const show=!!ends&&(ends.from.literal||ends.to.literal);
    const key=show?o.id+'|'+svg.getAttribute('viewBox')+'|'+s.source:'';
    const layer=svg.querySelector('.cl-line-handles');
    if(key===handleKey&&!!layer===show)return;
    handleKey=key;layer?.remove();if(!show)return;
    const ctm=svg.getScreenCTM(),scale=ctm?Math.hypot(ctm.a,ctm.b)||1:1;
    const g=svgEl('g',{class:'cl-line-handles'});
    for(const which of ['from','to']){
      const p=toSvg(s.scene,ends[which].point);
      g.append(svgEl('circle',{cx:p.x,cy:p.y,r:6/scale,class:'cl-dot cl-end-handle','data-end':which,'vector-effect':'non-scaling-stroke',role:'button','aria-label':which==='from'?'Drag line start':'Drag line end'}));
    }
    svg.append(g);
  }
  function drawLineGhost(points,target){
    const svg=svgNow(),d=lineDrag;if(!svg||!d)return;
    svg.querySelector('.cl-rubber')?.remove();clearLive();
    const pts=points.map(p=>toSvg(d.scene,p));
    const layer=svgEl('g',{class:'cl-rubber','aria-hidden':'true'});
    layer.append(svgEl('path',{d:'M'+pts.map(p=>p.x+' '+p.y).join(' L'),class:'cl-rubber-line','vector-effect':'non-scaling-stroke'}));
    if(target)svg.querySelector(`[data-pikchr-id="${target.id}"]`)?.classList.add('cl-target-shape');
    svg.append(layer);
  }
  function endLineDrag(d){
    const svg=svgNow();svg?.querySelector(`[data-pikchr-id="${d.object.id}"]`)?.removeAttribute('transform');
    svg?.querySelector('.cl-rubber')?.remove();clearLive();handleKey='';lineDrag=null;schedule();
  }
  diagram.addEventListener('pointerdown',e=>{
    if(e.button!==0||connect||lineDrag||e.shiftKey)return;
    if(selectTool?.getAttribute('aria-pressed')!=='true')return;
    const s=studio.state();if(!s.valid)return;
    const handle=e.target.closest?.('.cl-line-handles [data-end]');
    let object=null;
    if(handle)object=selectedLine();
    else{
      const g=e.target.closest?.('[data-pikchr-id]'),o=g&&s.scene.objects.find(n=>n.id===g.getAttribute('data-pikchr-id'));
      if(!o||!lineKinds.includes(o.kind))return;
      let ok=false;try{ok=literalRoute(s.source,o);}catch{}
      if(!ok)return;object=o;
    }
    const ends=object&&lineEnds(s.source,s.scene,object);if(!ends)return;
    e.preventDefault();e.stopPropagation();
    if(s.object?.id!==object.id)studio.select(object.id);
    lineDrag={pointerId:e.pointerId,object,which:handle?.dataset.end||null,ends,x:e.clientX,y:e.clientY,start:studio.screenToModel(e.clientX,e.clientY),moved:false,source:s.source,scene:s.scene};
    try{diagram.setPointerCapture(e.pointerId);}catch{}
  },true);
  diagram.addEventListener('pointermove',e=>{
    const d=lineDrag;if(!d||d.pointerId!==e.pointerId)return;
    e.stopPropagation();
    if(!d.moved&&Math.hypot(e.clientX-d.x,e.clientY-d.y)>3){d.moved=true;svgNow()?.querySelector('.cl-line-handles')?.remove();}
    if(!d.moved)return;
    let p=studio.screenToModel(e.clientX,e.clientY);if(!p)return;
    const shift=e.shiftKey||shiftDown;
    if(d.which){
      const other=d.ends[d.which==='from'?'to':'from'].point;
      const target=hitShape(connectable(),p,{margin:0.05});
      if(!target&&shift)p=lockDirection(other,p).point;
      d.target=target;d.targetAnchor=target?targetAnchor(target,p,other):null;d.pointer=p;
      const end=target?target.anchors[d.targetAnchor]:{x:snapToGrid(p.x),y:snapToGrid(p.y)};
      drawLineGhost(d.which==='from'?[end,other]:[other,end],target);
      badge.hidden=false;badge.textContent=(d.which==='from'?'Start → ':'End → ')+(target?`${target.name}.${d.targetAnchor}`:pointText(end));
      badge.style.left=(e.clientX+14)+'px';badge.style.top=(e.clientY+14)+'px';
    }else{
      let dx=p.x-d.start.x,dy=p.y-d.start.y;
      if(shift){const q=lockDirection({x:0,y:0},{x:dx,y:dy}).point;dx=q.x;dy=q.y;}
      d.delta={x:snapToGrid(dx),y:snapToGrid(dy)};
      const g=svgNow()?.querySelector(`[data-pikchr-id="${d.object.id}"]`);
      if(g){const a=toSvg(d.scene,{x:0,y:0}),b=toSvg(d.scene,d.delta);g.setAttribute('transform',`translate(${b.x-a.x} ${b.y-a.y})`);}
    }
  },true);
  diagram.addEventListener('pointerup',async e=>{
    const d=lineDrag;if(!d||d.pointerId!==e.pointerId)return;
    e.stopPropagation();endLineDrag(d);badge.hidden=true;
    try{diagram.releasePointerCapture(e.pointerId);}catch{}
    if(!d.moved)return;
    const s=studio.state();if(!s.valid||s.source!==d.source){$('state').textContent='The diagram changed. Try again.';return;}
    let option;
    try{
      option=d.which
        ?moveEndpointCandidate(d.source,d.scene,d.object,d.which,d.target?{object:d.target,anchor:d.targetAnchor}:{point:d.pointer})
        :translateLineCandidate(d.source,d.scene,d.object,d.delta?.x||0,d.delta?.y||0);
    }catch(error){$('state').textContent=error.message;return;}
    await studio.propose([option]);
  },true);
  const cancelLineDrag=()=>{if(lineDrag){endLineDrag(lineDrag);badge.hidden=true;}};
  diagram.addEventListener('pointercancel',cancelLineDrag,true);
  addEventListener('keydown',e=>{if(e.key==='Escape'&&lineDrag){e.preventDefault();e.stopImmediatePropagation();cancelLineDrag();}},true);
  // Escape must cancel a connect drag even though the canvas tools stop the
  // key on the stage, so listen in the capture phase on the window.
  addEventListener('keydown',e=>{if(e.key==='Escape'&&connect){e.preventDefault();e.stopImmediatePropagation();cancelConnect();}},true);
  // The stage is the whole viewport; its focus ring only helps keyboard users.
  addEventListener('pointerdown',()=>document.body.classList.add('cl-pointer'),true);
  addEventListener('keydown',e=>{if(e.key==='Tab')document.body.classList.remove('cl-pointer');},true);
  // ---- keyboard ----------------------------------------------------------------
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(connect){e.preventDefault();cancelConnect();return;}
      const open=popovers.find(p=>!p.hidden);if(open&&!e.target.closest?.('#diagram')){e.preventDefault();toggle(open,open.opener,false);restoreFocus(open);return;}
      if(drawer.classList.contains('open')&&drawer.contains(e.target)){e.preventDefault();setDrawer(false);return;}
      // Outside the canvas (e.g. focus on a palette button) Escape still
      // returns to the Select tool; inside it, canvas-tools handles it.
      if(!e.target.closest?.('#diagram,input,textarea,select,dialog')&&selectTool&&selectTool.getAttribute('aria-pressed')!=='true'){e.preventDefault();selectTool.click();}
      return;
    }
    if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.isComposing)return;
    if(e.target.closest?.('input,textarea,select,[contenteditable="true"],dialog'))return;
    if(document.querySelector('dialog[open]'))return;
    const k=e.key;
    const actions={v:()=>selectTool?.click(),m:()=>marquee?.click(),h:()=>panTool?.click(),b:()=>placeShape('box'),c:()=>placeShape('circle'),d:()=>placeShape('cylinder'),r:()=>placeShape('diamond'),'/':()=>$('mobile-objects')?.click(),
      t:()=>textTool?.click(),a:()=>setConnect('arrow'),l:()=>setConnect('line'),s:()=>setDrawer(!drawer.classList.contains('open')),'?':()=>toggle(helpPanel,helpButton)};
    const action=actions[k==='?'?'?':k.toLowerCase()];
    if(!action||(e.shiftKey&&k!=='?'&&k!=='/'))return;
    e.preventDefault();action();
  });

  syncPalette();schedule();
}
