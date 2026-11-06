"""Editing semantics: labelled macro detach, macro refusals that name the way
out, Enter/Escape agreeing with the shortcuts panel, named apply toasts, one
pressed connect tool, undoable Discard all, Escape in inspector fields, view
keys after a zoom click, arrows from the selection toolbar, and an invalid
source that disables editing and offers the Source drawer."""
import os
import signal
from playwright.sync_api import sync_playwright, expect
from browser_helpers import wait_rendered, set_source, hide_source, open_more, close_popovers, set_auto_apply, menu_click


def deadline(*_):
    raise TimeoutError("Editing semantics browser exceeded its 240-second deadline")


signal.signal(signal.SIGALRM, deadline)
signal.alarm(240)
BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
PLAIN = 'Client: box "Client" at (0,0)\nAPI: box "API" at (3,0)\n'


def state(page):
    return page.locator('#state')


def click_shape(page, oid):
    box = page.locator(f'#diagram [data-pikchr-id="{oid}"]').first.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def settled(page, text):
    try:
        page.wait_for_function("s=>pikchrStudio.state().source===s&&pikchrStudio.state().valid", arg=text, timeout=4000)
    except Exception:
        raise AssertionError(repr(page.evaluate("pikchrStudio.state().source")) + " != " + repr(text))
    page.wait_for_function("s=>pikchrStudio.state().source===s&&pikchrStudio.state().valid", arg=text)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE)
        wait_rendered(page)

        # 1. A labelled macro use can be detached; the label stays, so N1.e still resolves.
        macro = 'define node { box }\nN1: node\narrow\nN2: node\nline from N1.n up 0.3\n'
        set_source(page, macro)
        page.wait_for_function("pikchrStudio.state().valid")
        click_shape(page, "o1")
        page.wait_for_function("pikchrStudio.state().object?.name==='N1'")
        close_popovers(page)
        open_more(page)
        detach = page.get_by_role("button", name="Detach from macro", exact=True)
        expect(detach).to_be_enabled()
        detach_all = page.get_by_role("button", name="Detach all 2 uses", exact=True)
        assert "every use" in detach_all.get_attribute("title"), detach_all.get_attribute("title")
        detach.click()
        page.wait_for_function("!document.querySelector('#preview-actions').hidden")
        page.locator("#preview-accept").click()
        settled(page, 'define node { box }\n# detached from node\nN1: box\narrow\nN2: node\nline from N1.n up 0.3\n')
        assert page.evaluate("pikchrStudio.state().object?.name") == "N1"
        assert page.evaluate("pikchrStudio.state().object?.editable") is True

        # 2. Delete, Duplicate and Edit label on a macro shape point to Detach from macro.
        set_source(page, macro)
        page.wait_for_function("pikchrStudio.state().valid")
        click_shape(page, "o3")
        page.wait_for_function("pikchrStudio.state().object?.name==='N2'")
        close_popovers(page)
        way_out = "This shape comes from the macro node, so it can’t be {} here. Choose Detach from macro in the inspector to edit it on its own."
        page.locator("#diagram").focus()
        page.keyboard.press("Delete")
        expect(state(page)).to_have_text(way_out.format("deleted"))
        page.keyboard.press("ControlOrMeta+d")
        expect(state(page)).to_have_text(way_out.format("duplicated"))
        page.evaluate("window.pikchrStudio.editLabelDialog()")
        expect(state(page)).to_have_text(way_out.format("edited"))
        assert page.evaluate("pikchrStudio.state().source") == macro

        # 4. The status names what happened.
        set_source(page, PLAIN)
        page.wait_for_function("pikchrStudio.state().valid")
        click_shape(page, "o2")
        page.wait_for_function("pikchrStudio.state().object?.name==='API'")
        page.keyboard.press("ArrowRight")
        settled(page, PLAIN.replace("(3,0)", "(3.1, 0)"))
        expect(state(page)).to_have_text("Moved API.")
        page.keyboard.press("Delete")
        page.wait_for_function("pikchrStudio.state().source==='Client: box \"Client\" at (0,0)\\n'")
        expect(state(page)).to_have_text("Deleted API.")
        page.locator("#canvas-undo").click()
        settled(page, PLAIN.replace("(3,0)", "(3.1, 0)"))

        # 3b. Escape with nothing pending only deselects: no "Cancelled" toast.
        click_shape(page, "o1")
        page.wait_for_function("pikchrStudio.state().object?.name==='Client'")
        page.evaluate("document.querySelector('#state').textContent='marker'")
        page.keyboard.press("Escape")
        page.wait_for_function("!pikchrStudio.state().object")
        assert "Cancelled" not in state(page).inner_text(), state(page).inner_text()

        # 3c. Click a shape, ArrowRight nudges 0.1 in, in both apply modes; focus
        # left on the selection toolbar still nudges.
        base = page.evaluate("pikchrStudio.state().source")
        click_shape(page, "o1")
        page.wait_for_function("pikchrStudio.state().object?.name==='Client'")
        page.keyboard.press("ArrowRight")
        settled(page, base.replace("(0,0)", "(0.1, 0)"))
        page.locator('.cl-context [aria-label="More options"]').focus()
        page.keyboard.press("ArrowRight")
        settled(page, base.replace("(0,0)", "(0.2, 0)"))
        nudged = page.evaluate("pikchrStudio.state().source")

        # 3a / 6. Queue mode: Enter applies the queue instead of editing a label;
        # Discard all is undoable.
        set_auto_apply(page, False)
        click_shape(page, "o1")
        page.wait_for_function("pikchrStudio.state().object?.name==='Client'")
        page.keyboard.press("ArrowRight")
        page.wait_for_function("pikchrStudio.state().queued===1")
        queued = page.evaluate("pikchrStudio.state().source")
        assert queued == nudged.replace("(0.2, 0)", "(0.3, 0)"), queued
        page.keyboard.press("ArrowDown")
        page.wait_for_function("pikchrStudio.state().queued===2")
        two = page.evaluate("pikchrStudio.state().source")
        # Escape keeps the queue.
        page.keyboard.press("Escape")
        assert page.evaluate("pikchrStudio.state().queued") == 2
        menu_click(page, "#cancel")
        page.wait_for_function("pikchrStudio.state().queued===0")
        settled(page, nudged)
        expect(state(page)).to_have_text("All queued changes discarded. Undo restores them.")
        expect(page.locator("#canvas-undo")).to_be_enabled()
        page.locator("#canvas-undo").click()
        page.wait_for_function("pikchrStudio.state().queued===2")
        settled(page, two)
        click_shape(page, "o1")
        page.wait_for_function("pikchrStudio.state().object?.name==='Client'")
        page.keyboard.press("Enter")
        page.wait_for_function("pikchrStudio.state().queued===0")
        expect(state(page)).to_have_text("Applied 2 changes. Undo restores the whole batch.")
        expect(page.locator(".cl-inline-text")).to_have_count(0)
        assert page.evaluate("pikchrStudio.state().source") == two
        # With nothing pending, Enter edits the label.
        page.locator("#diagram").focus()
        page.keyboard.press("Enter")
        expect(page.locator(".cl-inline-text")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator(".cl-inline-text")).to_have_count(0)
        set_auto_apply(page, True)

        # 7. Escape in a size field reverts it; a second Escape closes the inspector.
        click_shape(page, "o2")
        page.wait_for_function("pikchrStudio.state().object?.name==='API'")
        close_popovers(page)
        open_more(page)
        width = page.get_by_label("Shape width", exact=True)
        committed = width.input_value()
        width.fill("3")
        page.keyboard.press("Escape")
        expect(width).to_have_value(committed)
        expect(page.locator(".cl-more")).to_be_visible()
        page.keyboard.press("Escape")
        expect(page.locator(".cl-more")).to_be_hidden()
        assert page.evaluate("pikchrStudio.state().source") == two

        # 5. L presses Line only; A presses Arrow only.
        page.locator("#diagram").focus()
        page.keyboard.press("l")
        pressed = "[...document.querySelectorAll('.cl-palette [aria-pressed=true]')].map(b=>b.getAttribute('aria-label'))"
        page.wait_for_function(pressed + ".join()==='Line'")
        page.keyboard.press("a")
        page.wait_for_function(pressed + ".join()==='Arrow'")
        page.keyboard.press("v")
        page.wait_for_function(pressed + ".join()==='Select'")

        # 3d. 0 fits after zooming with the + button (focus on the button).
        page.locator("#zoom-in").click()
        page.locator("#zoom-in").click()
        assert page.locator("#zoom-level").inner_text() != "100%"
        page.keyboard.press("0")
        expect(page.locator("#zoom-level")).to_have_text("100%")

        # 8. An invalid source disables editing with the reason and offers the drawer.
        click_shape(page, "o2")
        page.wait_for_function("pikchrStudio.state().object?.name==='API'")
        set_source(page, two + "box (\n")
        fix = "Fix the syntax error in Source (S) to edit."
        expect(page.locator("#delete-selected")).to_be_disabled()
        assert page.locator("#delete-selected").get_attribute("title") == fix
        expect(page.locator("#duplicate-selected")).to_be_disabled()
        page.locator("#diagram").focus()
        page.keyboard.press("Delete")
        expect(state(page)).to_have_text(fix)
        offer = page.get_by_role("button", name="Open Source to fix (S)", exact=True)
        expect(offer).to_be_visible()
        offer.click()
        expect(page.locator("#source")).to_be_focused()
        page.locator("#source").fill(two)
        page.wait_for_function("pikchrStudio.state().valid")
        expect(offer).to_be_hidden()
        hide_source(page)
        click_shape(page, "o2")
        page.wait_for_function("pikchrStudio.state().object?.name==='API'")
        expect(page.locator("#delete-selected")).to_be_enabled()
        assert page.locator("#delete-selected").get_attribute("title") != fix

        assert not errors, errors
        print("PASS: editing semantics")
    finally:
        browser.close()
