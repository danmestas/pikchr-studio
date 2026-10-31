"""Canvas-first navigation uses real controls and the existing guarded edits."""
import os
import re
import signal
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_helpers import open_more, close_popovers, object_button, set_source


def deadline(*_):
    raise TimeoutError("Canvas-first browser exceeded its 300-second deadline")


signal.signal(signal.SIGALRM, deadline)
signal.alarm(300)
BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
SHAPES = 'A: box "Alpha" at (0,0)\nB: box "Beta" at (3,-1)\n'
SOURCE = SHAPES + 'E: arrow from A.e to B.w\n'
SHOTS = os.environ.get("PIKCHR_MENU_SCREENSHOTS")


def rendered(page):
    page.wait_for_function("pikchrStudio.state().valid")


def sheet_inside(page, width, height):
    box = page.locator(".cl-more").bounding_box()
    assert box["x"] >= 15.5 and box["x"] + box["width"] <= width - 15.5, box
    assert box["y"] >= 0 and box["y"] + box["height"] <= height, box
    assert box["height"] < height * .65, box
    return box


def open_objects(page):
    page.locator("#mobile-objects").click()
    expect(page.locator(".cl-view-objects")).to_be_visible()


def choose_object(page, label, name=None):
    open_objects(page)
    page.locator("#object-search").fill(label)
    page.locator("#objects button:visible").filter(has_text=re.compile(re.escape(label))).first.click()
    expect(page.locator(".cl-view-properties")).to_be_visible()
    page.wait_for_function("name=>pikchrStudio.state().object?.name===name", arg=name or label)


def undo_exact(page, before):
    page.locator("#canvas-undo").click()
    page.wait_for_function("s=>document.querySelector('#source').value===s", arg=before)
    rendered(page)


def screenshot(page, name):
    if SHOTS:
        Path(SHOTS).mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(Path(SHOTS) / (name + ".png")))


def inspect_macro_source(page):
    macro_source = 'define tile { box "Generated" }\ntile\ntile\nN: box "Native" at (3,0)\n'
    set_source(page, macro_source)
    open_objects(page)
    page.locator("#object-search").fill("Generated box")
    expect(page.locator("#objects button:visible")).to_have_count(2)
    page.locator("#objects button:visible").first.click()
    expect(page.locator("#inspector")).to_contain_text("Its source may be shared by other instances")
    advanced = page.locator("details.inspector-advanced")
    assert advanced.get_attribute("open") is None
    expect(page.get_by_role("button", name="Inspect generating source", exact=True)).to_be_visible()
    width, height = page.viewport_size["width"], page.viewport_size["height"]
    if width < 600:
        sheet_inside(page, width, height)
    theme = "dark" if page.evaluate("document.body.classList.contains('cl-dark')") else "light"
    screenshot(page, str(width) + "-" + theme + "-macro")
    selected_id = page.evaluate("pikchrStudio.state().object.id")
    for control in ("#delete-selected", "#duplicate-selected"):
        page.locator(control).click()
        expect(page.locator("#state")).to_contain_text("read-only")
        assert page.locator("#source").input_value() == macro_source
        assert page.evaluate("pikchrStudio.state().selectedIds") == [selected_id]
        assert page.evaluate("pikchrStudio.state().queued") == 0
    open_more(page)
    span = page.evaluate("pikchrStudio.state().object.span")
    generating_source = macro_source.encode("utf-8")[span["start"]:span["end"]].decode("utf-8")
    assert 'box "Generated"' in generating_source
    page.get_by_role("button", name="Inspect generating source", exact=True).click()
    expect(page.locator(".cl-more")).to_be_hidden()
    expect(page.locator("#source")).to_be_visible()
    expect(page.locator("#source")).to_be_focused()
    assert page.locator("#source").input_value() == macro_source
    assert page.locator("#source").evaluate("e=>e.value.slice(e.selectionStart,e.selectionEnd)") == generating_source
    page.keyboard.press("ControlOrMeta+A")
    page.keyboard.press("ArrowRight")
    page.keyboard.type("# inspected via source\n")
    page.wait_for_function("s=>pikchrStudio.state().source===s&&pikchrStudio.state().valid", arg=macro_source + "# inspected via source\n")
    page.locator(".cl-doc [aria-label='Source']").click()
    choose_object(page, "Native", "N")
    expect(page.locator(".cl-more")).to_be_visible()
    expect(page.get_by_role("button", name="Inspect generating source", exact=True)).to_have_count(0)
    open_objects(page)
    page.locator("#object-search").fill("")
    close_popovers(page)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE)
        inspect_macro_source(page)
        set_source(page, SOURCE)
        original = page.locator("#source").input_value()
        rendered(page)

        # Common tasks have stable sections and keep the original controls.
        page.locator(".cl-doc [aria-label='Menu']").click()
        headings = page.locator(".cl-menu > section > h3").all_text_contents()
        assert headings == ["Document", "Preferences", "Advanced"], headings
        assert page.locator(".cl-menu > section").last.get_attribute("aria-label") == "About"
        menu = page.locator(".cl-menu")
        # Document: New, Open file, Examples on one row; recent documents instead of a select.
        row = menu.locator(".cl-section").first.locator(".cl-row").first
        assert row.locator("button").all_inner_texts() == ["New", "Open file\u2026", "Examples\u2026"], row.inner_text()
        assert page.locator("#documents").evaluate("e=>!!e.closest('.cl-offstage')"), "the Saved documents select is off-stage"
        current = menu.locator(".cl-recent button[aria-current=true]")
        expect(current).to_have_count(1)
        assert re.search(r"just now|min ago", current.inner_text()), current.inner_text()
        assert menu.get_by_text("Saved on this browser").count() == 0 or not menu.get_by_text("Saved on this browser").first.is_visible()
        # Preferences: four checkboxes, Snap resize moved out of Tool options.
        prefs = menu.locator("section[aria-label=Preferences] label").all_inner_texts()
        assert [t.strip() for t in prefs] == ["Show anchors", "Apply accepted changes immediately", "Snap resize to 0.1 in", "Advanced tools"], prefs
        assert menu.locator("section[aria-label=Preferences] #auto-apply").count() == 1
        # Advanced items need Advanced tools; footer is one row of links plus the credit line.
        assert menu.locator("section[aria-label=Advanced]").is_hidden()
        footer = menu.locator("section[aria-label=About]")
        assert footer.locator(".cl-footer-links a, .cl-footer-links button").all_inner_texts() == ["How it works", "Shortcuts", "Licenses", "Source"]
        assert footer.get_by_role("link", name="Source").get_attribute("href") == "https://zeitforge.app/r/dmestas/pikchr-studio"
        assert "github" not in footer.inner_html().lower()
        assert footer.locator("p").inner_text() == "Rendered by Pikchr, 0BSD."
        assert footer.locator("p a").get_attribute("href") == "https://pikchr.org"
        for gone in ("#multi-select", "#clear-selection", "#mobile-objects", "#focus-selection", "#mobile-add", "#accept", "#undo-draft"):
            assert menu.locator(gone).count() == 0, gone + " left the menu"
        # The menu never scrolls at 1440x900, with or without Advanced tools.
        def no_scroll(label):
            fits = page.evaluate("(()=>{const m=document.querySelector('.cl-menu');return [m.scrollHeight,m.clientHeight]})()")
            assert fits[0] <= fits[1], (label, "menu scrolls", fits)
        no_scroll("basic")
        page.locator("#advanced-mode").check()
        expect(menu.locator("section[aria-label=Advanced]")).to_be_visible()
        assert menu.locator("section[aria-label=Advanced] button").all_inner_texts() == ["Components\u2026", "Back up documents\u2026", "Restore\u2026"]
        no_scroll("advanced")
        page.locator("#advanced-mode").uncheck()
        # Shortcuts in the footer opens the panel with the three groups.
        footer.get_by_role("button", name="Shortcuts").click()
        help_panel = page.locator(".cl-help")
        expect(help_panel).to_be_visible()
        expect(menu).to_be_hidden()
        assert help_panel.locator("h3").evaluate_all("hs=>hs.map(h=>h.textContent)") == ["Tools", "Editing", "View"]
        assert help_panel.locator(".canvas-help").count() == 0
        text = help_panel.text_content()
        assert "V  M  H" in text and "B  C  D  R  T" in text and "Find object" in text
        close_popovers(page)

        # Search includes names, rendered labels, kinds and connector endpoints.
        open_objects(page)
        expect(page.locator("#object-search")).to_be_focused()
        assert page.locator("#objects button").count() == 3
        assert page.locator("#objects-count").inner_text() == "3 objects"
        for query in ("arrow", "Beta", "Beta box", "A → B"):
            page.locator("#object-search").fill(query)
            expect(page.locator("#objects button:visible"), "Objects search: " + query).to_have_count(1)
        page.locator("#object-search").fill("no-such-object")
        expect(page.locator("#objects button:visible")).to_have_count(0)
        expect(page.locator("#objects-empty")).to_be_visible()
        page.locator("#object-search").fill("")
        page.keyboard.press("Escape")
        expect(page.locator(".cl-more")).to_be_hidden()
        expect(page.locator(".cl-doc [aria-label='Menu']")).to_be_focused()

        choose_object(page, "Beta", "B")
        assert page.evaluate("pikchrStudio.state().object?.name") == "B"
        close_popovers(page)
        object_button(page, "B").click()
        close_popovers(page)
        open_more(page)
        more = page.locator(".cl-more")
        expect(more).to_be_visible()
        expect(more.get_by_role("button", name="Close inspector")).to_be_visible()
        expect(page.locator("#inspector")).to_contain_text("Placement suggestions available")
        assert "Bounds" not in page.locator("#inspector").inner_text()
        assert "connector expression" not in page.locator("#inspector").inner_text()
        advanced = more.locator("details.inspector-advanced")
        assert advanced.get_attribute("open") is None
        assert page.evaluate("document.querySelector('#inspector').lastElementChild.classList.contains('inspector-advanced')")
        assert page.locator(".inspector-status").bounding_box()["y"] < advanced.bounding_box()["y"]
        advanced.locator("summary").click()
        expect(page.locator("#inspector")).to_contain_text("Bounds")
        expect(more.get_by_role("button", name="Show source")).to_be_visible()
        assert more.locator(".cl-route-choices").count() == 0
        page.keyboard.press("Escape")
        expect(more).to_be_hidden()
        expect(page.get_by_role("button", name="More options", exact=True)).to_be_focused()

        choose_object(page, "E")
        # The inspector helper must leave Objects through its visible Back action.
        open_objects(page)
        open_more(page)
        expect(page.locator(".cl-view-properties")).to_be_visible()
        assert page.evaluate("pikchrStudio.state().object?.name") == "E"
        routes = more.locator(".cl-route-choices")
        for label in ("Straight", "Elbow", "Curve", "Arc", "Waypoints"):
            expect(routes.get_by_role("button", name=label, exact=True)).to_be_visible()
        assert page.evaluate("""()=>{const r=document.querySelector('.cl-route-choices'),
          a=document.querySelector('.arrow-editor');
          return !!(r&&a&&(r.compareDocumentPosition(a)&Node.DOCUMENT_POSITION_FOLLOWING))}""")
        assert routes.get_by_role("button", name="Straight", exact=True).get_attribute("aria-pressed") == "true"
        routes.get_by_role("button", name="Elbow", exact=True).click()
        routes.get_by_role("button", name="Vertical first").click()
        page.wait_for_function("s=>document.querySelector('#source').value!==s", arg=original)
        assert "then to" in page.locator("#source").input_value()
        rendered(page)
        undo_exact(page, original)
        close_popovers(page)

        # Arc and curve shortcuts retain identity and use one ordinary Undo.
        for fixture, first, changed_kind in [
            (SOURCE, "Arc", "arc"),
            (SHAPES + 'E: arrow from A.e to (1.5,-1) then to B.w\n', "Curve", "spline"),
        ]:
            set_source(page, fixture)
            choose_object(page, "E")
            before = page.locator("#source").input_value()
            page.locator(".cl-route-choices").get_by_role("button", name=first, exact=True).click()
            page.wait_for_function("k=>pikchrStudio.state().valid&&pikchrStudio.state().object?.kind===k", arg=changed_kind)
            assert page.evaluate("pikchrStudio.state().object.name") == "E"
            converted = page.locator("#source").input_value()
            segment_label = "Straight" if changed_kind == "arc" else "Segments"
            page.locator(".cl-route-choices").get_by_role("button", name=segment_label, exact=True).click()
            page.wait_for_function("pikchrStudio.state().valid&&pikchrStudio.state().object?.kind==='arrow'")
            undo_exact(page, converted)
            undo_exact(page, before)
            close_popovers(page)

        # Every theme/device gets real Objects -> shape -> connector navigation.
        for width, height, device in ((1440, 900, "desktop"), (390, 844, "phone")):
            for theme in ("light", "dark"):
                sample = browser.new_page(viewport={"width": width, "height": height},
                                          color_scheme=theme, is_mobile=device == "phone",
                                          has_touch=device == "phone")
                sample.on("pageerror", lambda error: errors.append(str(error)))
                sample.goto(BASE)
                set_source(sample, SOURCE)
                sample.wait_for_function("dark=>document.body.classList.contains('cl-dark')===dark", arg=theme == "dark")
                choose_object(sample, "Beta", "B")
                if device == "phone":
                    sheet_inside(sample, width, height)
                screenshot(sample, device + "-" + theme + "-shape")
                # Record the head before scrolling; Close must stay reachable.
                head = sample.locator(".cl-more .cl-popover-head")
                head_before = head.bounding_box()
                sample.locator(".cl-more").hover()
                sample.mouse.wheel(0, 800)
                expect(head).to_be_visible()
                assert abs(head.bounding_box()["y"] - head_before["y"]) < 2
                close = sample.locator(".cl-more").get_by_role("button", name="Close inspector")
                expect(close).to_be_visible()
                close.click()
                expect(sample.locator(".cl-doc [aria-label='Menu']")).to_be_focused()
                choose_object(sample, "E")
                grid = sample.locator(".cl-route-grid")
                expect(grid).to_be_visible()
                if device == "phone":
                    sheet_inside(sample, width, height)
                    gb = grid.bounding_box()
                    assert gb["x"] >= 15.5 and gb["x"] + gb["width"] <= width - 15.5, gb
                assert not sample.evaluate("document.documentElement.scrollWidth>innerWidth")
                screenshot(sample, device + "-" + theme + "-connector")
                sample.keyboard.press("Escape")
                expect(sample.locator(".cl-more")).to_be_hidden()
                inspect_macro_source(sample)
                sample.close()
        assert not errors, errors
        print("PASS: task menus; searchable Objects; action-first properties; source facts;")
        print("      real elbow/arc/curve/segments edits and exact Undo; focus return;")
        print("      bounded sticky phone sheets; desktop/phone in both themes")
    finally:
        browser.close()
