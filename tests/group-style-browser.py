"""Group style: three shapes styled together as one undoable change, a mixed
shape/connector selection limited to stroke and thickness, and an atomic
refusal that leaves the source untouched. Uses the real Select multiple menu,
canvas taps and visible ⋯ → Group controls. Desktop and phone, light and dark.
"""
import os
import re
from browser_helpers import object_button, open_document_menu, close_popovers, open_more, reveal, set_source
from playwright.sync_api import sync_playwright, expect

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
URL = STUDIO + "/"
BASE = 'A: box "Alpha" at (0,0)\nB: cylinder "Beta" at (2.5,0)\nC: box "Gamma" at (5,0)\nLink: arrow from A.e to B.w\n'
STYLED = ('A: box "Alpha" at (0,0) color 0x123456 thickness 1.5\n'
          'B: cylinder "Beta" at (2.5,0) color 0x123456 thickness 1.5\n'
          'C: box "Gamma" at (5,0) color 0x123456 thickness 1.5\n'
          'Link: arrow from A.e to B.w\n')
CENTER = """name=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);const p=pikchrStudio.modelToScreen(o.center);return {x:p.x,y:p.y}}"""


def shape_style(page, name):
    """The renderer's own drawing style, not the transient selection highlight.

    For a connector the first drawn element is the arrowhead polygon, which
    carries fill only, so the stroked geometry is found by scanning children."""
    return page.evaluate("""name=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);
      const g=document.querySelector(`#diagram [data-pikchr-id="${o.id}"]`);
      const shapes=[...g.querySelectorAll('path,polygon')];
      const stroked=shapes.find(shape=>/stroke-width/.test(shape.getAttribute('style')||''));
      const shape=stroked||shapes[0];return shape?shape.getAttribute('style'):null}""", name)


def svg_stroke(page, name):
    style = shape_style(page, name) or ""
    match = re.search(r"stroke:rgb\((\d+),(\d+),(\d+)\)", style)
    return match and "rgb(%s, %s, %s)" % match.groups()


def svg_width(page, name):
    style = shape_style(page, name) or ""
    match = re.search(r"stroke-width:([\d.]+)", style)
    return match and float(match.group(1))


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 900}, color_scheme="light")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)

    def rendered():
        # state().valid is true only when the scene matches the source text, so
        # this waits for the render rather than a chip that may still read
        # "Rendered" from the previous source.
        page.wait_for_function("()=>{const s=window.pikchrStudio&&pikchrStudio.state();"
                               "return !!(s&&s.valid&&document.querySelector('.cl-summary')?.textContent==='Rendered')}")

    def click(name):
        point = page.evaluate(CENTER, name)
        page.mouse.click(point["x"], point["y"])

    def changed(before):
        page.wait_for_function("old => document.querySelector('#source').value !== old", arg=before)
        rendered()

    def undo():
        page.locator("#canvas-undo").click()
        rendered()

    def reset_selection():
        """Clear ends both the selection and multiple-select mode."""
        reveal(page, "#clear-selection").click()
        page.wait_for_function("document.querySelector('#selection-count').textContent==='No selection'")

    def select_group(*names):
        """Clear, turn on Select multiple from ☰, then tap each named shape."""
        reset_selection()
        open_document_menu(page)
        page.locator(".cl-menu #multi-select").click()
        close_popovers(page)
        for name in names:
            click(name)
        page.wait_for_function("count => document.body.classList.contains('has-multiple') && pikchrStudio.state().selectedIds.length === count", arg=len(names))
        assert page.locator("#selection-count").inner_text() == f"{len(names)} selected"

    def open_group_style():
        open_more(page)
        group = page.locator(".cl-more .cl-group")
        expect(group).to_be_visible()
        style = group.get_by_role("button", name="Style…", exact=True)
        expect(style).to_be_visible()
        style.click()
        panel = page.locator("#inspector .group-style")
        expect(panel).to_be_visible()
        return panel

    rendered()
    set_source(page, BASE)
    rendered()
    assert page.locator("#source").input_value() == BASE

    # ---- three shapes, one atomic style change -------------------------------
    select_group("A", "B", "C")
    # Group actions advertise Style beside Move and Arrange; the inspector never
    # shows one object's fields.
    open_more(page)
    note = page.locator(".cl-more .cl-group .cl-muted").inner_text()
    assert "style every selected object" in note.lower(), note
    close_popovers(page)
    panel = open_group_style()
    assert panel.get_by_label("Stroke / text color", exact=True).is_visible()
    assert panel.get_by_label("Line thickness (pixels)", exact=True).is_visible()
    assert panel.get_by_label("Fill color", exact=True).is_visible()
    assert page.locator("#inspector dt", has_text="Name").count() == 0
    assert page.locator(".cl-more .cl-label-options").is_hidden()
    panel.get_by_label("Stroke / text color", exact=True).fill("#123456")
    panel.get_by_label("Line thickness (pixels)", exact=True).fill("1.5")
    panel.get_by_role("button", name="Style 3 objects", exact=True).click()
    changed(BASE)
    assert page.locator("#source").input_value() == STYLED, page.locator("#source").input_value()
    # Renderer, not just source: every shape takes the new stroke and width.
    for name in ("A", "B", "C"):
        assert svg_stroke(page, name) == "rgb(18, 52, 86)", (name, shape_style(page, name))
        # Pikchr draws 144 units per inch; thickness 1.5 is drawn at 216.
        assert abs(svg_width(page, name) - 1.5 * 144) < 0.01, (name, shape_style(page, name))
    # Geometry and the connector statement are untouched.
    assert page.evaluate("""()=>{const s=pikchrStudio.state();
      return s.scene.objects.map(o=>o.name+':'+o.center.x.toFixed(3)+','+o.center.y.toFixed(3)).join('|')}""") == \
        "A:0.000,0.000|B:2.500,0.000|C:5.000,0.000|Link:1.250,0.000"
    assert page.locator("#selection-count").inner_text() == "3 selected"

    # Exactly one Undo returns the whole group to its original source.
    undo()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=BASE)
    assert page.locator("#selection-count").inner_text() == "3 selected"

    # ---- mixed shape and connector: stroke/thickness, never fill ------------
    select_group("A", "Link")
    panel = open_group_style()
    assert panel.get_by_label("Stroke / text color", exact=True).is_visible()
    assert panel.get_by_label("Line thickness (pixels)", exact=True).is_visible()
    assert panel.get_by_label("Fill color", exact=True).count() == 0, "fill offered for a mixed selection"
    panel.get_by_label("Stroke / text color", exact=True).fill("#222222")
    panel.get_by_label("Line thickness (pixels)", exact=True).fill("2")
    panel.get_by_role("button", name="Style 2 objects", exact=True).click()
    changed(BASE)
    mixed = page.locator("#source").input_value()
    assert mixed == ('A: box "Alpha" at (0,0) color 0x222222 thickness 2\n'
                     'B: cylinder "Beta" at (2.5,0)\nC: box "Gamma" at (5,0)\n'
                     'Link: arrow from A.e to B.w color 0x222222 thickness 2\n'), mixed
    assert svg_stroke(page, "A") == "rgb(34, 34, 34)"
    assert svg_stroke(page, "Link") == "rgb(34, 34, 34)"
    undo()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=BASE)

    # ---- an unsupported member refuses the whole edit ----------------------
    nested = 'A: box "Alpha" at (0,0)\nG: [\n  N: box "inside"\n]\nB: box "Beta" at (4,0)\n'
    set_source(page, nested)
    rendered()
    reset_selection()
    open_document_menu(page)
    page.locator(".cl-menu #multi-select").click()
    close_popovers(page)
    object_button(page, "A").click()
    object_button(page, "N").click()
    page.wait_for_function("pikchrStudio.state().selectedIds.length === 2")
    panel = open_group_style()
    panel.get_by_label("Line thickness (pixels)", exact=True).fill("3")
    panel.get_by_role("button", name="Style 2 objects", exact=True).click()
    error = page.locator("#inspector .group-style .property-error")
    expect(error).to_contain_text("No style applied")
    expect(error).to_contain_text("N: Objects inside a group are inspect-only")
    expect(page.locator("#canvas-feedback")).to_contain_text("No style applied")
    assert page.locator("#source").input_value() == nested, "refusal changed the source"
    assert not page.evaluate("document.querySelector('#diagram').classList.contains('stale')")
    assert page.evaluate("pikchrStudio.state().queued") == 0, "refusal queued a partial change"
    close_popovers(page)

    # ---- desktop and phone, each in light and dark -------------------------
    for width, scheme in ((1440, "light"), (1440, "dark"), (390, "light"), (390, "dark")):
        page.set_viewport_size({"width": width, "height": 900 if width == 1440 else 844})
        page.emulate_media(color_scheme=scheme)
        if scheme == "dark":
            page.wait_for_function("document.body.classList.contains('cl-dark')")
        else:
            page.wait_for_function("!document.body.classList.contains('cl-dark')")
        rendered()
        set_source(page, BASE)
        rendered()
        select_group("A", "B", "C")
        panel = open_group_style()
        stroke = panel.get_by_label("Stroke / text color", exact=True)
        expect(stroke).to_be_visible()
        box = stroke.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= width, (width, scheme, box)
        button = panel.get_by_role("button", name="Style 3 objects", exact=True)
        expect(button).to_be_visible()
        assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), f"{width} {scheme} overflow"
        assert not page.evaluate("document.querySelector('.cl-more').scrollWidth > innerWidth")
        stroke.fill("#123456")
        panel.get_by_label("Line thickness (pixels)", exact=True).fill("1.5")
        button.click()
        changed(BASE)
        assert page.locator("#source").input_value() == STYLED
        # Pikchr's dark flag lightens dark ink for contrast, so the same source
        # colour draws as two different rgb values. Assert the themed value.
        expected = {"light": "rgb(18, 52, 86)", "dark": "rgb(169, 203, 237)"}[scheme]
        assert svg_stroke(page, "A") == expected, (scheme, shape_style(page, "A"))
        assert svg_stroke(page, "B") == expected, (scheme, shape_style(page, "B"))
        assert abs(svg_width(page, "B") - 1.5 * 144) < 0.01, (scheme, shape_style(page, "B"))
        undo()
        page.wait_for_function("text => document.querySelector('#source').value === text", arg=BASE)

    # ---- reload keeps the styled source ------------------------------------
    page.set_viewport_size({"width": 1440, "height": 900})
    page.emulate_media(color_scheme="light")
    select_group("A", "B", "C")
    panel = open_group_style()
    panel.get_by_label("Stroke / text color", exact=True).fill("#123456")
    panel.get_by_label("Line thickness (pixels)", exact=True).fill("1.5")
    panel.get_by_role("button", name="Style 3 objects", exact=True).click()
    changed(BASE)
    assert page.locator("#source").input_value() == STYLED
    page.reload()
    rendered()
    from browser_helpers import show_source
    show_source(page)
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=STYLED)

    assert not errors, errors
    browser.close()
    print("PASS: group style of three shapes with exact single undo, mixed stroke/thickness without fill, atomic refusal, reload persistence, desktop and phone in light and dark")
