"""On-canvas label commits for every shape kind.

A label typed into the inline editor must land in the source for named and
unnamed shapes, with and without existing text, in both apply modes. Shapes
placed implicitly (the common case) cannot grow to fit without moving their
neighbours, so they keep their size; nothing is dropped silently. A refused
label keeps the editor open with the reason next to it."""
import os
from browser_helpers import set_auto_apply
from playwright.sync_api import sync_playwright, expect

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
KINDS = ["box", "circle", "cylinder", "diamond", "ellipse", "oval", "file"]
LABEL = "this is a label"


def src(page):
    return page.evaluate("document.getElementById('source').value")


def rendered(page):
    page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'&&pikchrStudio.state().valid")


def load(page, text):
    page.evaluate("t=>{const s=document.getElementById('source');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}))}", text)
    page.wait_for_function("t=>pikchrStudio.state().source===t&&pikchrStudio.state().valid", arg=text)
    page.wait_for_function("!document.getElementById('diagram').classList.contains('stale')")


def centre(page, index):
    return page.evaluate("i=>{const o=pikchrStudio.state().scene.objects[i];const q=pikchrStudio.modelToScreen(o.center);return {x:q.x,y:q.y}}", index)


def open_editor(page, index, how):
    p = centre(page, index)
    if how == "dblclick":
        page.mouse.dblclick(p["x"], p["y"])
    else:
        page.mouse.click(p["x"], p["y"])
        page.wait_for_function("i=>pikchrStudio.state().object?.id===pikchrStudio.state().scene.objects[i].id", arg=index)
        page.keyboard.press("Enter")
    editor = page.locator("textarea.cl-inline-text")
    expect(editor).to_be_visible()
    return editor


def statement(kind, named, text):
    return ("C: " if named else "") + kind + (' "old"' if text else "")


def run(page, queued):
    for kind in KINDS:
        for named in (True, False):
            for text in (False, True):
                stmt = statement(kind, named, text)
                source = 'box "A"\nmove\n' + stmt + '\nmove\nbox "B"\n'
                load(page, source)
                editor = open_editor(page, 2, "dblclick" if named else "enter")
                page.keyboard.press("ControlOrMeta+a")
                page.keyboard.type(LABEL)
                page.keyboard.press("Enter")
                case = f"{stmt!r} ({'queue' if queued else 'auto'})"
                try:
                    page.wait_for_function("l=>document.getElementById('source').value.includes(l)", arg='"' + LABEL + '"', timeout=5000)
                except Exception:
                    raise AssertionError(f"{case}: label not committed; source={src(page)!r}; state={page.evaluate('document.getElementById(`state`).textContent')!r}")
                if queued:
                    page.wait_for_function("document.querySelectorAll('#queue-list li').length===1&&pikchrStudio.state().valid")
                else:
                    rendered(page)
                after = src(page)
                assert editor.count() == 0, case
                assert '"old"' not in after, case + " kept the old label: " + after
                line = after.split("\n")[2]
                assert line.startswith(("C: " if named else "") + kind + ' "' + LABEL + '"'), case + ": " + line
                assert after.split("\n")[0] == 'box "A"' and after.split("\n")[4] == 'box "B"', case + ": neighbours changed"
                assert LABEL in page.locator("#diagram svg").text_content().replace("\xa0", " "), case + ": label not rendered"
                if queued:
                    assert page.locator("#queue-list li").count() == 1, case
                    page.locator(".cl-status").get_by_role("button", name="Discard", exact=True).click()
                    page.wait_for_function("t=>document.getElementById('source').value===t", arg=source)
                    page.wait_for_function("document.querySelectorAll('#queue-list li').length===0")


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/index.html")
    page.wait_for_function("window.pikchrStudio && document.querySelector('.cl-doc')")

    set_auto_apply(page, True)
    run(page, queued=False)

    # A refused label keeps the editor and the typed text, and says why.
    load(page, 'box "A"\nmove\nC: cylinder\nmove\nbox "B"\n')
    before = src(page)
    editor = open_editor(page, 2, "dblclick")
    page.keyboard.type('say "hi"')
    page.keyboard.press("Enter")
    error = page.locator(".cl-inline-error")
    expect(error).to_be_visible()
    expect(error).to_have_attribute("role", "alert")
    expect(error).to_contain_text("quotes")
    expect(editor).to_be_visible()
    assert editor.input_value() == 'say "hi"'
    assert src(page) == before
    page.keyboard.press("Escape")
    expect(editor).to_have_count(0)
    expect(error).to_have_count(0)
    assert src(page) == before

    # A refusal after a blur keeps the editor and its text as well.
    editor = open_editor(page, 2, "dblclick")
    page.keyboard.type('a "b"')
    page.locator(".cl-doc [aria-label='Menu']").focus()
    expect(error).to_be_visible()
    expect(editor).to_be_visible()
    assert editor.input_value() == 'a "b"'
    assert src(page) == before
    editor.focus()
    page.keyboard.press("Escape")
    expect(editor).to_have_count(0)
    assert src(page) == before

    set_auto_apply(page, False)
    run(page, queued=True)

    assert not errors, errors
    browser.close()
print("label-commit-browser: ok")
