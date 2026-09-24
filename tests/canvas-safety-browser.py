"""Selection, sizing metadata, overflow feedback and cancellation regressions."""
from playwright.sync_api import sync_playwright, expect
from browser_helpers import open_document_menu, show_source, hide_source, open_label_dialog, open_more, reveal, close_popovers

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome')
    page=browser.new_page(viewport={'width':1440,'height':1100})
    page.add_init_script("""(() => {
      // Delay delivery, not rendering or application state, to deterministically
      // exercise Escape while a valid native result is still in flight.
      const Original=window.Worker;window.__testRenderDelay=0;
      window.Worker=class extends Original{
        set onmessage(fn){this._handler=fn;super.onmessage=event=>setTimeout(()=>fn?.(event),window.__testRenderDelay);}
        get onmessage(){return this._handler;}
      };
    })();""")
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto('http://127.0.0.1:8790/')
    page.wait_for_function("document.querySelectorAll('#objects button').length===5")
    source=page.locator('#source');initial=source.input_value()
    diagram=page.locator('#diagram')
    diagram.scroll_into_view_if_needed()
    before=diagram.bounding_box()
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    after=diagram.bounding_box()
    assert abs(before['y']-after['y'])<1, (before,after)

    open_document_menu(page);page.get_by_role('button',name='Select area',exact=True).click()
    boxes=[page.locator(f'#diagram [data-pikchr-id="o{i}"]').bounding_box() for i in [1,2,3]]
    x=min(b['x'] for b in boxes)-5;y=min(b['y'] for b in boxes)-5
    right=max(b['x']+b['width'] for b in boxes)+5;bottom=max(b['y']+b['height'] for b in boxes)+5
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(right,bottom,steps=10);page.mouse.up()
    expect(page.locator('#selection-count')).to_have_text('3 selected')
    page.locator('#copy-selection').click();page.locator('#paste-selection').click()
    page.wait_for_function("document.querySelectorAll('#objects button').length>5")
    pasted_count=page.locator('#objects button').count()
    expect(source).not_to_have_value(initial)
    page.locator('#canvas-undo').click();expect(source).to_have_value(initial)
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")

    # A cancelled resize keeps both the source and history unchanged.
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    handle=page.locator('[data-resize="se"]');handle.scroll_into_view_if_needed()
    box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+40,y+35,steps=5)
    expect(page.locator('.canvas-preview')).to_have_count(1)
    diagram.dispatch_event('pointercancel',{'pointerId':1,'bubbles':True})
    page.mouse.up();expect(page.locator('.canvas-preview')).to_have_count(0)
    expect(source).to_have_value(initial)

    # A late worker reply cannot commit the manipulation cancelled with Escape.
    page.evaluate('window.__testRenderDelay=300')
    page.locator('#diagram [data-pikchr-id="o1"]').click();diagram.focus()
    page.keyboard.press('ArrowRight');page.keyboard.press('Escape')
    page.wait_for_timeout(600)
    expect(source).to_have_value(initial)
    page.evaluate('window.__testRenderDelay=0')

    # Exact same source still stores an explicit label policy and restores it.
    open_document_menu(page)
    if not source.is_visible():show_source(page)
    fixed='A: box "A" width 1 height 0.5 at (0, 0)\n'
    source.fill(fixed);hide_source(page)
    expect(page.locator('#objects button')).to_have_count(1)
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    dialog=open_label_dialog(page)
    dialog.get_by_label('Text sizing',exact=True).select_option('fixed')
    expect(dialog.get_by_role('button',name='Done',exact=True)).to_be_enabled()
    dialog.get_by_role('button',name='Done',exact=True).click()
    expect(source).to_have_value(fixed)
    expect(page.locator('#state')).to_have_text('Label behavior saved. Diagram geometry is unchanged.')
    page.wait_for_function("Object.keys(JSON.parse(localStorage.getItem('pikchr-studio.document.v1.'+document.querySelector('#documents').value)).state.sizingPreferences||{}).length>0")
    page.reload();page.wait_for_function("document.querySelectorAll('#objects button').length===1")
    expect(source).to_have_value(fixed)
    page.locator('#diagram [data-pikchr-id="o1"]').click();open_label_dialog(page)
    expect(dialog.get_by_label('Text sizing',exact=True)).to_have_value('fixed')
    dialog.get_by_label('Canvas label',exact=True).fill('This deliberately long label exceeds the fixed shape width by a lot')
    expect(dialog.get_by_role('button',name='Done',exact=True)).to_be_enabled()
    dialog.get_by_role('button',name='Done',exact=True).click()
    open_more(page)
    expect(page.locator('.canvas-sizing')).to_contain_text('Text exceeds shape: choose Grow or Wrap.')
    warning=page.locator('.canvas-sizing').get_by_text('Text exceeds shape: choose Grow or Wrap.',exact=True)
    expect(warning).to_be_visible()
    close_popovers(page)
    page.set_viewport_size({'width':390,'height':844})
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    open_more(page)
    expect(warning).to_be_visible()
    assert not page.evaluate('document.documentElement.scrollWidth>innerWidth')
    assert not errors,errors
    assert pasted_count==10, f'Copy must include both internal arrows; got {pasted_count} total objects instead of 10'
    browser.close()
    print('PASS: stable selection layout, marquee subgraph copy/paste+Undo, resize cancellation, Escape rejects delayed native response, same-source policy persistence, fixed overflow warning and mobile')
