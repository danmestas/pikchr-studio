import {validateSizingPreferences} from './sizing-preferences.js?v=20260923c';
// Documents are independent records: a damaged record never prevents opening another.
const PREFIX='pikchr-studio.document.v1.';
const CURRENT='pikchr-studio.current-document.v1';
const LAST='pikchr-studio.last-document.v1';
const LIMIT=2*1024*1024;
const copy=value=>JSON.parse(JSON.stringify(value));
function source(value){return typeof value==='string'&&value.length<=LIMIT;}
function draftStep(step){return !!step&&source(step.before)&&source(step.after)&&
  typeof step.label==='string'&&typeof step.diff==='string';}
function validate(state){
  if(!state||!source(state.source)||!Array.isArray(state.draft)||state.draft.length>1000||
    !Array.isArray(state.undo)||!Array.isArray(state.redo)||
    !state.undo.every(source)||!state.redo.every(source)||
    typeof state.autoApply!=='boolean'||typeof state.applied!=='boolean')throw Error('Invalid saved document state.');
  if(state.title!==undefined&&(typeof state.title!=='string'||state.title.length>100))throw Error('Invalid saved document title.');
  if(state.draft.length){
    if(!source(state.draftBase))throw Error('Invalid saved draft base.');
    let previous=state.draftBase;
    for(const step of state.draft){
      if(!draftStep(step)||step.before!==previous)throw Error('Invalid saved draft chain.');
      previous=step.after;
    }
    if(previous!==state.source)throw Error('Saved draft does not match the diagram source.');
  }else if(state.draftBase!==null)throw Error('Unexpected saved draft base.');
  const draftRedo=state.draftRedo===undefined?[]:state.draftRedo;
  if(!Array.isArray(draftRedo)||draftRedo.length>1000||(draftRedo.length&&state.autoApply))
    throw Error('Invalid saved draft redo state.');
  let previous=state.source;
  for(let index=draftRedo.length-1;index>=0;index--){
    const step=draftRedo[index];
    if(!draftStep(step)||step.before!==previous)throw Error('Invalid saved draft redo chain.');
    previous=step.after;
  }
  return copy({source:state.source,draft:state.draft,draftBase:state.draftBase,
    draftRedo,undo:state.undo,redo:state.redo,autoApply:state.autoApply,applied:state.applied,
    ...(state.title===undefined?{}:{title:state.title}),
    ...(state.sizingPreferences===undefined?{}:{sizingPreferences:validateSizingPreferences(state.sizingPreferences)})});
}
export {validate as validateDocumentState};
function decode(raw,id){
  const record=JSON.parse(raw);
  if(!record||record.version!==1||record.id!==id||!Number.isSafeInteger(record.revision)||
    record.revision<1||!Number.isFinite(record.updated))throw Error('Unsupported or corrupt saved document.');
  record.state=validate(record.state);
  return record;
}
function validId(id){return typeof id==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(id);}

export function createDocumentStore({local=globalThis.localStorage,session=globalThis.sessionStorage}={}){
  let current=null,baseline=null,blocked=false;
  function storage(){if(!local||!session)throw Error('Browser document storage is unavailable.');}
  function read(id){
    if(!validId(id))throw Error('Invalid document ID.');
    const raw=local.getItem(PREFIX+id);
    return {raw,record:raw===null?null:decode(raw,id)};
  }
  function select(id){
    const {raw,record}=read(id);
    session.setItem(CURRENT,id);
    current=id;baseline=raw;blocked=false;
    return record?{id,state:copy(record.state)}:null;
  }
  return {
    load(){
      storage();
      const id=session.getItem(CURRENT)||local.getItem(LAST);
      if(!id)return null;
      try{return select(id);}catch(error){current=id;blocked=true;throw error;}
    },
    open(id){storage();return select(id);},
    create(){
      storage();
      let id;
      do{id=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;}
      while(local.getItem(PREFIX+id)!==null);
      session.setItem(CURRENT,id);
      current=id;baseline=null;blocked=false;
      return id;
    },
    save(state){
      try{
        storage();
        if(blocked)throw Error('Saved document is corrupt. Its original data was preserved; create a new document to continue.');
        const clean=validate(state);
        if(!current)this.create();
        const raw=local.getItem(PREFIX+current);
        if(raw!==baseline)throw Error('This document changed in another tab. Open it again or create a new document before saving.');
        const revision=raw===null?1:decode(raw,current).revision+1;
        const next=JSON.stringify({version:1,id:current,revision,updated:Date.now(),state:clean});
        local.setItem(PREFIX+current,next);
        baseline=next;
        local.setItem(LAST,current);
        return {ok:true};
      }catch(error){return {ok:false,error:error.message||String(error)};}
    },
    list(){
      storage();
      const items=[];
      for(let i=0;i<local.length;i++){
        const key=local.key(i);
        if(!key?.startsWith(PREFIX))continue;
        const id=key.slice(PREFIX.length);
        try{
          const {record}=read(id);
          if(record)items.push({id,title:(record.state.title?.trim()||record.state.source.match(/"([^"\n]*)"/)?.[1]||'Untitled').slice(0,100),updated:record.updated});
        }catch{/* Preserve unreadable records, without hiding healthy documents. */}
      }
      return items.sort((a,b)=>b.updated-a.updated);
    },
    records(){
      storage();
      // Reading a backup must not change the active tab's selected document or
      // its conflict-detection baseline. Invalid records remain untouched.
      const records=[];
      for(let i=0;i<local.length;i++){
        const key=local.key(i);
        if(!key?.startsWith(PREFIX))continue;
        try{const {record}=read(key.slice(PREFIX.length));if(record)records.push(copy(record));}catch{}
      }
      return records.sort((a,b)=>b.updated-a.updated);
    }
  };
}
