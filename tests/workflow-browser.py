"""Browser regressions for saved documents and the multi-object canvas workflow."""
import re
from browser_helpers import object_button, open_document_menu, show_source, reveal, set_source, menu_click, set_auto_apply
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/?advanced=1")
    open_document_menu(page)
    source = page.locator("#source")

    def rendered():
        page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")

    def saved():
        page.wait_for_function("document.querySelector('#save-state').dataset.state === 'saved' && document.querySelector('#save-state').textContent === 'Saved on this browser'")

    def select(name, shift=False):
        object_button(page, name).click(modifiers=["Shift"] if shift else [])

    def changed(before):
        page.wait_for_function("old => document.querySelector('#source').value !== old", arg=before)
        rendered()

    def nudge(key):
        page.locator("#diagram").focus()
        page.keyboard.press(key)

    rendered()
    show_source(page)
    base = 'A: box "Alpha" at (0,0)\nB: box "Beta" at (3,-1)\nC: box "Gamma" at (6,-2)\nLink: arrow from A.e to B.w\n'
    set_source(page, base)
    rendered()
    set_auto_apply(page, False)
    select("A")
    nudge("ArrowUp")
    changed(base)
    draft = source.input_value()
    page.wait_for_function("document.querySelectorAll('#queue-list li').length === 1")
    saved()
    doc_id = page.locator("#documents").input_value()
    page.reload()
    open_document_menu(page)
    rendered()
    assert source.input_value() == draft
    assert source.get_attribute("readonly") is not None
    assert page.locator("#queue-list li").count() == 1
    assert not page.locator("#auto-apply").is_checked()
    menu_click(page, "#cancel")
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=base)
    rendered()
    set_auto_apply(page, True)

    # New document preserves the first document and restores it from the list.
    reveal(page, "#new-document").click()
    page.wait_for_function("document.querySelector('#source').value === ''")
    show_source(page)
    set_source(page, 'X: box "Separate document" at (0,0)')
    rendered()
    saved()
    second_id = page.locator("#documents").input_value()
    assert second_id != doc_id
    reveal(page, "#documents").select_option(doc_id)
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=base)
    rendered()
    saved()
    assert page.locator("#documents option").count() == 2

    # Duplicate, delete, and undo must operate on actual source and SVG.
    select("A")
    reveal(page, "#duplicate-selected").click()
    changed(base)
    duplicated = source.input_value()
    assert page.locator("#objects button").count() == 5
    reveal(page, "#delete-selected").click()
    changed(duplicated)
    assert page.locator("#objects button").count() == 4
    reveal(page, "#canvas-undo").click()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=duplicated)
    rendered()
    reveal(page, "#canvas-undo").click()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=base)
    rendered()

    # A multiple selection survives arrange and moves as one undoable edit.
    select("A")
    select("B", shift=True)
    assert page.locator("#selection-count").inner_text() == "2 selected"
    reveal(page, "#layout-mode").select_option("align-y")
    reveal(page, "#arrange").click()
    changed(base)
    aligned = source.input_value()
    assert page.locator("#selection-count").inner_text() == "2 selected"
    def xy(text, name):
        match = re.search(r'^'+name+r':.*?at\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)', text, re.M)
        assert match, text
        return tuple(map(float, match.groups()))
    assert xy(aligned,"A")[1] == xy(aligned,"B")[1]
    nudge("ArrowRight")
    changed(aligned)
    moved = source.input_value()
    delta_a = xy(moved,"A")[0] - xy(aligned,"A")[0]
    delta_b = xy(moved,"B")[0] - xy(aligned,"B")[0]
    assert delta_a > 0 and abs(delta_a-delta_b) < .0001
    assert xy(moved,"C") == xy(aligned,"C")
    reveal(page, "#canvas-undo").click()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=aligned)
    rendered()

    # View changes are source-neutral and reset correctly.
    svg = page.locator("#diagram svg")
    original_view = svg.get_attribute("viewBox")
    reveal(page, "#zoom-in").click()
    zoomed_view = svg.get_attribute("viewBox")
    assert original_view != zoomed_view
    page.get_by_role("button", name="Pan", exact=True).click()
    svg.scroll_into_view_if_needed()
    bounds = svg.bounding_box()
    x,y = bounds["x"]+bounds["width"]*.5,bounds["y"]+bounds["height"]*.5
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x+45,y+25,steps=5)
    page.mouse.up()
    assert svg.get_attribute("viewBox") != zoomed_view
    assert source.input_value() == aligned
    page.get_by_role("button", name="Pan", exact=True).click()
    reveal(page, "#fit-view").click()
    assert svg.get_attribute("viewBox") == original_view
    page.set_viewport_size({"width": 390, "height": 844})
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), "Mobile layout overflows horizontally"
    assert page.locator("#duplicate-selected").is_visible()
    assert not errors, errors
    browser.close()
    print("PASS: saved draft reload/recovery, multiple documents, duplicate/delete/undo, multi-select align and group nudge, source-neutral zoom/pan/fit")
