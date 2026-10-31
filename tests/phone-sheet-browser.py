"""At phone width the inspector is a bottom sheet: 45% tall, handle drags it to 90%, selection stays visible."""
import os
from playwright.sync_api import sync_playwright, expect
from browser_helpers import wait_rendered, set_source, open_more, close_popovers

BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/") + "/"
SOURCE = 'A: box "High" at (0,0)\nB: box "Low" at (0,-5)\n'


def rect(page, selector):
    return page.evaluate("s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom}}", selector)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    errors = []
    phone = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    phone.on("pageerror", lambda error: errors.append(str(error)))
    phone.goto(BASE)
    wait_rendered(phone)
    set_source(phone, SOURCE)
    phone.wait_for_function("window.pikchrStudio.state().valid")
    # Fit, then zoom out twice: the view kept from the previous document is
    # arbitrary and can leave B under the bottom palette, where no tap reaches
    # it. This leaves B low, clear of the bottom chrome, and short enough to fit
    # above the sheet at 90%.
    phone.locator("#fit-view").tap()
    phone.locator("#zoom-out").tap()
    phone.locator("#zoom-out").tap()
    low = '#diagram [data-pikchr-id="o2"]'
    phone.locator(low).tap()
    phone.wait_for_function("window.pikchrStudio.state().selectedIds.length === 1")
    before = rect(phone, low)
    assert before["b"] > 844 * .55, before   # without the pan, the sheet would cover it
    undo_chip, zoom_chip = rect(phone, ".cl-history"), rect(phone, ".cl-zoom")
    assert undo_chip["x"] + undo_chip["w"] <= zoom_chip["x"], (undo_chip, zoom_chip)   # undo/redo and zoom never overlap

    open_more(phone)
    sheet = rect(phone, ".cl-more")
    assert abs(sheet["x"]) < .5 and abs(sheet["w"] - 390) < .5, sheet
    assert abs(sheet["b"] - 844) < .5, sheet
    assert abs(sheet["h"] - 844 * .45) < 2, sheet
    for chip in (".cl-history", ".cl-zoom"):   # undo and zoom stay above the open sheet
        box = rect(phone, chip)
        assert box["b"] <= sheet["y"] + .5 and box["y"] > 60, (chip, box, sheet)
    radii = phone.evaluate("(()=>{const s=getComputedStyle(document.querySelector('.cl-more'));return [s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius]})()")
    assert radii[0] != "0px" and radii[1] != "0px" and radii[2] == "0px" and radii[3] == "0px", radii
    handle = phone.get_by_role("button", name="Resize inspector")
    expect(handle).to_be_visible()
    grab = rect(phone, ".cl-grab")
    assert grab["y"] >= sheet["y"] - .5 and grab["y"] + grab["h"] <= sheet["y"] + 40, (grab, sheet)

    # The canvas panned so the selected object sits above the sheet.
    phone.wait_for_function("s=>document.querySelector(s).getBoundingClientRect().bottom <= document.querySelector('.cl-more').getBoundingClientRect().top", arg=low)
    after = rect(phone, low)
    assert after["y"] >= 0 and after["b"] <= sheet["y"], (after, sheet)

    # Dragging the handle up expands the sheet to about 90%.
    cx, cy = grab["x"] + grab["w"] / 2, grab["y"] + grab["h"] / 2
    phone.mouse.move(cx, cy)
    phone.mouse.down()
    phone.mouse.move(cx, cy - 150, steps=6)
    phone.mouse.move(cx, cy - 400, steps=6)
    phone.mouse.up()
    phone.wait_for_function("Math.abs(document.querySelector('.cl-more').getBoundingClientRect().height - innerHeight*.9) < 3")
    tall = rect(phone, ".cl-more")
    assert abs(tall["b"] - 844) < .5 and abs(tall["y"] - 844 * .1) < 3, tall
    assert handle.get_attribute("aria-expanded") == "true"
    # No room above a 90% sheet: undo and zoom hide rather than sit under it.
    for chip in (".cl-history", ".cl-zoom"):
        expect(phone.locator(chip)).to_be_hidden()
    # The selection follows: it is still above the taller sheet.
    phone.wait_for_function("s=>{const b=document.querySelector(s).getBoundingClientRect();return b.top>=0&&b.bottom<=document.querySelector('.cl-more').getBoundingClientRect().top}", arg=low)

    # A short drag snaps back; tapping the handle toggles between the two heights.
    phone.mouse.move(cx, tall["y"] + 12)
    phone.mouse.down()
    phone.mouse.move(cx, tall["y"] + 300, steps=6)
    phone.mouse.up()
    phone.wait_for_function("Math.abs(document.querySelector('.cl-more').getBoundingClientRect().height - innerHeight*.45) < 3")
    for chip in (".cl-history", ".cl-zoom"):   # back above the 45% sheet
        expect(phone.locator(chip)).to_be_visible()
        phone.wait_for_function("c=>document.querySelector(c).getBoundingClientRect().bottom <= document.querySelector('.cl-more').getBoundingClientRect().top + .5", arg=chip)
    handle.click()
    phone.wait_for_function("Math.abs(document.querySelector('.cl-more').getBoundingClientRect().height - innerHeight*.9) < 3")
    handle.click()
    phone.wait_for_function("Math.abs(document.querySelector('.cl-more').getBoundingClientRect().height - innerHeight*.45) < 3")
    assert not phone.evaluate("document.documentElement.scrollWidth > innerWidth")

    # Reopening starts at 45% again, whatever the last height was.
    handle.click()
    phone.wait_for_function("Math.abs(document.querySelector('.cl-more').getBoundingClientRect().height - innerHeight*.9) < 3")
    phone.get_by_role("button", name="Close inspector").click()
    expect(phone.locator(".cl-more")).to_be_hidden()
    open_more(phone)
    phone.wait_for_function("Math.abs(document.querySelector('.cl-more').getBoundingClientRect().height - innerHeight*.45) < 3")

    # Desktop keeps the floating popover: no handle, inset from the right edge.
    desktop = browser.new_page(viewport={"width": 1440, "height": 900})
    desktop.on("pageerror", lambda error: errors.append(str(error)))
    desktop.goto(BASE)
    wait_rendered(desktop)
    set_source(desktop, SOURCE)
    desktop.locator('#diagram [data-pikchr-id="o1"]').click()
    open_more(desktop)
    box = rect(desktop, ".cl-more")
    assert box["x"] + box["w"] <= 1440 - 8 and box["b"] < 900 - 8 and box["y"] > 40, box
    assert desktop.get_by_role("button", name="Resize inspector").is_hidden()
    assert not errors, errors
    browser.close()
    print("PASS: phone inspector bottom sheet at 390x844 (45%, rounded top, handle drag to 90%, selection panned into view); desktop unchanged")
