import {applyPatch,routeCandidates} from './edits.js?v=20260923c';
import {readProperties} from './properties.js?v=20260923c';

export function reverseConnector(source,scene,object){
  readProperties(source,object,scene);
  if(!['line','arrow'].includes(object.kind))throw new Error('Select a connector to reverse.');
  // Reuse the native-subset route decoder, including its scope, source-span,
  // endpoint-order, and rendered-path checks. Never reconstruct from SVG.
  const accepted=routeCandidates(source,object,scene,'straight')[0];
  if(!accepted)throw new Error('This connector route cannot be safely reversed. Edit it in source.');
  const route=accepted.patch.expected;
  const positions=route.replace(/^from\s+/,'').split(/\s+(?:then\s+)?to\s+/).map(value=>value.trim());
  if(positions.length<2||positions.some(value=>!value))throw new Error('This connector route cannot be safely reversed.');
  positions.reverse();
  const text=`from ${positions[0]} to ${positions.slice(1).join(' then to ')}`;
  const patch={...accepted.patch,text};
  return {label:'Reverse connector',patch,source:applyPatch(source,patch),...(object.name?{selectName:object.name}:{selectId:object.id,targetKind:object.kind})};
}
