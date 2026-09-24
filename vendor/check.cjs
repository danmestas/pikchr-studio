const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const publicDir = path.resolve(__dirname, '../public');
const context = vm.createContext({require, process, console, __dirname:publicDir, __filename:path.join(publicDir,'pikchr.js'), URL, TextDecoder, TextEncoder, setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir,'pikchr.js'),'utf8'), context);
(async () => {
  const m = await context.initPikchrModule({locateFile:p=>path.join(publicDir,p)});
  const studio = m.cwrap('pikchr_studio','number',['string','string','number']);
  const legacy = m.cwrap('pikchr','number',['string','string','number','number','number']);
  const read = p => { const text=m.UTF8ToString(p);m._free(p);return text; };
  const render = (s,cls=null,flags=1) => JSON.parse(read(studio(s,cls,flags)));
  const bytes = (src,span) => span && Buffer.from(src).subarray(span.start,span.end).toString();
  const src = 'API: box "é; API"\nDatabase: cylinder "DB" with .n at 0.75cm below API.s\narrow from API.s to Database.n';
  const scene = render(src);
  assert.equal(scene.error,null);
  assert.equal(scene.objects.length,3);
  assert.equal(scene.objects[1].editable,true);
  assert.equal(Buffer.from(src).subarray(scene.objects[1].span.start,scene.objects[1].span.end).toString(),'Database: cylinder "DB" with .n at 0.75cm below API.s');
  assert.equal(scene.svg.replace(/<g data-pikchr-id="o\d+">|<\/g>/g,''),read(legacy(src,null,1,0,0)));
  assert.equal(scene.transform.d,-144);
  assert.equal(scene.objects[2].path.length,2);
  assert.deepEqual(scene.objects[0].path,[]);
  const horizontalFirst=render('line from (0,0) to (1,0) then to (1,1)').objects[0];
  const verticalFirst=render('line from (0,0) to (0,1) then to (1,1)').objects[0];
  assert.deepEqual(horizontalFirst.bbox,verticalFirst.bbox);
  assert.notDeepEqual(horizontalFirst.path,verticalFirst.path);
  assert.ok(render('A: box at (').error);
  assert.deepEqual(render('').objects,[]);
  const macro = render('define thing { box }\nA: thing');
  assert.equal(macro.error,null);
  assert.equal(macro.objects[0].editable,false);
  const nested = render('Group: [ A: box "inside" ]');
  assert.equal(nested.error,null);
  assert.ok(nested.objects.every(o=>!o.editable));
  assert.equal(render('A: box; B: cylinder').objects[0].span.end,6);
  assert.equal(scene.version,2);
  // Provenance: every by-name or ordinal reference is recorded, not only centers.
  const deps = (src,i) => render(src).objects[i].dependencies;
  assert.deepEqual(deps('A: box\nB: box at (2,0)\narrow from A.e to B.w',2),['o1','o2']);
  assert.deepEqual(deps('A: box\nC: box at A.s',1),['o1']);
  assert.deepEqual(deps('A: box\nB: box at (0,-2)\nline from A.s down until even with B.s',2),['o1','o2']);
  assert.deepEqual(deps('A: box\nB: box at 1 right of last box',1),['o1']);
  assert.deepEqual(deps('A: box\nB: box same as A',1),['o1']);
  assert.deepEqual(deps('A: box\nB: box with .n at 0.5 below A.s',1),['o1']);
  assert.deepEqual(deps('A: box\nB: box at (1,1)',1),[]);
  assert.ok(render(src).objects.every(o=>o.dependenciesComplete===true));
  // Sub-spans and comment exclusion.
  {
    const commented='A: box "x" # note\nB: box "y" with .n at 0.5 below A.s /* c */\nC: box at (1,1)';
    const objs=render(commented).objects;
    assert.equal(bytes(commented,objs[0].spans.statement),'A: box "x"');
    assert.equal(bytes(commented,objs[0].span),'A: box "x"');
    assert.equal(bytes(commented,objs[0].spans.label),'"x"');
    assert.equal(objs[0].spans.placement,null);
    assert.equal(bytes(commented,objs[1].spans.statement),'B: box "y" with .n at 0.5 below A.s');
    assert.equal(bytes(commented,objs[1].spans.placement),'with .n at 0.5 below A.s');
    assert.equal(bytes(commented,objs[2].spans.placement),'at (1,1)');
    assert.equal(objs[2].spans.label,null);
    const trailing='A: box at (1,1) // tail';
    assert.equal(bytes(trailing,render(trailing).objects[0].spans.placement),'at (1,1)');
    const multiline='A: box "l" \\\n  at (2,2) \\\n  fill red';
    assert.equal(bytes(multiline,render(multiline).objects[0].spans.placement),'at (2,2)');
    assert.equal(bytes(multiline,render(multiline).objects[0].spans.label),'"l"');
  }
  // Class and flags pass through exactly as for pikchr().
  assert.equal(render(src,'pikchr',1).svg.replace(/<g data-pikchr-id="o\d+">|<\/g>/g,''),read(legacy(src,'pikchr',1,0,0)));
  assert.equal(render(src,null,3).svg.replace(/<g data-pikchr-id="o\d+">|<\/g>/g,''),read(legacy(src,null,3,0,0)));
  assert.notEqual(render(src,null,3).svg,render(src,null,1).svg);
  assert.ok(/<svg[^>]*class="pikchr"/.test(render(src,'pikchr',1).svg));
  assert.ok(/ERROR/.test(render('A: box at (',null,1).error));
  assert.ok(/<pre>|<br>|&lt;/.test(render('A: box at (',null,0).error), 'HTML error without plaintext flag');
  // Invalid UTF-8 never produces invalid JSON.
  {
    const raw=Buffer.concat([Buffer.from('box "bad'),Buffer.from([0xff,0xfe]),Buffer.from('"')]);
    const ptr=m._malloc(raw.length+1); m.HEAPU8.set(raw,ptr); m.HEAPU8[ptr+raw.length]=0;
    const out=read(m._pikchr_studio(ptr,0,1)); m._free(ptr);
    const parsed=JSON.parse(out);
    assert.equal(parsed.error,null);
    assert.ok(parsed.svg.includes('\ufffd'));
  }
  for(let i=0;i<300;i++) assert.equal(render(src).objects.length,3);
  const corpusDir=process.env.PIKCHR_SRC?path.resolve(process.env.PIKCHR_SRC,'tests'):path.resolve(__dirname,'../../home/tests');
  let cases=0;
  if(fs.existsSync(corpusDir))for(const file of fs.readdirSync(corpusDir).filter(f=>f.endsWith('.pikchr'))){
    const input=fs.readFileSync(path.join(corpusDir,file),'utf8');
    const actual=render(input);
    const expected=read(legacy(input,null,1,0,0));
    assert.equal(actual.error || actual.svg.replace(/<g data-pikchr-id="o\d+">|<\/g>/g,''),expected,file);
    cases++;
  }
  console.log(`Legacy equivalence checked across ${cases} upstream fixtures.`);
  console.log('Studio API checks passed: geometry, UTF-8 spans, sub-spans, comment exclusion, complete dependencies, class/flags passthrough, invalid UTF-8 repair, macro/nested protection, semicolons, errors, empty source, legacy SVG equivalence, repeated allocation/free.');
})().catch(error=>{console.error(error);process.exitCode=1;});
