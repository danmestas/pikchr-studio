"""SVG cleanup and bounded PNG rasterization through browser export APIs."""
from pathlib import Path
import struct
from playwright.sync_api import sync_playwright, expect
from browser_helpers import wait_rendered, open_export, export_item, set_selection_only, set_source, close_popovers
import os
STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1100}, accept_downloads=True)
    page.goto(STUDIO + "/")
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
    page.close()

    # ---- the Export popover: Copy and Download groups, Selection only ----
    context = browser.new_context(viewport={"width": 1440, "height": 1100}, accept_downloads=True,
                                  permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/")
    wait_rendered(page)
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    panel = page.locator(".cl-export")
    open_export(page)
    expect(panel).to_be_visible()
    groups = [t.strip().lower() for t in panel.locator(".cl-section > .cl-section-title").all_inner_texts()]
    assert groups == ["copy", "download"], groups
    copy_names = [b.get_attribute("aria-label") for b in panel.locator(".cl-section[aria-label=Copy] button").all()]
    assert copy_names == ["Copy Share link", "Copy Pikchr source", "Copy SVG"], copy_names
    download_names = [b.get_attribute("aria-label") for b in panel.locator(".cl-section[aria-label=Download] button").all()]
    assert download_names == ["Download SVG", "Download PNG", "Download Source"], download_names
    # No embed item: embed.js takes its source only from its own textarea, never a URL.
    assert panel.get_by_text("Embed", exact=False).count() == 0
    # Every item has an SVG line icon in the toolbar's style, and no emoji or glyph text.
    icons = page.evaluate("""()=>[...document.querySelectorAll('.cl-export .cl-export-item')].map(b=>{
      const s=b.querySelector('svg');return {n:b.getAttribute('aria-label'),vb:s?.getAttribute('viewBox'),stroke:s?.getAttribute('stroke'),w:s?.getAttribute('stroke-width'),
        marks:s?s.children.length:0,text:b.querySelector('.cl-label').textContent,glyph:/[^\x00-\x7f]/.test(b.textContent)}})""")
    assert len(icons) == 6, icons
    for icon in icons:
        assert icon["vb"] == "0 0 24 24" and icon["stroke"] == "currentColor" and icon["w"] == "1.7" and icon["marks"] > 0 and not icon["glyph"], icon

    # Selection only: disabled with a hint until something is selected, live thereafter.
    only = panel.get_by_label("Selection only")
    hint = page.locator("#selection-only-hint")
    expect(only).to_be_disabled()
    expect(hint).to_be_visible()
    assert hint.inner_text() == "select objects first"
    close_popovers(page)
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    open_export(page)
    expect(only).to_be_enabled()
    expect(hint).to_be_hidden()
    only.check()
    close_popovers(page)
    page.keyboard.press("Escape")
    page.locator("#diagram").click(position={"x": 5, "y": 5})
    page.wait_for_function("window.pikchrStudio.state().selectedIds.length === 0")
    open_export(page)
    expect(only).to_be_disabled()
    expect(only).not_to_be_checked()
    expect(hint).to_be_visible()

    # Copy actions write to the real clipboard and confirm on the toast.
    clip = lambda: page.evaluate("navigator.clipboard.readText()")
    toast = page.locator("#canvas-feedback")
    source = page.evaluate("window.pikchrStudio.state().source")
    export_item(page, "Copy", "Pikchr source").click()
    expect(toast).to_have_text("Pikchr source copied")
    assert clip() == source
    export_item(page, "Copy", "Share link").click()
    expect(toast).to_have_text("Share link copied")
    link = clip()
    assert link.startswith(STUDIO + "/#z="), link
    export_item(page, "Copy", "SVG").click()
    expect(toast).to_have_text("SVG copied")
    whole = clip()
    assert whole.startswith("<svg") and "data-pikchr-id" not in whole and "studio-overlay" not in whole, whole[:200]
    full_view = whole.split('viewBox="')[1].split('"')[0]

    # Selection only crops Copy SVG, Download SVG and Download PNG to the selected objects.
    close_popovers(page)
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    set_selection_only(page, True)
    export_item(page, "Copy", "SVG").click()
    expect(toast).to_have_text("SVG copied")
    cropped = clip()
    crop_view = cropped.split('viewBox="')[1].split('"')[0]
    assert crop_view != full_view and float(crop_view.split()[2]) < float(full_view.split()[2]), (crop_view, full_view)
    with page.expect_download() as transfer:
        export_item(page, "Download", "SVG").click()
    assert transfer.value.suggested_filename == "selection.svg"
    assert Path(transfer.value.path()).read_text().split('viewBox="')[1].split('"')[0] == crop_view
    with page.expect_download() as transfer:
        export_item(page, "Download", "PNG").click()
    assert transfer.value.suggested_filename == "selection.png"
    selected_png = Path(transfer.value.path()).read_bytes()
    set_selection_only(page, False)
    with page.expect_download() as transfer:
        export_item(page, "Download", "SVG").click()
    assert transfer.value.suggested_filename == "diagram.svg"
    assert Path(transfer.value.path()).read_text().split('viewBox="')[1].split('"')[0] == full_view
    with page.expect_download() as transfer:
        export_item(page, "Download", "PNG").click()
    whole_png = Path(transfer.value.path()).read_bytes()
    assert struct.unpack('>II', selected_png[16:24]) != struct.unpack('>II', whole_png[16:24])
    with page.expect_download() as transfer:
        export_item(page, "Download", "Source").click()
    assert transfer.value.suggested_filename == "diagram.pikchr"
    assert Path(transfer.value.path()).read_text() == source

    # A clipboard that refuses: the toast says why and the text is offered for manual copy.
    page.evaluate("void(navigator.clipboard.writeText=()=>Promise.reject(new DOMException('blocked','NotAllowedError')))")
    export_item(page, "Copy", "Pikchr source").click()
    expect(toast).to_contain_text("Could not copy pikchr source")
    expect(toast).to_contain_text("blocked clipboard access")
    manual = page.locator("#copy-fallback textarea")
    expect(manual).to_be_visible()
    assert manual.input_value() == source
    assert page.evaluate("(()=>{const t=document.querySelector('#copy-fallback textarea');return t.value.slice(t.selectionStart,t.selectionEnd)})()") == source
    assert not errors, errors
    browser.close()
    print("PASS: nonmutating SVG cleanup, source viewBox, crop bounds, escaped title, invalid bounds, native text/paths, bounded real PNG download; Export popover groups, icons, copy actions, Selection only, clipboard refusal")
