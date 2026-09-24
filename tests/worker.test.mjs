import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const workerSource=readFileSync(new URL('../public/worker.js',import.meta.url),'utf8');
function worker(options={}){
  const messages=[],calls=[],freed=[];
  const module={
    cwrap:()=>source=>{calls.push(source);return options.render?options.render(source):7;},
    UTF8ToString:pointer=>options.read?options.read(pointer):'{"svg":"<svg/>","objects":[],"error":null}',
    _free:pointer=>{freed.push(pointer);if(options.free)options.free(pointer);},
  };
  const self={postMessage:value=>messages.push(JSON.parse(JSON.stringify(value)))};
  const context=vm.createContext({self,TextEncoder,Error,
    importScripts:()=>{if(options.importError)throw new Error('Script unavailable');},
    initPikchrModule:()=>options.init?options.init(module):Promise.resolve(module),
  });
  vm.runInContext(workerSource,context);
  return {messages,calls,freed,send:data=>self.onmessage({data})};
}

test('worker validates messages without calling native code or losing later requests',async()=>{
  const w=worker();
  for(const data of [null,undefined,[],{},'text',{id:-1},{id:NaN},{id:1.5},{id:'1'}])await w.send(data);
  assert.deepEqual(w.messages,[]);
  for(const source of [undefined,null,{},42,['box']])await w.send({id:1,source});
  assert.ok(w.messages.every(item=>item.id===1&&item.result.error==='Source must be a string.'));
  await w.send({id:2,source:'box\0circle'});
  assert.match(w.messages.at(-1).result.error,/NUL/);
  assert.deepEqual(w.calls,[]);
  await w.send({id:3,source:'box'});
  assert.equal(w.messages.at(-1).id,3);
  assert.equal(w.messages.at(-1).result.error,null);
  assert.deepEqual(w.freed,[7]);
});

test('worker enforces UTF-8 byte limit before native allocation',async()=>{
  const w=worker();
  for(const source of ['a'.repeat(100001),'é'.repeat(50001),'😀'.repeat(25001)]){
    await w.send({id:1,source});
    assert.match(w.messages.at(-1).result.error,/100 KB/);
  }
  assert.deepEqual(w.calls,[]);
  await w.send({id:2,source:'é'.repeat(50000)});
  assert.equal(w.calls.length,1);
});

test('worker bounds startup queue and duplicate ids cannot poison original results',async()=>{
  let finish;
  const w=worker({init:module=>new Promise(resolve=>{finish=()=>resolve(module);})});
  const requests=Array.from({length:32},(_,id)=>w.send({id,source:'box'}));
  await w.send({id:0,source:null});
  assert.deepEqual(w.messages,[]);
  await w.send({id:32,source:'circle'});
  assert.match(w.messages[0].result.error,/busy/);
  assert.deepEqual(w.calls,[]);
  finish();await Promise.all(requests);
  assert.equal(w.calls.length,32);
  assert.equal(w.messages.filter(item=>item.id===0).length,1);
  await w.send({id:33,source:'line'});
  assert.equal(w.messages.at(-1).result.error,null);
});

test('worker returns startup errors correlated to each valid request',async()=>{
  for(const options of [{importError:true},{init:()=>Promise.reject(new Error('WASM unavailable'))}]){
    const w=worker(options);
    await w.send({id:1,source:'box'});
    await w.send({id:2,source:'box'});
    assert.deepEqual(w.messages.map(item=>item.id),[1,2]);
    assert.ok(w.messages.every(item=>/unavailable/.test(item.result.error)));
    assert.deepEqual(w.calls,[]);
  }
});

test('worker releases owned results after parse/read failures and recovers',async()=>{
  for(const read of [()=>'{broken',()=>{throw new Error('Read failed');},()=> 'null',()=> '[]']){
    let fail=true;
    const w=worker({read:()=>fail?read():'{"error":null,"objects":[]}'});
    await w.send({id:1,source:'box'});
    assert.equal(typeof w.messages[0].result.error,'string');
    assert.deepEqual(w.freed,[7]);
    fail=false;await w.send({id:2,source:'circle'});
    assert.equal(w.messages[1].result.error,null);
    assert.deepEqual(w.freed,[7,7]);
  }
});

test('worker handles native allocation, native exceptions, and free exceptions',async()=>{
  for(const render of [()=>0,()=>{throw new Error('Native failed');},()=>{throw 'failure';}]){
    const w=worker({render});await w.send({id:1,source:'box'});
    assert.equal(typeof w.messages[0].result.error,'string');
    assert.deepEqual(w.freed,[]);
  }
  const w=worker({free:()=>{throw new Error('Free failed');}});
  await w.send({id:1,source:'box'});
  assert.equal(w.messages[0].result.error,'Free failed');
  assert.deepEqual(w.freed,[7]);
});
