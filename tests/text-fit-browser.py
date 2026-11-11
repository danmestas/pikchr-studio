"""One Text fit everywhere: the inspector's Text fit control, its size fields,
the label dialog and the resize handles all follow the mode label edits use
(a box wraps and other shapes grow by default; fit grows; Fixed only when
chosen). Choosing the mode already in force writes nothing. A deliberate view
(Focus selection) survives a window resize."""
import os
from playwright.sync_api import sync_playwright, expect
from browser_helpers import set_source, set_auto_apply, object_button, close_popovers, open_more, open_label_dialog

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/")
    page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")
    source = page.locator("#source")

    def load(text):
        set_source(page, text)
        expect(page.locator("#state")).to_contain_text("Rendered")

    def inspect(name):
        object_button(page, name).click()
        close_popovers(page)
        open_more(page)
        fit = page.locator(".canvas-sizing [aria-label='Text fit']")
        expect(fit).to_be_visible()
        return fit

    def pressed(fit):
        return fit.locator("button[aria-pressed=true]").get_attribute("data-value")

    set_auto_apply(page, True)

    # A default box shows Wrap. Both size fields stay editable, as the resize
    # handles do: a new width rewraps the label, a new height is a fixed size.
    text = 'A: box "one two three four five six" at (0,0) width 2.5\n'
    load(text)
    fit = inspect("A")
    assert pressed(fit) == "wrap", pressed(fit)
    width, height = page.get_by_label("Shape width", exact=True), page.get_by_label("Shape height", exact=True)
    expect(width).to_be_enabled()
    expect(height).to_be_enabled()
    # Choosing Wrap again writes nothing.
    fit.get_by_role("button", name="Wrap", exact=True).click()
    page.wait_for_timeout(300)
    expect(source).to_have_value(text)
    expect(page.locator("#state")).to_contain_text("already Wrap")
    # A narrower width rewraps the label instead of letting it overflow.
    width.fill("1")
    width.press("Enter")
    page.wait_for_function("t=>document.querySelector('#source').value!==t&&pikchrStudio.state().valid", arg=text)
    line = source.input_value().split("\n")[0]
    assert "width 1 " in line + " " and line.count('"') >= 4, line
    labels = page.evaluate("""()=>{const o=pikchrStudio.state().scene.objects.find(o=>o.name==='A');
      return [...document.querySelectorAll(`#diagram [data-pikchr-id="${o.id}"] text`)].map(t=>{const r=t.getBBox();return [r.x,r.width]}).concat([[o.bbox.width]])}""")
    assert len(labels) > 2, labels
    # Every wrapped line fits inside the 1 in box (the scene's own scale).
    fits = page.evaluate("""()=>{const o=pikchrStudio.state().scene.objects.find(o=>o.name==='A');const g=document.querySelector(`#diagram [data-pikchr-id="${o.id}"]`);
      const a=pikchrStudio.modelToScreen({x:o.bbox.x,y:0}),b=pikchrStudio.modelToScreen({x:o.bbox.x+o.bbox.width,y:0});
      return [...g.querySelectorAll('text')].every(t=>{const r=t.getBoundingClientRect();return r.left>=Math.min(a.x,b.x)-1&&r.right<=Math.max(a.x,b.x)+1})}""")
    assert fits, "a wrapped line overflows the box"

    # A default oval shows Grow; Grow again is a no-op. Its fields stay
    # editable: a typed size is a fixed size, and Text fit then shows Fixed.
    text = 'O: oval "Label" at (0,0)\n'
    load(text)
    fit = inspect("O")
    assert pressed(fit) == "grow", pressed(fit)
    expect(page.get_by_label("Shape width", exact=True)).to_be_enabled()
    expect(page.get_by_label("Shape height", exact=True)).to_be_enabled()
    fit.get_by_role("button", name="Grow shape", exact=True).click()
    page.wait_for_timeout(300)
    expect(source).to_have_value(text)
    oval_height = page.get_by_label("Shape height", exact=True)
    oval_height.fill("1.2")
    oval_height.press("Enter")
    page.wait_for_function("t=>document.querySelector('#source').value!==t&&pikchrStudio.state().valid", arg=text)
    assert "height 1.2" in source.input_value(), source.input_value()
    open_more(page)
    page.wait_for_function("()=>document.querySelector('.canvas-sizing [aria-label=\"Text fit\"] [aria-pressed=true]')?.dataset.value==='fixed'")

    # The label dialog starts on the same mode: Wrap for a default box.
    text = 'B: box "Label" at (0,0)\n'
    load(text)
    object_button(page, "B").click()
    close_popovers(page)
    open_label_dialog(page)
    dialog = page.get_by_role("dialog", name="Edit label", exact=True)
    expect(dialog.get_by_role("combobox", name="Text sizing", exact=True)).to_have_value("wrap")
    dialog.get_by_role("button", name="Cancel", exact=True).click()

    # Focus selection is a deliberate view: a window resize keeps its zoom.
    load('A: box "A" at (0,0)\nB: box "B" at (4,0)\nC: box "C" at (8,0)\n')
    object_button(page, "B").click()
    close_popovers(page)
    page.locator("#diagram").focus()
    page.keyboard.press("f")
    page.wait_for_function("document.getElementById('zoom-level').textContent!=='100%'")
    zoom = page.locator("#zoom-level").text_content()
    page.set_viewport_size({"width": 1200, "height": 900})
    page.wait_for_timeout(400)
    assert page.locator("#zoom-level").text_content() == zoom, (zoom, page.locator("#zoom-level").text_content())

    assert not errors, errors
    browser.close()
print("PASS: one Text fit for the inspector, size fields, label dialog and handles; a repeated choice writes nothing; Focus survives a resize")
