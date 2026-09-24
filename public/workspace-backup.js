import {validateDocumentState} from './documents.js';

// Backups contain data only. Importers create fresh document IDs; archived IDs
// identify records within this bundle and must never overwrite browser data.
export const WORKSPACE_LIMITS=Object.freeze({bytes:16*1024*1024,documents:100,history:1000});
const format='pikchr-studio-workspace';
const bytes=text=>new TextEncoder().encode(text).byteLength;
function size(text){
  if(typeof text!=='string'||text.length>WORKSPACE_LIMITS.bytes||bytes(text)>WORKSPACE_LIMITS.bytes)
    throw Error('Workspace backup exceeds the 16 MB limit.');
}
function records(input){
  if(!Array.isArray(input)||input.length>WORKSPACE_LIMITS.documents)
    throw Error('Workspace backup must contain at most 100 documents.');
  const ids=new Set();
  return input.map(record=>{
    if(!record||record.version!==1||typeof record.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(record.id)||ids.has(record.id)||
      !Number.isSafeInteger(record.revision)||record.revision<1||!Number.isFinite(record.updated))
      throw Error('Workspace backup contains an invalid or duplicate document record.');
    ids.add(record.id);
    const state=validateDocumentState(record.state);
    if(state.undo.length>WORKSPACE_LIMITS.history||state.redo.length>WORKSPACE_LIMITS.history)
      throw Error('Workspace backup contains more than 1000 undo or redo entries.');
    return {version:1,id:record.id,revision:record.revision,updated:record.updated,state};
  });
}
export function exportWorkspace(input){
  const text=JSON.stringify({format,version:1,documents:records(input)},null,2);
  size(text);return text;
}
export function parseWorkspace(text){
  size(text);
  let bundle;
  try{bundle=JSON.parse(text);}catch{throw Error('Workspace backup is not valid JSON.');}
  if(!bundle||bundle.format!==format||bundle.version!==1)
    throw Error('Unsupported workspace backup format or version.');
  // Validate the entire bundle before the caller writes even the first copy.
  return records(bundle.documents);
}
