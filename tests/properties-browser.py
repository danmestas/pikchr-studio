"""Real WASM/browser regressions for direct object properties and apply state."""
from playwright.sync_api import sync_playwright, expect
from browser_helpers import prepare_legacy, object_button, edit_label, reveal, set_source, open_label_dialog, menu_click, set_auto_apply


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/?advanced=1")
    prepare_legacy(page)
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    source = page.locator("#source")
    baseline = 'A: box "A" at (0,0)\nB: box "B" at (3,-2)\narrow from A.e to B.w\n'

    def render(text):
        set_source(page, text)
        expect(page.locator("#state")).to_have_text("Rendered 3 objects. Select one to inspect.")

    def queued(count):
        expect(page.locator("#queue-list li")).to_have_count(count)
        expect(page.locator("#queue-status")).to_have_attribute("data-state", "draft")
        expect(page.locator("#diagram svg")).to_have_count(1)

    def applied():
        expect(page.locator("#queue-list li")).to_have_count(0)
        expect(page.locator("#queue-status")).to_have_attribute("data-state", "applied")

    render(baseline)
    expect(page.locator("#auto-apply")).not_to_be_checked()
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    open_label_dialog(page)
    expect(page.get_by_label("Canvas label", exact=True)).to_be_focused()
    page.get_by_label("Canvas label", exact=True).fill("Café 日本語 ☕")
    page.get_by_label("Text sizing", exact=True).select_option('fixed')
    expect(page.locator('.label-dialog[aria-labelledby="canvas-label-title"]').get_by_role('button', name='Done', exact=True)).to_be_enabled()
    page.locator('.label-dialog[aria-labelledby="canvas-label-title"]').get_by_role('button', name='Done', exact=True).click()
    queued(1)
    expect(source).to_have_value(baseline.replace('"A"', '"Café 日本語 ☕"'))
    expect(page.locator('#diagram [data-pikchr-id="o1"]')).to_contain_text("Café 日本語 ☕")
    menu_click(page, "#cancel")
    expect(source).to_have_value(baseline)
    expect(page.locator('#diagram [data-pikchr-id="o1"] text')).to_have_text("A")

    open_label_dialog(page)
    expect(page.get_by_label("Canvas label", exact=True)).to_be_focused()
    page.get_by_label("Canvas label", exact=True).fill("Edited")
    page.get_by_label("Text sizing", exact=True).select_option('fixed')
    expect(page.locator('.label-dialog[aria-labelledby="canvas-label-title"]').get_by_role('button', name='Done', exact=True)).to_be_enabled()
    page.locator('.label-dialog[aria-labelledby="canvas-label-title"]').get_by_role('button', name='Done', exact=True).click()
    queued(1)
    page.locator('#appearance-selected').click()
    page.get_by_label("Shape type", exact=True).select_option("ellipse")
    page.get_by_role("button", name="Change shape type", exact=True).click()
    queued(2)
    expect(source).to_have_value(baseline.replace('box "A"', 'ellipse "Edited"'))
    menu_click(page, "#accept")
    applied()
    committed = source.input_value()
    set_auto_apply(page, True)
    edit_label(page, 'Automatic', 'fixed')
    expect(source).to_have_value(committed.replace('"Edited"', '"Automatic"'))
    applied()
    page.locator("#canvas-undo").click()
    expect(source).to_have_value(committed)
    set_auto_apply(page, False)

    # The unnamed object must retain selection when arrow becomes plain line.
    render(baseline)
    object_button(page, "arrow o3").click()
    page.locator('#route-selected').click()
    for count, mode in enumerate(["none", "start", "both", "end"], 1):
        page.locator('#inspector').get_by_label("Arrowheads", exact=True).select_option(mode)
        queued(count)
        expect(page.locator('#inspector').get_by_label("Arrowheads", exact=True)).to_have_value(mode)
        expect(page.locator('.arrow-editor')).to_have_count(1)
        expect(page.locator('#objects button[aria-pressed="true"]')).to_contain_text("line o3")
        expect(page.locator('#diagram [data-pikchr-id="o3"] polygon')).to_have_count(
            {"none": 0, "start": 1, "both": 2, "end": 1}[mode])
    page.get_by_role("button", name="Routing", exact=True).click()
    page.get_by_role("button", name="Horizontal first", exact=True).click()
    queued(5)
    assert "then to B.w" in source.input_value()
    page.get_by_role("button", name="Endpoints", exact=True).click()
    page.get_by_role("button", name="Connect to North", exact=True).click()
    queued(6)
    assert "B.n" in source.input_value() and "->" in source.input_value()
    menu_click(page, "#accept")
    applied()
    page.locator("#canvas-undo").click()
    expect(source).to_have_value(baseline)
    page.set_viewport_size({"width": 390, "height": 844})
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    assert not errors, errors
    browser.close()
    print("PASS: text, Unicode, shape mutation, apply state, auto-apply undo, all arrowheads, route/reconnect, mobile")
