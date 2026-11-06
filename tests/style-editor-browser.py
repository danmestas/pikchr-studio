"""The inspector's Style section: colour swatches, custom colours, thickness
presets. Every change goes through the validated propose path at once (no
Update button), respects queue mode, and refusals show next to the control."""
import os
from browser_helpers import set_source, set_auto_apply, inspector_section, close_popovers, open_more
from playwright.sync_api import sync_playwright, expect

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
SOURCE = 'A: box "A" at (0,0)\nB: box "B" at (2,0)\nE: arrow from A.e to B.w\n'


def src(page):
    return page.locator("#source").input_value()


def line(page, index):
    return src(page).split("\n")[index]


def settled(page):
    page.wait_for_function("pikchrStudio.state().valid&&!document.getElementById('diagram').classList.contains('stale')")


def select(page, name):
    close_popovers(page)
    p = page.evaluate("n=>{const o=pikchrStudio.state().scene.objects.find(o=>o.name===n);const q=pikchrStudio.modelToScreen(o.kind==='arrow'?o.path[0]:o.center);return {x:q.x,y:q.y,arrow:o.kind==='arrow',end:o.kind==='arrow'?pikchrStudio.modelToScreen(o.path.at(-1)):null}}", name)
    if p["arrow"]:
        p = {"x": (p["x"] + p["end"]["x"]) / 2, "y": p["y"]}
    page.mouse.click(p["x"], p["y"])
    page.wait_for_function("n=>pikchrStudio.state().object?.name===n", arg=name)


def style(page):
    return inspector_section(page, "Style")


def wait_line(page, index, text):
    page.wait_for_function("([i,t])=>document.getElementById('source').value.split('\\n')[i]===t", arg=[index, text])
    settled(page)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/index.html")
    set_auto_apply(page, True)
    set_source(page, SOURCE)
    settled(page)
    select(page, "A")
    section = style(page)

    # No Update button; current values are visible.
    expect(section.get_by_role("button", name="Update style")).to_have_count(0)
    fill = section.get_by_role("group", name="Fill", exact=True)
    ink = section.get_by_role("group", name="Line & text", exact=True)
    weight = section.get_by_role("group", name="Thickness presets", exact=True)
    expect(fill.get_by_role("button", name="Fill none", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(ink.get_by_role("button", name="Line & text black", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(weight.get_by_role("button", name="Normal", exact=True)).to_have_attribute("aria-pressed", "true")
    thickness = section.get_by_label("Thickness in inches", exact=True)
    assert thickness.input_value() == "" and thickness.get_attribute("placeholder") == "0.015", thickness.get_attribute("placeholder")
    expect(section.locator(".style-unit")).to_contain_text("in")
    expect(section).to_contain_text("outline and label")

    # Nothing changes until a value changes.
    before = src(page)
    fill.get_by_role("button", name="Fill none", exact=True).click()
    ink.get_by_role("button", name="Line & text black", exact=True).click()
    weight.get_by_role("button", name="Normal", exact=True).click()
    thickness.fill("")
    thickness.press("Enter")
    page.wait_for_timeout(400)
    assert src(page) == before, src(page)

    # Swatch: applied at once, then shown as the current value.
    fill.get_by_role("button", name="Fill aliceblue", exact=True).click()
    wait_line(page, 0, 'A: box "A" at (0,0) fill aliceblue')
    section = style(page)
    expect(section.get_by_role("group", name="Fill", exact=True).get_by_role("button", name="Fill aliceblue", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(section.locator("summary .style-preview")).to_be_visible()

    # Custom colour typed as hex.
    section.get_by_role("button", name="Custom line & text colour", exact=True).click()
    value = section.get_by_label("Line & text colour value", exact=True)
    expect(value).to_be_visible()
    value.fill("#1A7F37")
    value.press("Enter")
    wait_line(page, 0, 'A: box "A" at (0,0) fill aliceblue color 0x1a7f37')
    section = style(page)
    # A colour outside the palette shows as Custom with its value.
    expect(section.get_by_role("button", name="Custom line & text colour", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(section.get_by_label("Line & text colour value", exact=True)).to_have_value("#1a7f37")
    expect(section.get_by_label("Line & text colour picker", exact=True)).to_have_value("#1a7f37")

    # Custom colour from the picker.
    section.get_by_label("Line & text colour picker", exact=True).fill("#123456")
    wait_line(page, 0, 'A: box "A" at (0,0) fill aliceblue color 0x123456')

    # Invalid custom colour: inline error, no change.
    section = style(page)
    before = src(page)
    section.get_by_role("button", name="Custom fill colour", exact=True).click()
    value = section.get_by_label("Fill colour value", exact=True)
    value.fill("notacolour")
    value.press("Enter")
    error = section.locator(".style-error:visible")
    expect(error).to_have_count(1)
    expect(error).to_contain_text("colour name Pikchr knows")
    expect(value).to_have_attribute("aria-invalid", "true")
    page.wait_for_timeout(300)
    assert src(page) == before
    # A named colour typed in is accepted.
    value.fill("Lavender")
    value.press("Enter")
    wait_line(page, 0, 'A: box "A" at (0,0) color 0x123456 fill lavender')

    # Thickness presets and the numeric field (inches, as Pikchr reads it).
    section = style(page)
    section.get_by_role("group", name="Thickness presets", exact=True).get_by_role("button", name="Thick", exact=True).click()
    wait_line(page, 0, 'A: box "A" at (0,0) color 0x123456 fill lavender thick')
    section = style(page)
    expect(section.get_by_role("group", name="Thickness presets", exact=True).get_by_role("button", name="Thick", exact=True)).to_have_attribute("aria-pressed", "true")
    thickness = section.get_by_label("Thickness in inches", exact=True)
    expect(thickness).to_have_value("0.0225")
    thickness.fill("0.02")
    thickness.press("Enter")
    wait_line(page, 0, 'A: box "A" at (0,0) color 0x123456 fill lavender thickness 0.02')
    # Normal removes the property, so Pikchr's default applies again.
    section = style(page)
    section.get_by_role("group", name="Thickness presets", exact=True).get_by_role("button", name="Normal", exact=True).click()
    wait_line(page, 0, 'A: box "A" at (0,0) color 0x123456 fill lavender')
    section = style(page)
    section.get_by_label("Thickness in inches", exact=True).fill("0.02")
    section.get_by_label("Thickness in inches", exact=True).press("Enter")
    wait_line(page, 0, 'A: box "A" at (0,0) color 0x123456 fill lavender thickness 0.02')
    section = style(page)
    thickness = section.get_by_label("Thickness in inches", exact=True)
    thickness.fill("-1")
    thickness.press("Enter")
    expect(section.locator(".style-error:visible")).to_contain_text("greater than zero")
    page.wait_for_timeout(300)
    assert line(page, 0).endswith("thickness 0.02")

    # Connectors: no fill, the same colour and thickness controls.
    select(page, "E")
    section = style(page)
    expect(section.get_by_role("group", name="Fill", exact=True)).to_have_count(0)
    section.get_by_role("group", name="Line & text", exact=True).get_by_role("button", name="Line & text firebrick", exact=True).click()
    wait_line(page, 2, "E: arrow from A.e to B.w color firebrick")
    section = style(page)
    section.get_by_role("group", name="Thickness presets", exact=True).get_by_role("button", name="Thin", exact=True).click()
    wait_line(page, 2, "E: arrow from A.e to B.w color firebrick thin")
    # The connector slot keeps its own controls, without a second colour or weight picker.
    section = style(page)
    expect(section.locator(".connector-style-slot")).to_have_count(1)
    expect(section.get_by_label("Connector colour", exact=True)).to_have_count(0)
    expect(section.get_by_role("group", name="Weight", exact=True)).to_have_count(0)
    expect(section.get_by_role("group", name="Stroke", exact=True)).to_have_count(1)

    # Any Pikchr colour keeps the connector's own controls (stroke, chop,
    # label, suggested routes) and further Style changes working.
    def connector_controls():
        section = style(page)
        expect(section.get_by_role("group", name="Stroke", exact=True)).to_have_count(1)
        expect(section.get_by_role("group", name="Ends", exact=True)).to_have_count(1)
        expect(section.get_by_label("Connector label", exact=True)).to_have_count(1)
        expect(page.locator("#inspector .inspector-routes")).to_have_count(1)
        return section
    section = connector_controls()
    section.get_by_role("button", name="Line & text saddlebrown", exact=True).click()
    wait_line(page, 2, "E: arrow from A.e to B.w color saddlebrown thin")
    section = connector_controls()
    section.get_by_role("button", name="Custom line & text colour", exact=True).click()
    value = section.get_by_label("Line & text colour value", exact=True)
    value.fill("darkred")
    value.press("Enter")
    wait_line(page, 2, "E: arrow from A.e to B.w color darkred thin")
    section = connector_controls()
    # The same colour from the picker (#8b0000) is a no-op, not a rewrite.
    section.get_by_label("Line & text colour picker", exact=True).fill("#8b0000")
    page.wait_for_timeout(400)
    assert line(page, 2) == "E: arrow from A.e to B.w color darkred thin", line(page, 2)
    section.get_by_label("Line & text colour value", exact=True).fill("#1A7F37")
    section.get_by_label("Line & text colour value", exact=True).press("Enter")
    wait_line(page, 2, "E: arrow from A.e to B.w color 0x1a7f37 thin")
    section = connector_controls()
    section.get_by_role("button", name="Line & text firebrick", exact=True).click()
    wait_line(page, 2, "E: arrow from A.e to B.w color firebrick thin")
    connector_controls()

    # A thick connector shows Thick, and Normal makes it normal again.
    set_source(page, SOURCE.replace("E: arrow from A.e to B.w", "E: arrow from A.e to B.w thick"))
    settled(page)
    select(page, "E")
    section = style(page)
    presets = section.get_by_role("group", name="Thickness presets", exact=True)
    expect(presets.get_by_role("button", name="Thick", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(presets.get_by_role("button", name="Normal", exact=True)).to_have_attribute("aria-pressed", "false")
    expect(section.get_by_label("Thickness in inches", exact=True)).to_have_value("0.0225")
    presets.get_by_role("button", name="Normal", exact=True).click()
    wait_line(page, 2, "E: arrow from A.e to B.w")
    section = style(page)
    expect(section.get_by_role("group", name="Thickness presets", exact=True).get_by_role("button", name="Normal", exact=True)).to_have_attribute("aria-pressed", "true")

    # Readability: a custom ink that is hard to read on the fill warns (never
    # blocks); a readable one does not. Swatches paint Pikchr's dark colour.
    set_source(page, SOURCE.replace('B: box "B" at (2,0)', 'B: box "B" at (2,0) fill white'))
    settled(page)
    select(page, "B")
    section = style(page)
    section.get_by_role("button", name="Custom line & text colour", exact=True).click()
    value = section.get_by_label("Line & text colour value", exact=True)
    value.fill("orange")
    value.press("Enter")
    wait_line(page, 1, 'B: box "B" at (2,0) fill white color orange')
    section = style(page)
    warning = section.locator(".style-warning:visible")
    expect(warning).to_have_count(1)
    expect(warning).to_contain_text("Hard to read in light mode")
    value = section.get_by_label("Line & text colour value", exact=True)
    value.fill("black")
    value.press("Enter")
    wait_line(page, 1, 'B: box "B" at (2,0) fill white color black')
    expect(style(page).locator(".style-warning:visible")).to_have_count(0)
    # The palette never warns; a dark custom fill under black ink fails in both themes.
    section = style(page)
    section.get_by_role("button", name="Line & text black", exact=True).click()
    wait_line(page, 1, 'B: box "B" at (2,0) fill white color black')
    expect(style(page).locator(".style-warning:visible")).to_have_count(0)
    section = style(page)
    section.get_by_role("button", name="Custom fill colour", exact=True).click()
    section.get_by_label("Fill colour value", exact=True).fill("#101010")
    section.get_by_label("Fill colour value", exact=True).press("Enter")
    wait_line(page, 1, 'B: box "B" at (2,0) color black fill 0x101010')
    warning = style(page).locator(".style-warning:visible")
    expect(warning).to_have_count(1)
    expect(warning).to_contain_text("light mode")
    expect(warning).to_contain_text("dark mode")
    section = style(page)
    section.get_by_role("group", name="Fill", exact=True).get_by_role("button", name="Fill white", exact=True).click()
    wait_line(page, 1, 'B: box "B" at (2,0) color black fill white')

    # Dark theme: the white fill swatch shows the near-black the canvas draws.
    swatch = lambda: style(page).get_by_role("button", name="Fill white", exact=True)
    light_colour = swatch().evaluate("e=>getComputedStyle(e).backgroundColor")
    assert light_colour == "rgb(255, 255, 255)", light_colour
    page.emulate_media(color_scheme="dark")
    page.wait_for_function("document.body.classList.contains('cl-dark')")
    settled(page)
    page.wait_for_function("""()=>{const e=[...document.querySelectorAll('#inspector .style-swatch')].find(b=>b.getAttribute('aria-label')==='Fill white');return e&&getComputedStyle(e).backgroundColor==='rgb(0, 0, 0)'}""")
    page.emulate_media(color_scheme="light")
    page.wait_for_function("!document.body.classList.contains('cl-dark')")
    settled(page)
    page.wait_for_function("""()=>{const e=[...document.querySelectorAll('#inspector .style-swatch')].find(b=>b.getAttribute('aria-label')==='Fill white');return e&&getComputedStyle(e).backgroundColor==='rgb(255, 255, 255)'}""")

    set_source(page, SOURCE)
    settled(page)

    # Queue mode: the change waits in the queue like other inspector edits.
    set_auto_apply(page, False)
    select(page, "B")
    section = style(page)
    section.get_by_role("group", name="Fill", exact=True).get_by_role("button", name="Fill lightyellow", exact=True).click()
    page.wait_for_function("document.querySelectorAll('#queue-list li').length===1")
    assert line(page, 1) == 'B: box "B" at (2,0) fill lightyellow', line(page, 1)
    close_popovers(page)
    page.locator(".cl-status").get_by_role("button", name="Discard", exact=True).click()
    page.wait_for_function("document.querySelectorAll('#queue-list li').length===0")
    assert line(page, 1) == 'B: box "B" at (2,0)'
    set_auto_apply(page, True)

    # Phone bottom sheet: the section fits 360px without sideways scrolling.
    phone = browser.new_page(viewport={"width": 360, "height": 740}, is_mobile=True, has_touch=True)
    phone.on("pageerror", lambda error: errors.append(str(error)))
    phone.goto(STUDIO + "/index.html")
    set_source(phone, SOURCE)
    settled(phone)
    phone.evaluate("pikchrStudio.select('o1')")
    phone.wait_for_function("pikchrStudio.state().object?.name==='A'")
    open_more(phone)
    section = inspector_section(phone, "Style")
    overflow = phone.evaluate("""()=>{const s=document.querySelector('#inspector .appearance-editor');const m=document.querySelector('.cl-more');
      const r=s.getBoundingClientRect();return {sw:s.scrollWidth,cw:s.clientWidth,right:r.right,vw:innerWidth,msw:m.scrollWidth,mcw:m.clientWidth}}""")
    assert overflow["sw"] <= overflow["cw"] + 1 and overflow["right"] <= overflow["vw"] and overflow["msw"] <= overflow["mcw"] + 1, overflow

    assert not errors, errors
    browser.close()
print("style-editor-browser: ok")
