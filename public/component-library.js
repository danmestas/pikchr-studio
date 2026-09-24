const key='pikchr-studio.components.v1';
const maximumBytes=1024*1024;
const bytes=value=>new TextEncoder().encode(value).length;
function nameValue(name){
  if(typeof name!=='string'||!name.trim()||name.trim().length>80||/[<>\u0000-\u001f\u007f]/.test(name))throw new Error('Use a component name of 1–80 characters without HTML or control characters.');
  return name.trim();
}
function cloneFragment(fragment){
  if(fragment?.version!==1||!Array.isArray(fragment.objects)||!fragment.objects.length||fragment.objects.length>1000)throw new Error('Choose a valid copied selection for this component.');
  let text;
  try{text=JSON.stringify(fragment);}catch{throw new Error('The component cannot be saved as portable JSON.');}
  if(bytes(text)>maximumBytes)throw new Error('The component exceeds the 1 MB library limit.');
  const result=JSON.parse(text);
  for(const item of result.objects){
    if(!item||typeof item.statement!=='string'||!item.statement||item.statement.length>100000||!/^[A-Z][A-Za-z0-9_]*$/.test(item.name||'')||!['box','cylinder','circle','ellipse','oval','diamond','text','arrow','line'].includes(item.kind))throw new Error('The component contains an invalid object.');
  }
  if(result.omittedEdges!==undefined&&(!Array.isArray(result.omittedEdges)||result.omittedEdges.some(value=>typeof value!=='string')))throw new Error('The component has invalid omitted-edge metadata.');
  return result;
}

// Browser-local only. Components are separate from document history/backups;
// pasteSelection performs source-level validation before a component is used.
export function createComponentLibrary({storage}={}){
  if(storage===undefined){try{storage=globalThis.localStorage;}catch{throw new Error('Component storage is unavailable in this browser.');}}
  function read(){
    let raw;
    try{raw=storage.getItem(key);}catch{throw new Error('Component storage is unavailable in this browser.');}
    if(raw===null)return {version:1,entries:[]};
    try{
      if(typeof raw!=='string'||bytes(raw)>maximumBytes)throw Error();
      const record=JSON.parse(raw);
      if(record?.version!==1||!Array.isArray(record.entries)||record.entries.length>50)throw Error();
      const ids=new Set();
      for(const item of record.entries){
        if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)||ids.has(item.id)||nameValue(item.name)!==item.name)throw Error();
        cloneFragment(item.fragment);ids.add(item.id);
      }
      return record;
    }catch{throw new Error('The component library is corrupt or unsupported. Existing data was left untouched.');}
  }
  return {
    list(){return read().entries.map(({id,name})=>({id,name}));},
    get(id){const item=read().entries.find(entry=>entry.id===id);if(!item)throw new Error('This component no longer exists.');return cloneFragment(item.fragment);},
    save(name,fragment){
      const record=read(),cleanName=nameValue(name),copy=cloneFragment(fragment);
      if(record.entries.length>=50)throw new Error('The local component library is full (50 components).');
      const occupied=new Set(record.entries.map(item=>item.id));
      const prefix='component-'+Date.now().toString(36);let id=prefix,index=2;
      while(occupied.has(id))id=prefix+'-'+index++;
      record.entries.push({id,name:cleanName,fragment:copy});
      const text=JSON.stringify(record);
      if(bytes(text)>maximumBytes)throw new Error('The local component library exceeds its 1 MB limit. Nothing was saved.');
      try{storage.setItem(key,text);}catch{throw new Error('Component was not saved: browser storage is unavailable or full. Existing components were left untouched.');}
      return id;
    },
  };
}
