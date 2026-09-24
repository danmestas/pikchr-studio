from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1100, "height": 800})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/embed.html")
    page.wait_for_function("document.querySelector('#embed-state').textContent === 'Rendered 3 objects.'")
    source = page.get_by_label("Pikchr source", exact=True)
    source.fill('A: diamond "Café ☕" at (-2,1)')
    assert page.locator('#embed-output.stale').count() == 1
    page.get_by_role('button', name='Render diagram').click()
    page.wait_for_function("document.querySelector('#embed-state').textContent === 'Rendered 1 objects.'")
    assert 'Café' in page.locator('#embed-output').inner_text()
    source.fill('not valid pikchr')
    page.get_by_role('button', name='Render diagram').click()
    page.wait_for_function("document.querySelector('#embed-error').textContent.length > 0")
    assert 'Café' in page.locator('#embed-output').inner_text()
    assert page.locator('#embed-output.stale').count() == 1
    source.fill('box "Recovered"')
    source.press('Control+Enter')
    page.wait_for_function("document.querySelector('#embed-output').textContent.includes('Recovered')")
    assert page.locator('#embed-error').inner_text() == ''
    page.set_viewport_size({"width":390,"height":844})
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    assert not errors, errors
    browser.close()
    print('PASS: embed valid render, stale marking, native error, last output retention, keyboard recovery, Unicode, mobile')
