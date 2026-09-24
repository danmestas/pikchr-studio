"""Direct-canvas regression tests using real browser events and native WASM."""
from playwright.sync_api import sync_playwright, expect
from browser_helpers import open_document_menu, reveal, show_source, hide_source, open_label_dialog, render_source, close_popovers, menu_click, set_auto_apply

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/")
    open_document_menu(page)
    source = page.locator("#source")
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    initial = source.input_value()

    def ready():
        page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale') && !document.querySelector('#undo').disabled")

    def changed(before):
        expect(source).not_to_have_value(before)
        ready()

    def select(index=1):
        page.locator(f'#diagram [data-pikchr-id="o{index}"]').click()
        expect(page.locator("#edit-selected")).to_be_enabled()

    def undo_to(before):
        page.locator("#canvas-undo").click()
        expect(source).to_have_value(before)
        page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")

    def label(text, mode="grow", cancel=False):
        dialog = open_label_dialog(page)
        dialog.get_by_label("Canvas label", exact=True).fill(text)
        dialog.get_by_label("Text sizing", exact=True).select_option(mode)
        if mode == "wrap":
            dialog.get_by_label("Wrap width", exact=True).fill("1.2")
        done = dialog.get_by_role("button", name="Done", exact=True)
        expect(done).to_be_enabled(timeout=15000)
        dialog.get_by_role("button", name="Cancel" if cancel else "Done", exact=True).click()
        expect(dialog).not_to_be_visible()

    # This script exercises immediate application; queue mode is the default.
    set_auto_apply(page, True)
    select()
    label("This preview must be discarded", cancel=True)
    expect(source).to_have_value(initial)
    expect(page.locator('#diagram [data-pikchr-id="o1"] text')).to_have_text("Client")
    select()
    label("A readable multiline label with several longer words", mode="wrap")
    changed(initial)
    assert page.locator('#diagram [data-pikchr-id="o1"] text').count() > 1
    assert page.locator("#queue-list li").count() == 0
    undo_to(initial)

    palette = page.get_by_role("toolbar", name="Tools")
    def menu_tool(name):
        open_document_menu(page)
        button = page.locator(".cl-menu button").filter(has_text=name).first
        for details in button.locator("xpath=ancestor::details").all():
            if details.get_attribute("open") is None:
                details.locator(":scope > summary").click()
        return button
    palette.get_by_role("button", name="Box", exact=True).click()
    menu_tool("Place at view center").click()
    changed(initial)
    expect(page.locator("#objects button")).to_have_count(6)
    placed = source.input_value()
    menu_tool("Add connected shape").click()
    changed(placed)
    expect(page.locator("#objects button")).to_have_count(8)
    undo_to(placed)
    undo_to(initial)

    close_popovers(page)
    palette.get_by_role("button", name="Arrow", exact=True).click()
    select(1)
    select(3)
    changed(initial)
    expect(page.locator("#objects button")).to_have_count(6)
    assert "Link1:" in source.input_value()
    undo_to(initial)

    close_popovers(page)
    select(1)
    handle = page.locator('[data-resize="se"]')
    handle.scroll_into_view_if_needed()
    bounds = handle.bounding_box()
    x, y = bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 45, y + 30, steps=8)
    page.mouse.up()
    changed(initial)
    undo_to(initial)

    set_auto_apply(page, False)
    close_popovers(page)
    select(1)
    label("Queued label")
    expect(page.locator("#queue-list li")).to_have_count(1)
    menu_tool("Add connected shape").click()
    expect(page.locator("#queue-list li")).to_have_count(2)
    expect(page.locator("#objects button")).to_have_count(7)
    expect(page.locator('#diagram [data-pikchr-id="o1"] text')).to_have_text("Queued label")
    menu_click(page, "#cancel")
    expect(source).to_have_value(initial)
    expect(page.locator("#objects button")).to_have_count(5)
    set_auto_apply(page, True)
    close_popovers(page)

    palette.get_by_role("button", name="Box", exact=True).click()
    menu_tool("Cancel tool").click()
    close_popovers(page)
    expect(source).to_have_value(initial)
    if not source.is_visible():
        show_source(page)
    source.fill(initial + "# unrendered change\n")
    stale = source.input_value()
    # A disabled tool or its explicit validity guard must leave source intact.
    page.evaluate("window.pikchrStudio.editLabelDialog()")
    expect(page.locator('.label-dialog[aria-labelledby="canvas-label-title"]')).not_to_be_visible()
    expect(source).to_have_value(stale)
    render_source(page)
    ready()

    hide_source(page)
    page.set_viewport_size({"width": 390, "height": 844})
    select(1)
    open_label_dialog(page)
    expect(page.get_by_label("Canvas label", exact=True)).to_be_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), "Mobile horizontal overflow"
    page.locator('.label-dialog[aria-labelledby="canvas-label-title"]').get_by_role("button", name="Cancel", exact=True).click()
    palette.get_by_role("button", name="Box", exact=True).click()
    center = menu_tool("Place at view center")
    center.scroll_into_view_if_needed()
    expect(center).to_be_in_viewport()
    center.click()
    changed(stale)
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    page.screenshot(path="/tmp/pikchr-direct-canvas-mobile.png", full_page=True)
    assert not errors, errors
    browser.close()
    print("PASS: label cancel/wrap/Undo, place, connected neighbor, connect, pointer resize, two-edit queue/discard, stale guard, mobile controls")
