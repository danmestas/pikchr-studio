import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attachPoints,nearestAnchor,contains,hitShape,facingSide,targetAnchor,connectionLabel,connectCandidate} from '../public/connect-drag.js';

const binary=fileURLToPath(new URL('../vendor/pikchr',import.meta.url));
function studio(source){
  const result=spawnSync(binary,['--studio','-'],{input:source,encoding:'utf8'});
  const scene=JSON.parse(result.stdout);
  assert.equal(scene.error,null,scene.error);
  return scene;
}
const base='A: box "A" at (0,0)\nB: circle "B" at (2,0)\nC: cylinder "Café ☕" at (0,-2)\n';
const find=(scene,name)=>scene.objects.find(o=>o.name===name);

test('attach points are the four side anchors of a shape', () => {
  const a=find(studio(base),'A');
  assert.deepEqual(attachPoints(a).map(p=>p.anchor),['n','e','s','w']);
  assert.deepEqual(attachPoints({anchors:{}}),[]);
  assert.deepEqual(attachPoints(null),[]);
});

test('nearest anchor picks the closest side', () => {
  const a=find(studio(base),'A');
  assert.equal(nearestAnchor(a,{x:5,y:0}),'e');
  assert.equal(nearestAnchor(a,{x:-5,y:0.1}),'w');
  assert.equal(nearestAnchor(a,{x:0,y:3}),'n');
  assert.equal(nearestAnchor(a,{x:0.1,y:-3}),'s');
  assert.equal(nearestAnchor({anchors:{}},{x:0,y:0}),'c');
});

test('hit testing ignores connectors, honours margin and prefers the smallest shape', () => {
  const scene=studio(base+'arrow from A.e to B.w\nBig: box "Big" width 5 height 5 at (0,0)\n');
  const a=find(scene,'A'),big=find(scene,'Big');
  assert.equal(hitShape(scene.objects,{x:0,y:0}),a);
  assert.equal(hitShape(scene.objects,{x:2,y:2}),big);
  assert.equal(hitShape(scene.objects,{x:0,y:0},{exclude:a}),big);
  assert.equal(hitShape(scene.objects,{x:1.2,y:0}).name,'Big');
  assert.ok(contains(a,{x:a.bbox.x-0.04,y:0},0.05));
  assert.ok(!contains(a,{x:a.bbox.x-0.2,y:0},0.05));
  assert.equal(hitShape(studio(base).objects,{x:10,y:10}),null);
});

test('facing side points a new shape back at its origin', () => {
  assert.equal(facingSide({x:3,y:0},{x:0,y:0}),'w');
  assert.equal(facingSide({x:-3,y:0},{x:0,y:0}),'e');
  assert.equal(facingSide({x:0,y:-3},{x:0,y:0}),'n');
  assert.equal(facingSide({x:0,y:3},{x:0,y:0}),'s');
});

test('badge text names both ends', () => {
  const scene=studio(base);
  assert.equal(connectionLabel(find(scene,'A'),'e',find(scene,'B'),'w'),'A.e → B.w');
  assert.equal(connectionLabel(find(scene,'A'),'s',null,null),'A.s → new shape');
});

test('dropping on a shape appends one connector that renders', () => {
  const scene=studio(base),a=find(scene,'A'),b=find(scene,'B');
  const option=connectCandidate(base,scene,{from:a,fromAnchor:'e',to:b,toAnchor:'w'});
  assert.match(option.source,/\nLink1: arrow from A\.e to B\.w\n$/);
  assert.ok(option.source.startsWith(base));
  const after=studio(option.source);
  assert.equal(after.objects.length,4);
  assert.deepEqual(option.connection,{from:'A',fromAnchor:'e',to:'B',toAnchor:'w'});
});

test('target anchor defaults to the side nearest the start, and line kind works', () => {
  const scene=studio(base),a=find(scene,'A'),c=find(scene,'C');
  const option=connectCandidate(base,scene,{from:a,fromAnchor:'s',to:c,kind:'line'});
  assert.match(option.source,/Link1: line from A\.s to C\.n\n$/);
  studio(option.source);
});

test('dropping on empty canvas adds a matching shape and a facing connector', () => {
  const scene=studio(base),b=find(scene,'B');
  const option=connectCandidate(base,scene,{from:b,fromAnchor:'e',at:{x:4,y:0}});
  assert.match(option.source,/Shape1: circle .*at \(4, 0\)/);
  assert.match(option.source,/Link1: arrow from B\.e to Shape1\.w\n$/);
  assert.equal(option.selectName,'Shape1');
  const after=studio(option.source);
  assert.equal(after.objects.length,5);
  assert.ok(Math.abs(find(after,'Shape1').center.x-4)<1e-6);
});

test('CRLF and Unicode sources keep their line endings and text', () => {
  const crlf=base.replace(/\n/g,'\r\n'),scene=studio(crlf),a=find(scene,'A'),c=find(scene,'C');
  const option=connectCandidate(crlf,scene,{from:c,fromAnchor:'n',to:a,toAnchor:'s'});
  assert.ok(option.source.startsWith(crlf));
  assert.match(option.source,/Link1: arrow from C\.n to A\.s\r\n$/);
  const dropped=connectCandidate(crlf,scene,{from:c,fromAnchor:'s',at:{x:0,y:-4}});
  assert.match(dropped.source,/Link1: arrow from C\.s to Shape1\.n\r\n$/);
  assert.ok(!/[^\r]\n/.test(dropped.source));
});

test('link names avoid existing identifiers', () => {
  const src=base+'Link1: arrow from A.e to B.w\n',scene=studio(src);
  const option=connectCandidate(src,scene,{from:find(scene,'A'),fromAnchor:'s',to:find(scene,'C')});
  assert.match(option.source,/Link2: arrow from A\.s to C\.n\n$/);
});

test('unsafe requests fail closed', () => {
  const scene=studio(base),a=find(scene,'A');
  assert.throws(()=>connectCandidate(base,scene,{from:a,fromAnchor:'e',to:a}),/different shape/);
  assert.throws(()=>connectCandidate(base,scene,{from:a,fromAnchor:'ne',to:find(scene,'B')}),/side/);
  assert.throws(()=>connectCandidate(base,scene,{from:a,fromAnchor:'e'}),/Drop on a shape/);
  assert.throws(()=>connectCandidate(base,scene,{from:a,fromAnchor:'e',to:find(scene,'B'),kind:'spline'}),/arrow or line/);
  const nested='G: [ Inner: box "x" ]\nA: box "A" at (3,0)\n',ns=studio(nested);
  const inner=ns.objects.find(o=>o.name==='Inner');
  assert.throws(()=>connectCandidate(nested,ns,{from:inner,fromAnchor:'e',at:{x:5,y:5}}));
  assert.throws(()=>connectCandidate(nested,ns,{from:find(ns,'A'),fromAnchor:'w',to:inner}));
});

test('target side: near an edge wins, deep inside faces the start', () => {
  const scene=studio(base),b=find(scene,'B'),a=find(scene,'A');
  const from=a.anchors.s;
  assert.equal(targetAnchor(b,{x:b.center.x,y:b.center.y},from),'w');
  assert.equal(targetAnchor(b,{x:b.center.x,y:b.bbox.y+0.02},from),'s');
  assert.equal(targetAnchor(b,{x:b.bbox.x+b.bbox.width-0.02,y:b.center.y},from),'e');
  const c=find(scene,'C');
  assert.equal(targetAnchor(c,c.center,a.anchors.e),'n');
  assert.equal(targetAnchor(null,{x:0,y:0},from),'c');
});

test('elbowRoute bends once between perpendicular sides and matches the source words', async () => {
  const {elbowRoute} = await import('../public/connect-drag.js');
  const r = elbowRoute({x:4,y:-1},'n',{x:2.5,y:0},'e','API');
  assert.deepEqual(r.points, [{x:4,y:-1},{x:4,y:0},{x:2.5,y:0}]);
  assert.equal(r.words, 'up until even with API.e then to API.e');
});

test('elbowRoute bends twice between offset facing sides and stays straight when aligned or backwards', async () => {
  const {elbowRoute} = await import('../public/connect-drag.js');
  const two = elbowRoute({x:4,y:-1.5},'n',{x:2,y:-0.25},'s','API');
  assert.equal(two.points.length, 4);
  assert.equal(two.words, 'up 0.65 then left until even with API.s then to API.s');
  assert.equal(elbowRoute({x:0,y:0},'e',{x:2,y:0},'w','B').words, null);
  assert.equal(elbowRoute({x:4,y:0.25},'n',{x:2,y:-0.25},'s','API').words, null);
  assert.equal(elbowRoute({x:0,y:0},'n',{x:2,y:-1},'e','B').words, null);
});

test('connectCandidate writes the elbow route that the guide shows', () => {
  const source='API: box "API" at (2,0)\nDatabase: cylinder "Database" at (4,-1)\n';
  const scene=studio(source);
  const api=scene.objects.find(o=>o.name==='API'),db=scene.objects.find(o=>o.name==='Database');
  const option=connectCandidate(source,scene,{from:db,fromAnchor:'n',to:api,toAnchor:'e'});
  assert.match(option.source, /arrow from Database\.n up until even with API\.e then to API\.e/);
  assert.equal(studio(option.source).objects.length, 3);
});
