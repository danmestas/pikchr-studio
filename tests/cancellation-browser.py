"""Escape cancels whichever canvas gesture is live, in every route that owns one.

The same rule everywhere: Escape before a target is chosen, Escape while a
preview is showing, and an empty-canvas drop each leave the source, the undo
history and the queued changes exactly as they were; releasing the pointer
afterwards cannot apply the gesture either; and the next supported operation
still works. Covered here for a route-bend drag (the connector Routing tab),
the connect-drag gesture, and the drag-to-preview gesture, in both auto-apply
and queue review. Shape resize, marquee, endpoint and bend cancellation are
already covered by canvas-safety, endpoint-ownership, canvas-layout and
browser.py; this script asserts only the gaps those leave.
"""
import os
import re
from playwright.sync_api import sync_playwright
from browser_helpers import object_button, close_popovers, set_source, set_auto_apply, menu_click

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")

SOURCE = """A: box "A" at (0,0)
B: box "B" at (3,-2)
L: arrow from A.e to (1, 0) then to (1, -2) then to B.w
"""
PIPELINE = """Client: box "Client" at (0,0)
API: box "API" at (2,0)
Database: cylinder "Database" at (4,0)
arrow from Client.e to API.w
arrow from API.e to Database.w
"""

SCREEN = """([name,anchor])=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);
  const p=pikchrStudio.modelToScreen(anchor?o.anchors[anchor]:o.center);return {x:p.x,y:p.y}}"""


def rendered(page):
    page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'")


def origin(page, name, anchor=None):
    return page.evaluate(SCREEN, [name, anchor])


def handle_center(page, label):
    box = page.get_by_role("button", name=label, exact=True).bounding_box()
    return {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}


def show_routing(page, name="L"):
    object_button(page, name).click()
    page.get_by_role("button", name="Routing", exact=True).click()


def bend_drag(page, dx=40, dy=30, steps=6, release=True, escape=False, expect_change=False):
    handle = handle_center(page, "Drag bend 1")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(handle["x"] + dx, handle["y"] + dy, steps=steps)
    if escape:
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
    if release:
        before = page.locator("#source").input_value()
        page.mouse.up()
        # A release validates asynchronously; wait for the outcome rather than
        # for the canvas, which can be valid before the gesture is applied.
        if expect_change:
            page.wait_for_function("v=>document.querySelector('#source').value!==v", arg=before)
            page.wait_for_function("!document.querySelector('#auto-apply').disabled")
        else:
            page.wait_for_function("pikchrStudio.state().valid")


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/index.html")
    rendered(page)
    source = page.locator("#source")

    # --- 1. Escape cancels a route-bend drag before release -------------------
    # A filled bend handle drags one literal waypoint. Escape must drop the
    # gesture: the guide clears, and the release that follows applies nothing.
    set_source(page, SOURCE)
    show_routing(page)
    before = source.input_value()
    handle = handle_center(page, "Drag bend 1")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(handle["x"] + 40, handle["y"] + 30, steps=6)
    assert page.locator(".route-ghost").get_attribute("points"), "a live route drag shows its guide"
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    assert not page.locator(".route-ghost").get_attribute("points"), "Escape removes the route guide"
    page.mouse.up()
    page.wait_for_function("pikchrStudio.state().valid")
    assert source.input_value() == before, "Escape must leave the bend where it was"
    assert page.locator("#queue-list li").count() == 0, "a cancelled bend drag queues nothing"
    assert page.get_by_role("button", name="Drag bend 1", exact=True).is_visible(), \
        "the connector stays selected with its handles after the cancel"

    # The next supported operation works: the same drag, finished normally,
    # still moves the bend, and Undo restores the cancelled original.
    bend_drag(page, expect_change=True)
    assert source.input_value() != before, "a completed bend drag still applies"
    assert re.search(r"L: arrow from A\.e to \(\d+\.\d+, -?\d+\.\d+\)", source.input_value()), source.input_value()
    page.locator("#canvas-undo").click()
    page.wait_for_function("o=>document.querySelector('#source').value===o", arg=before)
    assert source.input_value() == before

    # --- 2. Movement and release after Escape cannot revive the gesture -----
    show_routing(page)
    handle = handle_center(page, "Drag bend 1")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(handle["x"] + 25, handle["y"] - 20, steps=5)
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    page.mouse.move(handle["x"] + 60, handle["y"] - 50, steps=5)
    page.mouse.up()
    page.wait_for_function("pikchrStudio.state().valid")
    assert source.input_value() == before, "movement after Escape must not revive the cancelled gesture"
    assert page.locator("#queue-list li").count() == 0

    # --- 3. Queue review: Escape cancels the pending bend drag and queues
    #        nothing; the next completed drag queues exactly one change ------
    set_auto_apply(page, False)
    close_popovers(page)
    show_routing(page)
    bend_drag(page, escape=True)
    assert source.input_value() == before, "a cancelled bend drag queues nothing in review"
    assert page.locator("#queue-list li").count() == 0
    bend_drag(page)
    page.wait_for_function("document.querySelectorAll('#queue-list li').length===1")
    menu_click(page, "#cancel")
    page.wait_for_function("document.querySelectorAll('#queue-list li').length===0")
    set_auto_apply(page, True)
    close_popovers(page)
    set_source(page, SOURCE)

    # --- 4. Connect drag: Escape before the target is chosen ----------------
    set_source(page, PIPELINE)
    close_popovers(page)
    page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Arrow", exact=True).click()
    start = origin(page, "API", "s")
    page.mouse.move(start["x"], start["y"])
    page.mouse.down()
    page.mouse.move(start["x"] + 60, start["y"] + 40, steps=5)
    page.keyboard.press("Escape")
    target = origin(page, "Database", "n")
    page.mouse.move(target["x"], target["y"], steps=6)
    page.mouse.up()
    page.wait_for_function("pikchrStudio.state().valid")
    assert source.input_value() == PIPELINE, "Escape before choosing a target creates no connector"
    assert page.evaluate("pikchrStudio.state().scene.objects.length") == 5

    # --- 5. Reconnect on empty canvas: the drop creates nothing -------------
    close_popovers(page)
    object_button(page, "arrow o4").click()
    page.get_by_role("button", name="Endpoints", exact=True).click()
    handle = handle_center(page, "Drag arrowhead endpoint")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(300, 800, steps=6)
    page.mouse.up()
    page.wait_for_timeout(300)
    assert source.input_value() == PIPELINE, "an empty-canvas reconnect drop changes nothing"
    assert page.evaluate("pikchrStudio.state().scene.objects.length") == 5, \
        "an empty-canvas reconnect drop creates nothing"

    # --- 6. Drag-to-preview: Escape keeps the original; the next drag works --
    # The Arrow tool stays armed after a cancelled connect, so put it away the
    # way a person does before dragging a shape.
    close_popovers(page)
    page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Select", exact=True).click()
    set_auto_apply(page, False)
    close_popovers(page)
    db = origin(page, "Database")
    page.mouse.move(db["x"], db["y"])
    page.mouse.down()
    page.mouse.move(db["x"], db["y"] + 120, steps=8)
    page.mouse.up()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    previewed = source.input_value()
    page.locator("#diagram").focus()
    page.keyboard.press("Escape")
    page.wait_for_function("document.querySelector('#preview-actions').hidden")
    assert source.input_value() == previewed, "Escape discards the preview and keeps the original"
    assert page.locator("#queue-list li").count() == 0
    # The next drag still previews; accepting it is what queues.
    db = origin(page, "Database")
    page.mouse.move(db["x"], db["y"])
    page.mouse.down()
    page.mouse.move(db["x"], db["y"] + 120, steps=8)
    page.mouse.up()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    page.locator("#preview-accept").click()
    page.wait_for_function("document.querySelectorAll('#queue-list li').length===1")
    menu_click(page, "#cancel")
    page.wait_for_function("document.querySelectorAll('#queue-list li').length===0")

    assert not errors, errors
    browser.close()
    print("PASS: Escape cancels route-bend, connect and preview gestures and their release, empty-canvas reconnect drops create nothing, and the next gesture still works in auto-apply and review")
