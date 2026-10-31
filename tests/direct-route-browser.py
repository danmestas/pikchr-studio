"""Route opens visible visual choices, including for arcs and curves."""
import os
from playwright.sync_api import sync_playwright, expect
from browser_helpers import object_button, set_source, close_popovers

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
BASE = 'A: box "Alpha" at (0,0)\nB: box "Beta" at (3,0)\n'

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    for width, scheme in ((1440, "light"), (390, "dark")):
        context = browser.new_context(viewport={"width": width, "height": 900}, color_scheme=scheme)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(STUDIO + "/")

        def route():
            object_button(page, "Link").click()
            close_popovers(page)
            button = page.locator("#route-selected")
            expect(button).to_be_visible()
            expect(button).to_be_enabled()
            button.click()
            first = page.locator(".route-style-option").first
            expect(first).to_be_visible()
            expect(first).to_be_focused()
            panel = page.locator(".cl-more").bounding_box()
            tile = first.bounding_box()
            assert panel and tile and tile["y"] >= panel["y"] and tile["y"] + tile["height"] <= panel["y"] + panel["height"], (panel, tile)
            heading = page.locator(".inspector-routes > summary").bounding_box()
            header = page.locator(".cl-more .cl-popover-head").bounding_box()
            assert heading and header and heading["y"] >= header["y"] + header["height"], (heading, header)
            assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")

        # Open immediately on an uncached, slower render rather than waiting
        # for the choices before clicking the control we are testing.
        cdp = context.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        crowded = BASE + ''.join(f'Extra{i}: box "{i}" at ({i % 6},{-3-i // 6})\n' for i in range(18))
        set_source(page, crowded + 'Link: arrow from A.e to B.w\n')
        route()
        close_popovers(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})

        for statement, label, kind in (
            ('Link: arrow from A.e to B.w\n', "Arc clockwise", "arc"),
            ('Link: arrow from A.s to (0,-1.5) then to B.s\n', "Curve", "spline"),
        ):
            original = BASE + statement
            set_source(page, original)
            route()
            page.locator(".route-styles").get_by_role("option", name=label, exact=True).click()
            chip = page.locator("#preview-actions").bounding_box()
            panel = page.locator(".cl-more").bounding_box()
            assert chip and panel and (chip["x"] + chip["width"] <= panel["x"] or panel["x"] + panel["width"] <= chip["x"] or chip["y"] + chip["height"] <= panel["y"] or panel["y"] + panel["height"] <= chip["y"]), (chip, panel)
            page.locator("#preview-accept").click()
            page.wait_for_function("kind => document.querySelector('#source').value.includes('Link: ' + kind + ' ') && document.querySelector('#save-state').dataset.state === 'saved'", arg=kind)
            changed = page.locator("#source").input_value()
            route()
            assert page.locator("#source").input_value() == changed
            close_popovers(page)
            page.locator("#canvas-undo").click()
            page.wait_for_function("text => document.querySelector('#source').value === text && document.querySelector('#save-state').dataset.state === 'saved'", arg=original)
        assert not errors, errors
        context.close()
    browser.close()
    print("PASS: Route opens focused visible choices for straight, arc and curve connectors; exact Undo; light/desktop and dark/phone")
