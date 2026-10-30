// Names survive ordinary edits; positional ids only survive when a candidate
// explicitly supplies the new id. Otherwise rebase anonymous statement spans.
const only = list => list.length === 1 ? list[0] : null;
const bytes = text => new TextEncoder().encode(text).length;

function relocatedSpan(object, patch) {
  if (!object.span || !patch) return object.span || null;
  const {start,end} = object.span;
  const delta = bytes(patch.text) - (patch.end - patch.start);
  if (patch.end <= start) return {start:start + delta,end:end + delta};
  if (patch.start >= end) return {start,end};
  if (patch.start <= start && patch.end >= end) return null;
  if (patch.start >= start && patch.end <= end) return {start,end:end + delta};
  return null;
}

export function correspondingObject(objects, object, option = {}) {
  const name = option.selectName || object?.name;
  const kind = option.targetKind || (option.selectName ? null : object?.kind);
  if (name) {
    const hit = only(objects.filter(n => n.name === name));
    return hit && (!kind || hit.kind === kind) ? hit : null;
  }
  if (option.selectId) {
    return only(objects.filter(n => n.id === option.selectId && (!kind || n.kind === kind)
      && (!object || !n.name)));
  }
  if (!object) return null;
  const span = relocatedSpan(object,option.patch);
  if (span) {
    const hit = only(objects.filter(n => n.span?.start === span.start && n.span?.end === span.end
      && n.kind === kind && !n.name));
    if (hit) return hit;
  }
  if (option.patch?.text !== undefined) {
    // A whole-statement replacement can be identified only if its patch
    // contains exactly one anonymous object of the expected kind.
    const from = option.patch.start,to = from + bytes(option.patch.text);
    return only(objects.filter(n => n.span && n.kind === kind && !n.name
      && n.span.start >= from && n.span.end <= to));
  }
  return null;
}
