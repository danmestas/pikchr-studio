"""Canvas-first layout: floating chrome, contextual toolbar, drag-to-connect,
source drawer, no refusal right after typing, and a phone viewport."""
from playwright.sync_api import sync_playwright, expect
import os
STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")

URL = STUDIO + "/index.html"
CENTER = """name=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);const p=pikchrStudio.modelToScreen(o.center);return {x:p.x,y:p.y}}"""
TOP = """name=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);const p=pikchrStudio.modelToScreen({x:o.center.x,y:o.bbox.y+o.bbox.height});return p.y}"""
DOT = """([name,anchor])=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);const d=document.querySelector(`.cl-dots .cl-dot[data-id="${o.id}"][data-anchor="${anchor}"]`);if(!d)return null;const r=d.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}"""


def rendered(page):
    page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'")


def drag(page, start, end, steps=8):
    page.mouse.move(start["x"], start["y"])
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(start["x"] + (end["x"] - start["x"]) * i / steps, start["y"] + (end["y"] - start["y"]) * i / steps)
        page.wait_for_timeout(40)
    page.wait_for_timeout(250)
    page.mouse.up()


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    rendered(page)
    original = page.locator("#source").input_value()

    # Full-viewport canvas with the palette floating at the top.
    assert "layout-canvas" in page.evaluate("document.body.className")
    box = page.locator("#diagram").bounding_box()
    assert box["width"] == 1400 and box["height"] == 900, box
    palette = page.get_by_role("toolbar", name="Tools")
    assert palette.is_visible() and palette.bounding_box()["y"] < 40
    for name in ["Select", "Select area", "Pan", "Box", "Circle", "Cylinder", "Diamond", "Text", "Arrow", "Line"]:
        assert palette.get_by_role("button", name=name, exact=True).is_visible(), name
    names = palette.get_by_role("button").evaluate_all("bs=>bs.filter(b=>b.offsetParent).map(b=>b.getAttribute('aria-label'))")
    assert names[:3] == ["Select", "Select area", "Pan"], "Select area sits right after Select: " + str(names)
    assert names.index("Adding shapes") == names.index("Diamond") + 1, "the chevron follows the shape tools: " + str(names)
    for name, letter in [("Select", "V"), ("Select area", "M"), ("Pan", "H"), ("Box", "B"), ("Circle", "C"), ("Cylinder", "D"), ("Diamond", "R"), ("Text", "T"), ("Arrow", "A"), ("Line", "L")]:
        button = palette.get_by_role("button", name=name, exact=True)
        assert button.get_attribute("data-key") == letter and button.get_attribute("title").endswith("(" + letter + ")"), (name, letter)
    assert palette.locator(".tool-options").count() == 0, "tool options live in the Adding shapes popover"
    assert not page.locator("#multi-select").is_visible(), "Select multiple is a touch-only palette toggle"
    # Icons are drawn, never typed: no glyph characters inside the palette, doc chip or zoom chip.
    for chip in [".cl-palette", ".cl-doc", ".cl-zoom"]:
        assert page.locator(chip + " button svg").count() >= 3, chip
        text = page.locator(chip).evaluate("e=>[...e.querySelectorAll('button')].map(b=>b.textContent.trim()).join('')")
        assert all(c.isalnum() or c in " %" for c in text), (chip, text)
    # M, R and / are shortcuts when focus is not in a text field.
    page.locator("#diagram").focus()
    page.keyboard.press("m")
    expect(palette.get_by_role("button", name="Select area", exact=True)).to_have_attribute("aria-pressed", "true")
    page.keyboard.press("r")
    expect(palette.get_by_role("button", name="Diamond", exact=True)).to_have_attribute("aria-pressed", "true")
    assert page.evaluate("document.querySelector('.active-shape-kind select').value") == "diamond"
    page.keyboard.press("d")
    assert page.evaluate("document.querySelector('.active-shape-kind select').value") == "cylinder", "D stays Cylinder"
    page.keyboard.press("v")
    page.keyboard.press("/")
    expect(page.locator(".cl-more")).to_be_visible()
    expect(page.locator("#object-search")).to_be_focused()
    page.keyboard.type("/")
    assert page.locator("#object-search").input_value() == "/", "/ inside a text field types normally"
    page.keyboard.press("Escape")
    expect(page.locator(".cl-more")).to_be_hidden()
    page.locator("#diagram").focus()
    # Find object and Focus selection sit beside Fit.
    zoom = page.locator(".cl-zoom")
    assert zoom.get_by_role("button", name="Find object").get_attribute("title") == "Find object (/)"
    assert zoom.get_by_role("button", name="Focus selection").get_attribute("title") == "Focus selection (F)"
    assert zoom.get_by_role("button", name="Focus selection").is_disabled()
    zoom.get_by_role("button", name="Find object").click()
    expect(page.locator(".cl-view-objects")).to_be_visible()
    page.keyboard.press("Escape")
    # Adding shapes popover holds the placement options.
    palette.get_by_role("button", name="Adding shapes").click()
    adding = page.locator(".cl-adding")
    expect(adding).to_be_visible()
    for text in ["Place at view center", "Add by coordinates", "Add connected shape", "Keep adding"]:
        assert adding.get_by_text(text).count() >= 1, text
    assert adding.get_by_label("Direction").count() == 1
    page.keyboard.press("Escape")
    expect(adding).to_be_hidden()
    # Changes stay out of reach until something is queued or queue mode is on.
    summary = page.locator(".cl-status .cl-summary")
    assert summary.is_disabled() and page.locator(".cl-changes").is_hidden()
    # Compact status chip; the long status text is not inside it.
    assert page.locator(".cl-status .cl-summary").inner_text() == "Rendered"
    assert page.locator(".cl-status #state").count() == 0
    # Natural size: a small diagram is never upscaled on load.
    assert page.locator("#zoom-level").inner_text() == "100%"
    scale = page.evaluate("(()=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name==='API');const a=pikchrStudio.modelToScreen({x:o.bbox.x,y:0}),b=pikchrStudio.modelToScreen({x:o.bbox.x+o.bbox.width,y:0});return (b.x-a.x)/(o.bbox.width*s.scene.transform.a)})()")
    assert abs(scale - 1) < 0.01, scale

    # Selecting a shape shows the contextual toolbar just above it.
    api = page.evaluate(CENTER, "API")
    page.mouse.click(api["x"], api["y"])
    context = page.get_by_role("toolbar", name="Selection actions")
    context.wait_for(state="visible")
    ctx = context.bounding_box()
    top = page.evaluate(TOP, "API")
    assert ctx["y"] + ctx["height"] <= top and top - (ctx["y"] + ctx["height"]) < 40, (ctx, top)
    assert context.get_by_role("button", name="Edit label").is_visible()
    assert context.get_by_role("button", name="Delete").is_visible()
    # Selection is accent ink on the shape, not a dashed box; dots sit on the edges.
    assert page.evaluate("document.querySelector('#diagram [data-pikchr-id].cl-selected')!==null")
    assert page.evaluate("[...document.querySelectorAll('.studio-overlay:not(.preview-overlay)>rect')].every(r=>getComputedStyle(r).display==='none')")
    page.wait_for_function("document.querySelector('.cl-dots .cl-dot')")
    on_edge = page.evaluate("""(()=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name==='API');const p=pikchrStudio.modelToScreen(o.anchors.e);const d=document.querySelector(`.cl-dots .cl-dot[data-id="${o.id}"][data-anchor="e"]`).getBoundingClientRect();return Math.hypot(d.x+d.width/2-p.x,d.y+d.height/2-p.y)})()""")
    assert on_edge < 1.5, on_edge

    # Drag from API's bottom dot onto Database: one connector, facing side.
    page.mouse.move(api["x"] + 3, api["y"] + 3)
    page.wait_for_function("document.querySelector('.cl-dots .cl-dot')")
    dot = page.evaluate(DOT, ["API", "s"])
    database = page.evaluate(CENTER, "Database")
    page.mouse.move(dot["x"], dot["y"])
    page.mouse.down()
    for i in range(1, 9):
        page.mouse.move(dot["x"] + (database["x"] - dot["x"]) * i / 8, dot["y"] + (database["y"] - dot["y"]) * i / 8)
        page.wait_for_timeout(40)
    page.wait_for_function("document.querySelector('.cl-badge')?.textContent==='API.s → Database.w'")
    page.wait_for_function("!!document.querySelector('#diagram .cl-rubber path.cl-rubber-line')")
    assert page.evaluate("!!document.querySelector('#diagram [data-pikchr-id].cl-target-shape')")
    assert page.locator("#source").input_value() == original, "source must not change during the drag"
    page.mouse.up()
    page.wait_for_function("document.querySelector('#source').value.includes('Link1: arrow from API.s to Database.w')")
    # Changes apply immediately; undo is the safety net.
    rendered(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("orig=>document.querySelector('#source').value===orig", arg=original)
    rendered(page)

    # Escape cancels a connect drag; nothing changes.
    api = page.evaluate(CENTER, "API")
    page.mouse.click(api["x"], api["y"])
    page.wait_for_function("document.querySelector('.cl-dots .cl-dot')")
    dot = page.evaluate(DOT, ["API", "s"])
    database = page.evaluate(CENTER, "Database")
    page.mouse.move(dot["x"], dot["y"])
    page.mouse.down()
    page.mouse.move(database["x"], database["y"], steps=6)
    page.wait_for_function("!!document.querySelector('#diagram .cl-rubber')")
    page.keyboard.press("Escape")
    page.mouse.up()
    page.wait_for_timeout(400)
    assert page.locator("#source").input_value() == original
    assert not page.evaluate("!!document.querySelector('#diagram .cl-rubber')")

    # Drag from a dot to empty canvas: a new matching shape plus a connector.
    database = page.evaluate(CENTER, "Database")
    page.mouse.click(database["x"], database["y"])
    page.wait_for_function("document.querySelector('.cl-dots .cl-dot')")
    dot = page.evaluate(DOT, ["Database", "s"])
    drag(page, dot, {"x": dot["x"], "y": dot["y"] + 220})
    page.wait_for_function("document.querySelector('#source').value.includes('Link1: arrow from Database.s to Shape1.n')")
    assert "Shape1: cylinder" in page.locator("#source").input_value()
    rendered(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("orig=>document.querySelector('#source').value===orig", arg=original)
    rendered(page)

    # S toggles the source drawer from the canvas; Escape inside closes it.
    page.locator("#diagram").focus()
    page.keyboard.press("s")
    page.wait_for_function("document.querySelector('.cl-drawer').classList.contains('open')")
    page.locator("#source").wait_for(state="visible")
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('.cl-drawer').classList.contains('open')")
    page.locator("#diagram").focus()
    page.keyboard.press("s")
    page.wait_for_function("document.querySelector('.cl-drawer').classList.contains('open')")

    # Typing then dragging at once renders first and lets the drag proceed.
    page.locator("#source").fill(original.replace('API: box "API" at (2,0)', 'API: box "API" at (2,0.25)'))
    database = page.evaluate(CENTER, "Database")
    drag(page, database, {"x": database["x"], "y": database["y"] + 120})
    # The drop applies directly: no preview chip, Database's placement changed.
    page.wait_for_function("!/Database: cylinder \"Database\" at \\(4,0\\)/.test(document.querySelector('#source').value)")
    assert "Render to update" not in page.locator("#state").inner_text()
    assert page.locator("#preview-actions").is_hidden()
    rendered(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("/Database: cylinder \"Database\" at \\(4,0\\)/.test(document.querySelector('#source').value)")
    rendered(page)
    page.wait_for_function("pikchrStudio.state().valid")

    # Queue mode keeps the ranked preview. Clicking the canvas during a
    # preview both dismisses it and selects.
    page.evaluate("(()=>{const a=document.getElementById('auto-apply');a.checked=false;a.dispatchEvent(new Event('change'))})()")
    database = page.evaluate(CENTER, "Database")
    drag(page, database, {"x": database["x"], "y": database["y"] + 120})
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    api = page.evaluate(CENTER, "API")
    page.mouse.click(api["x"], api["y"])
    page.wait_for_function("document.querySelector('#preview-actions').hidden")
    page.wait_for_function("pikchrStudio.state().object?.name==='API'")
    page.evaluate("(()=>{const a=document.getElementById('auto-apply');a.checked=true;a.dispatchEvent(new Event('change'))})()")
    assert not errors, errors

    # Dark scheme: dark canvas, Pikchr draws light ink; exports stay light.
    page.emulate_media(color_scheme="dark")
    page.wait_for_function("document.body.classList.contains('cl-dark')")
    page.wait_for_function("(document.querySelector('#diagram svg [data-pikchr-id] path')?.getAttribute('style')||'').includes('rgb(255,255,255)')")
    assert page.evaluate("getComputedStyle(document.querySelector('#diagram')).backgroundColor") != "rgb(255, 255, 255)"
    page.emulate_media(color_scheme="light")
    page.wait_for_function("!document.body.classList.contains('cl-dark')")
    page.wait_for_function("(document.querySelector('#diagram svg [data-pikchr-id] path')?.getAttribute('style')||'').includes('rgb(0,0,0)')")

    # Phone: palette at the bottom, no horizontal scroll.
    phone = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    phone.goto(URL)
    rendered(phone)
    assert not phone.evaluate("document.documentElement.scrollWidth > innerWidth")
    bar = phone.get_by_role("toolbar", name="Tools").bounding_box()
    assert bar["y"] + bar["height"] > 780 and bar["x"] >= 0 and bar["x"] + bar["width"] <= 390, bar
    for selector in [".cl-doc", ".cl-status", ".cl-history", ".cl-zoom"]:
        r = phone.locator(selector).bounding_box()
        assert r["x"] >= 0 and r["x"] + r["width"] <= 390, (selector, r)
    # The ☰ menu is flat sections, fits the viewport, and closes on Escape.
    phone.get_by_role("button", name="Menu", exact=True).click()
    menu = phone.locator(".cl-menu")
    expect(menu).to_be_visible()
    titles = menu.locator(".cl-section:visible > .cl-section-title").all_inner_texts()
    assert [t.strip().lower() for t in titles] == ["document", "preferences"], titles
    assert menu.locator("details.canvas-view-options:visible, details.draft-toolbar:visible").count() == 0
    for id_ in ["#auto-apply", "#anchors", "#snap-resize", "#choose-example", "#advanced-mode"]:
        assert menu.locator(id_).count() == 1, id_
    for id_ in ["#accept", "#cancel", "#undo-draft", "#multi-select", "#clear-selection", "#mobile-objects", "#focus-selection"]:
        assert menu.locator(id_).count() == 0, id_ + " left the menu"
    # Touch screens get Select multiple in the palette.
    assert phone.evaluate("matchMedia('(pointer: coarse)').matches")
    assert phone.locator(".cl-palette #multi-select").is_visible()
    box = menu.bounding_box()
    assert box["y"] >= 0 and box["y"] + box["height"] <= 844 and box["x"] + box["width"] <= 390, box
    phone.keyboard.press("Escape")
    expect(menu).to_be_hidden()
    browser.close()
    print("PASS: canvas layout chrome, contextual toolbar, drag-to-connect to shape and empty canvas, source drawer shortcut, render-on-press after typing, preview click-through, phone layout")
