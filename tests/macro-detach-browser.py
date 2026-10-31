"""Detach from macro: preview, Escape keeps the source, accept inlines one use
(or every use) and leaves the define byte-identical."""
import os
import signal
from playwright.sync_api import sync_playwright, expect
from browser_helpers import wait_rendered, set_source, object_button, open_more, close_popovers


def deadline(*_):
    raise TimeoutError("Macro detach browser exceeded its 240-second deadline")


signal.signal(signal.SIGALRM, deadline)
signal.alarm(240)
BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
DEFINE = 'define tile { $1: box $2 at $3 }\n'
SOURCE = DEFINE + 'tile(A, "One", (0,0))\ntile(B, "Two", (2,0))\n'
MACRO = "Macro-expanded object"


def select_shape(page, name):
    object_button(page, name).first.click()
    page.wait_for_function("n=>pikchrStudio.state().object?.name===n", arg=name)
    close_popovers(page)
    open_more(page)


def preview(page, button):
    page.get_by_role("button", name=button, exact=True).click()
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    assert page.locator("#source").input_value() == SOURCE, "preview must not modify the source"


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE)
        wait_rendered(page)
        set_source(page, SOURCE)
        page.wait_for_function("pikchrStudio.state().valid")
        select_shape(page, "B")
        expect(page.locator("#inspector")).to_contain_text("This shape comes from the macro tile, which other shapes may share. Detach it to edit it on its own.")
        expect(page.get_by_role("button", name="Detach all 2 uses", exact=True)).to_be_visible()

        # Escape discards the preview: nothing applies.
        preview(page, "Detach from macro")
        assert "# detached from tile" in page.locator("#diff").inner_text()
        page.keyboard.press("Escape")
        page.wait_for_function("document.querySelector('#preview-actions').hidden")
        page.wait_for_function("pikchrStudio.state().valid")
        assert page.locator("#source").input_value() == SOURCE

        # Accept inlines only B's use.
        select_shape(page, "B")
        preview(page, "Detach from macro")
        page.locator("#preview-accept").click()
        detached = DEFINE + 'tile(A, "One", (0,0))\n# detached from tile\nB: box "Two" at (2,0)\n'
        page.wait_for_function("s=>pikchrStudio.state().source===s&&pikchrStudio.state().valid", arg=detached)
        assert page.evaluate("pikchrStudio.state().object?.name") == "B"
        objects = page.evaluate("pikchrStudio.state().scene.objects.map(o=>({name:o.name,editable:o.editable,reason:o.reason}))")
        assert objects[0] == {"name": "A", "editable": False, "reason": MACRO}, objects
        assert objects[1]["name"] == "B" and objects[1]["editable"] is True, objects
        assert page.locator("#source").input_value().startswith(DEFINE)
        # The detached shape now drags like any other shape.
        box = page.locator('#diagram [data-pikchr-id="o2"] path').first.bounding_box()
        close_popovers(page)
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2 + 40, box["y"] + box["height"] / 2 + 30, steps=8)
        page.mouse.up()
        page.wait_for_function("s=>pikchrStudio.state().source!==s&&pikchrStudio.state().valid", arg=detached)
        moved = page.locator("#source").input_value()
        assert moved.startswith(DEFINE + 'tile(A, "One", (0,0))\n# detached from tile\nB: box "Two" at ') and moved != detached, moved
        page.locator("#canvas-undo").click()
        page.wait_for_function("s=>pikchrStudio.state().source===s&&pikchrStudio.state().valid", arg=detached)
        # A, now the only use, offers no Detach all.
        select_shape(page, "A")
        expect(page.get_by_role("button", name="Detach from macro", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name="Detach all 2 uses", exact=True)).to_have_count(0)
        close_popovers(page)

        # Detach all inlines every use; the define stays.
        set_source(page, SOURCE)
        page.wait_for_function("pikchrStudio.state().valid")
        select_shape(page, "A")
        preview(page, "Detach all 2 uses")
        page.locator("#preview-accept").click()
        everything = DEFINE + '# detached from tile\nA: box "One" at (0,0)\n# detached from tile\nB: box "Two" at (2,0)\n'
        page.wait_for_function("s=>pikchrStudio.state().source===s&&pikchrStudio.state().valid", arg=everything)
        assert page.evaluate("pikchrStudio.state().scene.objects.every(o=>o.editable&&o.reason!=='Macro-expanded object')")
        assert page.evaluate("pikchrStudio.state().object?.name") == "A"
        assert not errors, errors
        print("macro detach browser checks passed")
    finally:
        browser.close()
