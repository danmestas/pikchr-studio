// Shift-drag constraints. Pure geometry in Pikchr inches (y up).
//
// constrainDrag locks a drag to the nearest of eight directions (horizontal,
// vertical, and the four diagonals) measured from where the drag started.
// On a horizontal or vertical lock the free coordinate also snaps into line
// with other objects' centers and edges, and the result names the guide to
// draw. Diagonal locks never snap, because snapping would break the angle.

const DIRECTIONS = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]]
  .map(([x,y]) => { const n = Math.hypot(x,y); return {x:x/n, y:y/n, axis: x && y ? 'diagonal' : x ? 'x' : 'y'}; });

export function lockDirection(start, target) {
  const dx = target.x - start.x, dy = target.y - start.y;
  if (!dx && !dy) return {point:{...start}, axis:null};
  let best = DIRECTIONS[0], score = -Infinity;
  for (const d of DIRECTIONS) { const s = dx*d.x + dy*d.y; if (s > score) { score = s; best = d; } }
  return {point:{x:start.x + best.x*score, y:start.y + best.y*score}, axis:best.axis};
}

// Lines a moving box can align on: its center and both edges on one axis.
function stops(center, size) { return [center, center - size/2, center + size/2]; }

export function constrainDrag(start, target, {size={width:0,height:0}, others=[], tolerance=0.15}={}) {
  const locked = lockDirection(start, target);
  const point = {...locked.point};
  const result = {point, axis:locked.axis, guide:null};
  if (locked.axis !== 'x' && locked.axis !== 'y') return result;
  // Moving along x: snap x so a vertical line through our center or an edge
  // meets another object's center or edge. Same idea for y.
  const k = locked.axis, extent = k === 'x' ? size.width : size.height;
  let best = null;
  for (const other of others) {
    if (!other?.center || !other?.bbox) continue;
    const theirs = k === 'x'
      ? stops(other.center.x, other.bbox.width)
      : stops(other.center.y, other.bbox.height);
    const mine = stops(point[k], extent);
    for (let i = 0; i < mine.length; i++) for (const line of theirs) {
      const delta = line - mine[i];
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta)))
        best = {delta, line, other, kind: i === 0 ? 'center' : 'edge'};
    }
  }
  if (best) {
    point[k] += best.delta;
    result.guide = {axis:k, at:best.line, name:best.other.name || best.other.kind, kind:best.kind, other:best.other};
  }
  return result;
}

// Smart snapping for an unconstrained drag. Each axis snaps independently to
// the nearest of: another shape's edges or center (edge-to-edge, center-to-
// center, edge-to-center), the mirror of a sibling about a pivot shape, or an
// equal gap continuing a row/column. Returns the snapped center plus guides.
export function smartSnap(target, {size={width:0,height:0}, others=[], tolerance=0.08}={}) {
  const point = {...target}, guides = [];
  const box = (c, s) => ({x:[c.x - s.width/2, c.x, c.x + s.width/2], y:[c.y - s.height/2, c.y, c.y + s.height/2]});
  const shapes = others.filter(o => o?.center && o?.bbox);
  for (const k of ['x', 'y']) {
    const mine = box(point, size)[k];
    let best = null;
    const offer = (delta, guide) => { if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9)) best = {delta, guide}; };
    for (const o of shapes) {
      const theirs = box(o.center, o.bbox)[k];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
        offer(theirs[j] - mine[i], {type:'align', axis:k, at:theirs[j], other:o, kind: i === 1 && j === 1 ? 'center' : 'edge'});
    }
    // Equal gap: continue the spacing between two neighbours on this axis.
    const other = k === 'x' ? 'y' : 'x', ext = k === 'x' ? 'width' : 'height';
    for (const a of shapes) for (const b of shapes) {
      if (a === b || a.center[k] >= b.center[k]) continue;
      const gap = (b.center[k] - b.bbox[ext]/2) - (a.center[k] + a.bbox[ext]/2);
      if (gap <= 0) continue;
      const after = b.center[k] + b.bbox[ext]/2 + gap + size[ext]/2;
      const before = a.center[k] - a.bbox[ext]/2 - gap - size[ext]/2;
      // Only when roughly in the same row/column as the pair.
      if (Math.abs(point[other] - b.center[other]) > Math.max(size[k === 'x' ? 'height' : 'width'], b.bbox[k === 'x' ? 'height' : 'width']))
        continue;
      offer(after - point[k], {type:'gap', axis:k, at:after, gap, a, b, side:'after'});
      offer(before - point[k], {type:'gap', axis:k, at:before, gap, a, b, side:'before'});
    }
    // Mirror: land where a sibling would be reflected about a pivot's center.
    for (const pivot of shapes) for (const sib of shapes) {
      if (pivot === sib) continue;
      const mirrored = 2*pivot.center[k] - sib.center[k];
      if (Math.abs(mirrored - pivot.center[k]) < 1e-9) continue;
      offer(mirrored - point[k], {type:'mirror', axis:k, at:mirrored, pivot, other:sib});
    }
    if (best) { point[k] += best.delta; guides.push(best.guide); }
  }
  return {point, guides};
}
