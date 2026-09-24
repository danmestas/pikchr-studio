import { readProperties } from './properties.js';

export const SIZING_PREFERENCE_LIMITS = Object.freeze({ entries: 500, snapshots: 20, text: 10000, bytes: 1024 * 1024 });
const modes = new Set(['grow', 'wrap', 'fixed']);
const shapes = new Set(['box', 'circle', 'ellipse', 'oval', 'cylinder', 'diamond']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const valid = value => record(value) && modes.has(value.mode) && typeof value.text === 'string'
  && value.text.length <= SIZING_PREFERENCE_LIMITS.text && typeof value.statement === 'string';
const cloneSnapshot = entry => ({statement:entry.statement,mode:entry.mode,text:entry.text});

export function validateSizingPreferences(value = {}) {
  if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid text sizing preferences.');
  const entries=Object.entries(value);
  if(entries.length > SIZING_PREFERENCE_LIMITS.entries) throw new Error('Text sizing preferences exceed 500 entries.');
  const result={};
  for(const [name,entry] of entries) {
    if(!/^[A-Z][A-Za-z0-9_]*$/.test(name) || !valid(entry) || entry.statement.length > 2 * 1024 * 1024) throw new Error('Invalid text sizing preference entry.');
    result[name]=cloneSnapshot(entry);
    if(Object.hasOwn(entry,'history')) {
      if(!Array.isArray(entry.history) || entry.history.length >= SIZING_PREFERENCE_LIMITS.snapshots || entry.history.some(item=>!valid(item) || item.statement.length > 2*1024*1024 || Object.hasOwn(item,'history'))) throw new Error('Invalid text sizing preference history.');
      result[name].history=entry.history.map(cloneSnapshot);
    }
  }
  if(new TextEncoder().encode(JSON.stringify(result)).length > SIZING_PREFERENCE_LIMITS.bytes) throw new Error('Text sizing preferences exceed the 1 MB storage limit.');
  return result;
}

function statementFor(source, scene, object) {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(object?.name || '') || !shapes.has(object.kind)) throw new Error('Text sizing preferences need a uniquely named editable shape.');
  return readProperties(source, object, scene).statement;
}

// Preferences explain the author's sizing intent, never override source.
// Imported or manually changed statements deliberately have no inferred mode.
export function readSizingPreference(source, scene, object, preferences) {
  try {
    if (!record(preferences) || !Object.hasOwn(preferences, object?.name)) return null;
    const current = preferences[object.name];
    if (!valid(current)) return null;
    if(current.history !== undefined && (!Array.isArray(current.history) || current.history.length >= SIZING_PREFERENCE_LIMITS.snapshots || current.history.some(entry=>!valid(entry)))) return null;
    const statement=statementFor(source,scene,object);
    const entry=[current,...(current.history||[])].find(item=>item.statement===statement);
    if(!entry) return null;
    if (entry.mode === 'wrap' && object.kind !== 'box') return null;
    const width = object.bbox?.width;
    if (!Number.isFinite(width) || width <= 0) return null;
    return { mode: entry.mode, text: entry.text, width };
  } catch { return null; }
}

export function writeSizingPreference(source, scene, object, preferences, { mode, text } = {}) {
  if (!modes.has(mode) || typeof text !== 'string' || text.length > SIZING_PREFERENCE_LIMITS.text) throw new Error('Choose a supported sizing mode and at most 10000 text characters.');
  if (mode === 'wrap' && object?.kind !== 'box') throw new Error('Wrap preferences are currently supported only for boxes.');
  const statement = statementFor(source, scene, object);
  // The newest entry wins and is retained if the bounded store needs eviction.
  const existing=validateSizingPreferences(preferences||{}), prior=existing[object.name];
  const seen=new Set([statement]), history=[];
  for(const entry of prior ? [prior,...(prior.history||[])] : []) {
    if(seen.has(entry.statement)) continue;
    seen.add(entry.statement); history.push(cloneSnapshot(entry));
    if(history.length===SIZING_PREFERENCE_LIMITS.snapshots-1) break;
  }
  const entries=Object.entries(existing).filter(([name])=>name!==object.name);
  return validateSizingPreferences(Object.fromEntries([...entries.slice(-(SIZING_PREFERENCE_LIMITS.entries - 1)), [object.name, { statement, mode, text,...(history.length?{history}:{}) }]]));
}
