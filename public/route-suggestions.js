import { routeCandidates, applyPatch } from './edits.js?v=20260923c';

const directions = { e: [1, 0], w: [-1, 0], n: [0, 1], s: [0, -1] };
const epsilon = 1e-8;
// Keep the renderer's full precision: rounding only one coordinate could make
// the first or final segment subtly diagonal at an otherwise fixed anchor.
const scalar = value => Object.is(value, -0) ? 0 : value;
const pointText = point => `(${scalar(point.x)}, ${scalar(point.y)})`;
const intersects = (a, b, r) => a.x === b.x
  ? a.x > r.left + epsilon && a.x < r.right - epsilon && Math.max(a.y, b.y) > r.bottom + epsilon && Math.min(a.y, b.y) < r.top - epsilon
  : a.y > r.bottom + epsilon && a.y < r.top - epsilon && Math.max(a.x, b.x) > r.left + epsilon && Math.min(a.x, b.x) < r.right - epsilon;

// Small deterministic min-heap: equal-cost choices use grid IDs, not timing.
function heap() {
  const items = [], less = (a,b) => a.cost < b.cost || (a.cost === b.cost && a.key < b.key);
  return {
    push(value) { items.push(value); let i=items.length-1; while(i) { const p=(i-1)>>1; if(!less(items[i],items[p])) break; [items[i],items[p]]=[items[p],items[i]]; i=p; } },
    pop() { const first=items[0], last=items.pop(); if(items.length) { items[0]=last; let i=0; while(true) { let next=i; for(const c of [2*i+1,2*i+2]) if(c<items.length && less(items[c],items[next])) next=c; if(next===i) break; [items[i],items[next]]=[items[next],items[i]]; i=next; } } return first; },
    get length() { return items.length; },
  };
}

// Shape rectangles grown by a clearance margin. Connectors are not obstacles.
export function obstacleRects(scene, margin = 0, skip = ['arrow','line']) {
  return (scene?.objects || []).filter(o => !skip.includes(o.kind) && o.bbox?.width > 0 && o.bbox?.height > 0)
    .map(o => ({ object:o, left:scalar(o.bbox.x-margin), right:scalar(o.bbox.x+o.bbox.width+margin), bottom:scalar(o.bbox.y-margin), top:scalar(o.bbox.y+o.bbox.height+margin) }));
}

export function tidyRouteCandidate(source, scene, object, { margin = 0.15 } = {}) {
  if (scene?.source !== undefined && scene.source !== source) throw new Error('Source changed. Generate a new route suggestion.');
  if (!scene?.objects?.includes(object)) throw new Error('Select a connector in the current diagram.');
  if (object.path?.length > 2) throw new Error('This connector has existing bends. Reset its bends explicitly before asking for a tidy route.');
  const original = routeCandidates(source, object, scene, 'straight')[0];
  if (!original || object.path?.length !== 2) throw new Error('Tidy route needs a supported connector with explicit shape endpoints.');
  const match = original.patch.text.match(/^from ([A-Z]\w*)\.([nsew]) to ([A-Z]\w*)\.([nsew])$/);
  if (!match) throw new Error('Choose north, south, east, or west endpoints before tidying this route.');
  if (!Number.isFinite(margin) || margin <= 0 || margin > 10) throw new Error('Route clearance must be greater than zero and at most 10 inches.');
  const endpoints = [scene.objects.find(o => o.name === match[1]), scene.objects.find(o => o.name === match[3])];
  // Native arrow paths may stop short of their named anchor to draw an
  // arrowhead. Route from the anchors, not those shortened stroke vertices.
  const ends = [endpoints[0]?.anchors?.[match[2]], endpoints[1]?.anchors?.[match[4]]];
  if (ends.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) throw new Error('The connector has invalid endpoint coordinates.');
  const normals = [directions[match[2]], directions[match[4]]];
  const stubs = ends.map((p,i) => ({ x: scalar(p.x + normals[i][0]*margin), y: scalar(p.y + normals[i][1]*margin) }));
  const obstacles = obstacleRects(scene, margin);
  if (obstacles.length > 250) throw new Error('Tidy route supports up to 250 obstacles. Simplify the diagram or route this connector manually.');
  for (let i=0;i<2;i++) if (obstacles.some(r => r.object !== endpoints[i] && intersects(ends[i], stubs[i], r))) throw new Error('An endpoint is blocked by another shape. Move the shapes apart or choose a different anchor.');
  // Bound the routing grid; distant shapes still participate in collision checks.
  const center = {x:(stubs[0].x+stubs[1].x)/2,y:(stubs[0].y+stubs[1].y)/2};
  const rails = [...obstacles].sort((a,b) => Math.abs((a.left+a.right)/2-center.x)+Math.abs((a.bottom+a.top)/2-center.y)-Math.abs((b.left+b.right)/2-center.x)-Math.abs((b.bottom+b.top)/2-center.y)).slice(0,24);
  const xs = [...new Set([...stubs.map(p=>p.x), ...rails.flatMap(r=>[r.left,r.right])])].sort((a,b)=>a-b);
  const ys = [...new Set([...stubs.map(p=>p.y), ...rails.flatMap(r=>[r.bottom,r.top])])].sort((a,b)=>a-b);
  const point = id => ({x:xs[id%xs.length],y:ys[Math.floor(id/xs.length)]});
  const index = p => ys.indexOf(p.y)*xs.length+xs.indexOf(p.x);
  const start=index(stubs[0]), target=index(stubs[1]), queue=heap(), distance=new Map(), previous=new Map();
  const startDirection=normals[0][0] ? 1 : 2, startKey=start*3+startDirection;
  distance.set(startKey,0); queue.push({key:startKey,cost:0}); let final;
  while(queue.length) {
    const current=queue.pop(); if(current.cost !== distance.get(current.key)) continue;
    const id=Math.floor(current.key/3), direction=current.key%3;
    if(id===target) { final=current.key; break; }
    const x=id%xs.length, y=Math.floor(id/xs.length), a=point(id);
    for(const [nx,ny,heading] of [[x-1,y,1],[x+1,y,1],[x,y-1,2],[x,y+1,2]]) {
      if(nx<0 || nx>=xs.length || ny<0 || ny>=ys.length) continue;
      const next=ny*xs.length+nx, b=point(next);
      if(obstacles.some(r=>intersects(a,b,r))) continue;
      const cost=current.cost+Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+(heading!==direction ? margin*2 : 0), key=next*3+heading;
      if(cost >= (distance.get(key) ?? Infinity)-epsilon) continue;
      distance.set(key,cost); previous.set(key,current.key); queue.push({key,cost});
    }
  }
  if(final === undefined) throw new Error('No clear orthogonal route was found within the routing limit. Move shapes apart, change anchors, or add bends manually.');
  const route=[]; for(let key=final; key!==undefined; key=previous.get(key)) route.push(point(Math.floor(key/3)));
  const points=[];
  for(const p of [ends[0],...route.reverse(),ends[1]]) {
    if(points.length && Math.abs(points.at(-1).x-p.x)<epsilon && Math.abs(points.at(-1).y-p.y)<epsilon) continue;
    while(points.length>1) { const a=points.at(-2),b=points.at(-1); if(!((a.x===b.x && b.x===p.x)||(a.y===b.y && b.y===p.y))) break; points.pop(); }
    points.push(p);
  }
  const text=`from ${match[1]}.${match[2]} to ${[...points.slice(1,-1).map(pointText),`${match[3]}.${match[4]}`].join(' then to ')}`;
  const patch={...original.patch,text};
  return {label:'Tidy orthogonal route',patch,source:applyPatch(source,patch),selectId:object.id,targetKind:object.kind,...(object.name ? {selectName:object.name} : {}),routing:{points,margin,gridNodes:xs.length*ys.length}};
}
