"""Style and text controls on a shape written the way people write Pikchr:
a named oval with a hex fill and an italic label, placed by an expression
Studio cannot rewrite. Opening Style shows no error; only moving is blocked,
with the real reason; a colour written as a variable disables just its row
and says what is written; swatch rows fit the inspector without clipping;
text controls stay available while the label is edited in place and in the
inspector's Text group."""
import os
from browser_helpers import set_source, set_auto_apply, inspector_section, close_popovers, open_more
from playwright.sync_api import sync_playwright, expect

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
OWNER = ('NBT: box "Not Before Time" bold at (0,0)\n'
         'Time: oval "Zeit" italic fill 0xe8f0d2 at NBT.n + (0, NBT.ht)\n'
         'P: line dashed from Time.s to NBT.n "parameter" aligned above\n')
LOCKED = '$zeit = 0xe8f0d2\n' + OWNER.replace('fill 0xe8f0d2', 'fill $zeit')
CENTER = """n=>{const o=pikchrStudio.state().scene.objects.find(o=>o.name===n);const q=pikchrStudio.modelToScreen(o.center);return {x:q.x,y:q.y}}"""


def src(page):
    return page.locator("#source").input_value()


def time_line(page):
    return next(l for l in src(page).split("\n") if l.startswith("Time:"))


def settled(page):
    page.wait_for_function("pikchrStudio.state().valid&&!document.getElementById('diagram').classList.contains('stale')")


def wait_time(page, text):
    page.wait_for_function("t=>document.getElementById('source').value.split('\\n').some(l=>l===t)", arg=text)
    settled(page)


def select(page, name):
    close_popovers(page)
    p = page.evaluate(CENTER, name)
    page.mouse.click(p["x"], p["y"])
    page.wait_for_function("n=>pikchrStudio.state().object?.name===n", arg=name)


def no_errors_shown(page):
    shown = page.evaluate("""()=>[...document.querySelectorAll('#inspector .style-error,#inspector .property-error,#inspector [role=alert]')]
      .filter(e=>e.offsetParent&&e.textContent.trim()).map(e=>e.textContent)""")
    assert not shown, shown


def rows_fit(page):
    """Every swatch row is one row inside the inspector, rings unclipped."""
    report = page.evaluate("""()=>{
      const clip=e=>{for(let p=e.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(/(auto|scroll|hidden|clip)/.test(s.overflowX))return p.getBoundingClientRect();}return {left:0,right:innerWidth};};
      return [...document.querySelectorAll('#inspector .style-swatches')].filter(g=>g.offsetParent).map(g=>{
        const items=[...g.children].filter(c=>c.offsetParent),box=clip(g);
        const rects=items.map(i=>i.getBoundingClientRect());
        return {name:g.getAttribute('aria-label'),count:items.length,
          tops:[...new Set(rects.map(r=>Math.round(r.top)))].length,
          minLeft:Math.min(...rects.map(r=>r.left))-box.left,maxRight:box.right-Math.max(...rects.map(r=>r.right)),
          minSize:Math.min(...rects.map(r=>Math.min(r.width,r.height))),
          gaps:[...new Set(rects.slice(1).map((r,i)=>Math.round(r.left-rects[i].right)))].filter(()=>true),
          customLast:items.at(-1).classList.contains('style-custom'),customIcon:!!items.at(-1).querySelector('svg')&&!items.at(-1).textContent.trim()};
      });}""")
    return report


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/index.html")
    set_auto_apply(page, True)
    set_source(page, OWNER)
    settled(page)

    # Bug 2: an expression placement no longer blocks moving, so no banner.
    select(page, "Time")
    section = inspector_section(page, "Style")
    expect(page.locator("#inspector > .inspector-status")).to_have_count(0)
    # Bug 1: opening Style shows no error and focuses no text field.
    no_errors_shown(page)
    focused = page.evaluate("document.activeElement?.matches('.style-custom-fields input')")
    assert not focused, "a custom colour field took focus on open"
    fill = section.get_by_role("group", name="Fill", exact=True)
    expect(fill.get_by_role("button", name="Custom fill colour", exact=True)).to_have_attribute("aria-pressed", "true")
    expect(section.get_by_label("Fill colour value", exact=True)).to_have_value("#e8f0d2")
    # Opening Custom shows the fields without moving focus into them.
    ink = section.get_by_role("group", name="Line & text", exact=True)
    ink.get_by_role("button", name="Custom line & text colour", exact=True).click()
    expect(section.get_by_label("Line & text colour value", exact=True)).to_be_visible()
    assert not page.evaluate("document.activeElement?.matches('.style-custom-fields input[type=text]')")
    no_errors_shown(page)
    # Style edits work on the shape that cannot move.
    fill.get_by_role("button", name="Fill honeydew", exact=True).click()
    wait_time(page, 'Time: oval "Zeit" italic at NBT.n + (0, NBT.ht) fill honeydew')
    no_errors_shown(page)

    # Bug 3: rows fit at 1440 in one line, Custom an icon swatch at the end.
    section = inspector_section(page, "Style")
    for row in rows_fit(page):
        assert row["tops"] == 1, row
        assert row["minLeft"] >= 4 and row["maxRight"] >= 4, row
        assert row["customLast"] and row["customIcon"], row
        assert len(row["gaps"]) == 1, row

    # Bug 4: the inspector's Text group (size, bold, italic, mono, alignment).
    text = page.locator("#inspector").get_by_role("group", name="Text style", exact=True)
    expect(text.get_by_role("button", name="Italic", exact=True)).to_have_attribute("aria-pressed", "true")
    text.get_by_role("button", name="Bold", exact=True).click()
    wait_time(page, 'Time: oval "Zeit" bold italic at NBT.n + (0, NBT.ht) fill honeydew')
    text = page.locator("#inspector").get_by_role("group", name="Text style", exact=True)
    text.get_by_role("button", name="Monospace", exact=True).click()
    wait_time(page, 'Time: oval "Zeit" bold italic mono at NBT.n + (0, NBT.ht) fill honeydew')
    sizes = page.locator("#inspector").get_by_role("group", name="Text size", exact=True)
    sizes.get_by_role("button", name="L", exact=True).click()
    wait_time(page, 'Time: oval "Zeit" big bold italic mono at NBT.n + (0, NBT.ht) fill honeydew')
    page.locator("#inspector").get_by_role("group", name="Text alignment", exact=True).get_by_role("button", name="Align left", exact=True).click()
    wait_time(page, 'Time: oval "Zeit" big bold italic mono ljust at NBT.n + (0, NBT.ht) fill honeydew')
    # Colour lives in Style's Line & text row, and the Text group says so.
    expect(page.locator("#inspector .text-style-group")).to_contain_text("Line & text")

    # Bug 4: the canvas text bar shows for this oval, and while editing inline.
    set_source(page, OWNER)
    settled(page)
    select(page, "Time")
    close_popovers(page)
    page.wait_for_function("!document.querySelector('.cl-textbar').hidden")
    p = page.evaluate(CENTER, "Time")
    page.mouse.dblclick(p["x"], p["y"])
    editor = page.locator(".cl-inline-text")
    editor.wait_for(state="visible")
    page.wait_for_function("!document.querySelector('.cl-textbar').hidden")
    overlap = page.evaluate("""()=>{const a=document.querySelector('.cl-inline-text').getBoundingClientRect(),b=document.querySelector('.cl-textbar').getBoundingClientRect();
      return a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom}""")
    assert not overlap, "the text bar covers the label editor"
    page.keyboard.press("End")
    page.keyboard.type(" Zone")
    bar = page.locator(".cl-textbar")
    expect(bar.get_by_role("button", name="Italic", exact=True)).to_have_attribute("aria-pressed", "true")
    bar.get_by_role("button", name="Bold", exact=True).click()
    # The typed text is kept and styled together, as one change.
    wait_time(page, 'Time: oval "Zeit Zone" bold italic fill 0xe8f0d2 at NBT.n + (0, NBT.ht)')
    editor.wait_for(state="visible")
    assert editor.input_value() == "Zeit Zone", editor.input_value()
    expect(bar.get_by_role("button", name="Bold", exact=True)).to_have_attribute("aria-pressed", "true")
    page.keyboard.type("!")
    page.keyboard.press("Enter")
    wait_time(page, 'Time: oval "Zeit Zone!" bold italic fill 0xe8f0d2 at NBT.n + (0, NBT.ht)')
    # Text colour is Pikchr's color: the bar names it Line & text like Style.
    select(page, "Time")
    close_popovers(page)
    page.wait_for_function("!document.querySelector('.cl-textbar').hidden")
    bar.get_by_role("button", name="Line & text firebrick", exact=True).click()
    wait_time(page, 'Time: oval "Zeit Zone!" bold italic fill 0xe8f0d2 at NBT.n + (0, NBT.ht) color firebrick')

    # Bug 1: a colour written as a variable locks just its row, calmly.
    set_source(page, LOCKED)
    settled(page)
    select(page, "Time")
    section = inspector_section(page, "Style")
    no_errors_shown(page)
    expect(page.locator("#inspector > .inspector-status")).to_have_count(0)
    fill = section.get_by_role("group", name="Fill", exact=True)
    for button in fill.get_by_role("button").all():
        expect(button).to_be_disabled()
    lock = section.locator(".style-locked").first
    expect(lock).to_contain_text('Written as "fill $zeit" in source, which Studio can’t rewrite. Edit it in Source (S).')
    ink = section.get_by_role("group", name="Line & text", exact=True)
    expect(ink.get_by_role("button", name="Line & text blue", exact=True)).to_be_enabled()
    lock.get_by_role("button", name="Show in source", exact=True).click()
    page.wait_for_function("""()=>{const s=document.getElementById('source');return s.value.slice(s.selectionStart,s.selectionEnd).startsWith('Time: oval')}""")
    close_popovers(page)
    page.locator('.cl-doc [aria-label="Source"]').click()
    select(page, "Time")
    section = inspector_section(page, "Style")
    section.get_by_role("group", name="Line & text", exact=True).get_by_role("button", name="Line & text blue", exact=True).click()
    wait_time(page, 'Time: oval "Zeit" italic fill $zeit at NBT.n + (0, NBT.ht) color blue')
    no_errors_shown(page)

    # The oval moves by dragging, and keeps its offset from NBT.n.
    set_source(page, OWNER)
    settled(page)
    close_popovers(page)
    p = page.evaluate(CENTER, "Time")
    page.mouse.move(p["x"], p["y"])
    page.mouse.down()
    page.mouse.move(p["x"] + 50, p["y"], steps=4)
    page.mouse.move(p["x"] + 100, p["y"], steps=4)
    page.mouse.up()
    page.wait_for_function("t=>document.getElementById('source').value!==t", arg=OWNER)
    settled(page)
    assert time_line(page).startswith('Time: oval "Zeit" italic fill 0xe8f0d2 at NBT.n + ('), time_line(page)
    assert "NBT.ht" not in time_line(page), time_line(page)
    expect(page.locator("#state")).to_have_text("Moved Time.")
    assert 'P: line dashed from Time.s to NBT.n' in src(page)

    # Dark theme: rows still fit.
    page.emulate_media(color_scheme="dark")
    page.wait_for_function("document.body.classList.contains('cl-dark')")
    set_source(page, OWNER)
    settled(page)
    select(page, "Time")
    inspector_section(page, "Style")
    for row in rows_fit(page):
        assert row["tops"] == 1 and row["minLeft"] >= 4 and row["maxRight"] >= 4, row
    page.emulate_media(color_scheme="light")

    # Phone sheet at 360: no sideways scroll, nothing clipped, 44px targets.
    phone = browser.new_page(viewport={"width": 360, "height": 740}, is_mobile=True, has_touch=True)
    phone.on("pageerror", lambda error: errors.append(str(error)))
    phone.goto(STUDIO + "/index.html")
    set_source(phone, OWNER)
    settled(phone)
    phone.evaluate("pikchrStudio.select(pikchrStudio.state().scene.objects.find(o=>o.name==='Time').id)")
    phone.wait_for_function("pikchrStudio.state().object?.name==='Time'")
    open_more(phone)
    inspector_section(phone, "Style")
    no_errors_shown(phone)
    for row in rows_fit(phone):
        assert row["minLeft"] >= 4 and row["maxRight"] >= 4 and row["minSize"] >= 44 and row["customLast"], row
    overflow = phone.evaluate("""()=>{const m=document.querySelector('.cl-more');return {sw:m.scrollWidth,cw:m.clientWidth}}""")
    assert overflow["sw"] <= overflow["cw"] + 1, overflow

    assert not errors, errors
    browser.close()
print("style-owner-browser: ok")
