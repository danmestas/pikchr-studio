// Alignment guides for a shape being dragged. Pure geometry in Pikchr inches
// (y up); rendering lives in the caller.
//
// alignmentGuides reports every line the moving box currently shares with
// other shapes, not just the one it snapped to: left/center/right on x and
// bottom/middle/top on y. Each guide spans all shapes on that line and lists
// the points where each shape meets it, so the caller can draw one line plus
// small markers instead of lines that start in the middle of a shape.

const EPS = 1e-6;
const lines = (b, axis) => axis === 'x'
  ? [['start', b.x], ['center', b.x + b.width / 2], ['end', b.x + b.width]]
  : [['start', b.y], ['center', b.y + b.height / 2], ['end', b.y + b.height]];

// Points on a box that lie on a given vertical (axis x) or horizontal line.
function touchPoints(b, axis, value, feature) {
  if (axis === 'x') {
    if (feature === 'center') return [{x:value, y:b.y + b.height / 2}];
    return [{x:value, y:b.y}, {x:value, y:b.y + b.height}];
  }
  if (feature === 'center') return [{x:b.x + b.width / 2, y:value}];
  return [{x:b.x, y:value}, {x:b.x + b.width, y:value}];
}

export function alignmentGuides(moving, others) {
  const guides = [];
  for (const axis of ['x', 'y']) {
    const cross = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'height' : 'width';
    const mine = lines(moving, axis);
    // One relationship per shape per axis: centers if they line up (this also
    // covers same-size shapes, whose edges would add two redundant lines),
    // otherwise whichever edges match.
    const relations = [];
    for (const o of others) {
      if (!o?.bbox) continue;
      const theirs = lines(o.bbox, axis);
      if (Math.abs(theirs[1][1] - mine[1][1]) < EPS) { relations.push({o, feature:'center', theirFeature:'center', value:mine[1][1]}); continue; }
      for (const [feature, value] of mine) for (const [theirFeature, t] of theirs)
        if (feature !== 'center' && theirFeature !== 'center' && Math.abs(t - value) < EPS) relations.push({o, feature, theirFeature, value});
    }
    const byValue = new Map();
    for (const r of relations) {
      const key = [...byValue.keys()].find(v => Math.abs(v - r.value) < EPS) ?? r.value;
      if (!byValue.has(key)) byValue.set(key, []);
      byValue.get(key).push(r);
    }
    for (const [value, rs] of byValue) {
      const feature = rs[0].feature, names = rs.map(r => r.o.name || r.o.kind);
      if (feature === 'center') {
        // Draw only in the gaps between the moving shape and each other shape,
        // from facing edge to facing edge, so the line never crosses a label.
        const segments = [], points = [];
        const lo = b => b[cross], hi = b => b[cross] + b[size];
        for (const r of rs) {
          const b = r.o.bbox;
          const [from, to] = hi(b) <= lo(moving) ? [hi(b), lo(moving)] : hi(moving) <= lo(b) ? [hi(moving), lo(b)] : [null, null];
          if (from === null) continue;
          segments.push([from, to]);
          points.push(axis === 'x' ? {x:value, y:from} : {x:from, y:value}, axis === 'x' ? {x:value, y:to} : {x:to, y:value});
        }
        if (segments.length) guides.push({axis, value, feature, names, segments, points,
          from:Math.min(...segments.map(s => s[0])), to:Math.max(...segments.map(s => s[1]))});
        continue;
      }
      const boxes = [moving, ...rs.map(r => r.o.bbox)];
      const from = Math.min(...boxes.map(b => b[cross])), to = Math.max(...boxes.map(b => b[cross] + b[size]));
      const points = [...touchPoints(moving, axis, value, feature), ...rs.flatMap(r => touchPoints(r.o.bbox, axis, value, r.theirFeature))];
      guides.push({axis, value, feature, names, segments:[[from, to]], points, from, to});
    }
  }
  return guides;
}

// Equal-gap measurement between neighbours on one axis, for labelled ticks.
export function gapMarks(a, b, moving, axis, gap) {
  const ext = axis === 'x' ? 'width' : 'height', cross = axis === 'x' ? 'y' : 'x', size = axis === 'x' ? 'height' : 'width';
  const boxes = [a, b, moving].sort((p, q) => p[axis] - q[axis]);
  const marks = [];
  for (let i = 0; i < 2; i++) {
    const from = boxes[i][axis] + boxes[i][ext], to = boxes[i + 1][axis];
    const lo = Math.max(boxes[i][cross], boxes[i + 1][cross]), hi = Math.min(boxes[i][cross] + boxes[i][size], boxes[i + 1][cross] + boxes[i + 1][size]);
    const at = lo < hi ? (lo + hi) / 2 : (boxes[i][cross] + boxes[i][size] / 2 + boxes[i + 1][cross] + boxes[i + 1][size] / 2) / 2;
    marks.push({axis, from, to, at, label:gap.toFixed(2)});
  }
  return marks;
}
