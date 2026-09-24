import test from 'node:test';
import assert from 'node:assert/strict';
import {createCandidateReview} from '../public/candidate-review.js';

class Element {
  constructor(tag,doc) { this.tag=tag; this.ownerDocument=doc; this.children=[]; this.style={}; this.events={}; this.attributes={}; this.innerHTML=''; this.open=false; }
  append(node) {this.children.push(node);}
  setAttribute(name,value) {this.attributes[name]=value;}
  addEventListener(name,handler) {(this.events[name]??=[]).push(handler);}
  async fire(name,event={preventDefault(){}}) {for(const handler of this.events[name]||[]) await handler(event);}
  focus() {this.ownerDocument.focused=this;}
  showModal() {this.open=true;}
  close() {this.open=false;}
  querySelector(name) {return name==='svg' && this.innerHTML.includes('<svg') ? new Element('svg',this.ownerDocument) : null;}
}
function fixture(render=async()=>({svg:'<svg viewBox="0 0 10 10"></svg>',error:null})) {
  const doc={nodes:[],createElement(tag){const n=new Element(tag,this);this.nodes.push(n);return n;}};
  doc.body=doc.createElement('body');const host=doc.createElement('section');host.innerHTML='<svg>original</svg>';
  const state={source:'old source',key:'doc-a/1',valid:true,object:{id:'arrow'}};
  const proposed=[],messages=[];let bindings=0;
  const controller=createCandidateReview({host,getState:()=>state,render,propose:(object,options)=>proposed.push({object,options}),status:text=>messages.push(text),rebind:()=>bindings++});
  const option={source:'new source',patch:{base:'old source',expected:'old route',text:'new route'}};
  return {doc,host,state,proposed,messages,controller,option,get bindings(){return bindings;},button:text=>doc.nodes.find(n=>n.tag==='button' && n.textContent===text)};
}
test('preview does not apply; Cancel restores the canvas and its bindings',async()=>{
  const f=fixture(); assert.equal(await f.controller.review(f.option),true);
  assert.match(f.host.innerHTML,/viewBox/);assert.equal(f.state.source,'old source');assert.equal(f.proposed.length,0);assert.equal(f.controller.busy,true);
  await f.button('Cancel').fire('click'); assert.equal(f.host.innerHTML,'<svg>original</svg>');assert.equal(f.bindings,1);assert.equal(f.controller.busy,false);assert.equal(f.doc.focused,f.host);
});
test('Use route restores before proposing exactly one candidate',async()=>{
  const f=fixture(); await f.controller.review(f.option);await f.button('Use route').fire('click');
  assert.equal(f.host.innerHTML,'<svg>original</svg>');assert.equal(f.proposed.length,1);assert.deepEqual(f.proposed[0].options,[f.option]);assert.equal(f.bindings,1);
});
test('Escape during pending validation ignores late renderer results',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const pending=f.controller.review(f.option);
  const dialog=f.doc.nodes.find(n=>n.tag==='dialog');await dialog.fire('cancel');resolve({svg:'<svg>late</svg>'});
  assert.equal(await pending,false);assert.equal(f.host.innerHTML,'<svg>original</svg>');assert.equal(f.proposed.length,0);assert.equal(f.controller.busy,false);
});
test('document switches never restore an old canvas or apply an old candidate',async()=>{
  const f=fixture();await f.controller.review(f.option);f.state.key='doc-b/1';f.state.source='another document';f.host.innerHTML='<svg>other document</svg>';
  f.controller.sync();assert.equal(f.host.innerHTML,'<svg>other document</svg>');assert.equal(f.bindings,0);assert.equal(f.controller.busy,false);
  await f.button('Use route').fire('click');assert.equal(f.proposed.length,0);
});
test('renderer errors leave source/canvas untouched and expose Cancel',async()=>{
  const f=fixture(async()=>({error:'invalid route'}));assert.equal(await f.controller.review(f.option),false);
  assert.equal(f.host.innerHTML,'<svg>original</svg>');assert.equal(f.button('Use route').disabled,true);assert.match(f.messages.at(-1),/invalid route/);
  await f.button('Cancel').fire('click');assert.equal(f.controller.busy,false);
});
test('late results from an earlier review cannot replace a newer preview',async()=>{
  const resolvers=[];const f=fixture(()=>new Promise(r=>resolvers.push(r)));
  const first=f.controller.review(f.option), second=f.controller.review({...f.option,source:'second source'});
  resolvers[1]({svg:'<svg>second</svg>'});assert.equal(await second,true);
  resolvers[0]({svg:'<svg>first</svg>'});assert.equal(await first,false);assert.equal(f.host.innerHTML,'<svg>second</svg>');
});
