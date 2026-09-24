import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, endpointCandidates, routeCandidates, moveVertexCandidates, bendCandidates, applyPatch, byteOffsetToIndex } from '../public/edits.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const bytes = text => new TextEncoder().encode(text).length;
function fixture(statement = 'Database: cylinder "DB" fill blue at (1, -1)') {
  const prefix = '# café 😀\r\nAPI: box "API" at (0,0)\r\n';
  const source = prefix + statement + '\r\narrow from API.s to Database.n\r\n';
  const object = { id: '2', name: 'Database', kind: 'cylinder', editable: true, span: { start: bytes(prefix), end: bytes(prefix + statement) }, center: { x: 1, y: -1 } };
  const scene = { objects: [{ id: '1', name: 'API', span: {start: bytes('# café 😀\r\n')}, center: { x:0, y:0 } }, object] };
  return {source,object,scene,prefix};
}
test('UTF-8 offsets preserve CRLF, Unicode, style, labels, and unrelated source', () => {
  const {source,object,scene,prefix} = fixture();
  const [candidate] = candidates(source,object,scene,{x:2,y:-1.5});
  assert.equal(candidate.source,prefix+'Database: cylinder "DB" fill blue at (2, -1.5)\r\narrow from API.s to Database.n\r\n');
  assert.equal(applyPatch(source,candidate.patch),candidate.source);
});
test('patch rejects stale source even if target statement is unchanged', () => {
  const {source,object,scene} = fixture();
  const [candidate] = candidates(source,object,scene,{x:2,y:1});
  assert.throws(() => applyPatch(source+'# new',candidate.patch),/Source changed/);
});
test('byte offsets cannot split unicode or escape source', () => {
  assert.equal(byteOffsetToIndex('😀a',4),2);
  assert.throws(() => byteOffsetToIndex('😀a',1));
  assert.throws(() => byteOffsetToIndex('a',2));
});
test('implicit placement becomes explicit without disturbing label or CRLF', () => {
  const {source,object,scene} = fixture('Database: cylinder "at (3,4) café" fit');
  const [candidate] = candidates(source,object,scene,{x:0,y:0});
  assert.match(candidate.source,/cylinder "at \(3,4\) café" fit at \(0, 0\)/);
});
test('relative candidates use earlier names and y-up coordinates', () => {
  const {source,object,scene} = fixture();
  scene.objects.push({id:'3',name:'Later',span:{start:10000},center:{x:0,y:0}});
  const result = candidates(source,object,scene,{x:0.1,y:-2});
  assert.ok(result.some(item => item.source.includes('with .c at API.c + (0.1, -2)')));
  assert.ok(result.some(item => item.label.startsWith('Align centers vertically')));
  assert.ok(result.every(item => !item.source.includes('Later')));
});
test('unsupported placement, variables, nesting, and nonfinite targets are read-only', () => {
  for (const statement of ['Database: cylinder "DB" at (x, y)', 'Database: cylinder "DB" with .n at API.s + (x, y)', 'Database: cylinder "DB" width size', 'Database: cylinder "DB" width size at (0,0)', '[Database: cylinder "DB"]']) {
    const {source,object,scene}=fixture(statement);
    assert.deepEqual(candidates(source,object,scene,{x:1,y:1}),[]);
  }
  const {source,object,scene}=fixture();
  assert.deepEqual(candidates(source,object,scene,{x:NaN,y:0}),[]);
});
test('generated relative placement stays relative to its reference and offers an absolute alternative', () => {
  const {source,object,scene} = fixture('Database: cylinder "DB" with .c at API.c + (0, -2)');
  const result = candidates(source,object,scene,{x:1,y:-2});
  assert.match(result[0].source,/Database: cylinder "DB" with \.c at API\.c \+ \(1, -2\)/);
  assert.ok(result.some(item => /Database: cylinder "DB" at \(1, -2\)/.test(item.source)));
  assert.ok(result.every(item => !item.relational || item.references.includes('API')));
});
test('edge attachments and gaps are recognised, rewritten, and never rank an absolute rewrite first', () => {
  const {source,object,scene} = fixture('Database: cylinder "DB" with .n at 1cm below API.s');
  const result = candidates(source,object,scene,{x:1,y:-2});
  assert.ok(result.length);
  assert.ok(result[0].references.includes('API'));
  assert.match(result[0].source,/Database: cylinder "DB" with /);
});
test('drop points snap to the grid and to neighbour centers, and stay bounded', () => {
  const {source,object,scene} = fixture();
  assert.match(candidates(source,object,scene,{x:2.024,y:-1.513})[0].source,/at \(2, -1.5\)/);
  assert.match(candidates(source,object,scene,{x:0.03,y:-1.5})[0].source,/at \(0, -1.5\)/);
  assert.match(candidates(source,object,scene,{x:1e21,y:-1e21})[0].source,/at \(1000, -1000\)/);
});
test('relational candidates come from scene anchors: touching and gapped attachments', () => {
  const api = {id:'1',name:'API',kind:'box',span:{start:0,end:20},center:{x:0,y:0},bbox:{x:-0.375,y:-0.25,width:0.75,height:0.5},
    anchors:{c:{x:0,y:0},n:{x:0,y:0.25},s:{x:0,y:-0.25},e:{x:0.375,y:0},w:{x:-0.375,y:0},ne:{x:0.375,y:0.25},nw:{x:-0.375,y:0.25},se:{x:0.375,y:-0.25},sw:{x:-0.375,y:-0.25}}};
  const statement='Database: cylinder "DB" at (1, -1)';
  const source='API: box "API" at (0,0)\n'+statement+'\n';
  const db = {id:'2',name:'Database',kind:'cylinder',editable:true,span:{start:24,end:24+statement.length},center:{x:1,y:-1},bbox:{x:0.625,y:-1.375,width:0.75,height:0.75},
    anchors:{c:{x:1,y:-1},n:{x:1,y:-0.625},s:{x:1,y:-1.375},e:{x:1.375,y:-1},w:{x:0.625,y:-1},ne:{x:1.375,y:-0.625},nw:{x:0.625,y:-0.625},se:{x:1.375,y:-1.375},sw:{x:0.625,y:-1.375}}};
  const scene={objects:[api,db]};
  const touching = candidates(source,db,scene,{x:0.02,y:-0.63});
  assert.equal(touching[0].patch.text,'Database: cylinder "DB" with .n at API.s');
  assert.equal(touching[0].literals,0);
  const gapped = candidates(source,db,scene,{x:0.05,y:-1.13});
  assert.equal(gapped[0].patch.text,'Database: cylinder "DB" with .n at 0.5 below API.s');
  assert.deepEqual(gapped[0].target,{x:0,y:-1.125});
  const far = candidates(source,db,scene,{x:3,y:2});
  assert.equal(far[0].patch.text,'Database: cylinder "DB" at (3, 2)');
});

function connectorFixture(statement = 'arrow "café 😀 from X to Y" from API.s to Database.n color blue') {
  const prefix = '# café 😀\r\nAPI: box "API"\r\nDatabase: cylinder "DB" at (1,-1)\r\n';
  const source = prefix + statement + '\r\n# keep this comment\r\n';
  const api = {id:'a',name:'API',kind:'box',span:{start:bytes('# café 😀\r\n'),end:bytes('# café 😀\r\nAPI: box "API"')},anchors:{e:{x:1,y:0}}};
  const database = {id:'b',name:'Database',kind:'cylinder',span:{start:bytes('# café 😀\r\nAPI: box "API"\r\n'),end:bytes(prefix.trimEnd())},anchors:{w:{x:0,y:-1}}};
  const object = {id:'c',name:statement.startsWith('Link:')?'Link':'',kind:statement.includes('line ')?'line':'arrow',editable:false,span:{start:bytes(prefix),end:bytes(prefix+statement)},path:[{x:0,y:0},{x:1,y:-1}]};
  return {source,object,scene:{objects:[api,database,object]},api,database};
}
test('endpoint edits preserve Unicode labels, styling, CRLF, and comments outside the statement', () => {
  const {source,object,scene,api}=connectorFixture();
  const [candidate]=endpointCandidates(source,object,scene,'from',api,'e');
  assert.equal(candidate.source,source.replace('from API.s','from API.e'));
  assert.equal(candidate.patch.expected,'API.s');
  assert.deepEqual(candidate.target,{x:1,y:0});
  assert.equal(applyPatch(source,candidate.patch),candidate.source);
  assert.throws(()=>applyPatch(source+' ',candidate.patch),/Source changed/);
});
test('named lines, unnamed arrows, and bare center references support either endpoint', () => {
  for(const statement of ['Link: line from API to Database dashed','arrow from API to Database']) {
    const {source,object,scene,api,database}=connectorFixture(statement);
    assert.equal(endpointCandidates(source,object,scene,'from',database,'sw')[0].source,source.replace('from API','from Database.sw'));
    assert.equal(endpointCandidates(source,object,scene,'to',api,'c')[0].source,source.replace('to Database','to API.c'));
  }
});
test('complex connector source does not receive guessed endpoint edits', () => {
  for(const statement of [
    'arrow from API.s then right 1 to Database.n',
    'arrow from API.s to Database.n to API.e',
    'arrow from API.s + (1,0) to Database.n',
    'arrow from API.s to Database.n # from API',
    'arrow from API.s to Database.n; box',
    'arrow to Database.n',
    'arrow from API.s to Database.n.foo',
  ]) {
    const {source,object,scene,api}=connectorFixture(statement);
    assert.deepEqual(endpointCandidates(source,object,scene,'from',api,'e'),[],statement);
  }
});
test('endpoint edits reject nested, macro, missing, future, and ambiguous targets', () => {
  for(const mutation of [
    f=>{f.object.reason='Nested object';},
    f=>{f.object.reason='Macro-expanded object';},
    f=>{f.api.reason='Nested object';},
    f=>{f.object.span.start=-1;},
    f=>{f.api.span.end=f.object.span.end+1;},
    f=>{f.scene.objects.push({...f.api,id:'duplicate'});},
    f=>{f.scene.objects=f.scene.objects.filter(o=>o.id!==f.api.id);},
    f=>{f.object.path.push({x:1,y:0});},
  ]) {
    const f=connectorFixture();mutation(f);
    assert.deepEqual(endpointCandidates(f.source,f.object,f.scene,'from',f.api,'e'),[]);
  }
});

test('route edits preserve surrounding source and compile with Pikchr', () => {
  const f = connectorFixture();
  for (const mode of ['straight','horizontal','vertical','via','via-x','via-y']) {
    const [candidate] = routeCandidates(f.source,f.object,f.scene,mode,{x:1.25,y:-0.75});
    assert.ok(candidate, mode);
    assert.ok(candidate.source.includes('"café 😀 from X to Y"'));
    assert.ok(candidate.source.endsWith('color blue\r\n# keep this comment\r\n'));
    const compiled = spawnSync(fileURLToPath(new URL('../vendor/pikchr',import.meta.url)),['--svg-only','-'],{input:candidate.source,encoding:'utf8'});
    assert.equal(compiled.status,0,`${mode}: ${compiled.stdout} ${compiled.stderr}`);
    assert.match(compiled.stdout,/<svg/);
    assert.equal(applyPatch(f.source,candidate.patch),candidate.source);
    assert.throws(()=>applyPatch(f.source+' ',candidate.patch),/Source changed/);
  }
});

test('generated routes can change mode, move again, and reconnect without losing relationships', () => {
  const f = connectorFixture('Link: line from API.e to Database.w dashed');
  for (const mode of ['horizontal','vertical','via','via-x','via-y']) {
    const [candidate] = routeCandidates(f.source,f.object,f.scene,mode,{x:2,y:-3});
    const statement = candidate.source.slice(candidate.source.indexOf('Link:'),candidate.source.indexOf('\r\n# keep'));
    const edited = connectorFixture(statement);
    edited.object.path.push({x:2,y:0});
    assert.equal(routeCandidates(edited.source,edited.object,edited.scene,'straight')[0].source,f.source);
    assert.equal(routeCandidates(edited.source,edited.object,edited.scene,'via-x',{x:4,y:-2}).length,1);
    const reconnected = endpointCandidates(edited.source,edited.object,edited.scene,'from',edited.api,'n')[0];
    assert.ok(reconnected,mode);
    assert.ok(!reconnected.source.includes('API.e'));
    assert.ok(reconnected.source.includes('Database.w'));
    const compiled = spawnSync(fileURLToPath(new URL('../vendor/pikchr',import.meta.url)),['--svg-only','-'],{input:reconnected.source,encoding:'utf8'});
    assert.equal(compiled.status,0,`${mode}: ${compiled.stdout}`);
  }
});

test('routing rejects unknown expressions, nested objects, ambiguous names, and invalid drag coordinates', () => {
  for (const statement of [
    'arrow from API.e to (1,2) then right 1 then to Database.w',
    'arrow from API.e to (Database.w,API.e)+(1,0) then to Database.w',
    'arrow from API.e to ((1,2),API.e) then to ((3,2),Database.w) then to Database.w',
    'arrow from API.e to (API.e,Database.w) then to API.e',
    'arrow from API.e "route label" to Database.w',
    'arrow from Missing.e to Database.w',
  ]) {
    const f = connectorFixture(statement);
    assert.deepEqual(routeCandidates(f.source,f.object,f.scene,'horizontal'),[],statement);
  }
  const f = connectorFixture();
  for (const target of [null,{x:NaN,y:0},{x:0,y:Infinity}]) assert.deepEqual(routeCandidates(f.source,f.object,f.scene,'via-x',target),[]);
  f.object.depth=1;
  assert.deepEqual(routeCandidates(f.source,f.object,f.scene,'horizontal'),[]);
});

test('literal vertex edits change only the selected tuple and compile', () => {
  for (const statement of [
    'arrow "café 😀" from API.e to (1, 2) then to Database.w color blue',
    'Link: line dashed from API.e to (1, 2) then to (-.5,+3.0) then to Database.w "café 😀"',
  ]) {
    const f = connectorFixture(statement);
    const tuples = statement.match(/\([^)]*\)/g);
    f.object.path = Array.from({length:tuples.length+2},()=>({x:0,y:0}));
    for (let index=1;index<=tuples.length;index++) {
      const [candidate] = moveVertexCandidates(f.source,f.object,f.scene,index,{x:4.123456,y:-2});
      assert.ok(candidate,statement);
      assert.equal(candidate.source,f.source.replace(tuples[index-1],'(4.1235, -2)'));
      assert.equal(candidate.patch.expected,tuples[index-1]);
      assert.equal(applyPatch(f.source,candidate.patch),candidate.source);
      assert.throws(()=>applyPatch(f.source+' ',candidate.patch),/Source changed/);
      const compiled = spawnSync(fileURLToPath(new URL('../vendor/pikchr',import.meta.url)),['--svg-only','-'],{input:candidate.source,encoding:'utf8'});
      assert.equal(compiled.status,0,compiled.stdout);
      assert.match(compiled.stdout,/<svg/);
    }
  }
});

test('vertex edits reject expressions, endpoint indices, and uncertain path mappings', () => {
  for (const statement of [
    'arrow from API.e to (Database.w,API.e) then to Database.w',
    'arrow from API.e to ((1,2),API.e) then to ((1,2),Database.w) then to Database.w',
    'arrow from API.e to (x,2) then to Database.w',
    'arrow from API.e to (1cm,2cm) then to Database.w',
    'arrow from API.e to (1,2) then right 1 then to Database.w',
    'arrow from API.e to (1,2) "inner label" then to Database.w',
    'arrow from Missing.e to (1,2) then to Database.w',
  ]) {
    const f=connectorFixture(statement);f.object.path.push({x:0,y:0});
    assert.deepEqual(moveVertexCandidates(f.source,f.object,f.scene,1,{x:2,y:2}),[],statement);
  }
  const f=connectorFixture('arrow from API.e to (1,2) then to Database.w');
  f.object.path.push({x:0,y:0});
  for (const index of [-1,0,2,1.5,NaN]) assert.deepEqual(moveVertexCandidates(f.source,f.object,f.scene,index,{x:2,y:2}),[]);
  assert.deepEqual(moveVertexCandidates(f.source,f.object,f.scene,1,{x:Infinity,y:2}),[]);
  f.object.path.push({x:0,y:0});
  assert.deepEqual(moveVertexCandidates(f.source,f.object,f.scene,1,{x:2,y:2}),[]);
  f.object.path.pop();f.object.depth=1;
  assert.deepEqual(moveVertexCandidates(f.source,f.object,f.scene,1,{x:2,y:2}),[]);
});

test('all native shape placements remain source-preserving and compile', () => {
  for (const kind of ['box','cylinder','circle','ellipse','oval','diamond']) {
    const f=fixture(`Database: ${kind} "DB" fill blue at (1, -1)`);
    f.object.kind=kind;
    const [candidate]=candidates(f.source,f.object,f.scene,{x:2,y:-2});
    assert.ok(candidate,kind);
    assert.equal(candidate.source,f.source.replace('at (1, -1)','at (2, -2)'));
    const compiled = spawnSync(fileURLToPath(new URL('../vendor/pikchr',import.meta.url)),['--svg-only','-'],{input:candidate.source,encoding:'utf8'});
    assert.equal(compiled.status,0,`${kind}: ${compiled.stdout}`);
  }
});

test('insert, move, delete and reset bends preserve labels, styles and endpoint references', () => {
  let f=connectorFixture('Link: arrow "café 😀" from API.e to Database.w color blue');
  const inserted=bendCandidates(f.source,f.object,f.scene,'insert',0,{x:1,y:2})[0];
  assert.ok(inserted);
  assert.equal(applyPatch(f.source,inserted.patch),inserted.source);
  assert.throws(()=>applyPatch(f.source+' ',inserted.patch),/Source changed/);
  const next=candidate=>{
    const statement=candidate.source.slice(candidate.source.indexOf('Link:'),candidate.source.indexOf('\r\n# keep'));
    const fixture=connectorFixture(statement);
    fixture.object.path=Array.from({length:(statement.match(/\bto\b/g)||[]).length+1},()=>({x:0,y:0}));
    const compiled=spawnSync(fileURLToPath(new URL('../vendor/pikchr',import.meta.url)),['--svg-only','-'],{input:candidate.source,encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stdout);
    return fixture;
  };
  f=next(inserted);
  f=next(bendCandidates(f.source,f.object,f.scene,'insert',1,{x:3,y:4})[0]);
  assert.match(f.source,/to \(1, 2\) then to \(3, 4\) then to Database.w/);
  f=next(moveVertexCandidates(f.source,f.object,f.scene,1,{x:2,y:2})[0]);
  f=next(endpointCandidates(f.source,f.object,f.scene,'to',f.database,'n')[0]);
  assert.match(f.source,/to \(2, 2\) then to \(3, 4\) then to Database.n/);
  f=next(bendCandidates(f.source,f.object,f.scene,'delete',1)[0]);
  assert.match(f.source,/from API.e to \(3, 4\) then to Database.n/);
  f=next(routeCandidates(f.source,f.object,f.scene,'straight')[0]);
  assert.match(f.source,/Link: arrow "café 😀" from API.e to Database.n color blue/);
  assert.ok(f.source.endsWith('\r\n# keep this comment\r\n'));
});

test('inserting into a reference-based elbow preserves expressions and makes the new literal movable',()=>{
  const f=connectorFixture('Link: arrow from API.e to (Database.w, API.e) then to Database.w');
  f.object.path=[{x:0,y:0},{x:1,y:0},{x:1,y:-1}];
  const inserted=bendCandidates(f.source,f.object,f.scene,'insert',1,{x:2,y:-.5})[0];
  assert.match(inserted.source,/to \(Database.w, API.e\) then to \(2, -0.5\) then to Database.w/);
  const statement=inserted.source.slice(inserted.source.indexOf('Link:'),inserted.source.indexOf('\r\n# keep'));
  const next=connectorFixture(statement);next.object.path=[...f.object.path,{x:2,y:-.5}];
  const moved=moveVertexCandidates(next.source,next.object,next.scene,2,{x:3,y:-1})[0];
  assert.ok(moved);assert.match(moved.source,/\(Database.w, API.e\) then to \(3, -1\)/);
  assert.deepEqual(moveVertexCandidates(next.source,next.object,next.scene,1,{x:3,y:-1}),[]);
  assert.equal(bendCandidates(next.source,next.object,next.scene,'delete',2)[0].source,f.source);
  const compiled=spawnSync(fileURLToPath(new URL('../vendor/pikchr',import.meta.url)),['--svg-only','-'],{input:moved.source,encoding:'utf8'});
  assert.equal(compiled.status,0,compiled.stdout);
});

test('bend edits reject invalid indices, ambiguous path mappings and unsupported source',()=>{
  const f=connectorFixture();
  for(const index of [-1,1,NaN,.5])assert.deepEqual(bendCandidates(f.source,f.object,f.scene,'insert',index,{x:1,y:2}),[]);
  assert.deepEqual(bendCandidates(f.source,f.object,f.scene,'insert',0,{x:NaN,y:2}),[]);
  assert.deepEqual(bendCandidates(f.source,f.object,f.scene,'delete',1),[]);
  for(const statement of ['arrow from API.e to (x,2) then to Database.w','arrow from API.e then right 1 then to Database.w']){
    const unsupported=connectorFixture(statement);unsupported.object.path.push({x:1,y:2});
    assert.deepEqual(bendCandidates(unsupported.source,unsupported.object,unsupported.scene,'insert',1,{x:1,y:2}),[]);
  }
  f.object.depth=1;
  assert.deepEqual(bendCandidates(f.source,f.object,f.scene,'insert',0,{x:1,y:2}),[]);
});
