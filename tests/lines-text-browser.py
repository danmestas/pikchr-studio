"""Canvas layout: free lines (draw, drag body, drag an end onto a shape),
Shift on the connect gesture, and on-canvas text (create, multi-line, drag,
style, double-click edit)."""
import re
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8790/index.html"
SOURCE = 'Client: box "Client" at (0,0)\nAPI: box "API" at (2,0)\n'
SCREEN = """p=>{const q=pikchrStudio.modelToScreen(p);return {x:q.x,y:q.y}}"""
CENTER = """name=>{const o=pikchrStudio.state().scene.objects.find(o=>o.name===name);const q=pikchrStudio.modelToScreen(o.center);return {x:q.x,y:q.y}}"""


def src(page):
    return page.evaluate("document.getElementById('source').value")


def last(page):
    return src(page).strip().split("\n")[-1]


def rendered(page):
    page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'&&pikchrStudio.state().valid")


def drag(page, a, b, steps=8):
    page.mouse.move(a["x"], a["y"])
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(a["x"] + (b["x"] - a["x"]) * i / steps, a["y"] + (b["y"] - a["y"]) * i / steps)
        page.wait_for_timeout(30)
    page.wait_for_timeout(200)
    page.mouse.up()


def load(page, text):
    page.evaluate("t=>{const s=document.getElementById('source');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}))}", text)
    page.wait_for_function("t=>pikchrStudio.state().source===t&&pikchrStudio.state().valid", arg=text)
    rendered(page)


def changed(page, before):
    page.wait_for_function("b=>document.getElementById('source').value!==b", arg=before)
    rendered(page)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    rendered(page)
    load(page, SOURCE)

    # Arrow tool: press-drag-release on empty canvas draws a free arrow.
    page.locator("#diagram").focus()
    page.keyboard.press("a")
    before = src(page)
    drag(page, page.evaluate(SCREEN, {"x": 0, "y": -1.5}), page.evaluate(SCREEN, {"x": 1.5, "y": -1.5}))
    changed(page, before)
    assert re.fullmatch(r"Link1: arrow from \(0, -1\.5\) to \(1\.5, -1\.5\)", last(page)), last(page)
    assert page.get_by_role("button", name="Arrow").get_attribute("aria-pressed") == "true", "tool stays active"
    # A click without a drag draws nothing.
    before = src(page)
    p = page.evaluate(SCREEN, {"x": 3, "y": -2})
    page.mouse.click(p["x"], p["y"])
    page.wait_for_timeout(500)
    assert src(page) == before

    # Line tool with Shift from a shape: the free end locks to 0/45/90 degrees.
    page.keyboard.press("l")
    before = src(page)
    start = page.evaluate(SCREEN, {"x": 0, "y": -0.2})
    end = page.evaluate(SCREEN, {"x": 0.9, "y": -1.2})
    page.mouse.move(start["x"], start["y"])
    page.mouse.down()
    page.keyboard.down("Shift")
    for i in range(1, 9):
        page.mouse.move(start["x"] + (end["x"] - start["x"]) * i / 8, start["y"] + (end["y"] - start["y"]) * i / 8)
        page.wait_for_timeout(30)
    page.mouse.up()
    page.keyboard.up("Shift")
    changed(page, before)
    m = re.fullmatch(r"Link2: line from Client\.s to \(([-\d.]+), ([-\d.]+)\)", last(page))
    assert m, last(page)
    dx, dy = float(m.group(1)) - 0, float(m.group(2)) - (-0.25)
    assert abs(abs(dx) - abs(dy)) < 0.051 or abs(dx) < 1e-9 or abs(dy) < 1e-9, (dx, dy)

    # Select tool: drag the free arrow's body; every point moves.
    page.keyboard.press("Escape")
    page.keyboard.press("v")
    before = src(page)
    drag(page, page.evaluate(SCREEN, {"x": 0.75, "y": -1.5}), page.evaluate(SCREEN, {"x": 1.25, "y": -1.0}))
    changed(page, before)
    assert "Link1: arrow from (0.5, -1) to (2, -1)" in src(page), src(page)
    # Its end handle onto API attaches the end to API.
    page.wait_for_function("document.querySelectorAll('#diagram .cl-line-handles [data-end]').length===2")
    handle = page.evaluate("(()=>{const r=document.querySelector('#diagram .cl-line-handles [data-end=to]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
    before = src(page)
    drag(page, handle, page.evaluate(SCREEN, {"x": 2, "y": -0.2}))
    changed(page, before)
    assert re.search(r"Link1: arrow from \(0\.5, -1\) to API\.s", src(page)), src(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("b=>document.getElementById('source').value===b", arg=before)

    # Text tool: click places text and opens the on-canvas editor.
    rendered(page)
    page.keyboard.press("t")
    before = src(page)
    p = page.evaluate(SCREEN, {"x": 1, "y": 1})
    page.mouse.click(p["x"], p["y"])
    editor = page.locator(".cl-inline-text")
    editor.wait_for(state="visible")
    assert page.locator("dialog[open]").count() == 0
    page.keyboard.type("Hi")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("there")
    page.keyboard.press("Enter")
    page.wait_for_function("document.getElementById('source').value.includes('T1: text \"Hi\" \"there\" at (1, 1)')")
    rendered(page)
    assert editor.count() == 0

    # Text drags like a shape.
    before = src(page)
    drag(page, page.evaluate(CENTER, "T1"), page.evaluate(SCREEN, {"x": 1.5, "y": 1.5}))
    changed(page, before)
    assert not re.search(r"T1: text .* at \(1, 1\)", src(page)), src(page)

    # One-click styling from the text bar.
    page.wait_for_function("!document.querySelector('.cl-textbar').hidden")
    before = src(page)
    page.locator(".cl-textbar").get_by_role("button", name="Bold").click()
    changed(page, before)
    assert '"Hi" bold "there" bold' in src(page), src(page)
    before = src(page)
    page.locator(".cl-textbar").get_by_role("button", name="Text size big").click()
    changed(page, before)
    assert '"Hi" big bold "there" big bold' in src(page), src(page)

    # Double-click reopens the editor with the current text; Escape keeps it.
    before = src(page)
    t1 = page.evaluate(CENTER, "T1")
    page.mouse.dblclick(t1["x"], t1["y"])
    editor.wait_for(state="visible")
    assert editor.input_value() == "Hi\nthere"
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    assert src(page) == before and editor.count() == 0
    # Double-click a shape edits its label in place, keeping its style words.
    api = page.evaluate(CENTER, "API")
    page.mouse.dblclick(api["x"], api["y"])
    editor.wait_for(state="visible")
    page.keyboard.press("ControlOrMeta+a")
    page.keyboard.type("Gateway")
    page.keyboard.press("Enter")
    page.wait_for_function("document.getElementById('source').value.includes('API: box \"Gateway\"')")
    rendered(page)
    assert page.locator("dialog[open]").count() == 0

    # Escape on a brand-new text removes it again.
    page.keyboard.press("t")
    before = src(page)
    p = page.evaluate(SCREEN, {"x": -1, "y": 1})
    page.mouse.click(p["x"], p["y"])
    editor.wait_for(state="visible")
    page.keyboard.press("Escape")
    page.wait_for_function("b=>document.getElementById('source').value===b", arg=before)

    # Phone width: the text bar fits the viewport.
    phone = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    phone.goto(URL)
    rendered(phone)
    load(phone, 'T1: text "Phone" at (0,0)\n')
    phone.evaluate("pikchrStudio.select(pikchrStudio.state().scene.objects[0].id)")
    phone.wait_for_function("!document.querySelector('.cl-textbar').hidden")
    box = phone.locator(".cl-textbar").bounding_box()
    assert box["x"] >= 0 and box["x"] + box["width"] <= 390, box
    assert not phone.evaluate("document.documentElement.scrollWidth > innerWidth")

    assert not errors, errors
    browser.close()
print("PASS: free lines (draw, click-no-op, Shift lock, body drag, end attach, undo), text (create inline, multi-line, drag, bold/size, double-click edit and cancel, shape label, empty cancel), phone text bar")
