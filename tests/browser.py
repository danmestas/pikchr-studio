from playwright.sync_api import sync_playwright
from browser_helpers import prepare_legacy, object_button, open_example, open_document_menu, show_source

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790")
    prepare_legacy(page)
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    source = page.locator("#source")
    original = source.input_value()
    object_button(page, "Database").click()
    assert "Placement suggestions available" in page.locator("#inspector").inner_text()
    assert page.locator(".studio-overlay circle").count() >= 4
    page.locator("#diagram").focus()
    page.keyboard.press("ArrowDown")
    page.wait_for_function("!document.querySelector('#accept').disabled")
    assert page.locator("#diagram svg").count() == 1
    assert source.input_value() != original
    assert source.get_attribute("readonly") is not None
    assert page.locator("#queue-list li").count() == 1
    page.locator("#accept").click()
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    changed = source.input_value()
    assert changed != original
    assert changed.startswith(original.split("Database:")[0])
    page.locator("#canvas-undo").click()
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    assert source.input_value() == original
    page.locator("#canvas-redo").click()
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    assert source.input_value() == changed
    # Actual pointer gesture on renderer-emitted SVG group.
    shape = page.locator('#diagram [data-pikchr-id="o2"] text')
    shape.scroll_into_view_if_needed()
    box = shape.bounding_box()
    page.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
    page.mouse.down()
    page.mouse.move(box["x"] + 45, box["y"] + 65, steps=5)
    page.mouse.up()
    # Drags preview ranked candidates first; nothing is queued until accepted.
    page.wait_for_function("!document.querySelector('#preview-actions').hidden")
    assert source.input_value() == changed, "preview must not touch the source"
    assert page.locator('#suggestions [role=option]').count() >= 1
    page.keyboard.press("]")
    page.locator("#preview-accept").click()
    page.wait_for_function("!document.querySelector('#accept').disabled")
    page.locator("#cancel").click()
    assert source.input_value() == changed
    # Reconnect either end through the compass controls and actual SVG handles.
    object_button(page, "arrow o4").click()
    page.get_by_role("button", name="Endpoints", exact=True).click()
    assert page.get_by_label("Endpoint target", exact=True).input_value() == "o2"
    page.get_by_label("Endpoint target", exact=True).select_option("o3")
    page.get_by_role("button", name="Connect to North", exact=True).click()
    page.wait_for_function("!document.querySelector('#accept').disabled")
    assert source.input_value() != changed
    assert "arrow from Client.e to Database.n" in source.input_value()
    page.locator("#accept").click()
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    assert "arrow from Client.e to Database.n" in source.input_value()
    assert page.locator(".arrow-editor").count() == 1
    page.locator("#canvas-undo").click()
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    assert source.input_value() == changed
    object_button(page, "arrow o4").click()
    handle = page.get_by_role("button", name="Drag arrowhead endpoint", exact=True)
    handle.scroll_into_view_if_needed()
    start = handle.bounding_box()
    page.mouse.move(start["x"] + start["width"]/2, start["y"] + start["height"]/2)
    page.mouse.down()
    end = page.locator('[data-anchor="Database.s"]').bounding_box()
    page.mouse.move(end["x"] + end["width"]/2, end["y"] + end["height"]/2, steps=10)
    page.mouse.up()
    page.wait_for_function("!document.querySelector('#accept').disabled")
    assert "Database.s" in page.locator("#diff").inner_text()
    page.locator("#cancel").click()
    assert source.input_value() == changed
    # Route presets, actual lane drag, keyboard bend edit, and reconnecting a route.
    route_source = 'A: box "A" at (0,0)\nB: box "B" at (3,-2)\narrow from A.e to B.w\n'
    source.fill(route_source)
    open_document_menu(page)
    page.locator("#render").click()
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    object_button(page, "arrow o3").click()
    page.get_by_role("button", name="Routing", exact=True).click()
    page.get_by_role("button", name="Horizontal first", exact=True).click()
    page.wait_for_function("!document.querySelector('#accept').disabled")
    assert source.input_value() != route_source
    assert "then to B.w" in source.input_value()
    assert "then to B.w" in page.locator("#diff").inner_text()
    page.locator("#accept").click()
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    assert page.get_by_role("button", name="Routing", exact=True).get_attribute("aria-pressed") == "true"
    routed = source.input_value()
    handle = page.get_by_role("button", name="Drag route segment 1", exact=True)
    handle.scroll_into_view_if_needed()
    handle.scroll_into_view_if_needed()
    box = handle.bounding_box()
    page.mouse.move(box["x"]+box["width"]/2, box["y"]+box["height"]/2)
    page.mouse.down()
    page.mouse.move(box["x"]+box["width"]/2, box["y"]+70, steps=8)
    assert page.locator(".route-ghost").get_attribute("points")
    page.mouse.up()
    page.wait_for_function("!document.querySelector('#accept').disabled")
    assert source.input_value() != routed
    page.locator("#accept").click()
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    lane = source.input_value()
    assert lane != routed
    page.get_by_role("button", name="Replace route through bend 1", exact=True).focus()
    page.keyboard.press("ArrowRight")
    page.wait_for_function("!document.querySelector('#accept').disabled")
    page.locator("#cancel").click()
    assert source.input_value() == lane
    page.get_by_role("button", name="Endpoints", exact=True).click()
    page.get_by_role("button", name="Connect to North", exact=True).click()
    page.wait_for_function("!document.querySelector('#accept').disabled")
    page.locator("#accept").click()
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    assert "B.n" in source.input_value() and "then to" in source.input_value()
    page.locator("#canvas-undo").click()
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    assert source.input_value() == lane
    page.set_viewport_size({"width":390,"height":844})
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    page.set_viewport_size({"width":1440,"height":1000})
    open_document_menu(page)
    assert page.locator('.arrow-editor').count() == 1
    page.get_by_role("button", name="Routing", exact=True).click()
    page.screenshot(path="/tmp/pikchr-routing.png", full_page=True)
    # Moving one literal bend preserves every other route clause.
    literal_route = 'A: box "A" at (0,0)\nB: box "B" at (3,-2)\narrow from A.e to (1, 0) then to (1, -2) then to B.w\n'
    show_source(page)
    source.fill(literal_route)
    open_document_menu(page)
    page.locator("#render").click()
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    object_button(page, "arrow o3").click()
    page.get_by_role("button", name="Drag bend 1", exact=True).focus()
    page.keyboard.press("ArrowRight")
    page.wait_for_function("!document.querySelector('#accept').disabled")
    assert source.input_value() == literal_route.replace('(1, 0)', '(1.1, 0)')
    assert page.locator("#diff").inner_text() == '- (1, 0)\n+ (1.1, 0)'
    page.locator("#accept").click()
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    assert source.input_value() == literal_route.replace('(1, 0)', '(1.1, 0)')
    assert page.get_by_role("button", name="Drag bend 2", exact=True).is_visible()
    # Invalid manual edits revoke existing edit authority.
    source.fill("invalid syntax here")
    open_document_menu(page)
    page.locator("#render").click()
    page.wait_for_function("document.querySelector('#diagnostic').textContent.length > 0")
    assert page.locator("#diagram.stale").count() == 1
    assert page.locator("#accept").is_disabled()
    open_example(page, 'unicode')
    prepare_legacy(page)
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    object_button(page, "Store").click()
    page.locator("#diagram").focus()
    page.keyboard.press("ArrowDown")
    page.wait_for_function("!document.querySelector('#accept').disabled")
    page.locator("#accept").click()
    page.wait_for_function("!document.querySelector('#source').readOnly && !document.querySelector('#queue-list li')")
    assert "Café ☕" in source.input_value() and "資料" in source.input_value()
    open_example(page, 'nested')
    prepare_legacy(page)
    page.wait_for_function("!document.querySelector('#diagram').classList.contains('stale')")
    page.locator("#objects button").first.click()
    assert "Placement suggestions available" not in page.locator("#inspector").inner_text()
    source.fill("# Empty diagram")
    open_document_menu(page)
    page.locator("#render").click()
    page.wait_for_function("document.querySelector('#state').textContent === 'Valid empty diagram.'")
    assert page.locator("#objects button").count() == 0
    page.set_viewport_size({"width":390,"height":844})
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    assert not errors, errors
    browser.close()
    print("PASS: inspection, anchors, keyboard/pointer movement, accept, cancel, undo/redo, stale errors, Unicode, nested read-only, empty source, mobile")
