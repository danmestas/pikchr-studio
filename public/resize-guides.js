const kinds=new Set(['box','cylinder','circle','ellipse','oval','diamond']);
const validSize=n=>Number.isFinite(n)&&n>=0.1&&n<=100;
const validBox=b=>b&&['x','y','width','height'].every(key=>Number.isFinite(b[key]))&&b.width>0&&b.height>0;
const epsilon=1e-9;

// Model-space geometry only. Render guides through the current scene transform.
// A resize keeps the original left/top fixed, not the shape center.
export function snapResize({object,scene,width,height,handle,tolerance=.08,enabled=true,lockRatio=false}){
  const b=object?.bbox;
  if(!validBox(b)||!validSize(width)||!validSize(height)||!['e','s','se'].includes(handle)||!Number.isFinite(tolerance)||tolerance<0)throw new Error('Resize guides need valid dimensions, bounds, handle and tolerance.');
  const ratio=object.kind==='circle'?1:lockRatio?b.width/b.height:null;
  if(ratio){
    const widthLeads=handle==='e'||(handle==='se'&&Math.abs(width-b.width)/b.width>=Math.abs(height-b.height)/b.height);
    if(widthLeads)height=width/ratio;else width=height*ratio;
  }
  if(!validSize(width)||!validSize(height))throw new Error('Aspect-ratio resize exceeds supported dimensions.');
  if(!enabled)return {width,height,guides:[]};
  const left=b.x,top=b.y+b.height;
  const others=(scene?.objects||[]).filter(o=>o!==object&&(!object.id||o.id!==object.id)&&kinds.has(o.kind)&&validBox(o.bbox));
  const candidates=[];
  for(const other of others){
    const r=other.bbox,identity=String(other.name||other.id||'Shape');
    for(const [axis,values,current] of [
      ['x',[[r.x,'left'],[r.x+r.width/2,'center'],[r.x+r.width,'right']],left+width],
      ['y',[[r.y,'bottom'],[r.y+r.height/2,'center'],[r.y+r.height,'top']],top-height],
    ]){
      if(handle==='e'&&axis==='y'||handle==='s'&&axis==='x')continue;
      for(const [value,edge]of values){
        const distance=Math.abs(value-current);
        if(distance>tolerance+epsilon)continue;
        let w=axis==='x'?value-left:width,h=axis==='y'?top-value:height;
        if(ratio){if(axis==='x')h=w/ratio;else w=h*ratio;}
        if(!validSize(w)||!validSize(h))continue;
        candidates.push({axis,value,distance,width:w,height:h,other,identity,edge});
      }
    }
  }
  // Explicit tie-breaks make scene object order irrelevant.
  candidates.sort((a,b)=>a.distance-b.distance||a.axis.localeCompare(b.axis)||a.value-b.value||a.identity.localeCompare(b.identity)||a.edge.localeCompare(b.edge));
  const chosen=[];
  if(ratio){if(candidates.length){const pick=candidates[0];width=pick.width;height=pick.height;chosen.push(pick);}}
  else for(const axis of ['x','y']){const pick=candidates.find(c=>c.axis===axis);if(pick){if(axis==='x')width=pick.width;else height=pick.height;chosen.push(pick);}}
  // A second guide is useful only when the ratio-constrained result actually
  // aligns. Merely being near a target must not display a false snap.
  if(ratio&&chosen.length)for(const c of candidates){
    if(chosen.some(p=>p.axis===c.axis))continue;
    if(Math.abs((c.axis==='x'?left+width:top-height)-c.value)<epsilon)chosen.push(c);
  }
  const guides=chosen.map(c=>({axis:c.axis,value:c.value,
    from:c.axis==='x'?Math.min(top-height,c.other.bbox.y):Math.min(left,c.other.bbox.x),
    to:c.axis==='x'?Math.max(top,c.other.bbox.y+c.other.bbox.height):Math.max(left+width,c.other.bbox.x+c.other.bbox.width),
    label:`Align ${c.axis==='x'?'right':'bottom'} to ${c.identity} ${c.edge}`,
  }));
  return {width,height,guides};
}

// Eight-handle resize in model space (y up). The side or corner opposite the
// handle stays fixed; with fromCenter the center stays fixed instead. Moving
// edges snap to other shapes' edges and centers, otherwise to the grid.
// ratio (width/height) keeps the aspect ratio; circles always use 1.
export const RESIZE_HANDLES=['n','ne','e','se','s','sw','w','nw'];
export function resizeBox({box,handle,pointer,ratio=null,fromCenter=false,others=[],tolerance=.08,grid=.05,min=.1}){
  if(!validBox(box)||!RESIZE_HANDLES.includes(handle)||!Number.isFinite(pointer?.x)||!Number.isFinite(pointer?.y))throw new Error('Resize needs a valid box, handle and pointer.');
  const cx=box.x+box.width/2,cy=box.y+box.height/2;
  let l=box.x,r=box.x+box.width,b=box.y,t=box.y+box.height;
  const movesX=handle.includes('e')?'r':handle.includes('w')?'l':null, movesY=handle.includes('n')?'t':handle.includes('s')?'b':null;
  const guides=[];
  const lines=axis=>others.filter(o=>validBox(o?.bbox)).flatMap(o=>{const q=o.bbox;return axis==='x'
    ?[[q.x,o],[q.x+q.width/2,o],[q.x+q.width,o]]:[[q.y,o],[q.y+q.height/2,o],[q.y+q.height,o]];});
  const settle=(axis,value)=>{
    let best=null;for(const [line,o] of lines(axis)){const d=Math.abs(line-value);if(d<=tolerance+epsilon&&(!best||d<best.d))best={d,line,o};}
    if(best){guides.push({axis,value:best.line,other:best.o});return best.line;}
    return grid?Math.round(value/grid)*grid:value;
  };
  if(movesX){const v=settle('x',pointer.x);if(movesX==='r')r=v;else l=v;if(fromCenter){const half=Math.abs(v-cx);l=cx-half;r=cx+half;}}
  if(movesY){const v=settle('y',pointer.y);if(movesY==='t')t=v;else b=v;if(fromCenter){const half=Math.abs(v-cy);b=cy-half;t=cy+half;}}
  // Never invert or collapse: clamp the moving side against the fixed one.
  if(movesX==='r'&&r-l<min)r=l+min; if(movesX==='l'&&r-l<min)l=r-min;
  if(movesY==='t'&&t-b<min)t=b+min; if(movesY==='b'&&t-b<min)b=t-min;
  if(ratio){
    let w=r-l,h=t-b;
    const widthLeads=movesX&&(!movesY||Math.abs(w-box.width)/box.width>=Math.abs(h-box.height)/box.height);
    if(widthLeads)h=w/ratio;else w=h*ratio;
    // Keep the fixed anchor: opposite side, or the center for edge handles.
    if(fromCenter||!movesX){l=cx-w/2;r=cx+w/2;}else if(movesX==='r')r=l+w;else l=r-w;
    if(fromCenter||!movesY){b=cy-h/2;t=cy+h/2;}else if(movesY==='t')t=b+h;else b=t-h;
    for(let i=guides.length-1;i>=0;i--){const g=guides[i];const edge=g.axis==='x'?[l,r,(l+r)/2]:[b,t,(b+t)/2];if(!edge.some(v=>Math.abs(v-g.value)<1e-9))guides.splice(i,1);}
  }
  const width=r-l,height=t-b;
  return {x:l,y:b,width,height,center:{x:(l+r)/2,y:(b+t)/2},guides};
}
