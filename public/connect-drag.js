// Pure helpers for drag-to-connect. Geometry is in Pikchr inches (y up).
// Every result is an ordinary candidate edit: the caller validates it by
// rendering, exactly like the other canvas tools.
import {createShape,createConnector,connectableShapes} from './creation.js?v=20260923c';
import {applyPatch} from './edits.js?v=20260923c';

export const sides=['n','e','s','w'];
const opposite={n:'s',s:'n',e:'w',w:'e'};
const point=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y);

// The four side anchors a connector can attach to.
export function attachPoints(object){
  return sides.filter(anchor=>point(object?.anchors?.[anchor]))
    .map(anchor=>({anchor,x:object.anchors[anchor].x,y:object.anchors[anchor].y}));
}

export function nearestAnchor(object,p){
  const best=attachPoints(object).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
  return best?.anchor||'c';
}

export function contains(object,p,margin=0){
  const b=object?.bbox;if(!b||!point(p))return false;
  return p.x>=b.x-margin&&p.x<=b.x+b.width+margin&&p.y>=b.y-margin&&p.y<=b.y+b.height+margin;
}

// The shape under a point. Connectors are never targets; when shapes overlap
// the smallest one wins, since it is the one visibly on top of the others.
export function hitShape(objects,p,{margin=0.05,exclude=null}={}){
  return (objects||[]).filter(o=>o!==exclude&&o.id!==exclude?.id&&!['arrow','line','spline','move','arc'].includes(o.kind)&&contains(o,p,margin))
    .sort((a,b)=>a.bbox.width*a.bbox.height-b.bbox.width*b.bbox.height)[0]||null;
}

// Which side of a new shape at `to` faces the point `from`.
export function facingSide(to,from){
  const dx=from.x-to.x,dy=from.y-to.y;
  if(Math.abs(dx)>=Math.abs(dy))return dx>=0?'e':'w';
  return dy>=0?'n':'s';
}

// The side to attach to on a hovered target: the edge the pointer is close
// to, or, from deep inside the shape, the side that faces the start point.
export function targetAnchor(target,p,from,{edge=0.25}={}){
  const b=target?.bbox;if(!b||!point(p))return nearestAnchor(target,p);
  const distances={n:b.y+b.height-p.y,s:p.y-b.y,e:b.x+b.width-p.x,w:p.x-b.x};
  const [side,distance]=Object.entries(distances).sort((x,y)=>x[1]-y[1])[0];
  if(distance<edge*Math.min(b.width,b.height))return side;
  return point(from)&&point(target.center)?facingSide(target.center,from):nearestAnchor(target,p);
}


// Route for a connector between two side anchors, shared by the dashed guide
// and the source edit so the preview never promises a shape Pikchr won't draw.
// Perpendicular sides get one bend ("up until even with B.w then to B.w");
// facing sides that are offset get two ("up 0.3 then left until even with
// B.s then to B.s"); anything else is a straight line.
const dir={n:[0,1],s:[0,-1],e:[1,0],w:[-1,0]};
const word={n:'up',s:'down',e:'right',w:'left'};
const EPS=0.01;
const snapGap=v=>Math.max(0.05,Math.round(v*20)/20);
const trim=v=>String(Math.round(v*100)/100);
export function elbowRoute(from,fromAnchor,to,toAnchor,toName=null){
  const straight={points:[from,to],words:null};
  if(!point(from)||!point(to)||!dir[fromAnchor]||!dir[toAnchor])return straight;
  const ds=dir[fromAnchor],approach=dir[toAnchor].map(v=>-v);
  const dot=(p,q,v)=>(q.x-p.x)*v[0]+(q.y-p.y)*v[1];
  const vertical=a=>a==='n'||a==='s';
  const ref=toName?`${toName}.${toAnchor}`:null;
  if(vertical(fromAnchor)!==vertical(toAnchor)){
    const corner=vertical(fromAnchor)?{x:from.x,y:to.y}:{x:to.x,y:from.y};
    if(dot(from,corner,ds)<=EPS||dot(corner,to,approach)<=EPS)return straight;
    return {points:[from,corner,to],words:ref&&`${word[fromAnchor]} until even with ${ref} then to ${ref}`};
  }
  if(ds[0]!==approach[0]||ds[1]!==approach[1])return straight;
  const along=dot(from,to,ds),lateral=vertical(fromAnchor)?to.x-from.x:to.y-from.y;
  if(Math.abs(lateral)<=EPS||along<=2*EPS)return straight;
  const gap=Math.min(snapGap(along/2),along-EPS);
  const a={x:from.x+ds[0]*gap,y:from.y+ds[1]*gap};
  const b=vertical(fromAnchor)?{x:to.x,y:a.y}:{x:a.x,y:to.y};
  const side=vertical(fromAnchor)?(lateral>0?'right':'left'):(lateral>0?'up':'down');
  return {points:[from,a,b,to],words:ref&&`${word[fromAnchor]} ${trim(gap)} then ${side} until even with ${ref} then to ${ref}`};
}

export function connectionLabel(from,fromAnchor,to,toAnchor){
  return `${from.name}.${fromAnchor} → `+(to?`${to.name}.${toAnchor}`:'new shape');
}

// One candidate edit for a finished drag: a connector to an existing shape,
// or a new shape at the drop point plus a connector to it.
export function connectCandidate(source,scene,{from,fromAnchor,to=null,toAnchor=null,at=null,kind='arrow'}){
  if(!['arrow','line'].includes(kind))throw new Error('Choose arrow or line.');
  if(!from||!sides.includes(fromAnchor))throw new Error('Start the connector from a side of a named shape.');
  if(to){
    if(to.id===from.id)throw new Error('Drop on a different shape. Self-loops need a routed path.');
    const anchor=toAnchor||facingSide(to.center,from.anchors[fromAnchor]);
    let option=createConnector(source,scene,{fromId:from.id,fromAnchor,toId:to.id,toAnchor:anchor,kind});
    const route=elbowRoute(from.anchors[fromAnchor],fromAnchor,to.anchors[anchor],anchor,to.name);
    const plain=`from ${from.name}.${fromAnchor} to ${to.name}.${anchor}`;
    if(route.words&&option.patch.text.includes(plain)){
      const patch={...option.patch,text:option.patch.text.replace(plain,`from ${from.name}.${fromAnchor} ${route.words}`)};
      option={...option,patch,source:applyPatch(source,patch)};
    }
    return {...option,label:`Connect ${from.name}.${fromAnchor} to ${to.name}.${anchor}`,connection:{from:from.name,fromAnchor,to:to.name,toAnchor:anchor},route:route.points};
  }
  if(!point(at))throw new Error('Drop on a shape or on empty canvas.');
  if(!connectableShapes(source,scene).includes(from))throw new Error('Start from a named, editable shape.');
  const kindOfShape=from.kind==='text'?'box':from.kind;
  const node=createShape(source,scene,{kind:kindOfShape,label:'',x:at.x,y:at.y,width:from.bbox?.width,height:from.bbox?.height});
  const inAnchor=facingSide(at,from.anchors[fromAnchor]);
  const reserved=new Set(node.source.match(/\b[A-Z][A-Za-z0-9_]*\b/g)||[]);
  for(const item of scene?.objects||[])if(item.name)reserved.add(item.name);
  let index=1;while(reserved.has(`Link${index}`))index++;
  const newline=source.includes('\r\n')?'\r\n':'\n';
  const patch={...node.patch,text:node.patch.text+`Link${index}: ${kind} from ${from.name}.${fromAnchor} to ${node.selectName}.${inAnchor}${newline}`};
  return {label:`Add connected ${kindOfShape}`,selectName:node.selectName,patch,source:applyPatch(source,patch),
    connection:{from:from.name,fromAnchor,to:node.selectName,toAnchor:inAnchor}};
}

export {opposite};
