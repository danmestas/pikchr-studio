import test from 'node:test';
import assert from 'node:assert/strict';
import {correspondingObject} from '../public/candidate-target.js';
import {endpointCandidates,applyPatch} from '../public/edits.js';
import {compileStudio} from './pikchr-wasm.mjs';

const DEFAULT='Client: box "café 😀" at (0,0)\nAPI: box "API" at (2,0)\n'
  +'Database: cylinder "Database" at (4,0)\narrow from Client.e to API.w\n'
  +'arrow from API.e to Database.w\n';
function scene(source) {
  const result=compileStudio(source);
  assert.equal(result.status,0,result.scene.error);
  return result.scene;
}

test('anonymous arrows retain their own identity among identically-kinded objects',()=>{
  const list=scene(DEFAULT).objects;
  const arrows=list.filter(o=>o.kind==='arrow');
  assert.equal(arrows.length,2);
  for(const object of arrows) assert.equal(correspondingObject(list,object),object);
});

test('ordinary endpoint replacements identify each anonymous arrow',()=>{
  const before=scene(DEFAULT),target=before.objects.find(o=>o.name==='API');
  for(const object of before.objects.filter(o=>o.kind==='arrow')) {
    const option=endpointCandidates(DEFAULT,object,before,'to',target,'n')[0];
    assert.ok(option);
    const after=scene(applyPatch(DEFAULT,option.patch));
    const found=correspondingObject(after.objects,object,option);
    assert.ok(found);
    assert.equal(found.id,object.id);
  }
});

test('later-target moves identify either anonymous arrow across both endpoint edits',()=>{
  const source=DEFAULT+'Late: box "new" at (2,-2)\n';
  const before=scene(source),target=before.objects.find(o=>o.name==='Late');
  for(const object of before.objects.filter(o=>o.kind==='arrow')) for(const endpoint of ['from','to']) {
    const option=endpointCandidates(source,object,before,endpoint,target,'n')[0];
    assert.ok(option);
    const after=scene(applyPatch(source,option.patch));
    const found=correspondingObject(after.objects,object,option);
    assert.equal(found?.id,option.selectId);
    assert.equal(found?.kind,'arrow');
    assert.ok(found.span.start>after.objects.find(o=>o.name==='Late').span.start);
    const from=new TextDecoder().decode(new TextEncoder().encode(option.source).slice(found.span.start,found.span.end));
    assert.ok(from.includes(`${endpoint} Late.n`),from);
  }
});

test('an explicit selection id cannot silently fall back to a different object',()=>{
  const list=scene(DEFAULT).objects,object=list.find(o=>o.kind==='arrow');
  assert.equal(correspondingObject(list,object,{selectId:'o1'}),null);
  assert.equal(correspondingObject(list,object,{selectId:'missing'}),null);
});

test('named candidates preserve kind unless a conversion explicitly declares the new kind',()=>{
  const object=scene(DEFAULT).objects.find(o=>o.name==='Client');
  const converted=scene('Client: cylinder "Client" at (0,0)\n').objects;
  assert.equal(correspondingObject(converted,object),null);
  assert.equal(correspondingObject(converted,object,{targetKind:'cylinder'})?.name,'Client');
  const renamed=scene('Kay: box "Client" at (0,0)\n').objects;
  assert.equal(correspondingObject(renamed,object),null);
  assert.equal(correspondingObject(renamed,object,{selectName:'Kay'})?.name,'Kay');
});

test('UTF-8 patches before and inside an anonymous statement rebase its span',()=>{
  const object={id:'o1',kind:'arrow',span:{start:20,end:50}};
  const before={start:2,end:4,text:'😀'};
  const shifted={id:'o2',kind:'arrow',span:{start:22,end:52}};
  assert.equal(correspondingObject([shifted],object,{patch:before}),shifted);
  const inside={start:25,end:27,text:'😀'};
  const expanded={id:'o1',kind:'arrow',span:{start:20,end:52}};
  assert.equal(correspondingObject([expanded],object,{patch:inside}),expanded);
});

test('an ambiguous anonymous replacement is refused without correspondence metadata',()=>{
  const object={id:'o1',kind:'arrow',span:{start:2,end:8}};
  const list=[{id:'o1',kind:'arrow',span:{start:2,end:4}},{id:'o2',kind:'arrow',span:{start:5,end:7}}];
  assert.equal(correspondingObject(list,object,{patch:{start:0,end:10,text:'0123456789'}}),null);
});

test('creation can select a new named connector while a shape is selected',()=>{
  const before=scene(DEFAULT).objects.find(o=>o.name==='Client');
  const list=scene(DEFAULT+'Link1: arrow from Client.e to API.w\n').objects;
  assert.equal(correspondingObject(list,before,{selectName:'Link1'})?.name,'Link1');
  assert.equal(correspondingObject(list,before,{selectName:'Link1',targetKind:'box'}),null);
});

test('creation can select a uniquely named object or its explicit id',()=>{
  const list=scene(DEFAULT).objects;
  assert.equal(correspondingObject(list,null,{selectName:'Client'}),list[0]);
  assert.equal(correspondingObject(list,null,{selectId:'o2'}),list[1]);
  assert.equal(correspondingObject(list,null,{selectId:'missing'}),null);
});
