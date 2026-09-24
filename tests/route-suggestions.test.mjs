import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { tidyRouteCandidate } from '../public/route-suggestions.js';
import { applyPatch } from '../public/edits.js';
const publicDir = path.resolve(import.meta.dirname, '../public');
const context = vm.createContext({ require: createRequire(import.meta.url), process, console, __dirname: publicDir, __filename: path.join(publicDir, 'pikchr.js'), URL, TextDecoder, TextEncoder, setTimeout });
vm.runInContext(fs.readFileSync(path.join(publicDir, 'pikchr.js'), 'utf8'), context);
const module = await context.initPikchrModule({ locateFile: p => path.join(publicDir, p) });
const native = module.cwrap('pikchr_studio', 'number', ['string']);
function render(source) { const pointer = native(source); try { return JSON.parse(module.UTF8ToString(pointer)); } finally { module._free(pointer); } }
function fixture(middle='', route='from A.e to B.w') {
  const source='# café 😀\r\nA: box at (0,0)\r\nB: box at (4,0)\r\n'+middle+'Link: arrow "café 😀" '+route+' color blue\r\n# untouched\r\n';
  const scene=render(source); assert.equal(scene.error,null); return {source,scene,object:scene.objects.at(-1)};
}
test('native obstacle avoidance is deterministic, orthogonal, and source preserving',()=>{
  const {source,scene,object}=fixture('Obstacle: box width 1 height 1 at (2,0)\r\n');
  const edit=tidyRouteCandidate(source,scene,object);
  assert.equal(tidyRouteCandidate(source,scene,object).source,edit.source);
  assert.equal(applyPatch(source,edit.patch),edit.source); assert.throws(()=>applyPatch(source+' ',edit.patch),/Source changed/);
  assert.ok(edit.source.startsWith(source.slice(0,source.indexOf('Link:'))));
  assert.ok(edit.source.endsWith('color blue\r\n# untouched\r\n'));
  assert.match(edit.source,/Link: arrow "café 😀" from A.e/); assert.match(edit.source,/then to B.w/);
  const result=render(edit.source); assert.equal(result.error,null,edit.source);
  const route=result.objects.at(-1).path; assert.deepEqual(route[0],object.path[0]); assert.deepEqual(route.at(-1),object.path.at(-1));
  assert.ok(route.length>2);
  for(let i=1;i<route.length;i++) {
    const a=route[i-1],b=route[i]; assert.ok(a.x===b.x || a.y===b.y);
    if(a.x===b.x) assert.ok(a.x<=1.35+1e-8 || a.x>=2.65-1e-8 || Math.max(a.y,b.y)<=-.65+1e-8 || Math.min(a.y,b.y)>=.65-1e-8);
    else assert.ok(a.y<=-.65+1e-8 || a.y>=.65-1e-8 || Math.max(a.x,b.x)<=1.35+1e-8 || Math.min(a.x,b.x)>=2.65-1e-8);
  }
  assert.ok(edit.routing.gridNodes<=2500);
});
test('clear routes stay straight and all cardinal endpoint directions compile',()=>{
  const straight=fixture(); assert.equal(tidyRouteCandidate(straight.source,straight.scene,straight.object).source,straight.source);
  for(const a of ['n','s','e','w']) for(const b of ['n','s','e','w']) {
    const {source,scene,object}=fixture('',`from A.${a} to B.${b}`);
    const edit=tidyRouteCandidate(source,scene,object),result=render(edit.source);
    assert.equal(result.error,null,edit.source);
    assert.deepEqual(edit.routing.points[0],scene.objects[0].anchors[a]); assert.deepEqual(edit.routing.points.at(-1),scene.objects[1].anchors[b]);
    const route=result.objects.at(-1).path;
    for(let i=1;i<route.length;i++) assert.ok(Math.abs(route[i-1].x-route[i].x)<1e-8 || Math.abs(route[i-1].y-route[i].y)<1e-8,edit.source);
  }
});
test('existing bends, center anchors, and stale source are explicitly rejected',()=>{
  const bent=fixture('','from A.e to (2,1) then to B.w');
  assert.throws(()=>tidyRouteCandidate(bent.source,bent.scene,bent.object),/existing bends/);
  const centered=fixture('','from A.c to B.c'); assert.throws(()=>tidyRouteCandidate(centered.source,centered.scene,centered.object),/north, south/);
  const f=fixture(); assert.throws(()=>tidyRouteCandidate(f.source,{...f.scene,source:f.source+' '},f.object),/Source changed/);
});
test('blocked endpoints give a no-solution explanation without a patch',()=>{
  const {source,scene,object}=fixture('Blocker: box width 0.5 height 2 at (0.55,0)\r\n');
  assert.throws(()=>tidyRouteCandidate(source,scene,object),/endpoint is blocked/);
});
test('an enclosed endpoint reports no clear route without unbounded searching',()=>{
  const {source,scene,object}=fixture('North: box width 2 height 0.2 at (0,1)\r\nSouth: box width 2 height 0.2 at (0,-1)\r\nEast: box width 0.2 height 2 at (1,0)\r\nWest: box width 0.2 height 2 at (-1,0)\r\n');
  assert.throws(()=>tidyRouteCandidate(source,scene,object),/No clear orthogonal route/);
});
test('tidy route on an unnamed connector can be identified by the app validator',()=>{
  const source='A: box at (0,0)\nB: box at (4,0)\nObstacle: box width 1 height 1 at (2,0)\narrow from A.e to B.w\n';
  const scene=render(source),object=scene.objects.at(-1);
  const edit=tidyRouteCandidate(source,scene,object);
  assert.equal(edit.selectName,undefined);
  assert.equal(edit.targetKind,'arrow');
  // Same matcher app.js validateSuggestions applies to id-selected candidates.
  const result=render(edit.source);
  const matches=result.objects.filter(n=>n.id===edit.selectId&&n.kind===edit.targetKind);
  assert.equal(matches.length,1);
});
