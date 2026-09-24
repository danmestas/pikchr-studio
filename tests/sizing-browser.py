"""Native/browser sizing: persistent label policy, exact dimensions and real drags."""
import re
from playwright.sync_api import sync_playwright, expect
from browser_helpers import reveal, show_source, set_source, open_label_dialog, set_auto_apply, object_button, close_popovers, open_more, open_document_menu


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    context = browser.new_context(viewport={"width":1440,"height":1000})
    page = context.new_page()
    errors=[]
    page.on("pageerror",lambda error:errors.append(str(error)))

    def setup(p):
        p.goto("http://127.0.0.1:8790/")
        p.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")

    def load(p,text):
        set_source(p, text)
        expect(p.locator("#state")).to_contain_text("Rendered")
        set_auto_apply(p, True)

    def select(p,name):
        object_button(p,name).click()
        close_popovers(p)

    def unchanged_after_undo(text):
        reveal(page,"#canvas-undo").click()
        expect(page.locator("#source")).to_have_value(text)
        page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")

    def native_bounds(name):
        return page.evaluate("""name=>new Promise((resolve,reject)=>{
          const worker=new Worker('worker.js');
          worker.onmessage=({data})=>{worker.terminate();if(data.result.error)reject(Error(data.result.error));else resolve(data.result.objects.find(o=>o.name===name).bbox);};
          worker.onerror=e=>{worker.terminate();reject(Error(e.message));};
          worker.postMessage({id:1,source:document.querySelector('#source').value});
        })""",name)

    setup(page)
    # Storing intent must work even when choosing Fixed changes no source bytes.
    metadata_only='Meta: box "Short" at (0,0)\n'
    load(page,metadata_only)
    select(page,'Meta')
    dialog=page.get_by_role("dialog",name="Edit label",exact=True)
    open_label_dialog(page)
    dialog.get_by_role('combobox',name='Text sizing',exact=True).select_option('fixed')
    expect(dialog.get_by_role('button',name='Done',exact=True)).to_be_enabled()
    dialog.get_by_role('button',name='Done',exact=True).click()
    expect(page.locator('#source')).to_have_value(metadata_only)
    open_more(page)
    expect(page.locator('#state')).to_contain_text('Label behavior saved')
    open_label_dialog(page)
    expect(dialog.get_by_role('combobox',name='Text sizing',exact=True)).to_have_value('fixed')
    dialog.get_by_role('button',name='Cancel',exact=True).click()
    load(page,'A: box "Short" width 1.5 height 0.5 at (0,0)\n')
    select(page,"A")
    original='The Node of the Day needs room'
    open_label_dialog(page)
    dialog.get_by_label("Canvas label",exact=True).fill(original)
    dialog.get_by_role("combobox",name="Text sizing",exact=True).select_option("wrap")
    dialog.get_by_label("Wrap width",exact=True).fill("1.5")
    expect(dialog.get_by_role("button",name="Done",exact=True)).to_be_enabled()
    dialog.get_by_role("button",name="Done",exact=True).click()
    expect(dialog).not_to_be_visible()
    open_more(page)
    expect(page.get_by_role("combobox",name="Label behavior",exact=True)).to_have_value("wrap")
    wrapped=page.locator("#source").input_value()
    open_more(page)
    page.get_by_label("Shape width",exact=True).fill("1")
    open_more(page)
    page.get_by_role("button",name="Apply size",exact=True).click()
    expect(page.locator("#source")).not_to_have_value(wrapped)
    open_more(page)
    expect(page.get_by_label("Shape width",exact=True)).to_have_value("1")
    resized=page.locator("#source").input_value()
    labels=re.findall(r'"([^"\\]*)"',resized)
    assert len(labels)<=5 and ' '.join(labels)==original,labels
    open_label_dialog(page)
    expect(dialog.get_by_label("Canvas label",exact=True)).to_have_value(original)
    expect(dialog.get_by_role("combobox",name="Text sizing",exact=True)).to_have_value("wrap")
    dialog.get_by_role("button",name="Cancel",exact=True).click()
    unchanged_after_undo(wrapped)
    open_more(page)
    expect(page.get_by_role("combobox",name="Label behavior",exact=True)).to_have_value("wrap")
    page.locator("#canvas-redo").click()
    expect(page.locator("#source")).to_have_value(resized)
    page.reload()
    page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")
    select(page,"A")
    open_more(page)
    expect(page.get_by_role("combobox",name="Label behavior",exact=True)).to_have_value("wrap")
    open_label_dialog(page)
    expect(dialog.get_by_label("Canvas label",exact=True)).to_have_value(original)
    dialog.get_by_role("button",name="Cancel",exact=True).click()

    # Rewrapping from an east-handle drag keeps the opposite left/top fixed.
    before_drag=page.locator('#source').input_value()
    bounds_before=native_bounds('A')
    close_popovers(page)
    select(page,'A')
    handle=page.locator('#diagram [data-resize="e"]')
    handle.scroll_into_view_if_needed()
    box=handle.bounding_box()
    shape=page.locator('#diagram [data-pikchr-id="o1"]').bounding_box()
    # Grab the edge away from its midpoint, where the connector attach dot sits.
    x,y=box['x']+box['width']/2,box['y']+box['height']*.2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-shape['width']*.3,y,steps=8);page.mouse.up()
    expect(page.locator('#source')).not_to_have_value(before_drag)
    bounds_after=native_bounds('A')
    assert bounds_after['height']>bounds_before['height'],(bounds_before,bounds_after)
    assert abs(bounds_after['x']-bounds_before['x'])<0.0002,(bounds_before,bounds_after)
    assert abs(bounds_after['y']+bounds_after['height']-bounds_before['y']-bounds_before['height'])<0.0002,(bounds_before,bounds_after)
    unchanged_after_undo(before_drag)

    # Moving must immediately show the retained policy, not a stale Fixed UI.
    page.locator('#diagram').focus()
    page.keyboard.press('ArrowRight')
    expect(page.locator('#source')).not_to_have_value(before_drag)
    open_more(page)
    expect(page.get_by_role('combobox',name='Label behavior',exact=True)).to_have_value('wrap')
    open_label_dialog(page)
    expect(dialog.get_by_label('Canvas label',exact=True)).to_have_value(original)
    dialog.get_by_role('button',name='Cancel',exact=True).click()

    # Fixed means precisely the entered dimensions, even if the label overflows.
    open_more(page)
    page.get_by_role("combobox",name="Label behavior",exact=True).select_option("fixed")
    open_more(page)
    page.get_by_label("Shape width",exact=True).fill("1.2")
    open_more(page)
    page.get_by_label("Shape height",exact=True).fill("0.8")
    open_more(page)
    page.get_by_role("button",name="Apply size",exact=True).click()
    open_more(page)
    expect(page.get_by_label("Shape width",exact=True)).to_have_value("1.2")
    open_more(page)
    expect(page.get_by_label("Shape height",exact=True)).to_have_value("0.8")
    open_more(page)
    expect(page.get_by_role("combobox",name="Label behavior",exact=True)).to_have_value("fixed")

    # Keyboard resizing honors the same aspect lock as pointer/numeric sizing.
    page.wait_for_function("/width 1\\.2\\b/.test(document.querySelector('#source').value)")
    locked_source=page.locator('#source').input_value()
    open_more(page)
    page.get_by_label('Lock aspect ratio',exact=True).check()
    page.locator('#diagram [data-resize="e"]').focus()
    page.keyboard.press('ArrowRight')
    expect(page.locator('#source')).not_to_have_value(locked_source)
    bounds=native_bounds('A')
    assert abs(bounds['width']/bounds['height']-1.5)<0.001,bounds
    unchanged_after_undo(locked_source)
    open_more(page)
    page.get_by_label('Lock aspect ratio',exact=True).uncheck()

    # Real pointer drags on every circle handle must shrink as well as grow.
    close_popovers(page)
    circle='C: circle "C" radius 0.5 at (0,0)\n'
    load(page,circle)
    select(page,"C")
    for name in ['e','s','se']:
        for sign in [1,-1]:
            close_popovers(page)
            handle=page.locator('#diagram [data-resize="'+name+'"]')
            handle.scroll_into_view_if_needed()
            box=handle.bounding_box()
            # Edge strips are grabbed away from the midpoint attach dot.
            x,y=box['x']+box['width']*(.2 if name=='s' else .5),box['y']+box['height']*(.2 if name=='e' else .5)
            page.mouse.move(x,y)
            page.mouse.down()
            page.mouse.move(x+(35*sign if name!='s' else 0),y+(35*sign if name!='e' else 0),steps=8)
            page.mouse.up()
            expect(page.locator("#source")).not_to_have_value(circle)
            width=float(page.get_by_label("Shape width",exact=True).input_value())
            height=float(page.get_by_label("Shape height",exact=True).input_value())
            assert abs(width-height)<0.001,(name,sign,width,height)
            assert width>1 if sign==1 else width<1,(name,sign,width,height)
            unchanged_after_undo(circle)
    assert not errors,errors

    # Touch hit targets are tested in a separate coarse-pointer browser context.
    touch=browser.new_context(viewport={"width":390,"height":844},has_touch=True,is_mobile=True)
    phone=touch.new_page()
    setup(phone)
    load(phone,circle)
    # Select through the actual rendered shape, not a hidden mobile drawer.
    phone.locator('#diagram [data-pikchr-id="o1"]').click()
    for handle in phone.locator('#diagram [data-resize]').all():
        hit=handle.locator('rect').first.bounding_box()
        # Corners are 44px squares; edge strips are 44px thick along the edge.
        assert min(hit['width'],hit['height'])>=43.9 or handle.get_attribute('data-resize') in ('n','s','e','w') and (hit['width']>=43.9 or hit['height']>=43.9),hit
    expect(phone.locator('#diagram [data-resize]')).to_have_count(8)
    touch.close()
    context.close()
    browser.close()
    print('PASS: metadata-only intent; original paragraph rewrap; fixed opposite edges; retained policy after move/reload/Undo/Redo; exact dimensions; keyboard ratio lock; circle e/s/corner grow+shrink; 44px coarse-pointer handles')
