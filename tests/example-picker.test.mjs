import test from 'node:test';
import assert from 'node:assert/strict';
import {examplePicker} from '../public/example-picker.js';

class Element {
  children=[];dataset={};attributes={};listeners={};textContent='';innerHTML='';disabled=false;hidden=false;
  append(child){this.children.push(child);}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}
  fire(type,event={}){for(const handler of this.listeners[type]||[])handler(event);}
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,{items,render,open}={}){
  const previous=globalThis.document;
  globalThis.document={createElement:()=>new Element()};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const fields=Object.fromEntries(['list','preview','description','message','use','guide','close'].map(name=>[name,new Element()]));
  const dialog=new Element();dialog.open=false;
  dialog.querySelector=selector=>fields[selector.slice(6,-1)];
  dialog.showModal=()=>{dialog.open=true;};
  dialog.close=()=>{dialog.open=false;dialog.fire('close');};
  const calls=[];
  const show=examplePicker({dialog,
    items:items||[{key:'a',title:'Pipeline',description:'Three connected objects.',load:async()=> 'source A'}],
    render:render|| (async source=>({svg:`<svg>${source}</svg>`})),
    open:open|| (async(...args)=>{calls.push(args);return true;})});
  return {dialog,...fields,show,calls};
}

test('opening previews an example without replacing the current document',async t=>{
  const h=setup(t);h.show();assert.equal(h.use.disabled,true);await flush();
  assert.equal(h.dialog.open,true);assert.equal(h.description.textContent,'Three connected objects.');
  assert.equal(h.preview.innerHTML,'<svg>source A</svg>');assert.equal(h.use.disabled,false);
  assert.equal(h.list.children[0].attributes['aria-pressed'],'true');assert.deepEqual(h.calls,[]);
  h.close.onclick();assert.equal(h.dialog.open,false);assert.deepEqual(h.calls,[]);
});

test('slower previous preview cannot overwrite the selected example',async t=>{
  const first=deferred();
  const h=setup(t,{items:[
    {key:'a',title:'Old',description:'Old description',load:async()=> 'A'},
    {key:'b',title:'New',description:'New description',guide:'guide.html',load:async()=> 'B'}
  ],render:source=>source==='A'?first.promise:Promise.resolve({svg:'<svg>B</svg>'})});
  h.show();await flush();h.list.children[1].onclick();await flush();
  first.resolve({svg:'<svg>A</svg>'});await flush();
  assert.equal(h.preview.innerHTML,'<svg>B</svg>');assert.equal(h.guide.href,'guide.html');assert.equal(h.guide.hidden,false);
  assert.equal(h.list.children[0].attributes['aria-pressed'],'false');
  await h.use.onclick();assert.deepEqual(h.calls,[['B',{svg:'<svg>B</svg>'},'New']]);
});

test('closing cancels a pending render without opening a document',async t=>{
  const pending=deferred(),h=setup(t,{render:()=>pending.promise});
  h.show();await flush();h.close.onclick();pending.resolve({svg:'<svg>late</svg>'});await flush();
  assert.equal(h.dialog.open,false);assert.equal(h.preview.innerHTML,'');assert.equal(h.use.disabled,true);assert.deepEqual(h.calls,[]);
});

test('failed save/open keeps the chooser and actionable error visible',async t=>{
  const h=setup(t,{open:async()=>false});h.show();await flush();await h.use.onclick();
  assert.equal(h.dialog.open,true);assert.equal(h.use.disabled,false);
  assert.match(h.message.textContent,/could not be saved/);assert.match(h.message.textContent,/Nothing was replaced/);
});

test('successful open passes the rendered source and closes the chooser',async t=>{
  const h=setup(t);h.show();await flush();await h.use.onclick();
  assert.deepEqual(h.calls,[['source A',{svg:'<svg>source A</svg>'},'Pipeline']]);assert.equal(h.dialog.open,false);
});

test('render errors disable opening and do not replace the current document',async t=>{
  const h=setup(t,{render:async()=>({error:'Invalid Pikchr'})});h.show();await flush();
  assert.equal(h.use.disabled,true);assert.match(h.message.textContent,/Invalid Pikchr/);
  await h.use.onclick();assert.deepEqual(h.calls,[]);assert.equal(h.dialog.open,true);
});

test('open exceptions leave the chooser available to retry',async t=>{
  const h=setup(t,{open:async()=>{throw Error('Storage unavailable');}});h.show();await flush();await h.use.onclick();
  assert.equal(h.dialog.open,true);assert.equal(h.use.disabled,false);assert.match(h.message.textContent,/Storage unavailable/);
});

test('an in-flight open cannot double-submit, close, or change selection',async t=>{
  const pending=deferred();let calls=0;
  const h=setup(t,{open:()=>{calls++;return pending.promise;}});h.show();await flush();
  const operation=h.use.onclick();await h.use.onclick();h.close.onclick();
  let prevented=false;h.dialog.fire('cancel',{preventDefault(){prevented=true;}});
  assert.equal(calls,1);assert.equal(h.dialog.open,true);assert.equal(h.use.disabled,true);assert.equal(prevented,true);
  pending.resolve(true);await operation;assert.equal(h.dialog.open,false);
});
