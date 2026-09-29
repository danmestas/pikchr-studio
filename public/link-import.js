// Decodes the #z= fragment quarry links carry: base64url (no padding) of the
// raw DEFLATE (RFC 1951) of the diagram's UTF-8 source. Pure: it reads nothing
// but its argument and sends nothing anywhere.
const PREFIX='#z=';
const LIMIT=2*1024*1024;
export function linkPayload(hash){return typeof hash==='string'&&hash.startsWith(PREFIX)?hash.slice(PREFIX.length):null;}
export async function decodeLinkSource(payload){
  if(typeof payload!=='string'||!payload||!/^[A-Za-z0-9_-]+$/.test(payload))throw Error('Not a valid link payload.');
  const b64=payload.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=Uint8Array.from(atob(b64+'==='.slice((b64.length+3)%4)),c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader=stream.getReader(),chunks=[];let size=0;
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    size+=value.length;
    if(size>LIMIT){await reader.cancel();throw Error('Link diagram is too large.');}
    chunks.push(value);
  }
  const all=new Uint8Array(size);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}
  const text=new TextDecoder('utf-8',{fatal:true}).decode(all);
  if(!text.trim())throw Error('Link diagram is empty.');
  return text;
}
