// Navigation owns gestures at capture phase, before shape/connector editors.
export const clampZoom=value=>Math.max(.2,Math.min(12,value));
export function pinchTransform(start,current){
  const middle=p=>({x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2});
  const distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
  return {from:middle(start),to:middle(current),factor:distance(current)/Math.max(1,distance(start))};
}
// marquee (optional): {enabled(), finish(rect, additive)}. When enabled, a
// primary-button drag on empty canvas draws a selection box instead of
// panning; the Hand tool, Space, middle button, wheel and pinch still pan.
export function canvasNavigation(host,{panEnabled,panBy,zoomAt,cancelEdit,deselect,onMode,end,ownsPointer=()=>false,marquee=null}){
  let box=null;
  const pointers=new Map();let navigating=false,last=null,space=false,moved=false,start=null,safariScale=null,suppressed=false;
  const editable=target=>target?.closest('input,textarea,select,[contenteditable="true"]');
  const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
  function cancel(){
    for(const [id,p]of pointers){
      // Editors already implement pointercancel; cancel on the original target
      // before removing its selection overlay or taking over pointer capture.
      p.target.dispatchEvent(new PointerEvent('pointercancel',{pointerId:id,bubbles:true}));
    }
    cancelEdit();
  }
  const points=()=>[...pointers.values()].slice(0,2).map(p=>({x:p.x,y:p.y}));
  host.addEventListener('pointerdown',e=>{
    // Inline labels retain native selection, focus and scrolling. They are not
    // canvas pointers and must not turn a second input touch into a pinch.
    if(editable(e.target))return;
    if(e.button!==0&&e.button!==1)return;
    host.focus?.({preventScroll:true});
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,target:e.target});
    if(pointers.size===2){cancel();navigating=true;last=points();moved=true;}
    else if(pointers.size===1&&e.button===0&&!space&&!panEnabled()&&marquee?.enabled()&&!ownsPointer(e)&&!e.target.closest('[data-pikchr-id],.arrow-overlay,.canvas-overlay')){
      const r=host.getBoundingClientRect(),el=document.createElement('div');el.className='cl-marquee';el.setAttribute('aria-hidden','true');host.append(el);
      box={pointerId:e.pointerId,x:e.clientX,y:e.clientY,el,r,moved:false};cancelEdit();try{host.setPointerCapture(e.pointerId);}catch{}stop(e);return;
    }
    else if(pointers.size===1&&(space||panEnabled()||e.button===1||(!ownsPointer(e)&&!e.target.closest('[data-pikchr-id],.arrow-overlay,.canvas-overlay')))){
      navigating=true;last=points();start={x:e.clientX,y:e.clientY};moved=false;cancelEdit();
    }
    if(navigating){for(const id of pointers.keys())try{host.setPointerCapture(id);}catch{}onMode(true);stop(e);}
  },true);
  host.addEventListener('pointermove',e=>{
    if(box&&box.pointerId===e.pointerId){
      stop(e);if(Math.hypot(e.clientX-box.x,e.clientY-box.y)>3)box.moved=true;
      const x=Math.min(box.x,e.clientX)-box.r.left,y=Math.min(box.y,e.clientY)-box.r.top;
      Object.assign(box.el.style,{left:x+'px',top:y+'px',width:Math.abs(e.clientX-box.x)+'px',height:Math.abs(e.clientY-box.y)+'px'});
      return;
    }
    const p=pointers.get(e.pointerId);if(!p)return;p.x=e.clientX;p.y=e.clientY;
    if(!navigating)return;stop(e);if(suppressed)return;const next=points();
    if(next.length>=2&&last?.length>=2){const t=pinchTransform(last,next);zoomAt(t.factor,t.from.x,t.from.y);panBy(t.to.x-t.from.x,t.to.y-t.from.y);}
    else if(next.length===1&&last?.length===1){panBy(next[0].x-last[0].x,next[0].y-last[0].y);if(start&&Math.hypot(next[0].x-start.x,next[0].y-start.y)>3)moved=true;}
    last=next;
  },true);
  function finish(e){
    if(box&&box.pointerId===e.pointerId){
      const b=box;box=null;b.el.remove();pointers.delete(e.pointerId);stop(e);
      if(e.type==='pointerup'){
        if(b.moved)marquee.finish({left:Math.min(b.x,e.clientX),top:Math.min(b.y,e.clientY),right:Math.max(b.x,e.clientX),bottom:Math.max(b.y,e.clientY)},e.shiftKey);
        else deselect(e);
      }
      end();return;
    }
    // Synthetic cancellation is sent to editors while our pointer map is kept.
    if(!e.isTrusted&&e.type==='pointercancel')return;
    pointers.delete(e.pointerId);
    if(!navigating)return;stop(e);last=points();
    if(!pointers.size){navigating=false;suppressed=false;onMode(false);if(!moved&&e.type==='pointerup'&&!space&&!panEnabled())deselect(e);end();}
  }
  host.addEventListener('pointerup',finish,true);
  host.addEventListener('pointercancel',finish,true);
  host.addEventListener('wheel',e=>{
    if(pointers.size)return;stop(e);
    const unit=e.deltaMode===1?16:e.deltaMode===2?host.clientHeight:1;
    if(e.ctrlKey||e.metaKey)zoomAt(Math.exp(-Math.max(-200,Math.min(200,e.deltaY*unit))*.01),e.clientX,e.clientY);
    else panBy(-(e.shiftKey&&!e.deltaX?e.deltaY:e.deltaX)*unit,-(e.shiftKey?0:e.deltaY)*unit);
    end();
  },{passive:false,capture:true});
  // Safari trackpad gestures are distinct from ctrl-wheel on some versions.
  host.addEventListener('gesturestart',e=>{if(pointers.size)return;e.preventDefault();safariScale=e.scale||1;},{passive:false});
  host.addEventListener('gesturechange',e=>{if(safariScale===null||pointers.size)return;e.preventDefault();zoomAt(e.scale/safariScale,e.clientX,e.clientY);safariScale=e.scale;},{passive:false});
  host.addEventListener('gestureend',()=>{safariScale=null;end();});
  document.addEventListener('keydown',e=>{
    if(editable(e.target))return;
    if(e.code==='Space'&&host.contains(document.activeElement)){e.preventDefault();space=true;onMode(true);}
    if(e.key==='Escape'&&box){box.el.remove();box=null;pointers.clear();return;}
    if(e.key==='Escape'&&pointers.size){cancel();navigating=true;moved=true;suppressed=true;}
  });
  document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;if(!navigating)onMode(false);}});
  window.addEventListener('blur',()=>{if(pointers.size)cancel();pointers.clear();navigating=false;space=false;suppressed=false;onMode(false);});
}
