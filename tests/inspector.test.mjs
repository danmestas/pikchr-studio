import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudio} from './pikchr-wasm.mjs';
import {connectorEnds,connectorTitle,editingBlocked} from '../public/arrow-ui.js';

const source=`Client: box "Client" at (0,0)
API: box "API" at (2,0)
E: arrow from Client.e to API.w
arrow "from X to Y" from Client to API chop
arrow from (0,2) to (1,2)
arrow from Client.n up 1
line from Client.s down 0.5 then right 1 then to API.s
`;
const scene=compileStudio(source).scene;
const object=i=>scene.objects[i];

test('connector ends read the source expressions, not the arrowhead-shortened path',()=>{
  assert.deepEqual(connectorEnds({object:object(2),scene,source}),{from:{code:'Client.e',name:'Client'},to:{code:'API.w',name:'API'}});
  // A quoted label containing "from" and "to" is not an endpoint.
  assert.deepEqual(connectorEnds({object:object(3),scene,source}),{from:{code:'Client',name:'Client'},to:{code:'API',name:'API'}});
  assert.deepEqual(connectorEnds({object:object(4),scene,source}),{from:{code:'(0,2)',name:null},to:{code:'(1,2)',name:null}});
  // No "to": the end is the rendered point.
  const free=connectorEnds({object:object(5),scene,source});
  assert.deepEqual(free.from,{code:'Client.n',name:'Client'});
  assert.equal(free.to.name,null);assert.match(free.to.code,/^\(0, 1\.\d+\)$/);
  // "then to" chains end at the last reference.
  assert.deepEqual(connectorEnds({object:object(6),scene,source}).to,{code:'API.s',name:'API'});
  assert.equal(connectorEnds({object:object(0),scene,source}),null);
});

test('connector titles name both attached shapes only when attached at both ends',()=>{
  assert.equal(connectorTitle({object:object(3),scene,source}),'Arrow · Client → API');
  assert.equal(connectorTitle({object:object(4),scene,source}),'Arrow');
  assert.equal(connectorTitle({object:object(5),scene,source}),'Arrow');
  assert.equal(connectorTitle({object:object(6),scene,source}),'Line · Client → API');
});

test('editing is reported only when blocked, in plain words',()=>{
  const editable={endpoints:true,route:false,styles:false};
  assert.equal(editingBlocked(object(0),null),null);
  assert.equal(editingBlocked(object(2),editable),null);
  assert.match(editingBlocked(object(2),{endpoints:false,route:false,styles:false}),/^Editing is blocked: .*Edit it in source\.$/);
  assert.match(editingBlocked({kind:'box',name:'',editable:false,reason:'Only supported named native shapes have movement suggestions'},null),/^Moving is blocked: this shape has no name/);
  assert.match(editingBlocked({kind:'file',name:'F',editable:false,reason:'Only supported named native shapes have movement suggestions'},null),/^Editing is blocked: .*file/);
  assert.match(editingBlocked({kind:'box',name:'H',editable:false,reason:'Nested object'},null),/^Editing is blocked: this object is inside a \[ \] block/);
  // Same advice as a blocked drag: Detach from macro, not "inspect the generating source".
  const macro=editingBlocked({kind:'box',name:'M',editable:false,reason:'Macro-expanded object'},null);
  assert.match(macro,/^Editing is blocked: this shape comes from a macro\b.*Choose Detach from macro to edit it on its own\.$/);
  assert.doesNotMatch(macro,/generating source/);
});

test('suggested routes are route candidates only; arrowheads belong to Heads',async()=>{
  const {routeStyleCandidates,suggestedRoutes}=await import('../public/route-styles.js');
  const all=routeStyleCandidates(source,object(2),scene),routes=suggestedRoutes(source,object(2),scene);
  assert.ok(all.options.some(o=>o.group==='Arrowheads'));
  assert.ok(routes.options.length>0);
  assert.deepEqual(routes.options.map(o=>o.id),all.options.filter(o=>o.group!=='Arrowheads').map(o=>o.id));
  assert.ok(routes.options.every(o=>!o.id.startsWith('heads-')));
});
