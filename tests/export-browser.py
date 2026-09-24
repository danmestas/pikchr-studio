"""SVG cleanup and bounded PNG rasterization through browser export APIs."""
from pathlib import Path
import struct
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1100}, accept_downloads=True)
    page.goto("http://127.0.0.1:8790/")
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    result = page.evaluate("""async()=>{
      const {cleanSVG}=await import('/diagram-export.js');
      const svg=document.querySelector('#diagram svg'),before=svg.outerHTML;
      const parse=text=>new DOMParser().parseFromString(text,'image/svg+xml').documentElement;
      const cleaned=parse(cleanSVG(svg,{title:'A <safe> title'}));
      const expanded=svg.cloneNode(true);expanded.dataset.exportViewBox='1 2 30 40';expanded.dataset.baseViewBox='0 0 300 400';
      const originalExport=parse(cleanSVG(expanded)).getAttribute('viewBox');
      const cropped=parse(cleanSVG(svg,{bounds:{x:10,y:20,width:30,height:40},padding:5}));
      let invalid=false;try{cleanSVG(svg,{bounds:{x:0,y:0,width:-1,height:1}});}catch{invalid=true;}
      return {unchanged:before===svg.outerHTML,overlay:cleaned.querySelectorAll('.studio-overlay,.arrow-overlay,.canvas-overlay,[stroke="transparent"],[data-pikchr-id]').length,
        title:cleaned.querySelector('title').textContent,viewBox:cleaned.getAttribute('viewBox'),originalViewBox:svg.dataset.exportViewBox||svg.dataset.baseViewBox,
        crop:cropped.getAttribute('viewBox'),originalExport,invalid,text:cleaned.querySelectorAll('text').length,paths:cleaned.querySelectorAll('path').length};
    }""")
    assert result["unchanged"] and result["overlay"] == 0, result
    assert result["title"] == "A <safe> title", result
    assert result["viewBox"] == result["originalViewBox"], result
    assert result["crop"] == "5 15 40 50" and result["invalid"], result
    assert result["originalExport"] == "1 2 30 40", result
    assert result["text"] >= 3 and result["paths"] > 0, result
    with page.expect_download() as transfer:
        dimensions = page.evaluate("""async()=>{
          const {downloadPNG}=await import('/diagram-export.js');
          return downloadPNG(document.querySelector('#diagram svg'),'diagram-test.png',{bounds:{x:0,y:0,width:20000,height:20000},padding:0});
        }""")
    path = Path(transfer.value.path())
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II',data[16:24])
    assert (width,height) == (dimensions["width"],dimensions["height"])
    assert width <= 4096 and height <= 4096 and width * height <= 16000000
    assert width == 4000 and height == 4000
    browser.close()
    print("PASS: nonmutating SVG cleanup, source viewBox, crop bounds, escaped title, invalid bounds, native text/paths, bounded real PNG download")
