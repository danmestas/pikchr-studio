"""Route styles: gallery → preview → cycle → accept curve → undo; dashed, <->
and a label on one connector; a detour; keyboard reachability and phone width."""
import os
import re
from playwright.sync_api import sync_playwright, expect
from browser_helpers import prepare_legacy, object_button, set_source, reveal, menu_click

BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
SOURCE = """A: box "A" at (0,0)
M: box "M" at (1.5,0)
B: box "B" at (3,0)
C: box "C" at (3,-1.5)
Link: arrow from A.s to (0,-1.5) then to C.w
Pipe: arrow from A.e to B.w
"""

def set_source(page, text):
    page.evaluate("t=>{const s=document.querySelector('#source');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}))}", text)
    page.wait_for_function("t=>document.querySelector('#state').textContent.startsWith('Rendered') && document.querySelector('#source').value===t", arg=text)

def select(page, name):
    object_button(page, name).click()
    page.wait_for_function("document.querySelectorAll('.route-styles .route-style-option').length > 0")

def option(page, label):
    return page.locator(".route-styles").get_by_role("option", name=label, exact=True)

def accept(page, queued):
    page.locator("#preview-accept").click()
    page.wait_for_function(f"document.querySelectorAll('#queue-list li').length === {queued}")

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE)
    prepare_legacy(page)
    set_source(page, SOURCE)
    source = page.locator("#source")

    # Gallery appears for an elbow connector, with rendered thumbnails.
    select(page, "Link")
    gallery = page.locator(".route-styles [role=listbox]")
    expect(gallery).to_be_visible()
    assert option(page, "Curve").count() == 1, gallery.inner_text()
    assert option(page, "Curve").locator("svg").count() == 1, "thumbnail rendered"
    assert page.locator(".route-styles [data-pikchr-id]").count() == 0, "thumbnails carry no canvas ids"

    # Preview the curve: canvas and diff change, the source does not.
    option(page, "Curve").click()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    assert "spline" in page.locator("#diff").inner_text()
    assert source.input_value() == SOURCE
    assert option(page, "Curve").get_attribute("aria-selected") == "true"
    first = page.locator("#preview-label").inner_text()
    # ] and [ cycle through the gallery, and the gallery selection follows.
    page.keyboard.press("]")
    assert page.locator("#preview-label").inner_text() != first
    assert option(page, "Curve").get_attribute("aria-selected") == "false"
    page.keyboard.press("[")
    assert page.locator("#preview-label").inner_text() == first
    # Roving focus: arrow keys move focus without previewing; Escape discards.
    option(page, "Curve").focus()
    page.keyboard.press("ArrowRight")
    assert page.evaluate("document.activeElement.getAttribute('role')") == "option"
    assert page.locator("#preview-label").inner_text() == first
    page.keyboard.press("Escape")
    page.wait_for_function("document.querySelector('#preview-actions').hidden")
    assert source.input_value() == SOURCE

    # Accept the curve, then undo it.
    select(page, "Link")
    option(page, "Curve").click()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    accept(page, 1)
    assert "Link: spline from A.s to (0,-1.5) then to C.w ->" in source.input_value(), source.input_value()
    menu_click(page, "#undo-draft")
    page.wait_for_function("document.querySelectorAll('#queue-list li').length === 0")
    expect(source).to_have_value(SOURCE)

    # Dashed, both arrowheads and a label on one connector, each previewed and accepted.
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#diagram').classList.contains('stale')")
    select(page, "Pipe")
    page.locator(".route-styles [role=group][aria-label=Stroke]").get_by_role("button", name="Dashed").click()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    accept(page, 1)
    select(page, "Pipe")
    expect(page.locator(".route-styles [role=group][aria-label=Stroke]").get_by_role("button", name="Dashed")).to_have_attribute("aria-pressed", "true")
    option(page, "Arrows at both ends").click()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    accept(page, 2)
    select(page, "Pipe")
    page.get_by_label("Connector label").fill("retry ✓")
    page.get_by_label("Label placement").select_option("above")
    page.locator(".route-label-form").get_by_role("button", name="Add label").click()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    accept(page, 3)
    assert 'Pipe: arrow from A.e to B.w dashed <-> "retry ✓" above' in source.input_value(), source.input_value()

    # A detour clears M and keeps the endpoint reference to B.
    select(page, "Pipe")
    assert option(page, "Route above").count() == 1, page.locator(".route-styles").inner_text()
    option(page, "Route above").click()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    assert "from A.n up" in page.locator("#diff").inner_text()
    accept(page, 4)
    assert re.search(r'Pipe: arrow from A\.n up [\d.]+ then right until even with B\.n then to B\.n dashed <-> "retry ✓" above', source.input_value()), source.input_value()
    menu_click(page, "#accept")
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")

    # Phone width: the gallery wraps inside the viewport.
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(300)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), page.evaluate("[document.documentElement.scrollWidth, innerWidth]")
    assert not errors, errors
    browser.close()
    print("PASS: gallery thumbnails, preview, [ ] cycling, roving focus, escape, accept curve, undo, dashed, <->, label, detour, phone width")
