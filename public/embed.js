// Minimal host integration. Serve this directory over HTTP, not file://.
const source=document.querySelector('#embed-source');
const output=document.querySelector('#embed-output');
const state=document.querySelector('#embed-state');
const error=document.querySelector('#embed-error');
let worker,requestId=0,revision=0,pending=null;
function cancelPending(){
  if(pending)clearTimeout(pending.timer);
  pending=null;
}
function startWorker(){
  worker=new Worker('./worker.js');
  worker.onmessage=({data})=>{
    if(!pending||data.id!==pending.id)return;
    const request=pending;cancelPending();
    // Rendering is asynchronous. Never display results for an older document.
    if(request.revision!==revision||request.source!==source.value)return;
    if(data.result?.error||!data.result?.svg){
      error.textContent=data.result?.error||'Renderer returned no diagram.';
      output.classList.add('stale');state.textContent='Fix the source and render again.';return;
    }
    // Only trusted renderer output goes into HTML; user source is never injected.
    output.innerHTML=data.result.svg;output.classList.remove('stale');
    state.textContent='Rendered '+data.result.objects.length+' objects.';
  };
  worker.onerror=()=>recover('Renderer could not load. Check the local files, then try Render again.');
}
function recover(message){
  cancelPending();worker.terminate();
  output.classList.add('stale');error.textContent=message;state.textContent='Render unavailable.';
  worker=null;
}
function render(){
  cancelPending();error.textContent='';
  const text=source.value;
  if(text.includes('\0')||new TextEncoder().encode(text).length>100000){
    error.textContent='Use at most 100,000 UTF-8 bytes and remove NUL characters.';
    state.textContent='Source cannot be rendered.';return;
  }
  if(!worker)startWorker();
  const id=++requestId;
  pending={id,revision,source:text,timer:setTimeout(()=>recover('Render exceeded five seconds. Simplify the source and try again.'),5000)};
  state.textContent='Rendering…';worker.postMessage({id,source:text});
}
source.oninput=()=>{
  ++revision;error.textContent='';output.classList.add('stale');state.textContent='Source changed. Render to update.';
};
source.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();render();}};
document.querySelector('#embed-render').onclick=render;
window.addEventListener('pagehide',()=>{cancelPending();worker?.terminate();});
render();
