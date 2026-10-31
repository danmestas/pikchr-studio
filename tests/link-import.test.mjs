import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {randomBytes} from 'node:crypto';
import {decodeLinkSource,encodeLinkSource,linkPayload} from '../public/link-import.js';

const encode=text=>zlib.deflateRawSync(Buffer.from(text,'utf8')).toString('base64url');

test('decodes the quarry test vector',async()=>{
  const vector='SsqvUFAqLE0sKqpUslZILCrKL7dWAAsWl5SmZOYrKaRl5uQoGFSkWqQZpBgBBgA';
  assert.equal(await decodeLinkSource(vector),'box "quarry"; arrow; box "studio" fill 0xe8f0d2');
});

test('round-trips non-ASCII source byte for byte',async()=>{
  for(const text of ['box "café ✓"','box "café → ✓ 日本語 ☕"\narrow\nbox "x"']){
    assert.equal(await decodeLinkSource(encode(text)),text);
  }
});

test('round-trips payloads whose length needs each padding amount',async()=>{
  for(let n=1;n<8;n++){const text='box "'+'a'.repeat(n)+'"';assert.equal(await decodeLinkSource(encode(text)),text);}
});

test('rejects malformed payloads',async()=>{
  for(const bad of ['','!!!','not base64 url','AAAA',encode('').slice(0,0),'SsqvUFAqLE0sKqpUslZILCrKL7dW',
    Buffer.from('plain text, not deflate').toString('base64url'),encode('   \n')]){
    await assert.rejects(decodeLinkSource(bad),undefined,JSON.stringify(bad));
  }
  await assert.rejects(decodeLinkSource(undefined));
});

test('rejects invalid UTF-8',async()=>{
  await assert.rejects(decodeLinkSource(zlib.deflateRawSync(Buffer.from([0xff,0xfe,0x62])).toString('base64url')));
});

test('linkPayload extracts only #z= fragments',()=>{
  assert.equal(linkPayload('#z=abc'),'abc');
  assert.equal(linkPayload('#other'),null);
  assert.equal(linkPayload(''),null);
});

test('encodeLinkSource round-trips ASCII, UTF-8 and multi-line sources',async()=>{
  for(const text of ['box','box "quarry"; arrow; box "studio" fill 0xe8f0d2','box "café → ✓ 日本語 ☕"\narrow\nbox "𝄞 x"','a'.repeat(5000)]){
    const payload=await encodeLinkSource(text);
    assert.match(payload,/^[A-Za-z0-9_-]+$/);
    assert.equal(await decodeLinkSource(payload),text);
  }
});

test('encodeLinkSource emits what the quarry decoder and node zlib agree on',async()=>{
  const text='box "quarry"; arrow; box "studio" fill 0xe8f0d2';
  assert.equal(zlib.inflateRawSync(Buffer.from(await encodeLinkSource(text),'base64url')).toString('utf8'),text);
});

test('encodeLinkSource rejects empty, blank and oversized sources',async()=>{
  await assert.rejects(encodeLinkSource(''),/empty/i);
  await assert.rejects(encodeLinkSource('  \n'),/empty/i);
  await assert.rejects(encodeLinkSource(undefined));
  await assert.rejects(encodeLinkSource('x'.repeat(2*1024*1024+1)),/too large/i);
  // Incompressible text exceeds the link-length bound even under the byte limit.
  const noise=randomBytes(40000).toString('base64');
  await assert.rejects(encodeLinkSource(noise),/too large for a link/i);
});

test('encodeLinkSource accepts a source at the decoder byte limit when it compresses',async()=>{
  const text='a'.repeat(2*1024*1024);
  assert.equal((await decodeLinkSource(await encodeLinkSource(text))).length,text.length);
});

test('linkPayload reads back an encoded payload',async()=>{
  const payload=await encodeLinkSource('box "x"');
  assert.equal(linkPayload('#z='+payload),payload);
});
