"""Drag → ranked preview → cycle → accept → undo, plus keyboard reachability."""
import re
from playwright.sync_api import sync_playwright, expect
from browser_helpers import prepare_legacy, object_button, reveal, menu_click, open_document_menu

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790")
    prepare_legacy(page)
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    source = page.locator("#source")
    original = source.input_value()
    # Errors surface on the canvas even when the source drawer is closed.
    page.evaluate("t=>{const s=document.querySelector('#source');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}))}", "A: box at (")
    page.wait_for_function("document.querySelector('#diagnostic').textContent.length > 0")
    assert page.locator("#diagnostic").is_visible()
    page.evaluate("t=>{const s=document.querySelector('#source');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}))}", original)
    page.wait_for_function("document.querySelector('#state').textContent.startsWith('Rendered')")
    # Drag Database so it sits just below API: the ranked list must lead with a
    # relational, literal-free edit and still offer the absolute fallback.
    api = page.locator('#diagram [data-pikchr-id="o2"] path').first.bounding_box()
    db = page.locator('#diagram [data-pikchr-id="o3"] path').first.bounding_box()
    sx, sy = db["x"] + db["width"] / 2, db["y"] + db["height"] / 2
    tx, ty = api["x"] + api["width"] / 2, api["y"] + api["height"] + db["height"] / 2 + 2
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(tx, ty, steps=10); page.mouse.up()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    options = page.locator("#suggestions [role=option]")
    assert options.count() >= 2, options.all_inner_texts()
    assert options.first.get_attribute("aria-selected") == "true"
    assert "with .n at API.s" in page.locator("#diff").inner_text(), page.locator("#diff").inner_text()
    assert source.input_value() == original, "preview must not modify the source"
    assert page.locator("#queue-list li").count() == 0
    assert page.locator("#diagram.previewing").count() == 1
    first_label = page.locator("#preview-label").inner_text()
    # Cycle with the keyboard from the canvas and from the list.
    page.locator("#diagram").focus(); page.keyboard.press("]")
    assert page.locator("#preview-label").inner_text() != first_label
    page.keyboard.press("[")
    assert page.locator("#preview-label").inner_text() == first_label
    page.keyboard.press("Escape")
    page.wait_for_function("document.querySelector('#preview-actions').hidden")
    assert source.input_value() == original
    assert page.locator("#diagram.previewing").count() == 0
    # Drag again, accept with Enter, then the draft queues and Apply all commits.
    page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(tx, ty, steps=10); page.mouse.up()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    page.locator("#diagram").focus(); page.keyboard.press("Enter")
    page.wait_for_function("document.querySelectorAll('#queue-list li').length === 1")
    assert "with .n at API.s" in source.input_value(), source.input_value()
    assert source.get_attribute("readonly") is not None
    menu_click(page, "#accept")
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    applied = source.input_value()
    page.locator("#canvas-undo").click()
    expect(source).to_have_value(original)
    page.locator("#canvas-redo").click()
    expect(source).to_have_value(applied)
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    # Rendered objects are focusable and arrow keys walk them.
    page.locator('#diagram [data-pikchr-id="o1"]').focus()
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.activeElement.getAttribute('data-pikchr-id')") == "o2"
    page.keyboard.press("Space")
    assert "API" in page.locator("#inspector").inner_text()
    # Advanced tools are hidden by default, even inside the ☰ menu.
    open_document_menu(page)
    assert not page.locator(".component-tools").is_visible()
    page.goto("http://127.0.0.1:8790/?advanced=1")
    page.wait_for_function("document.querySelector('#state').textContent.startsWith('Rendered')")
    open_document_menu(page)
    assert page.locator(".component-tools").is_visible()
    assert not errors, errors
    browser.close()
    print("PASS: error alert with the source closed, ranked relational preview, keyboard cycling, escape, accept, apply, undo/redo, focusable objects, advanced flag")
