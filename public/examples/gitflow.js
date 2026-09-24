const $=id=>document.getElementById(id);
const stages=[
{title:'1. Stable baseline',copy:'Main holds tagged production releases. Develop is the integration branch.',top:.65,bottom:-1.0,left:2.15,right:8.85},
{title:'2. Parallel features',copy:'Search merges into develop. Later remains independent and misses v1.1.',top:-.4,bottom:-3.85,left:-.4,right:3.45},
{title:'3. Cut release/1.1',copy:'The release accepts fixes, not new features. Develop can continue toward the next release.',top:-3.1,bottom:-6.2,left:-.4,right:5.8},
{title:'4. Ship v1.1',copy:'Merge the release into main and develop. Tag main as v1.1.',top:-5.95,bottom:-8.0,left:2.15,right:8.85},
{title:'5. Urgent hotfix',copy:'Start from production. Merge the fix into main and develop; tag v1.1.1.',top:-7.15,bottom:-10.95,left:2.15,right:8.85},
{title:'6. Finish Later',copy:'Later finally merges into develop. Released versions do not change.',top:-10.1,bottom:-12.4,left:-.4,right:3.45},
{title:'7. Ship v1.2',copy:'The next release delivers Later to production. Merge back into develop again.',top:-11.7,bottom:-14.7,left:2.15,right:8.85}
];
let scene,originalSVG,index=0,overview=matchMedia('(min-width:701px)').matches;
function show(){
  $('lane-headings').hidden=overview;
  $('explanation').hidden=overview;
  $('pan-hint').textContent=overview?'Scroll sideways to inspect the full diagram at readable size.':'Each step focuses the relevant branches. Use Full overview to see the complete lifecycle.';
  $('guide').hidden=overview;$('guided').setAttribute('aria-pressed',String(!overview));$('overview').setAttribute('aria-pressed',String(overview));
  $('step').value=String(index);$('step-title').textContent=stages[index].title;$('step-copy').textContent=stages[index].copy;$('position').textContent=(index+1)+' of '+stages.length;
  $('previous').disabled=index===0;$('next').disabled=index===stages.length-1;
  if(!scene)return;
  $('diagram').innerHTML=originalSVG;$('diagram').classList.toggle('overview',overview);
  $('diagram').style.width=overview?'':'100%';
  $('lane-headings').style.width='100%';
  const svg=$('diagram').querySelector('svg');svg.setAttribute('role','img');svg.setAttribute('aria-label',overview?'Complete Gitflow branching lifecycle':stages[index].title);
  if(!overview){
    for(const object of scene.objects){
      const marker='Marker'+['One','Two','Three','Four','Five','Six','Seven'][index];
      if(object.name?.startsWith('Event')||(object.name?.startsWith('Marker')&&!object.name.startsWith(marker)))svg.querySelector('[data-pikchr-id="'+object.id+'"]')?.remove();
    }
    const t=scene.transform,stage=stages[index],top=t.d*stage.top+t.f,bottom=t.d*stage.bottom+t.f;
    const left=t.a*stage.left+t.e,width=t.a*(stage.right-stage.left);
    // Show branch lanes only; numbered annotations remain in the full overview.
    svg.setAttribute('viewBox',`${left} ${top} ${width} ${bottom-top}`);
    const visibleWidth=$('viewport').clientWidth;
    const textSize=Math.max(23.04,13*width/visibleWidth);
    svg.querySelectorAll('text').forEach(text=>text.style.fontSize=textSize+'px');
    [...$('lane-headings').children].forEach((label,i)=>{
      const lane=[.65,2.6,4.2,5.8,7.4][i];
      label.hidden=lane<stage.left+.15||lane>stage.right-.15;
      label.style.left='clamp(38px, '+((lane-stage.left)/(stage.right-stage.left)*100)+'%, calc(100% - 38px))';
    });
  }
  $('viewport').scrollTop=0;$('viewport').scrollLeft=0;
  $('status').textContent=overview?'Complete diagram. Use Guided steps for a shorter view.':'Showing event '+(index+1)+' of 7 from the same rendered diagram.';
}
let resizeFrame=0,lastViewportWidth=0;
new ResizeObserver(entries=>{
  const width=entries[0].contentRect.width;
  if(Math.abs(width-lastViewportWidth)<1)return;
  lastViewportWidth=width;cancelAnimationFrame(resizeFrame);
  resizeFrame=requestAnimationFrame(()=>{if(scene&&!overview)show()});
}).observe($('viewport'));
$('guided').onclick=()=>{overview=false;show()};$('overview').onclick=()=>{overview=true;show()};
$('step').onchange=e=>{index=Number(e.target.value);show()};
$('previous').onclick=()=>{index=Math.max(0,index-1);show()};$('next').onclick=()=>{index=Math.min(stages.length-1,index+1);show()};
$('guide').addEventListener('keydown',e=>{if(e.target.tagName==='SELECT')return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();index=Math.max(0,Math.min(stages.length-1,index+(e.key==='ArrowRight'?1:-1)));show()}});
$('download').onclick=()=>{if(!originalSVG)return;const url=URL.createObjectURL(new Blob([originalSVG],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download='gitflow.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
show();
let worker,timer;
function fail(error){clearTimeout(timer);worker?.terminate();$('diagram').textContent='The renderer could not load. Reload this page, or download the source and open it in Studio.';$('status').textContent=String(error)}
try{
 const response=await fetch('gitflow.pikchr');if(!response.ok)throw new Error('Source request failed: '+response.status);
 const source=await response.text();worker=new Worker('../worker.js');timer=setTimeout(()=>fail('Renderer timed out.'),20000);
 worker.onerror=()=>fail('Renderer unavailable.');
 worker.onmessage=({data})=>{if(data.id!==1)return;clearTimeout(timer);if(data.result.error){fail(data.result.error);return}scene=data.result;originalSVG=scene.svg;$('download').disabled=false;worker.terminate();show()};
 worker.postMessage({id:1,source});
}catch(error){fail(error.message)}
