import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasNavigation,clampZoom,pinchTransform} from '../public/canvas-navigation.js';
test('pinch keeps a focal point and separates pan from scale',()=>{
  const result=pinchTransform([{x:0,y:0},{x:10,y:0}],[{x:5,y:8},{x:25,y:8}]);
  assert.deepEqual(result,{from:{x:5,y:0},to:{x:15,y:8},factor:2});
});
test('touches that start together cannot produce infinite zoom',()=>{
  assert(Number.isFinite(pinchTransform([{x:0,y:0},{x:0,y:0}],[{x:1,y:0},{x:2,y:0}]).factor));
  assert.equal(clampZoom(.01),.2);assert.equal(clampZoom(100),12);assert.equal(clampZoom(1.25),1.25);
});
test('pinch cancels editors and suppresses releases until both fingers lift',()=>{
  class Surface{
    listeners={};clientHeight=500;
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    setPointerCapture(){}
    contains(){return true;}
    fire(type,fields={}){const e={type,isTrusted:true,button:0,pointerId:1,clientX:100,clientY:100,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...fields};for(const fn of this.listeners[type]||[])fn(e);return e;}
  }
  const previous={document:globalThis.document,window:globalThis.window,PointerEvent:globalThis.PointerEvent};
  const host=new Surface(),doc=new Surface(),win=new Surface();let cancelled=0,ended=0,editsCancelled=0;const zooms=[],pans=[];
  const shape={closest:selector=>selector.includes('[data-pikchr-id]')?shape:null,dispatchEvent:e=>{assert.equal(e.type,'pointercancel');cancelled++;}};
  try{
    globalThis.document=doc;globalThis.window=win;globalThis.PointerEvent=class{constructor(type,values){this.type=type;Object.assign(this,values);}};
    canvasNavigation(host,{panEnabled:()=>false,panBy:(...p)=>pans.push(p),zoomAt:(...p)=>zooms.push(p),cancelEdit:()=>editsCancelled++,deselect:()=>assert.fail('pinch must not deselect'),onMode:()=>{},end:()=>ended++});
    assert(!host.fire('pointerdown',{target:shape}).stopped,'first finger may start a shape drag');
    assert(host.fire('pointerdown',{pointerId:2,clientX:200,target:shape}).stopped);
    assert.equal(cancelled,2);assert.equal(editsCancelled,1);
    host.fire('pointermove',{pointerId:2,clientX:300,target:shape});
    assert.equal(zooms[0][0],2);assert.deepEqual(pans[0],[50,0]);
    assert(host.fire('pointerup',{pointerId:2,target:shape}).stopped);
    assert(host.fire('pointermove',{clientX:110,target:shape}).stopped,'remaining finger must not resume editing');
    assert(host.fire('pointerup',{target:shape}).stopped);assert.equal(ended,1);
    assert(!host.fire('pointerdown',{target:shape}).stopped,'next gesture can edit normally');
    doc.fire('keydown',{key:'Escape',target:{closest:()=>null}});
    const panCount=pans.length;
    assert(host.fire('pointermove',{clientX:170,target:shape}).stopped);
    assert.equal(pans.length,panCount,'Escape suppresses movement until release');
    assert(host.fire('pointerup',{target:shape}).stopped);
    const z=zooms.length;
    host.fire('wheel',{ctrlKey:true,deltaY:-10,deltaX:0,deltaMode:0});
    assert(zooms[z][0]>1,'ctrl-wheel zooms inward');
    host.fire('wheel',{ctrlKey:false,deltaY:10,deltaX:5,deltaMode:0});
    assert.deepEqual(pans.at(-1),[-5,-10],'ordinary wheel pans');
  }finally{Object.assign(globalThis,previous);}
});

test('canvas tools own blank touches without taking over explicit pan, pinch or inline input',()=>{
  class Surface{
    listeners={};focused=0;
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    setPointerCapture(){}
    focus(){this.focused++;}
    contains(){return true;}
    fire(type,fields={}){const e={type,isTrusted:true,button:0,pointerId:1,clientX:100,clientY:100,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...fields};for(const fn of this.listeners[type]||[])fn(e);return e;}
  }
  const previous={document:globalThis.document,window:globalThis.window,PointerEvent:globalThis.PointerEvent};
  const host=new Surface(),doc=new Surface(),win=new Surface();
  let own=true,pan=false,cancelled=0,ended=0;const zooms=[];
  const blank={closest:()=>null,dispatchEvent:()=>{cancelled++;}};
  const input={closest:selector=>selector.includes('input')?input:null};
  const handle={closest:selector=>selector.includes('.canvas-overlay')?handle:null,dispatchEvent:()=>{cancelled++;}};
  try{
    globalThis.document=doc;globalThis.window=win;globalThis.PointerEvent=class{constructor(type,values){this.type=type;Object.assign(this,values);}};
    canvasNavigation(host,{panEnabled:()=>pan,ownsPointer:e=>own&&e.target===blank,panBy:()=>{},zoomAt:(...p)=>zooms.push(p),cancelEdit:()=>{},deselect:()=>{},onMode:()=>{},end:()=>ended++});
    assert(!host.fire('pointerdown',{target:input}).stopped);
    assert.equal(host.focused,0,'inline inputs retain focus');
    assert(!host.fire('pointerdown',{target:blank}).stopped,'tool receives first blank touch');
    assert.equal(cancelled,0,'input pointer must not join canvas pinch');
    assert(host.fire('pointerdown',{pointerId:2,clientX:200,target:blank}).stopped,'pinch overrides the tool');
    assert.equal(cancelled,2);
    host.fire('pointermove',{pointerId:2,clientX:300,target:blank});
    assert.equal(zooms.length,1);
    assert(host.fire('pointerup',{pointerId:2,target:blank}).stopped);
    assert(host.fire('pointerup',{target:blank}).stopped);
    assert.equal(ended,1);
    own=false;
    assert(!host.fire('pointerdown',{target:handle}).stopped,'resize handles remain editable without a tool mode');
    host.fire('pointerup',{target:handle});
    assert(host.fire('pointerdown',{target:blank}).stopped,'default blank canvas still pans');
    host.fire('pointerup',{target:blank});
    own=true;pan=true;
    assert(host.fire('pointerdown',{target:blank}).stopped,'explicit pan overrides tool');
    host.fire('pointerup',{target:blank});pan=false;
    assert(host.fire('pointerdown',{target:blank,button:1}).stopped,'middle button overrides tool');
    host.fire('pointerup',{target:blank,button:1});
    doc.fire('keydown',{code:'Space',target:blank});
    assert(host.fire('pointerdown',{target:blank}).stopped,'Space overrides tool');
    host.fire('pointerup',{target:blank});doc.fire('keyup',{code:'Space',target:blank});
    assert(!host.fire('pointerdown',{target:blank}).stopped,'tool resumes after Space release');
    host.fire('pointerup',{target:blank});
  }finally{Object.assign(globalThis,previous);}
});
