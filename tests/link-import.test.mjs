import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {decodeLinkSource,linkPayload} from '../public/link-import.js';

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
