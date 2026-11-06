// Applies the saved theme before first paint. "light" or "dark" pins it;
// nothing saved follows the system. The menu's Theme control calls
// pikchrTheme.set(); every page that loads this script honours the choice.
(()=>{
  const KEY='pikchr-studio.theme',root=document.documentElement;
  const get=()=>{try{const t=localStorage.getItem(KEY);return t==='light'||t==='dark'?t:'system';}catch{return 'system';}};
  function apply(theme){
    if(theme==='light'||theme==='dark'){root.dataset.theme=theme;root.style.colorScheme=theme;}
    else{delete root.dataset.theme;root.style.colorScheme='';}
    // The browser bar colour follows a pinned theme too.
    for(const meta of document.querySelectorAll('meta[name="theme-color"]')){
      if(meta.dataset.media===undefined)meta.dataset.media=meta.getAttribute('media')||'';
      if(theme==='system')meta.setAttribute('media',meta.dataset.media);
      else meta.setAttribute('media',meta.dataset.media.includes(theme)?'all':'not all');
    }
  }
  function set(theme){
    try{if(theme==='light'||theme==='dark')localStorage.setItem(KEY,theme);else localStorage.removeItem(KEY);}catch{}
    apply(theme);
  }
  // Another tab changing the theme changes this one as well.
  addEventListener('storage',e=>{if(e.key===KEY)apply(get());});
  window.pikchrTheme={get,set};
  apply(get());
})();
