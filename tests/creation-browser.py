import re
from browser_helpers import open_more, prepare_legacy, object_button, shape_option, open_document_menu, show_source, hide_source, reveal, set_source, render_source, open_menu_details, close_popovers, menu_click
from playwright.sync_api import sync_playwright


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/?advanced=1")
    prepare_legacy(page)
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    source = page.locator("#source")

    def rendered():
        page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")

    def applied():
        page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")

    def open_details(title):
        open_menu_details(page, title)

    def ready_preview(before):
        page.wait_for_function("!document.querySelector('#accept').disabled")
        assert source.input_value() != before, "Validated changes must update draft source"
        assert source.get_attribute("readonly") is not None
        assert page.locator("#queue-list li").count() == 1
        assert page.locator("#diagram svg").count() == 1

    set_source(page, "# Café ☕ and 資料\n")
    rendered()
    kinds = ["box", "circle", "ellipse", "oval", "cylinder", "diamond"]
    for index, kind in enumerate(kinds):
        open_details("Add shape")
        page.locator("#creation-tools").get_by_role("combobox", name="Shape", exact=True).select_option(kind)
        page.get_by_label("Label", exact=True).fill("資料 ☕ " + kind)
        page.get_by_label("X (inches)", exact=True).fill(str(index % 3 * 2))
        page.get_by_label("Y (inches)", exact=True).fill(str(-(index // 3) * 2))
        before = source.input_value()
        page.get_by_role("button", name="Add shape", exact=True).click()
        ready_preview(before)
        menu_click(page, "#accept")
        page.wait_for_function("document.querySelectorAll('#objects button').length === " + str(index + 1))
        applied()
        assert f'Shape{index + 1}: {kind} "資料 ☕ {kind}"' in source.input_value(), source.input_value()
        assert 'fit' in source.input_value().splitlines()[-1], source.input_value()
        open_more(page)
        assert page.get_by_role("combobox", name="Shape type", exact=True).input_value() == kind
        assert page.locator("#diagram svg").count() == 1
        sizes = page.locator(f'#diagram [data-pikchr-id="o{index + 1}"]').evaluate("""group => {
          const text = group.querySelector('text').getBoundingClientRect();
          const outline = group.querySelector('path,circle,ellipse,polygon,rect').getBoundingClientRect();
          return {textWidth:text.width, textHeight:text.height, width:outline.width, height:outline.height};
        }""")
        # Native renderer font measurement is approximate, especially for Unicode.
        assert sizes["textWidth"] <= sizes["width"] * 1.35 + 4, (kind, sizes)
        assert sizes["textHeight"] <= sizes["height"] + 4, (kind, sizes)

    # Newly created circles support the same keyboard movement workflow as boxes.
    object_button(page, "Shape2").click()
    before_move = source.input_value()
    page.locator("#diagram").focus()
    page.keyboard.press("ArrowDown")
    ready_preview(before_move)
    menu_click(page, "#accept")
    applied()
    assert source.input_value() != before_move
    assert 'circle "資料 ☕ circle"' in source.input_value()
    object_button(page, "Shape6").click()

    # Conversion preserves the label, placement, and selected object's identity.
    before = source.input_value()
    page.get_by_role("combobox", name="Shape type", exact=True).select_option("box")
    page.get_by_role("button", name="Change shape type", exact=True).click()
    ready_preview(before)
    menu_click(page, "#accept")
    applied()
    statement = next(line for line in source.input_value().splitlines() if line.startswith('Shape6:'))
    assert statement.startswith('Shape6: box "資料 ☕ diamond"') and 'fit' in statement and 'at (4, -2)' in statement, statement
    open_more(page)
    assert page.get_by_role("combobox", name="Shape type", exact=True).input_value() == "box"

    # Connect two newly created native shapes using the actual controls.
    open_details("Add connector")
    shape_option(page, "From shape", "Shape2")
    shape_option(page, "To shape", "Shape5")
    page.get_by_role("combobox", name="From anchor", exact=True).select_option("s")
    page.get_by_role("combobox", name="To anchor", exact=True).select_option("n")
    page.get_by_role("combobox", name="Connector", exact=True).select_option("arrow")
    before_connector = source.input_value()
    page.get_by_role("button", name="Add connector", exact=True).click()
    ready_preview(before_connector)
    menu_click(page, "#accept")
    page.wait_for_function("document.querySelectorAll('#objects button').length === 7")
    applied()
    connected = source.input_value()
    assert "Link1: arrow from Shape2.s to Shape5.n" in connected
    assert page.locator(".arrow-editor").count() == 1
    page.locator("#canvas-undo").click()
    rendered()
    assert source.input_value() == before_connector
    page.locator("#canvas-redo").click()
    rendered()
    assert source.input_value() == connected

    # Expanded creation controls must fit a narrow viewport.
    open_details("Add shape")
    open_details("Add connector")
    page.set_viewport_size({"width": 390, "height": 844})
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth"), "Mobile horizontal overflow"
    page.set_viewport_size({"width": 1440, "height": 1000})
    page.screenshot(path="/tmp/pikchr-creation.png", full_page=True)

    # Stale and invalid source must never create a proposal from old geometry.
    show_source(page)
    source.fill(connected + "# unrendered change\n")
    stale = source.input_value()
    hide_source(page)
    open_details("Add shape")
    page.get_by_role("button", name="Add shape", exact=True).click()
    assert page.locator("#accept").is_disabled()
    assert source.input_value() == stale
    assert "Render the current source" in page.locator(".creation-error").inner_text()
    set_source(page, "invalid syntax here")
    page.wait_for_function("document.querySelector('#diagnostic').textContent.length > 0")
    open_details("Add shape")
    page.get_by_role("button", name="Add shape", exact=True).click()
    assert page.locator("#accept").is_disabled()
    assert source.input_value() == "invalid syntax here"
    assert "Render the current source" in page.locator(".creation-error").inner_text()

    # Pointer deltas stay in model inches after responsive layout and CSS zoom.
    # The one-inch native box gives an independent CSS-pixel/inch measurement.
    coordinate_source = 'Negative: box "N" width 1 height 1 at (-2, -1)\nOther: box "O" at (1, 1)\n'
    for viewport, zoom in [({"width": 1180, "height": 900}, 1.25), ({"width": 650, "height": 900}, 0.8)]:
        set_source(page, coordinate_source)
        rendered()
        close_popovers(page)
        page.set_viewport_size(viewport)
        page.evaluate("value => document.body.style.zoom = value", str(zoom))
        shape = page.locator('#diagram [data-pikchr-id="o1"]')
        shape.scroll_into_view_if_needed()
        bounds = shape.locator("path").first.bounding_box()
        x, y = bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2
        # The press must land on the shape, not on a drawer or popover over it.
        hide_source(page)
        hit = page.evaluate("([x,y]) => document.elementFromPoint(x,y)?.closest('[data-pikchr-id]')?.getAttribute('data-pikchr-id')", [x, y])
        assert hit == "o1", ("press point is covered", viewport, zoom, hit)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + bounds["width"] * 0.5, y + bounds["height"] * 0.3, steps=8)
        page.mouse.up()
        # A drag previews ranked source edits; accepting the top one queues it.
        page.wait_for_function("!document.querySelector('#preview-actions').hidden")
        page.locator("#preview-accept").click()
        ready_preview(coordinate_source)
        menu_click(page, "#accept")
        applied()
        position = re.search(r'Negative:.*?at\s*\(\s*([\d.+-]+),\s*([\d.+-]+)\)', source.input_value())
        assert position, source.input_value()
        actual_x, actual_y = map(float, position.groups())
        assert abs(actual_x - (-1.5)) <= 0.1, (viewport, zoom, actual_x)
        assert abs(actual_y - (-1.3)) <= 0.1, (viewport, zoom, actual_y)
    page.evaluate("document.body.style.zoom = '1'")
    assert not errors, errors
    browser.close()
    print("PASS: six fitted native shapes, live draft, conversion, connector, undo/redo, Unicode, stale/invalid source, mobile controls, negative-coordinate pointer fidelity at two viewport/zoom settings")
