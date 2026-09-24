let nextReviewId = 0;

// Review owns only its temporary preview. Source/history still belong to the
// caller, and every asynchronous result is tied to its original document.
export function createCandidateReview({ host, getState, render, propose, status, rebind }) {
  const doc = host.ownerDocument || document;
  const make = (tag, text, parent) => { const node=doc.createElement(tag); if(text!==undefined) node.textContent=text; parent?.append(node); return node; };
  const dialog=make('dialog'); dialog.className='label-dialog';
  const heading=make('h2','Proposed route',dialog); heading.id=`candidate-review-${++nextReviewId}`;
  dialog.setAttribute('aria-labelledby',heading.id);
  const feedback=make('p','',dialog); feedback.setAttribute('role','status');
  const details=make('details',undefined,dialog); make('summary','Source change',details);
  make('h3','Before',details); const before=make('pre','',details);
  make('h3','After',details); const after=make('pre','',details);
  for(const node of [before,after]) { node.style.whiteSpace='pre-wrap'; node.style.overflowWrap='anywhere'; }
  const actions=make('div',undefined,dialog); actions.className='row';
  const accept=make('button','Use route',actions), dismiss=make('button','Cancel',actions);
  accept.type=dismiss.type='button';
  doc.body.append(dialog);
  let session=null, sequence=0;
  const current = item => {
    const state=getState();
    return session===item && item.token===sequence && state.valid && state.key===item.state.key && state.source===item.state.source;
  };
  function finish({announce=false,focus=true}={}) {
    const item=session; if(!item) return;
    const restore=current(item); session=null; sequence++;
    if(dialog.open) dialog.close();
    if(restore && item.preview) { host.innerHTML=item.original; rebind?.(); }
    if(restore && focus) host.focus({preventScroll:true});
    if(restore && announce) status('Route preview cancelled. No change applied.');
  }
  function cancel(announce=false) { finish({announce}); }
  function sync() { if(session && !current(session)) finish({focus:false}); }
  dismiss.addEventListener('click',()=>cancel(true));
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel(true);});
  dialog.addEventListener('close',()=>{if(!dialog.open) cancel();});
  accept.addEventListener('click',async()=>{
    const item=session;
    if(!item || !item.ready) return;
    if(!current(item)) { sync(); status('The document changed. Generate a new route suggestion.'); return; }
    finish();
    try { await propose(item.state.object,[item.option]); }
    catch(error) { status(error?.message || 'The route could not be applied. Generate a new suggestion.'); }
  });
  async function review(option) {
    cancel();
    const state=getState();
    if(!state.valid || !state.object || typeof option?.source!=='string' || option.patch?.base!==state.source) {
      status('Render the current diagram and generate a fresh route suggestion.'); return false;
    }
    const item={state:{...state},option,original:host.innerHTML,token:++sequence,preview:false,ready:false}; session=item;
    before.textContent=option.patch.expected; after.textContent=option.patch.text;
    accept.disabled=true; feedback.textContent='Checking the proposed route…';
    dialog.showModal(); dismiss.focus(); status('Checking the proposed route. Nothing has been applied.');
    try {
      const result=await render(option.source);
      if(!current(item)) { if(session===item) sync(); return false; }
      if(result?.error || typeof result?.svg!=='string' || !result.svg.includes('<svg')) throw new Error(result?.error || 'Pikchr did not return a route preview.');
      host.innerHTML=result.svg; item.preview=true;
      // Native SVG provides its own fit-to-diagram viewBox. Do not run the
      // normal editable-canvas binder against this uncommitted source.
      host.querySelector('svg')?.setAttribute('aria-label','Proposed route preview; not applied');
      item.ready=true; accept.disabled=false;
      feedback.textContent='The diagram shows the proposed route. Use route applies it; Cancel keeps the original.';
      status('Preview only. Choose Use route to apply, or Cancel to keep the original.');
      return true;
    } catch(error) {
      if(!current(item)) { if(session===item) sync(); return false; }
      feedback.textContent='Could not preview this route. '+(error?.message || 'Try generating it again.');
      status(feedback.textContent); accept.disabled=true; return false;
    }
  }
  return { review, cancel, sync, get busy() { return !!session; } };
}
