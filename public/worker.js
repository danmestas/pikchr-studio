const MAX_SOURCE_BYTES=100000;
const MAX_PENDING_REQUESTS=32;
const PLAINTEXT_ERRORS=1;
const DARK_MODE=2;
const pending=new Set();
const encoder=new TextEncoder();
const message=error=>error instanceof Error ? error.message : 'Renderer failed unexpectedly.';
// Resolve startup failures as data so a failed module never creates an unhandled
// rejection, including when failure happens before the first editor request.
const ready=(async()=>{
  try{
    importScripts('pikchr.js');
    const module=await initPikchrModule();
    return {module,render:module.cwrap('pikchr_studio','number',['string','string','number'])};
  }catch(error){return {error:message(error)};}
})();

self.onmessage=async(event)=>{
  const data=event?.data;
  // Unknown ids cannot safely correlate a response. Ignore them, and ignore a
  // duplicate live id rather than accidentally rejecting the original request.
  if(!data || typeof data!=='object' || Array.isArray(data)
      || !Number.isSafeInteger(data.id) || data.id<0 || pending.has(data.id))return;
  const id=data.id;
  const reject=error=>self.postMessage({id,result:{error}});
  if(typeof data.source!=='string')return reject('Source must be a string.');
  // The UTF-16 check bounds encoding allocation; UTF-8 check enforces the actual
  // byte limit. NUL would truncate the C string and invalidate source mappings.
  if(data.source.length>MAX_SOURCE_BYTES || encoder.encode(data.source).length>MAX_SOURCE_BYTES)
    return reject('Source exceeds the 100 KB editor limit.');
  if(data.source.includes('\0'))return reject('Source must not contain NUL characters.');
  // Optional rendering options pass straight through to the native call.
  const cls=data.cls==null?null:data.cls;
  if(cls!==null && (typeof cls!=='string' || cls.length>200 || /[^A-Za-z0-9_ -]/.test(cls)))
    return reject('Class must be a short string of letters, digits, spaces, hyphens or underscores.');
  const flags=data.flags==null?PLAINTEXT_ERRORS:data.flags;
  if(!Number.isSafeInteger(flags) || flags<0 || flags>(PLAINTEXT_ERRORS|DARK_MODE))
    return reject('Flags must be a bitmask of PLAINTEXT_ERRORS (1) and DARK_MODE (2).');
  if(pending.size>=MAX_PENDING_REQUESTS)return reject('Renderer is busy. Try again after pending renders finish.');
  pending.add(id);
  let module,pointer=0,result;
  try{
    const initialized=await ready;
    if(initialized.error)throw new Error(initialized.error);
    module=initialized.module;
    pointer=initialized.render(data.source,cls,flags);
    if(!pointer)throw new Error('Could not allocate renderer result.');
    result=JSON.parse(module.UTF8ToString(pointer));
    if(!result || typeof result!=='object' || Array.isArray(result))throw new Error('Renderer returned an invalid result.');
  }catch(error){result={error:message(error)};}
  finally{
    if(pointer){
      try{module._free(pointer);}catch(error){result={error:message(error)};}
    }
    pending.delete(id);
  }
  self.postMessage({id,result});
};
