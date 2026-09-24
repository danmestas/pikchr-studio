"""Browser/WASM regressions for fitting labels and preserving draft semantics."""
from playwright.sync_api import sync_playwright, expect
from browser_helpers import prepare_legacy, object_button, open_document_menu, edit_label, reveal, show_source, set_source, menu_click, set_auto_apply


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/")
    prepare_legacy(page)
    page.wait_for_function("document.querySelectorAll('#objects button').length === 5")
    source = page.locator("#source")
    baseline = 'A: box "A" at (0,0)\nB: box "B" at (5,0)\narrow from A.e to B.w\n'
    long_text = "The Node of the Day"

    def render(text, count=3):
        open_document_menu(page)
        if not source.is_visible():
            show_source(page)
        set_source(page, text)
        expect(page.locator("#state")).to_have_text(
            f"Rendered {count} objects. Select one to inspect.")

    def select(name="A"):
        object_button(page, name).click()

    def geometry():
        return page.evaluate("""() => {
          const group=document.querySelector('#diagram [data-pikchr-id="o1"]');
          const shape=group.querySelector('path,rect,ellipse,circle,polygon').getBBox();
          const text=group.querySelector('text').getBBox();
          const path=document.querySelector('#diagram [data-pikchr-id="o3"] path');
          const start=path.getPointAtLength(0);
          return {width:shape.width,right:shape.x+shape.width,left:shape.x,
            textLeft:text.x,textRight:text.x+text.width,arrowStart:start.x};
        }""")

    def fitted():
        result = geometry()
        assert result["width"] > initial["width"] + 10, result
        assert result["textLeft"] >= result["left"] - 1, result
        assert result["textRight"] <= result["right"] + 1, result
        assert abs(result["arrowStart"] - result["right"]) < 1, result

    render(baseline)
    select()
    initial = geometry()
    expect(page.locator('#inspector').get_by_label('Object text',exact=True)).to_have_count(0)
    expect(page.get_by_label('Fit shape to text',exact=True)).to_have_count(0)
    edit_label(page, long_text, 'grow')
    expect(page.locator("#queue-list li")).to_have_count(1)
    expect(page.locator("#queue-status")).to_have_attribute("data-state", "draft")
    fitted()
    assert '"The Node of the Day"' in source.input_value()
    menu_click(page, "#cancel")
    expect(source).to_have_value(baseline)
    expect(page.locator("#state")).to_have_text("All queued changes discarded.")
    assert abs(geometry()["width"] - initial["width"]) < .01

    # A fixed-size label edit remains possible by opting out.
    select()
    edit_label(page, long_text, 'fixed')
    expect(page.locator("#queue-list li")).to_have_count(1)
    expect(source).to_have_value(baseline.replace('"A"', f'"{long_text}"'))
    assert abs(geometry()["width"] - initial["width"]) < .01
    menu_click(page, "#accept")
    expect(page.locator("#queue-status")).to_have_attribute("data-state", "applied")
    overflow_source = source.input_value()

    # The preview action fixes existing overflow and is one undoable auto-edit.
    set_auto_apply(page, True)
    page.locator("#fit-text").click()
    expect(page.locator("#state")).to_have_text("All queued changes applied. Undo restores the whole batch.")
    expect(source).not_to_have_value(overflow_source)
    fitted()
    expect(page.locator("#queue-list li")).to_have_count(0)
    page.locator("#canvas-undo").click()
    expect(source).to_have_value(overflow_source)
    expect(page.locator("#state")).to_have_text("Undone. Redo restores the change.")
    assert abs(geometry()["width"] - initial["width"]) < .01

    # Phone-sized viewport: the preview action remains usable without overflow.
    page.set_viewport_size({"width": 390, "height": 844})
    select()
    button = reveal(page, '#fit-text')
    expect(button).to_be_enabled()
    button.scroll_into_view_if_needed()
    expect(button).to_be_in_viewport()
    button.click()
    expect(source).not_to_have_value(overflow_source)
    expect(page.locator("#queue-status")).to_have_attribute("data-state", "applied")
    fitted()
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    page.set_viewport_size({"width": 1440, "height": 1000})

    # Opting out also freezes a shape that already has native fit sizing.
    fitted_width = geometry()["width"]
    edit_label(page, long_text + " with an even longer label", 'fixed')
    expect(page.locator('#diagram [data-pikchr-id="o1"] text')).to_have_text(
        long_text + " with an even longer label")
    expect(page.locator("#queue-status")).to_have_attribute("data-state", "applied")
    assert abs(geometry()["width"] - fitted_width) < .1

    # Unsupported group contents never offer a misleading fit action.
    render('Group: [\n  A: box "Inside a group"\n]\n', count=2)
    select("A")
    expect(page.locator("#fit-text")).to_be_disabled()
    expect(page.get_by_label("Fit shape to text", exact=True)).to_have_count(0)
    assert not errors, errors
    browser.close()
    print("PASS: default text fitting, fixed-size opt-out, preview fit, attached connector, discard, auto-apply undo, mobile, unsupported group")
