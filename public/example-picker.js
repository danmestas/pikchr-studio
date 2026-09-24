export function examplePicker({dialog,items,render,open}){
  const list=dialog.querySelector('[data-list]'),preview=dialog.querySelector('[data-preview]'),description=dialog.querySelector('[data-description]'),message=dialog.querySelector('[data-message]'),use=dialog.querySelector('[data-use]'),guide=dialog.querySelector('[data-guide]');
  let selected=null,ready=null,generation=0,busy=false;
  async function choose(item){
    const token=++generation;selected=item;ready=null;use.disabled=true;preview.textContent='Rendering preview…';message.textContent='';description.textContent=item.description;
    for(const b of list.children)b.setAttribute('aria-pressed',String(b.dataset.key===item.key));
    guide.hidden=!item.guide;if(item.guide)guide.href=item.guide;
    use.textContent='Open a copy of '+item.title;
    try{const source=await item.load();const result=await render(source);if(token!==generation||!dialog.open)return;if(result.error||!result.svg)throw Error(result.error||'Preview unavailable.');preview.innerHTML=result.svg;preview.setAttribute('aria-label',item.title+' preview');ready={source,result};use.disabled=false;}
    catch(error){if(token!==generation)return;preview.textContent='Preview unavailable.';message.textContent=error.message+' Choose another example or try again.';}
  }
  for(const item of items){const b=document.createElement('button');b.type='button';b.textContent=item.title;b.dataset.key=item.key;b.onclick=()=>{if(!busy)choose(item);};list.append(b);}
  dialog.querySelector('[data-close]').onclick=()=>{if(!busy)dialog.close();};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dialog.addEventListener('close',()=>{++generation;});
  use.onclick=async()=>{if(!ready||busy)return;busy=true;use.disabled=true;message.textContent='Opening a separate document…';
    try{const success=await open(ready.source,ready.result,selected.title);if(success)dialog.close();else message.textContent='Your current diagram could not be saved. Nothing was replaced. Close this window and download your source before trying again.';}
    catch(error){message.textContent='Could not open the example. '+error.message;}
    finally{busy=false;use.disabled=!ready;}
  };
  return ()=>{dialog.showModal();choose(selected||items[0]);};
}
