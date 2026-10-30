"""Selection toolbar icons: crisp inline SVG instead of Unicode/emoji glyphs.

Every visible contextual action is an accessible, themed 20px icon with a
tooltip; the trash button is a real trash can; Delete then Undo restores the
exact source. Checked at desktop and phone widths in both colour schemes, with
single-object and group visibility policies unchanged.
"""
import os
import re
from browser_helpers import object_button, open_document_menu, close_popovers, set_source, wait_rendered
from playwright.sync_api import sync_playwright, expect

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
URL = STUDIO + "/index.html"
SOURCE = 'A: box "Alpha" at (0,0)\nB: box "Beta" at (3,0)\nLink: arrow from A.e to B.w\n'
CENTER = """name=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);const p=pikchrStudio.modelToScreen(o.center);return {x:p.x,y:p.y}}"""
# Emoji, dingbats, arrows, geometric shapes, variation selectors: the glyph
# soup this toolbar used to show.
GLYPH = re.compile("[←-⇿⌀-➿⬀-⯿️\U0001F000-\U0001FAFF]")
INK = {"light": "rgb(31, 35, 40)", "dark": "rgb(230, 237, 243)"}
ICON_STATE = """b=>{const svg=b.querySelector('svg');if(!svg)return null;const marks=[...svg.querySelectorAll('path,circle,rect,line')];
  const cs=getComputedStyle(svg);
  return {color:cs.color,display:cs.display,opacity:cs.opacity,viewBox:svg.getAttribute('viewBox'),
    hidden:svg.getAttribute('aria-hidden'),focusable:svg.getAttribute('focusable'),
    marks:marks.map(m=>{const s=getComputedStyle(m);return {stroke:s.stroke,fill:s.fill,display:s.display,opacity:s.opacity}}),
    signature:marks.map(m=>m.getAttribute('d')||m.tagName+':'+m.getAttribute('cx')+','+m.getAttribute('cy')+','+m.getAttribute('r')).join('|')}}"""


def rendered(page):
    page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'"
                            " && !document.querySelector('#diagram').classList.contains('stale')")


def select(page, name):
    # The source drawer slides away after typing; let it finish so the canvas
    # takes the click, as it does for a person.
    page.wait_for_function("getComputedStyle(document.querySelector('.cl-drawer')).visibility==='hidden'")
    point = page.evaluate(CENTER, name)
    page.mouse.click(point["x"], point["y"])
    expect(page.locator('.cl-context')).to_be_visible()


def icon_buttons(page):
    return page.locator('.cl-context .selection-toolbar > button:visible:not(.cl-endpoint-action)')


def check_icons(page, scheme, signatures):
    """Every visible action carries one coherent, visible, named SVG icon."""
    signatures.clear()
    context = page.locator('.cl-context')
    expect(context).to_be_visible()
    buttons = icon_buttons(page)
    assert buttons.count() >= 1, buttons.count()
    for index in range(buttons.count()):
        button = buttons.nth(index)
        name = button.get_attribute("aria-label")
        assert name and len(name.strip()) > 1, ("icon button has no accessible name", index)
        assert button.inner_text().strip() == "", (name, "still shows a text glyph", button.inner_text())
        tooltip = button.get_attribute("title") or ""
        assert len(tooltip.strip()) >= 3 and not GLYPH.search(tooltip), (name, tooltip)
        assert button.get_attribute("data-icon") is None, (name, "old data-icon glyph kept")
        assert button.locator("svg").count() == 1, (name, "needs exactly one svg")
        info = button.evaluate(ICON_STATE)
        assert info, name
        assert (info["viewBox"] or "").split() == ["0", "0", "24", "24"], (name, info["viewBox"])
        assert info["hidden"] == "true" and info["focusable"] == "false", name
        assert info["display"] != "none" and info["opacity"] != "0", (name, "icon hidden")
        assert info["marks"], (name, "icon has no marks")
        for mark in info["marks"]:
            assert mark["display"] != "none" and mark["opacity"] != "0", (name, mark)
            assert info["color"] in (mark["stroke"], mark["fill"]), (name, "icon does not use currentColor", mark)
        assert info["color"] == INK[scheme], (name, info["color"])
        box = button.locator("svg").bounding_box()
        assert box and 16 <= box["width"] <= 22 and abs(box["width"] - box["height"]) < 1, (name, box)
        assert info["signature"] and info["signature"] not in signatures, (name, "duplicate icon")
        signatures[info["signature"]] = name
    more = page.locator('.cl-context .cl-more-button')
    expect(more).to_be_visible()
    assert more.get_attribute("aria-label") == "More options"
    assert more.inner_text().strip() == ""
    assert more.locator("svg").count() == 1


def check_no_glyphs(page):
    texts = page.eval_on_selector_all(
        ".cl-context button", "els=>els.filter(e=>e.offsetParent!==null).map(e=>e.textContent)")
    for text in texts:
        assert not GLYPH.search(text), ("glyph still in the toolbar", text)
    assert not GLYPH.search(page.locator('.cl-context').inner_text())


def delete_and_undo(page):
    before = page.locator('#source').input_value()
    page.locator('#delete-selected').click()
    page.wait_for_function("text=>document.querySelector('#source').value!==text", arg=before)
    rendered(page)
    assert "A:" not in page.locator('#source').input_value()
    page.locator('#canvas-undo').click()
    page.wait_for_function("text=>document.querySelector('#source').value===text", arg=before)
    page.wait_for_function("document.querySelectorAll('#diagram [data-pikchr-id]').length===3")
    assert page.locator('#source').input_value() == before


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    signatures = {}
    for width, height, scheme in ((1440, 900, "light"), (1440, 900, "dark"),
                                  (390, 844, "light"), (390, 844, "dark")):
        label = f"{width}x{height} {scheme}"
        context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(URL)
        wait_rendered(page)
        set_source(page, SOURCE)
        rendered(page)
        assert page.evaluate("document.body.classList.contains('cl-dark')") == (scheme == "dark")

        select(page, "A")
        check_icons(page, scheme, signatures)
        check_no_glyphs(page)
        # Single-object policy: per-object actions are offered, connector-only
        # actions are not, and nothing spills out of the viewport.
        for identifier in ("#edit-selected", "#appearance-selected", "#copy-selection",
                           "#duplicate-selected", "#delete-selected", "#show-source-selected"):
            expect(page.locator(identifier)).to_be_visible()
        for identifier in ("#route-selected", "#tidy-route", "#paste-selection"):
            expect(page.locator(identifier)).to_be_hidden()
        assert not page.evaluate("document.querySelector('.cl-context').scrollWidth > innerWidth")
        if width == 390:
            box = page.locator('.cl-context').bounding_box()
            assert box["x"] >= 0 and box["x"] + box["width"] <= 390, box
        delete_and_undo(page)

        if width == 1440 and scheme == "light":
            # Keyboard: Tab reaches the toolbar and Enter deletes, then Undo
            # brings the exact source back.
            select(page, "A")
            page.locator("#diagram").focus()
            for _ in range(160):
                page.keyboard.press("Tab")
                if page.evaluate("document.activeElement.closest('.cl-context')!==null"):
                    break
            else:
                raise AssertionError("keyboard focus never reached the selection toolbar")
            for _ in range(40):
                if page.evaluate("document.activeElement.id") == "delete-selected":
                    break
                page.keyboard.press("Tab")
            else:
                raise AssertionError("keyboard focus never reached Delete")
            assert page.evaluate("getComputedStyle(document.activeElement).outlineStyle!=='none'")
            before = page.locator('#source').input_value()
            page.keyboard.press("Enter")
            page.wait_for_function("text=>document.querySelector('#source').value!==text", arg=before)
            rendered(page)
            page.locator('#canvas-undo').click()
            page.wait_for_function("text=>document.querySelector('#source').value===text", arg=before)
            rendered(page)

            # Group selection: object-specific actions go away; Delete, Copy
            # and the count stay.
            point = page.evaluate(CENTER, "A")
            page.mouse.click(point["x"], point["y"])
            open_document_menu(page)
            page.locator(".cl-menu #multi-select").click()
            close_popovers(page)
            point = page.evaluate(CENTER, "B")
            page.mouse.click(point["x"], point["y"])
            page.wait_for_function("document.body.classList.contains('has-multiple')")
            check_icons(page, scheme, signatures)
            check_no_glyphs(page)
            for identifier in ("#edit-selected", "#fit-text", "#appearance-selected",
                               "#duplicate-selected", "#show-source-selected"):
                expect(page.locator(identifier)).to_be_hidden()
            expect(page.locator('#delete-selected')).to_be_visible()
            expect(page.locator('#copy-selection')).to_be_visible()
            expect(page.locator('#selection-count')).to_have_text("2 selected")

            # A connector alone offers Route and tidy Route with distinct icons.
            open_document_menu(page)
            page.locator(".cl-menu #clear-selection").click()
            close_popovers(page)
            object_button(page, "Link").click()
            close_popovers(page)
            expect(page.locator('.cl-context')).to_be_visible()
            expect(page.locator('#route-selected')).to_be_visible()
            expect(page.locator('#tidy-route')).to_be_visible()
            check_icons(page, scheme, signatures)
            check_no_glyphs(page)
            change = page.locator('.cl-context .cl-endpoint-action:visible').first
            expect(change).to_have_text(re.compile(r"Change (start|end)"))

        assert not errors, errors
        context.close()
    browser.close()
    print("PASS: selection toolbar icons are named SVG, themed, distinct; delete/undo exact; single, group and connector policies")
