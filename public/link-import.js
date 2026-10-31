// Decodes (and encodes) the #z= fragment quarry links carry: base64url (no padding) of the
// raw DEFLATE (RFC 1951) of the diagram's UTF-8 source. Pure: it reads nothing
// but its argument and sends nothing anywhere.
const PREFIX='#z=';
const LIMIT=2*1024*1024;
// Share links stay short enough to paste into chat and survive URL handling.
const MAX_PAYLOAD=32*1024;
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
// The inverse of decodeLinkSource: the payload for a source, or an Error when it is blank or too large to share.
export async function encodeLinkSource(text){
  if(typeof text!=='string'||!text.trim())throw Error('Diagram is empty.');
  const bytes=new TextEncoder().encode(text);
  if(bytes.length>LIMIT)throw Error('Diagram is too large.');
  const packed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let bin='';for(let i=0;i<packed.length;i+=0x8000)bin+=String.fromCharCode(...packed.subarray(i,i+0x8000));
  const payload=btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(payload.length>MAX_PAYLOAD)throw Error('Diagram is too large for a link. Copy the source instead.');
  return payload;
}
export const linkFragment=payload=>PREFIX+payload;
