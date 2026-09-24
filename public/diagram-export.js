const MAX_SIDE=4096,MAX_PIXELS=16000000;
function viewBounds(svg,bounds,padding){
  let values;
  if(bounds){
    values=[bounds.x,bounds.y,bounds.width,bounds.height].map(Number);
    if(!Number.isFinite(padding)||padding<0)throw Error('Export padding must be a finite nonnegative number.');
  }else values=(svg.dataset.exportViewBox||svg.dataset.baseViewBox||svg.getAttribute('viewBox')||'').trim().split(/[ ,]+/).map(Number);
  if(values.length!==4||!values.every(Number.isFinite)||values[2]<=0||values[3]<=0)
    throw Error('The diagram does not have valid export bounds.');
  const [x,y,width,height]=values;
  return bounds?[x-padding,y-padding,width+2*padding,height+2*padding]:values;
}

export function cleanSVG(svg,{bounds,title='Diagram',padding=8}={}){
  if(!svg||svg.tagName?.toLowerCase()!=='svg')throw Error('Render a diagram before exporting.');
  const box=viewBounds(svg,bounds,padding),clone=svg.cloneNode(true);
  clone.querySelectorAll('.studio-overlay,.arrow-overlay,.canvas-overlay,.canvas-preview,.cl-dots,.cl-rubber,.cl-live,.live-drag,.align-guides,.cl-line-handles,.text-hit,[stroke="transparent"],script,foreignObject').forEach(node=>node.remove());
  for(const node of [clone,...clone.querySelectorAll('*')]){
    for(const attr of [...node.attributes]){
      if(attr.name.startsWith('data-')||attr.name.startsWith('on')||['tabindex','role','aria-label','aria-pressed','pointer-events'].includes(attr.name))node.removeAttribute(attr.name);
    }
    for(const property of ['cursor','pointer-events','touch-action','user-select','-webkit-user-select'])node.style?.removeProperty(property);
    if(node.hasAttribute('style')&&!node.getAttribute('style').trim())node.removeAttribute('style');
  }
  clone.querySelectorAll(':scope > title').forEach(node=>node.remove());
  const label=document.createElementNS('http://www.w3.org/2000/svg','title');label.textContent=String(title);clone.prepend(label);
  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox',box.join(' '));clone.setAttribute('width',String(box[2]));clone.setAttribute('height',String(box[3]));
  clone.setAttribute('role','img');clone.style.removeProperty('max-width');
  return new XMLSerializer().serializeToString(clone);
}

function download(blob,filename){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;link.hidden=true;document.body.append(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
export function downloadSVG(svg,filename='diagram.svg',options={}){
  download(new Blob([cleanSVG(svg,options)],{type:'image/svg+xml;charset=utf-8'}),filename);
}
export async function downloadPNG(svg,filename='diagram.png',options={}){
  const serialized=cleanSVG(svg,options),box=viewBounds(svg,options.bounds,options.padding??8);
  const scale=Math.min(2,MAX_SIDE/box[2],MAX_SIDE/box[3],Math.sqrt(MAX_PIXELS/(box[2]*box[3])));
  const width=Math.max(1,Math.floor(box[2]*scale)),height=Math.max(1,Math.floor(box[3]*scale));
  const url=URL.createObjectURL(new Blob([serialized],{type:'image/svg+xml;charset=utf-8'}));
  try{
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Could not rasterize the diagram. Export SVG instead.'));image.src=url;});
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d');if(!context)throw Error('PNG export is not supported in this browser.');
    context.fillStyle='white';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG export failed. Export SVG instead.');
    download(blob,filename);return {width,height};
  }finally{URL.revokeObjectURL(url);}
}
