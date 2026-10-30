"""Default-mode group editing: Select multiple and Clear are in the ☰ menu,
the selected count stays visible, and ⋯ offers a labelled Group section with
nudge and Arrange. The inspector states the group, never one object's fields.
Runs on the plain URL with no Advanced tools.
"""
import os
import re
from browser_helpers import object_button, open_document_menu, close_popovers, open_more, reveal, set_source
from playwright.sync_api import sync_playwright, expect

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
URL = STUDIO + "/"
BASE = 'A: box "Alpha" at (0,0)\nB: box "Beta" at (3,-1)\nC: box "Gamma" at (6,-2)\nLink: arrow from A.e to B.w\n'
CENTER = """name=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);const p=pikchrStudio.modelToScreen(o.center);return {x:p.x,y:p.y}}"""


def xy(text, name):
    match = re.search(r'^' + name + r':.*?at\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)', text, re.M)
    assert match, text
    return tuple(map(float, match.groups()))


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)

    def rendered():
        page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'")

    def click(name):
        point = page.evaluate(CENTER, name)
        page.mouse.click(point["x"], point["y"])

    def changed(before):
        page.wait_for_function("old => document.querySelector('#source').value !== old", arg=before)
        rendered()

    def undo():
        page.locator("#canvas-undo").click()
        rendered()

    def select_two():
        click("A")
        open_document_menu(page)
        page.locator(".cl-menu #multi-select").click()
        close_popovers(page)
        click("B")
        page.wait_for_function("document.body.classList.contains('has-multiple')")
        assert page.locator("#selection-count").inner_text() == "2 selected"
        assert page.locator("#selection-count").is_visible()

    rendered()
    assert "advanced" not in (page.evaluate("document.body.className") or "")
    set_source(page, BASE)
    rendered()

    # Select multiple lives in the basic ☰ menu, so it is reachable with no
    # selection and needs no modifier key.
    open_document_menu(page)
    assert page.locator(".cl-menu #multi-select").count() == 1
    close_popovers(page)
    select_two()

    # ⋯ states the group and offers its actions; no single-object inspector.
    open_more(page)
    expect(page.locator(".cl-more .cl-more-title")).to_have_text("2 selected")
    group = page.locator(".cl-more .cl-group")
    expect(group).to_be_visible()
    assert group.get_by_role("button", name="Move selection right").is_visible()
    assert group.get_by_role("combobox", name="Arrange selected objects").is_visible()
    assert group.get_by_role("button", name="Arrange", exact=True).is_visible()
    inspector = page.locator("#inspector")
    expect(inspector).to_contain_text("2 objects selected")
    assert inspector.locator("dt", has_text="Name").count() == 0
    assert page.locator(".cl-more .cl-label-options").is_hidden()
    assert page.locator(".cl-textbar").is_hidden()
    assert page.locator(".cl-context #edit-selected").is_hidden()
    assert page.locator(".cl-context .cl-endpoint-action").first.is_hidden()

    # Group nudge: exact equal deltas, untouched third shape, connectors stay.
    group.get_by_role("button", name="Move selection right").click()
    changed(BASE)
    moved = page.locator("#source").input_value()
    assert abs(xy(moved, "A")[0] - 0.1) < 1e-6 and abs(xy(moved, "A")[1]) < 1e-6, moved
    assert abs(xy(moved, "B")[0] - 3.1) < 1e-6 and abs(xy(moved, "B")[1] + 1) < 1e-6, moved
    assert xy(moved, "C") == xy(BASE, "C")
    assert "arrow from A.e to B.w" in moved
    undo()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=BASE)
    assert page.locator("#selection-count").inner_text() == "2 selected"

    # Arrange is a basic tool and undoable as one change.
    reveal(page, "#layout-mode").select_option("align-y")
    reveal(page, "#arrange").click()
    changed(BASE)
    aligned = page.locator("#source").input_value()
    assert xy(aligned, "A")[1] == xy(aligned, "B")[1]
    assert xy(aligned, "C") == xy(BASE, "C")
    undo()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=BASE)

    # Clear leaves group mode.
    reveal(page, "#clear-selection").click()
    page.wait_for_function("!document.body.classList.contains('has-multiple')")
    assert page.locator("#selection-count").inner_text() == "No selection"

    # A group mixing a shape and a connector offers no single-object connector
    # actions: Reverse and Reconnect would edit only the last-clicked
    # connector, and the sizing hint addresses one object. These controls live
    # in the canvas-context dock inside ⋯, not in .cl-context.
    open_document_menu(page)
    page.locator(".cl-menu #multi-select").click()
    close_popovers(page)
    object_button(page, "A").click()
    object_button(page, "Link").click()
    page.wait_for_function("document.body.classList.contains('has-multiple')")
    assert page.locator("#selection-count").inner_text() == "2 selected"
    open_more(page)
    expect(page.locator(".cl-more .cl-more-title")).to_have_text("2 selected")
    expect(page.locator(".cl-more .cl-group")).to_be_visible()
    dock = page.locator(".cl-more .canvas-context-dock")
    expect(dock).to_be_hidden()
    for name in ("Reverse direction", "Reconnect start", "Reconnect end"):
        expect(page.locator(".cl-more button", has_text=re.compile(r"^" + name + r"$"))).to_be_hidden()
    expect(page.locator(".cl-more .context-hint")).to_be_hidden()
    assert page.locator("#source").input_value() == BASE
    close_popovers(page)

    # The same connector alone keeps its actions, and they act on it.
    reveal(page, "#clear-selection").click()
    page.wait_for_function("document.querySelector('#selection-count').textContent==='No selection'")
    object_button(page, "Link").click()
    page.wait_for_function("document.querySelector('#selection-count').textContent==='1 selected'")
    open_more(page)
    expect(dock).to_be_visible()
    expect(page.locator(".cl-more .context-hint")).to_be_hidden()
    reverse = page.get_by_role("button", name="Reverse direction", exact=True)
    expect(reverse).to_be_visible()
    expect(reverse).to_be_enabled()
    for name in ("Reconnect start", "Reconnect end"):
        expect(page.get_by_role("button", name=name, exact=True)).to_be_visible()
    reverse.click()
    changed(BASE)
    reversed_source = page.locator("#source").input_value()
    assert "Link: arrow from B.w to A.e" in reversed_source, reversed_source
    undo()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=BASE)
    reveal(page, "#clear-selection").click()
    page.wait_for_function("document.querySelector('#selection-count').textContent==='No selection'")

    # Phone width: the group section is reachable inside the viewport, and the
    # page never scrolls sideways.
    page.set_viewport_size({"width": 390, "height": 844})
    open_document_menu(page)
    page.locator(".cl-menu #multi-select").click()
    close_popovers(page)
    object_button(page, "A").click()
    object_button(page, "B").click()
    page.wait_for_function("document.body.classList.contains('has-multiple')")
    open_more(page)
    move = page.locator(".cl-more .cl-group").get_by_role("button", name="Move selection right")
    expect(move).to_be_visible()
    box = move.bounding_box()
    assert box and box["x"] >= 0 and box["x"] + box["width"] <= 390, box
    assert page.locator(".cl-group #layout-mode").is_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), "phone layout overflows horizontally"
    assert not page.evaluate("document.querySelector('.cl-context').scrollWidth > innerWidth")

    # Dark theme keeps the same controls reachable and legible.
    page.emulate_media(color_scheme="dark")
    page.wait_for_function("document.body.classList.contains('cl-dark')")
    rendered()
    open_more(page)
    expect(page.locator(".cl-more .cl-group")).to_be_visible()
    assert page.evaluate("getComputedStyle(document.querySelector('.cl-more')).backgroundColor") not in ("rgba(0, 0, 0, 0)", "transparent")
    assert page.locator("#selection-count").is_visible()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")

    assert not errors, errors
    browser.close()
    print("PASS: basic-mode Select multiple/Clear, visible count, group inspector, group nudge and arrange with undo, phone and dark layouts")
