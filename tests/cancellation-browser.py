"""Escape cancels a live route-bend drag and leaves the source and queue alone.

The route-bend drag is the regression pinned here: before this change Escape
left the drag live, so the release that followed applied the abandoned bend.
The connect-drag, empty-canvas reconnect and drag-to-preview cases are
companion checks of the same rule along the other routes that own a gesture;
canvas-layout, endpoint-ownership and preview already cover their basic
cancellation, so this script adds no claims about those beyond what it runs.

A release can start validation that settles long after the pointer lifts, so
"the source is unchanged right after the release" proves nothing on its own:
the app reports `valid` throughout that window. `settle` therefore waits for
the validation and render the release started to finish (the status text is
no longer Validating/Rendering and the diagram is valid) before any assertion,
then a real follow-up action plus one Undo or one queued entry must land
exactly on the pre-gesture source. Had the abandoned edit applied, the
assertion after `settle` sees a different source and Undo stops one step short.
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

BUSY = "^(Rendering|Validating|Source changed)"


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


def settle(page):
    """Wait for any validation or render the gesture started to finish.

    `state.valid` stays true while candidates are being validated, so it
    alone is not a boundary. The app's own status text is: it reads
    Validating/Rendering for exactly as long as that work is outstanding.
    When nothing was started (the cancel worked) this returns at once."""
    page.wait_for_function(
        "busy=>{const t=document.querySelector('#state').textContent.trim();"
        "return window.pikchrStudio.state().valid&&!new RegExp(busy).test(t)}", arg=BUSY)


def undo_once(page, expected):
    page.locator("#canvas-undo").click()
    page.wait_for_function("o=>document.querySelector('#source').value===o", arg=expected)


def bend_drag(page, dx=40, dy=30, steps=6, escape=False):
    """Drag the first bend handle. With escape, wait for the cancel itself to
    show (the guide clears) before releasing."""
    handle = handle_center(page, "Drag bend 1")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(handle["x"] + dx, handle["y"] + dy, steps=steps)
    if escape:
        page.keyboard.press("Escape")
        page.wait_for_function("!(document.querySelector('.route-ghost')?.getAttribute('points'))")
    page.mouse.up()


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
    # gesture: the guide clears, and once the release's validation has settled
    # the source is untouched. The next real drag applies, and one Undo must
    # return the original.
    set_source(page, SOURCE)
    show_routing(page)
    before = source.input_value()
    handle = handle_center(page, "Drag bend 1")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(handle["x"] + 40, handle["y"] + 30, steps=6)
    assert page.locator(".route-ghost").get_attribute("points"), "a live route drag shows its guide"
    page.keyboard.press("Escape")
    page.wait_for_function("!(document.querySelector('.route-ghost')?.getAttribute('points'))")
    assert not page.locator(".route-ghost").get_attribute("points"), "Escape removes the route guide"
    page.mouse.up()
    settle(page)
    assert source.input_value() == before, "Escape must leave the bend where it was"
    assert page.locator("#queue-list li").count() == 0, "a cancelled bend drag queues nothing"
    assert page.get_by_role("button", name="Drag bend 1", exact=True).is_visible(), \
        "the connector stays selected with its handles after the cancel"

    bend_drag(page)
    page.wait_for_function("o=>document.querySelector('#source').value!==o", arg=before)
    assert re.search(r"L: arrow from A\.e to \(\d+\.\d+, -?\d+\.\d+\)", source.input_value()), source.input_value()
    undo_once(page, before)

    # --- 2. Escape reaches every listener that is waiting for it -------------
    # The route handles listen on the window, so several live gestures share
    # one key event. A test-owned observer registered after the drag started
    # stands in for the other listeners: it must still see the Escape. The
    # connector must also stay selected, so the key cannot travel on to the
    # diagram's own Escape (which would deselect).
    show_routing(page)
    handle = handle_center(page, "Drag bend 1")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(handle["x"] + 25, handle["y"] - 20, steps=5)
    page.evaluate("()=>{window.__sawEscape=false;addEventListener('keydown',e=>{if(e.key==='Escape')window.__sawEscape=true;},true);}")
    page.keyboard.press("Escape")
    page.wait_for_function("!(document.querySelector('.route-ghost')?.getAttribute('points'))")
    assert page.evaluate("window.__sawEscape"), \
        "Escape must reach every live route listener, not just the first"
    assert page.evaluate("!!document.querySelector('.arrow-editor')"), \
        "cancelling a route drag must not deselect the connector"
    # A second Escape after the drag ended is a plain deselect; moving and
    # releasing afterwards still cannot revive the cancelled gesture.
    page.keyboard.press("Escape")
    page.mouse.move(handle["x"] + 60, handle["y"] - 50, steps=5)
    page.mouse.up()
    settle(page)
    assert source.input_value() == before, "movement after Escape must not revive the cancelled gesture"
    assert page.locator("#queue-list li").count() == 0

    # --- 3. Queue review: Escape cancels the pending bend drag and queues
    #        nothing; the next completed drag queues exactly one change ------
    set_auto_apply(page, False)
    close_popovers(page)
    show_routing(page)
    bend_drag(page, escape=True)
    settle(page)
    assert source.input_value() == before, "a cancelled bend drag queues nothing in review"
    assert page.locator("#queue-list li").count() == 0
    # One queue entry, not two, is what proves the cancelled drag never queued.
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
    settle(page)
    assert source.input_value() == PIPELINE, "Escape before choosing a target creates no connector"
    assert page.evaluate("pikchrStudio.state().scene.objects.length") == 5

    # --- 5. Reconnect on empty canvas: the drop creates nothing, and the
    #        next reconnect to a real anchor is the only change ------------
    # Put the still-armed Arrow tool away first, or the press would start a
    # new connector instead of moving the endpoint.
    close_popovers(page)
    page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Select", exact=True).click()
    close_popovers(page)
    object_button(page, "arrow o4").click()
    page.get_by_role("button", name="Endpoints", exact=True).click()
    handle = handle_center(page, "Drag arrowhead endpoint")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    page.mouse.move(300, 800, steps=6)
    page.mouse.up()
    # The drop reports its own outcome; wait for that message rather than for
    # a fixed interval.
    page.wait_for_function("document.querySelector('#state').textContent.includes('Connection unchanged')")
    settle(page)
    assert page.locator(".arrow-overlay .endpoint-handle").count() == 2
    assert source.input_value() == PIPELINE, "an empty-canvas reconnect drop changes nothing"
    assert page.evaluate("pikchrStudio.state().scene.objects.length") == 5, \
        "an empty-canvas reconnect drop creates nothing"
    # A real reconnect still works, and one undo returns the original.
    handle = handle_center(page, "Drag arrowhead endpoint")
    page.mouse.move(handle["x"], handle["y"])
    page.mouse.down()
    north = origin(page, "Database", "n")
    page.mouse.move(north["x"], north["y"], steps=6)
    page.mouse.up()
    page.wait_for_function("document.querySelector('#source').value.includes('to Database.n')")
    undo_once(page, PIPELINE)

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
    settle(page)
    assert source.input_value() == previewed, "Escape discards the preview and keeps the original"
    assert page.locator("#queue-list li").count() == 0
    # The next drag still previews; accepting it queues exactly one change.
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
    print("PASS: Escape cancels a live route-bend drag (and the other canvas gestures), reaches every live route listener without deselecting, and each release's validation settles with the source unchanged, in auto-apply and review")
