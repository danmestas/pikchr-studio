"""Inspector rows: connector titles and rows (Start/End as code, Reconnect,
Reverse, Heads, Route, then Style · Suggested routes · Advanced), the
toolbar's Reconnect Start/End, and the shape rows (Text fit, Size applied on
Enter or blur with inline rejection and Escape, Shape segments)."""
import os
import re
from playwright.sync_api import sync_playwright, expect
from browser_helpers import set_source, object_button, open_more, close_popovers, set_auto_apply, inspector_section

BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
SOURCE = """Client: box "Client" at (0,0)
API: box "API" at (2,0)
arrow from Client.e to API.w
E: arrow from Client.s down 0.5 then right 2 then to API.s
arrow from (0,2) to (1,2)
"""


def title(page):
    return page.locator(".cl-more .cl-more-title").inner_text(), page.locator(".cl-more .cl-popover-kind").inner_text()


def source(page):
    return page.locator("#source").input_value()


def changed_from(page, before):
    page.wait_for_function("s=>pikchrStudio.state().source!==s&&pikchrStudio.state().valid", arg=before)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE)
    set_auto_apply(page, True)
    set_source(page, SOURCE)

    # Titles: an unnamed connector names its kind and both attached shapes;
    # a free one is just its kind; a named object keeps name + kind.
    object_button(page, "arrow o3").click()
    open_more(page)
    expect(page.locator(".cl-more .cl-more-title")).to_have_text("Arrow · Client → API")
    assert title(page)[1] == ""
    object_button(page, "arrow o5").click()
    open_more(page)
    expect(page.locator(".cl-more .cl-more-title")).to_have_text("Arrow")
    object_button(page, "E").click()
    open_more(page)
    assert title(page) == ("E", "arrow"), title(page)

    # The toolbar offers a muted Reconnect label and Start / End buttons.
    close_popovers(page)
    context = page.locator(".cl-context")
    expect(context.locator(".cl-endpoint-label")).to_have_text("Reconnect")
    expect(context.get_by_role("button", name="Reconnect start", exact=True)).to_have_text("Start")
    expect(context.get_by_role("button", name="Reconnect end", exact=True)).to_have_text("End")
    expect(context.get_by_role("button", name=re.compile("^Change "))).to_have_count(0)

    # Connector rows, in order, with code endpoints and no Editing line.
    object_button(page, "arrow o3").click()
    open_more(page)
    inspector = page.locator("#inspector")
    order = page.evaluate("""()=>[...document.querySelector('#inspector').children].filter(e=>e.offsetParent)
      .map(e=>e.matches('.label-row')?'label':e.matches('.connector-rows')?'connector':e.matches('.cl-route-choices')?'route'
        :e.matches('.appearance-editor')?'style':e.matches('.inspector-routes-slot')?'routes':e.matches('.inspector-advanced')?'advanced':e.className)""")
    assert order == ["label", "connector", "route", "style", "routes", "advanced"], order
    rows = page.evaluate("""()=>[...document.querySelectorAll('#inspector .connector-rows > *')]
      .map(e=>e.matches('.inspector-row')?e.querySelector('.row-name').textContent:e.textContent.trim())""")
    assert rows == ["Start", "End", "Reverse direction", "Heads"], rows
    expect(inspector.locator(".label-row")).to_contain_text("None")
    expect(inspector.locator(".label-row").get_by_role("button", name="Add label", exact=True)).to_be_visible()
    codes = inspector.locator(".connector-rows code").all_inner_texts()
    assert codes == ["Client.e", "API.w"], codes
    for which in ("start", "end"):
        button = inspector.get_by_role("button", name="Reconnect " + which, exact=True)
        expect(button).to_have_text("Reconnect")
        expect(button).to_be_enabled()
    reverse = inspector.get_by_role("button", name="Reverse direction", exact=True)
    assert reverse.locator("svg path").count() >= 2, "Reverse carries a line icon"
    assert not re.search(r"[←-⇿☀-➿\U0001F300-\U0001FAFF]", reverse.inner_text()), reverse.inner_text()
    for gone in ("Editable here", "Placement suggestions", "Editing", "Route styles", "Arrowheads"):
        assert gone not in inspector.inner_text(), gone
    assert inspector.get_by_role("combobox", name="Arrowheads").count() == 0
    expect(inspector.locator(".inspector-advanced")).not_to_have_attribute("open", "")

    # Heads: one segment pressed; choosing another is one validated edit.
    heads = inspector.get_by_role("group", name="Heads", exact=True)
    expect(heads.get_by_role("button")).to_have_text(["None", "End", "Start", "Both"])
    expect(heads.locator("[aria-pressed=true]")).to_have_text("End")
    before = source(page)
    heads.get_by_role("button", name="Both", exact=True).click()
    changed_from(page, before)
    assert "arrow <-> from Client.e to API.w" in source(page) or "arrow from Client.e to API.w <->" in source(page), source(page)
    open_more(page)
    expect(page.locator("#inspector").get_by_role("group", name="Heads", exact=True).locator("[aria-pressed=true]")).to_have_text("Both")
    page.locator("#canvas-undo").click()
    page.wait_for_function("s=>pikchrStudio.state().source===s&&pikchrStudio.state().valid", arg=before)

    # Suggested routes: collapsed, counted, and route shapes only.
    object_button(page, "E").click()
    routes = inspector_section(page, "Suggested routes")
    page.wait_for_function("document.querySelectorAll('.route-styles .route-style-option').length > 0")
    labels = routes.locator("[role=option]").all_inner_texts()
    assert not any("rrow" in label for label in labels), labels
    expect(routes.locator(":scope > summary .cl-count")).to_have_text(str(len(labels)))
    routes.locator(":scope > summary").click()

    # Shape rows, in order; the retired controls are gone.
    object_button(page, "Client").click()
    open_more(page)
    assert title(page) == ("Client", "box"), title(page)
    order = page.evaluate("""()=>[...document.querySelectorAll('#inspector > *, #inspector .canvas-sizing > .inspector-row')].filter(e=>e.offsetParent)
      .map(e=>e.querySelector(':scope > .row-name')?.textContent||e.querySelector(':scope > summary')?.textContent||e.className)""")
    assert order[:4] == ["Label", "canvas-sizing", "Text fit", "Size (in)"] and order[4:] == ["Shape", "Style", "Advanced & source"], order
    expect(inspector.locator(".label-row .label-preview")).to_have_text("Client")
    expect(inspector.locator(".label-row").get_by_role("button", name="Edit label", exact=True)).to_have_text("Edit")
    for gone in ("Label options…", "Apply size", "Change shape type"):
        expect(page.locator(".cl-more").get_by_role("button", name=gone, exact=True)).to_have_count(0)
    assert page.locator(".cl-more").get_by_role("combobox", name="Label behavior").count() == 0
    fit = inspector.get_by_role("group", name="Text fit", exact=True)
    expect(fit.get_by_role("button")).to_have_text(["Grow shape", "Wrap", "Fixed"])
    lock = page.get_by_label("Lock aspect ratio", exact=True)
    assert lock.locator("svg").count() == 1 and lock.inner_text().strip() == ""
    width, height = page.get_by_label("Shape width", exact=True), page.get_by_label("Shape height", exact=True)
    expect(width).to_have_value("0.75")

    # Typing does not render; Enter applies through the validated path.
    before = source(page)
    width.fill("1.5")
    page.wait_for_timeout(300)
    assert source(page) == before and page.evaluate("pikchrStudio.state().queued") == 0
    width.press("Enter")
    changed_from(page, before)
    assert re.search(r'Client: box "Client" at \(0,0\) width 1\.5\b', source(page)), source(page)
    open_more(page)
    expect(page.get_by_label("Shape width", exact=True)).to_have_value("1.5")

    # Blur applies too.
    before = source(page)
    height = page.get_by_label("Shape height", exact=True)
    height.fill("0.8")
    height.blur()
    changed_from(page, before)
    assert re.search(r"height 0\.8\b", source(page)), source(page)

    # A rejected size is explained under the field and the typed value stays.
    open_more(page)
    before = source(page)
    width = page.get_by_label("Shape width", exact=True)
    width.fill("500")
    width.press("Enter")
    error = page.locator(".cl-more .size-error")
    expect(error).to_be_visible()
    expect(error).to_contain_text("between 0.1 and 100")
    expect(width).to_have_value("500")
    expect(width).to_have_attribute("aria-invalid", "")
    assert source(page) == before

    # Escape in the field restores the current size and clears the error.
    width.press("Escape")
    expect(width).to_have_value("1.5")
    expect(error).to_be_hidden()
    expect(page.locator(".cl-more")).to_be_visible()
    assert source(page) == before

    # A size inside 0.1-100 that Pikchr itself rejects (the program asserts the
    # width) comes back through the validation path and is explained the same way.
    close_popovers(page)
    asserted = 'Client: box "Client" at (0,0)\nassert(Client.wid == 0.75)\n'
    set_source(page, asserted)
    object_button(page, "Client").click()
    open_more(page)
    width = page.get_by_label("Shape width", exact=True)
    expect(width).to_have_value("0.75")
    width.fill("1.5")
    width.press("Enter")
    error = page.locator(".cl-more .size-error")
    expect(error).to_be_visible()
    expect(error).to_contain_text("1.5 != 0.75")
    expect(width).to_have_value("1.5")
    expect(width).to_have_attribute("aria-invalid", "")
    assert source(page) == asserted and page.evaluate("pikchrStudio.state().queued") == 0
    width.press("Escape")
    expect(error).to_be_hidden()
    close_popovers(page)
    set_source(page, before)
    object_button(page, "Client").click()
    open_more(page)

    # Shape segments: the current kind is pressed; another is one edit.
    shapes = inspector.get_by_role("group", name="Shape type", exact=True)
    expect(shapes.get_by_role("button")).to_have_text(["Box", "Circle", "Cylinder", "Diamond"])
    expect(shapes.locator("[aria-pressed=true]")).to_have_text("Box")
    shapes.get_by_role("button", name="Cylinder", exact=True).click()
    changed_from(page, before)
    assert source(page).startswith('Client: cylinder "Client"'), source(page)
    open_more(page)
    expect(page.locator("#inspector").get_by_role("group", name="Shape type", exact=True).locator("[aria-pressed=true]")).to_have_text("Cylinder")
    assert page.evaluate("pikchrStudio.state().object.name") == "Client"

    # Text fit drives the label sizing modes through the same edit path.
    fit = page.locator("#inspector").get_by_role("group", name="Text fit", exact=True)
    expect(fit.get_by_role("button", name="Wrap", exact=True)).to_be_disabled()  # only boxes wrap
    before = source(page)
    fit.get_by_role("button", name="Grow shape", exact=True).click()
    changed_from(page, before)
    open_more(page)
    fit = page.locator("#inspector").get_by_role("group", name="Text fit", exact=True)
    expect(fit.locator("[aria-pressed=true]")).to_have_text("Grow shape")
    expect(page.get_by_label("Shape width", exact=True)).to_be_disabled()

    # Dragging a shape that cannot move explains why in plain words, with
    # the way out, rather than echoing an engine reason.
    close_popovers(page)
    set_source(page, 'define tile { box "Generated" }\ntile\nbox "Unnamed" at (2,0)\n')
    for object_id, message in (
        ("o1", "This shape comes from a macro, so it can’t be dragged. Choose Detach from macro in the inspector to edit it on its own."),
        ("o2", "This shape has no name, so it can’t be dragged. Name it in the source (S), for example A: box."),
    ):
        box = page.locator('#diagram [data-pikchr-id="' + object_id + '"]').bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2 + 20, box["y"] + box["height"] / 2 + 10, steps=4)
        page.mouse.up()
        expect(page.locator("#state")).to_have_text(message)
        assert "inspect-only" not in page.locator("#state").inner_text()

    assert not errors, errors
    browser.close()
    print("PASS: connector titles, rows, Heads, toolbar Reconnect, routes-only gallery; shape rows, size Enter/blur/reject/Escape, Shape and Text fit segments, plain drag-block reasons")
