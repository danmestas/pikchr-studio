"""Regression: drag unpainted shape interiors, not just SVG text or strokes."""
from playwright.sync_api import sync_playwright
from browser_helpers import prepare_legacy, open_example, set_source, reveal, menu_click

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width":1440,"height":1000})
    page.goto("http://127.0.0.1:8790/")
    prepare_legacy(page)
    source = page.locator('#source')
    for kind in ['box','circle','ellipse','oval','cylinder','diamond']:
        original = f'A: {kind} "A" width 2 height 2 at (0,0)\n'
        set_source(page, original)
        page.wait_for_function("document.querySelector('#state').textContent.startsWith('Rendered')")
        point = page.locator('#diagram [data-pikchr-id="o1"]').evaluate('''g=>{
            const r=g.getBoundingClientRect();
            return {x:r.x+r.width*.5,y:r.y+r.height*.35};
        }''')
        # This point is inside the shape, above the centered label, off its border.
        assert page.evaluate('''p=>document.elementFromPoint(p.x,p.y)?.closest('[data-pikchr-id]')?.getAttribute('data-pikchr-id')''', point) == 'o1', kind
        page.mouse.move(point['x'],point['y'])
        page.mouse.down()
        page.mouse.move(point['x']+35,point['y']+25,steps=6)
        page.mouse.up()
        page.wait_for_function("!document.querySelector('#preview-actions').hidden")
        page.locator("#preview-accept").click()
        page.wait_for_function("!document.querySelector('#accept').disabled")
        assert source.input_value() != original
        assert source.get_attribute("readonly") is not None
        assert page.locator('#queue-list li').count() == 1
        menu_click(page, "#accept")
        page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
        assert source.input_value() != original
    open_example(page, 'nested')
    original = source.input_value()
    label = page.locator('#diagram text').filter(has_text='Inside a group')
    label.scroll_into_view_if_needed()
    r = label.bounding_box()
    page.mouse.move(r['x']+3,r['y']+r['height']/2)
    page.mouse.down()
    page.mouse.move(r['x']+r['width']-3,r['y']+r['height']/2,steps=8)
    page.mouse.up()
    assert page.evaluate('window.getSelection().toString()') == ''
    assert 'inside a group' in page.locator('#state').inner_text().lower(), page.locator('#state').inner_text()
    assert page.locator('#accept').is_disabled()
    assert source.input_value() == original
    browser.close()
    print('PASS: blank-interior drag for all six shapes, live draft, and batch application')
