"""Browser regression for the single-canvas, validated draft queue."""
import re
from browser_helpers import prepare_legacy, object_button, shape_option, show_source, set_source, reveal, menu_click, open_menu_details, close_popovers
from playwright.sync_api import sync_playwright


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/")
    prepare_legacy(page)
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    source = page.locator("#source")

    def rendered():
        page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")

    def queued(count):
        page.wait_for_function("n => document.querySelectorAll('#queue-list li').length === n", arg=count)
        rendered()
        assert source.get_attribute("readonly") is not None
        assert page.locator("#diagram svg").count() == 1
        assert page.locator("#preview").count() == 0
        assert page.locator("#accept").is_enabled()

    def settled(expected):
        page.wait_for_function("text => document.querySelector('#source').value === text", arg=expected)
        page.wait_for_function("document.querySelectorAll('#queue-list li').length === 0")
        rendered()
        assert source.get_attribute("readonly") is None

    def load(text):
        set_source(page, text)
        page.wait_for_function("document.querySelector('#state').textContent.startsWith('Rendered')")

    def select(name):
        object_button(page, name).click()

    def nudge(key):
        page.locator("#diagram").focus()
        page.keyboard.press(key)

    def details(title):
        open_menu_details(page, title)

    # Consecutive edits build on the draft, while one canvas follows its source.
    original = source.input_value()
    select("Database")
    before_svg = page.locator("#diagram svg").inner_html()
    nudge("ArrowDown")
    queued(1)
    first = source.input_value()
    first_svg = page.locator("#diagram svg").inner_html()
    assert first != original and first_svg != before_svg
    select("API")
    nudge("ArrowUp")
    queued(2)
    second = source.input_value()
    assert second != first
    assert next(x for x in second.splitlines() if x.startswith("Database:")) == next(x for x in first.splitlines() if x.startswith("Database:"))
    assert page.locator("#diagram svg").inner_html() != first_svg
    assert page.locator("#diff").inner_text().strip()
    source.focus()
    page.keyboard.type("SHOULD NOT EDIT")
    assert source.input_value() == second
    menu_click(page, "#undo-draft")
    queued(1)
    assert source.input_value() == first
    menu_click(page, "#accept")
    settled(first)
    page.locator("#canvas-undo").click()
    settled(original)
    page.locator("#canvas-redo").click()
    settled(first)

    # A batch includes objects that did not exist in the committed diagram.
    load('A: box "Café ☕" at (0,0)\nB: cylinder "資料" at (3,-2)\n')
    base = source.input_value()
    details("Add shape")
    page.locator("#creation-tools").get_by_role("combobox", name="Shape", exact=True).select_option("circle")
    page.get_by_label("Label", exact=True).fill("New")
    page.get_by_label("X (inches)", exact=True).fill("5")
    page.get_by_label("Y (inches)", exact=True).fill("1")
    page.get_by_role("button", name=re.compile(r"(?:Preview new|Queue new|Add) shape", re.I)).click()
    queued(1)
    assert 'Shape1: circle "New"' in source.input_value()
    select("Shape1")
    nudge("ArrowDown")
    queued(2)
    details("Add connector")
    shape_option(page, "From shape", "A")
    shape_option(page, "To shape", "Shape1")
    page.get_by_role("combobox", name="From anchor", exact=True).select_option("e")
    page.get_by_role("combobox", name="To anchor", exact=True).select_option("w")
    page.get_by_role("button", name=re.compile(r"(?:Preview|Queue|Add) connector", re.I)).click()
    queued(3)
    assert "Link1: arrow from A.e to Shape1.w" in source.input_value()
    select("Link1")
    page.get_by_role("button", name="Routing", exact=True).click()
    page.get_by_role("button", name="Horizontal first", exact=True).click()
    queued(4)
    assert "then to Shape1.w" in source.input_value()
    page.get_by_role("button", name="Endpoints", exact=True).click()
    page.get_by_role("button", name="Connect to North", exact=True).click()
    queued(5)
    assert "then to Shape1.n" in source.input_value()
    batch = source.input_value()
    page.set_viewport_size({"width": 390, "height": 844})
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    assert reveal(page, "#accept").is_visible()
    close_popovers(page)
    page.set_viewport_size({"width": 1440, "height": 1000})
    menu_click(page, "#accept")
    settled(batch)
    page.locator("#canvas-undo").click()
    settled(base)
    page.locator("#canvas-redo").click()
    settled(batch)
    select("Shape1")
    nudge("ArrowRight")
    queued(1)
    select("B")
    nudge("ArrowDown")
    queued(2)
    menu_click(page, "#cancel")
    settled(batch)
    assert "Café ☕" in source.input_value() and "資料" in source.input_value()

    # Manual unrendered edits invalidate old canvas edit authority.
    show_source(page)
    source.fill(batch + "# source changed but not rendered\n")
    changed = source.input_value()
    page.locator("#diagram").focus()
    page.keyboard.press("ArrowRight")
    assert source.input_value() == changed
    assert page.locator("#queue-list li").count() == 0
    assert page.locator("#accept").is_disabled()
    assert not errors, errors
    browser.close()
    print("PASS: sequential draft edits, live single canvas, readonly draft, per-step undo, batch apply/discard, global undo/redo, new shape/move/connect/route/reconnect, Unicode, stale source, mobile")
