// Style and text edits on statements written the way people (and other tools)
// actually write Pikchr: every literal colour form Pikchr accepts is read and
// rewritten; anything else is reported once, calmly, with its source text,
// and blocks only the control it belongs to.
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileStudio,renderSvg} from './pikchr-wasm.mjs';
import {inspectProperties,attributeClauses,colourValue} from '../public/properties.js';
import {changeAppearance,styleLocks} from '../public/object-actions.js';
import {candidates,movementBlocked} from '../public/edits.js';
import {editingBlocked} from '../public/arrow-ui.js';
import {textStyle,textStyleCandidate} from '../public/text-style.js';

const render=source=>{const r=compileStudio(source);assert.equal(r.scene.error,null,source);return r.scene;};
const NBT='NBT: box "Not Before Time" bold at (0,0)\n';
// The owner's oval: named, italic label, hex fill, placed above another shape.
const oval=attrs=>NBT+`Time: oval "Zeit" italic ${attrs}\n`;
const time=scene=>scene.objects.find(o=>o.name==='Time');
const restyle=(source,values)=>{
  const scene=render(source),edit=changeAppearance(source,time(scene),scene,values);
  render(edit.source);
  return edit.source.split('\n')[1];
};

test('every literal colour form Pikchr accepts is replaced, not refused',()=>{
  const cases=[
    ['fill 0xe8f0d2 at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
    ['fill 0XE8F0D2 at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
    ['fill 0xdfd at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
    ['fill 15266002 at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
    ['fill LightGreen at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
    ['fill LIGHTGREEN at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
    ['fill none at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
    ['fill -1 at (0,1)','Time: oval "Zeit" italic at (0,1) fill red'],
  ];
  for(const [attrs,expected]of cases)assert.equal(restyle(oval(attrs),{fill:'red'}),expected,attrs);
  // A colour word inside a label is text, not an attribute.
  assert.equal(restyle(NBT+'Time: oval "fill color red" fill 0xe8f0d2 at (0,1)\n',{color:'#2d6a4f'}),
    'Time: oval "fill color red" fill 0xe8f0d2 at (0,1) color 0x2d6a4f');
  // Another object's colour read as a property is not this object's clause.
  assert.equal(restyle(oval('fill 0xe8f0d2 width NBT.wid at (0,1)'),{color:'blue'}),
    'Time: oval "Zeit" italic fill 0xe8f0d2 width NBT.wid at (0,1) color blue');
});

test('the inspector reads every literal form as the colour Pikchr draws, last clause winning',()=>{
  const read=attrs=>{const source=oval(attrs),scene=render(source);return inspectProperties(source,time(scene),scene);};
  assert.equal(read('fill 0xe8f0d2 at (0,1)').fill,'#e8f0d2');
  assert.equal(read('fill 0XE8F0D2 at (0,1)').fill,'#e8f0d2');
  // 0xdfd is the number 0x000dfd, not CSS shorthand.
  assert.equal(read('fill 0xdfd at (0,1)').fill,'#000dfd');
  assert.equal(read('fill 15266002 at (0,1)').fill,'#e8f0d2');
  assert.equal(read('fill LightGreen at (0,1)').fill,'lightgreen');
  assert.equal(read('fill -1 at (0,1)').fill,'none');
  const plain=read('fill 0xe8f0d2 at (0,1)');
  assert.deepEqual(plain.locked,{fill:null,color:null,thickness:null});
  // Pikchr draws exactly the colour the inspector reports.
  assert.match(renderSvg(oval('fill 15266002 at (0,1)')),/fill:rgb\(232,240,210\)/);
});

test('colour values parse as Pikchr reads them',()=>{
  assert.equal(colourValue('0x1A7F37'),'#1a7f37');
  assert.equal(colourValue('0xfff'),'#000fff');
  assert.equal(colourValue('255'),'#0000ff');
  assert.equal(colourValue('Bisque'),'bisque');
  assert.equal(colourValue('off'),'off');
  assert.equal(colourValue('-1'),'none');
  for(const bad of ['$c','c','zeitfill','rgb','#abc'])assert.equal(colourValue(bad),null,bad);
});

test('a non-literal colour is locked with its source text, never guessed',()=>{
  const cases=[
    ['fill $zeit at (0,1)','fill $zeit'],
    ['fill zeitfill at (0,1)','fill zeitfill'],
    ['fill 0xe8f0d2+1 at (0,1)','fill 0xe8f0d2+1'],
    ['fill 0xe8f0d2 + 0x10 at (0,1)','fill 0xe8f0d2 + 0x10'],
    ['fill (0xe8f0d2) at (0,1)','fill (0xe8f0d2)'],
    ['fill NBT.fill at (0,1)','fill NBT.fill'],
  ];
  for(const [attrs,written]of cases){
    const prefix=attrs.startsWith('fill $')?'$zeit = 0xe8f0d2\n':attrs.startsWith('fill zeitfill')?'zeitfill = 0xe8f0d2\n':'';
    const source=prefix+oval(attrs),scene=render(source),object=time(scene);
    assert.equal(attributeClauses(source.slice(source.indexOf('Time:')).split('\n')[0],'fill').written,written,attrs);
    const props=inspectProperties(source,object,scene);
    assert.equal(props.fill,undefined,attrs);
    assert.equal(props.locked.fill,written,attrs);
    assert.equal(props.locked.color,null,attrs);
    assert.deepEqual(styleLocks(source,object,scene),{fill:written,color:null,thickness:null},attrs);
    assert.throws(()=>changeAppearance(source,object,scene,{fill:'red'}),
      new RegExp(`^Error: Written as "${written.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}" in source, which Studio can’t rewrite\\. Edit it in Source \\(S\\)\\.$`),attrs);
    // The colour that is a literal still changes.
    assert.match(changeAppearance(source,object,scene,{color:'blue'}).source,/ color blue\n$/,attrs);
  }
  const thick='A: box thickness 1+1 at (0,0)\n',ts=render(thick);
  assert.deepEqual(styleLocks(thick,ts.objects[0],ts),{fill:null,color:null,thickness:'thickness 1+1'});
});

test('expression placements and attributes move; only a shape Studio cannot move says why',()=>{
  // These used to be refused; dragging now keeps or rewrites the placement.
  for(const source of [oval('fill 0xe8f0d2 at NBT.n + (0, 0.6*2)'),oval('fill 0xe8f0d2 at (NBT.x, NBT.y+1) color 0x2d6a4f'),
    '$zeit = 0xe8f0d2\n'+oval('fill $zeit at (0,1)'),oval('fill 0xe8f0d2 width NBT.wid*0.6 at (0,1)')]){
    const scene=render(source),o=time(scene);
    assert.ok(candidates(source,o,scene,o.center).length,source);
    assert.equal(movementBlocked(source,o,scene),'',source);
  }
  const file='F: file "doc" at (0,0)\n',fs=render(file);
  assert.equal(movementBlocked(file,fs.objects[0],fs),'');
  const dot='D: dot at (0,0)\n',ds=render(dot);
  assert.equal(movementBlocked(dot,ds.objects[0],ds),'Studio moves boxes, circles, ellipses, ovals, cylinders, diamonds, files and text, not dots');
  const ok=oval('fill 0xe8f0d2 at (0,1)'),os=render(ok);
  assert.equal(movementBlocked(ok,time(os),os),'');
  // The banner says the real reason and keeps style and text editable.
  const object={kind:'oval',name:'Time',editable:false,reason:'Placement or attributes are outside the supported literal subset.',
    moveReason:'its position is an expression Studio can’t rewrite (`at NBT.n + (0, 0.6*2)`)'};
  assert.equal(editingBlocked(object,null,{styleable:true}),
    'Moving is blocked: its position is an expression Studio can’t rewrite (`at NBT.n + (0, 0.6*2)`). Style and label edits still work.');
  assert.equal(editingBlocked(object,null,{styleable:false}),
    'Editing is blocked: its position is an expression Studio can’t rewrite (`at NBT.n + (0, 0.6*2)`). Edit this oval in Source (S).');
  // Style and label edits really work on that oval.
  const blocked=oval('fill 0xe8f0d2 at NBT.n + (0, 0.6*2)'),bs=render(blocked);
  assert.match(changeAppearance(blocked,time(bs),bs,{fill:'honeydew'}).source,/Time: oval "Zeit" italic at NBT\.n \+ \(0, 0\.6\*2\) fill honeydew/);
  assert.match(textStyleCandidate(blocked,time(bs),bs,{bold:true}).source,/Time: oval "Zeit" bold italic fill/);
});

test('text style reads hex and named colours, toggles monospace, and recolours through the Style rewrite',()=>{
  const source=oval('fill 0xe8f0d2 color 0x2d6a4f at NBT.n + (0, 0.6*2)'),scene=render(source),o=time(scene);
  assert.deepEqual(textStyle(source,o,scene),{size:'normal',bold:false,italic:true,mono:false,align:'center',placement:'center',aligned:false,colour:'#2d6a4f',colourLocked:null});
  // A custom colour does not stop other text changes.
  const big=textStyleCandidate(source,o,scene,{size:'big'});
  assert.equal(big.source.split('\n')[1],'Time: oval "Zeit" big italic fill 0xe8f0d2 color 0x2d6a4f at NBT.n + (0, 0.6*2)');
  render(big.source);
  const mono=textStyleCandidate(source,o,scene,{mono:true});
  assert.equal(mono.source.split('\n')[1],'Time: oval "Zeit" italic mono fill 0xe8f0d2 color 0x2d6a4f at NBT.n + (0, 0.6*2)');
  const ms=render(mono.source);
  assert.equal(textStyle(mono.source,time(ms),ms).mono,true);
  assert.equal(textStyleCandidate(mono.source,time(ms),ms,{mono:false}).source,source);
  // `monospace` is Pikchr's other spelling and reads the same.
  const spelled=oval('fill 0xe8f0d2 at (0,1)').replace('italic','italic monospace'),ss=render(spelled);
  assert.equal(textStyle(spelled,time(ss),ss).mono,true);
  // Colour is Pikchr's color, the same rewrite as Style's Line & text row.
  const red=textStyleCandidate(source,o,scene,{colour:'firebrick'});
  assert.equal(red.source.split('\n')[1],'Time: oval "Zeit" italic fill 0xe8f0d2 at NBT.n + (0, 0.6*2) color firebrick');
  assert.equal(red.source,changeAppearance(source,o,scene,{color:'firebrick'}).source);
  const reset=textStyleCandidate(source,o,scene,{colour:'default'});
  assert.equal(reset.source.split('\n')[1],'Time: oval "Zeit" italic fill 0xe8f0d2 at NBT.n + (0, 0.6*2)');
  // A colour Studio cannot rewrite is reported; the other text styles still apply.
  const locked='$ink = 0x2d6a4f\n'+oval('color $ink at (0,1)'),ls=render(locked);
  assert.equal(textStyle(locked,time(ls),ls).colourLocked,'color $ink');
  assert.throws(()=>textStyleCandidate(locked,time(ls),ls,{colour:'firebrick'}),/Written as "color \$ink" in source/);
  assert.match(textStyleCandidate(locked,time(ls),ls,{bold:true}).source,/"Zeit" bold italic color \$ink/);
});
