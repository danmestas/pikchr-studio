"""Reconnect an existing default arrow to a box added after both arrows."""
import os
from playwright.sync_api import sync_playwright, expect
from browser_helpers import set_auto_apply, set_source, object_button, close_popovers, open_more

STUDIO = os.environ.get('PIKCHR_STUDIO_URL', 'http://127.0.0.1:8790').rstrip('/')
INITIAL = 'Client: box "Client" at (0,0)\nAPI: box "API" at (2,0)\nDatabase: cylinder "Database" at (4,0)\narrow from Client.e to API.w\narrow from API.e to Database.w\n'

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome')
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(STUDIO + '/')
    set_source(page, INITIAL)
    set_auto_apply(page, True)
    palette = page.get_by_role('toolbar', name='Tools')
    palette.get_by_role('button', name='Box', exact=True).click()
    point = page.evaluate('window.pikchrStudio.modelToScreen({x:2,y:-1})')
    page.mouse.click(point['x'], point['y'])
    page.wait_for_function("window.pikchrStudio.state().source.includes('Shape1:')")
    added = page.locator('#source').input_value()
    assert added.index('Shape1:') > added.index('arrow from API.e to Database.w')
    for endpoint in ('end', 'start'):
        set_source(page, added)
        # The default diagram has two anonymous arrows; choose the first by its
        # visible object list rather than depending on connector hit testing.
        object_button(page, 'arrow o4').click()
        open_more(page)
        page.locator('.cl-more').get_by_role('button', name='Reconnect ' + endpoint, exact=True).click()
        close_popovers(page)
        point = page.evaluate('window.pikchrStudio.modelToScreen({x:2,y:-1})')
        page.mouse.click(point['x'], point['y'])
        token = 'to Shape1.' if endpoint == 'end' else 'from Shape1.'
        try:
            page.wait_for_function('(token)=>window.pikchrStudio.state().source.includes(token)', arg=token)
        except Exception:
            print(page.locator('#state').text_content(), flush=True)
            raise
        changed = page.locator('#source').input_value()
        assert changed.index('arrow from API.e to Database.w') < changed.index('Shape1:')
        assert changed.index('Shape1:') < changed.index('arrow from Shape1.' if endpoint == 'start' else 'arrow from Client.e')
        assert 'arrow from API.e to Database.w' in changed
        page.locator('#canvas-undo').click()
        expect(page.locator('#source')).to_have_value(added)
    overlapping = INITIAL + 'Shape1: box "T" fill white at (3,0)\n'
    set_source(page, overlapping)
    object_button(page, 'arrow o4').click()
    open_more(page)
    page.locator('.cl-more').get_by_role('button', name='Reconnect end', exact=True).click()
    close_popovers(page)
    point = page.evaluate('window.pikchrStudio.modelToScreen({x:3,y:0})')
    page.mouse.click(point['x'], point['y'])
    page.wait_for_function("window.pikchrStudio.state().source.includes('to Shape1.')")
    changed = page.locator('#source').input_value()
    assert changed.index('arrow from API.e to Database.w') < changed.index('Shape1:')
    assert changed.index('Shape1:') < changed.index('arrow from Client.e')
    ids = page.evaluate("[...document.querySelectorAll('#diagram svg > g[data-pikchr-id]')].map(g=>g.dataset.pikchrId)")
    assert ids.index('o4') < ids.index('o5'), 'untouched arrow remains painted before the white box'
    assert not errors, errors
    browser.close()
    print('PASS: add box after two anonymous arrows, reconnect both endpoints, retain unrelated arrow, Undo')
