"""A selected connector owns its endpoint gestures.

With a connector selected, hovering a shape draws creation dots. The dot on
the anchor under an endpoint handle must never sit above that handle: pressing
there drags the endpoint, it does not create a shape. Reconnect targeting also
hides the selection toolbar and inspector so they cannot cover the target.
"""
from playwright.sync_api import sync_playwright, expect
import os
import browser_helpers  # noqa: F401  (PIKCHR_STUDIO_DIAG failure diagnostics)
from browser_helpers import connector_editor

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
URL = STUDIO + "/index.html"

ARROW = """i=>{const s=pikchrStudio.state(),a=s.scene.objects.filter(o=>o.kind==='arrow')[i];
  if(!a)return null;const p=pikchrStudio.modelToScreen(a.path[Math.floor(a.path.length/2)]);
  const q=pikchrStudio.modelToScreen(a.path[0]);
  return {x:(p.x+q.x)/2,y:(p.y+q.y)/2}}"""
HANDLE = """which=>{const h=[...document.querySelectorAll('.arrow-overlay .endpoint-handle')]
  .find(n=>n.getAttribute('aria-label')===('Drag '+which+' endpoint'));if(!h)return null;
  const r=h.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}}"""
ANCHOR = """([name,anchor])=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===name);
  const p=pikchrStudio.modelToScreen(o.anchors[anchor]);return {x:p.x,y:p.y}}"""
SOURCE = "document.querySelector('#source').value"
COUNT = "pikchrStudio.state().scene.objects.length"


def rendered(page):
    page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'")


def select_arrow(page, index=0):
    # A selection left over from the previous step would make the next click
    # additive, so clear it on empty canvas first, as a person would.
    page.mouse.click(40, 500)
    page.wait_for_timeout(120)
    point = page.evaluate(ARROW, index)
    assert point, "default diagram has an arrow"
    page.mouse.click(point["x"], point["y"])
    page.wait_for_function("document.querySelectorAll('.arrow-overlay .endpoint-handle').length===2")
    page.wait_for_function("pikchrStudio.state().selectedIds.length===1")


def hover_shape(page, name, anchor='c'):
    point = page.evaluate(ANCHOR, [name, anchor])
    page.mouse.move(point["x"], point["y"])
    page.wait_for_timeout(120)
    return point


def drag(page, start, end, steps=10, release=True):
    page.mouse.move(start["x"], start["y"])
    page.wait_for_timeout(60)
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(start["x"] + (end["x"] - start["x"]) * i / steps,
                        start["y"] + (end["y"] - start["y"]) * i / steps)
        page.wait_for_timeout(35)
    page.wait_for_timeout(200)
    if release:
        page.mouse.up()


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1280, "height": 577})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    rendered(page)
    original = page.locator("#source").input_value()
    objects = page.evaluate(COUNT)

    # 1. The arrowhead handle owns its hit region: no creation dot is offered
    #    on the anchor the handle sits on, and the handle wins the hit test.
    select_arrow(page)
    head = page.evaluate(HANDLE, "arrowhead")
    hover_shape(page, "API")
    page.wait_for_function("document.querySelector('.cl-dots .cl-dot[data-anchor=\"n\"]')")
    assert not page.evaluate("!!document.querySelector('.cl-dots .cl-dot[data-anchor=\"w\"]')"), \
        "the anchor under the arrowhead handle must not offer a creation dot"
    top = page.evaluate("(p)=>{const n=document.elementFromPoint(p.x,p.y);return n&&n.closest('.endpoint-handle')?'handle':n&&n.closest('.cl-dot-hit')?'dot-hit':n&&n.tagName}", head)
    assert top == "handle", f"endpoint handle must win over the create dot: {top}"

    # 2. Dragging the arrowhead to API's top anchor edits the arrow and
    #    creates nothing.
    apex = page.evaluate(ANCHOR, ["API", "n"])
    drag(page, head, apex)
    page.wait_for_function("document.querySelector('#source').value.includes('to API.n')")
    edited = page.locator("#source").input_value()
    assert "Shape1" not in edited and "Shape" not in edited, edited
    assert page.evaluate(COUNT) == objects, "no object may be created by a reconnect drag"
    rendered(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("orig=>document.querySelector('#source').value===orig", arg=original)
    rendered(page)

    # 3. The start handle has the same ownership.
    select_arrow(page)
    start = page.evaluate(HANDLE, "start")
    hover_shape(page, "Client")
    page.wait_for_function("document.querySelector('.cl-dots .cl-dot[data-anchor=\"n\"]')")
    assert not page.evaluate("!!document.querySelector('.cl-dots .cl-dot[data-anchor=\"e\"]')"), \
        "the anchor under the start handle must not offer a creation dot"
    top = page.evaluate("(p)=>{const n=document.elementFromPoint(p.x,p.y);return n&&n.closest('.endpoint-handle')?'handle':n&&n.closest('.cl-dot-hit')?'dot-hit':n&&n.tagName}", start)
    assert top == "handle", f"start handle must win over the create dot: {top}"
    drag(page, start, page.evaluate(ANCHOR, ["API", "n"]))
    page.wait_for_function("document.querySelector('#source').value.includes('from API.n')")
    assert page.evaluate(COUNT) == objects, "no object may be created by a reconnect drag"
    rendered(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("orig=>document.querySelector('#source').value===orig", arg=original)
    rendered(page)

    # 4. A drop on empty canvas is an invalid reconnect: it changes nothing
    #    and creates nothing.
    select_arrow(page)
    head = page.evaluate(HANDLE, "arrowhead")
    drag(page, head, {"x": 200, "y": 500})
    page.wait_for_timeout(300)
    assert page.locator("#source").input_value() == original, "invalid drop changed the source"
    assert page.evaluate(COUNT) == objects, "invalid drop created an object"
    assert page.evaluate("document.querySelectorAll('.arrow-overlay .endpoint-handle').length===2")

    # 5. Escape cancels an endpoint drag without creating anything.
    select_arrow(page)
    head = page.evaluate(HANDLE, "arrowhead")
    drag(page, head, page.evaluate(ANCHOR, ["Database", "n"]), release=False)
    page.keyboard.press("Escape")
    page.mouse.up()
    page.wait_for_timeout(300)
    assert page.locator("#source").input_value() == original, "Escape must leave the arrow alone"
    assert page.evaluate(COUNT) == objects

    # 6. Chrome that covers the target hides while reconnect targeting is on:
    #    a drag clears the selection toolbar, inspector and text bar.
    select_arrow(page)
    head = page.evaluate(HANDLE, "arrowhead")
    page.wait_for_function("!document.querySelector('.cl-context').hidden")
    drag(page, head, page.evaluate(ANCHOR, ["Database", "n"]), release=False)
    page.wait_for_timeout(120)
    assert page.evaluate("[...document.querySelectorAll('.cl-context,.cl-more,.cl-textbar')].every(n=>getComputedStyle(n).display==='none')"), \
        "selection chrome must not cover the reconnect target"
    page.mouse.up()
    page.wait_for_timeout(300)
    page.keyboard.press("Escape")
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("orig=>document.querySelector('#source').value===orig", arg=original)
    rendered(page)

    # 6b. Arming anchors from the inspector hides the selection toolbar but
    #     keeps the inspector itself, so Cancel reconnect stays reachable.
    select_arrow(page)
    page.locator(".cl-context [aria-label='More options']").click()
    expect(page.locator(".cl-more")).to_be_visible()
    connector_editor(page)
    page.get_by_role("button", name="Reconnect on canvas", exact=True).click()
    page.wait_for_timeout(120)
    assert page.evaluate("getComputedStyle(document.querySelector('.cl-context')).display==='none'")
    assert page.locator(".cl-more").is_visible()
    page.get_by_role("button", name="Cancel reconnect", exact=True).click()
    page.wait_for_timeout(120)
    expect(page.locator(".cl-more")).to_be_visible()
    page.keyboard.press("Escape")

    # 7. Direct selection actions: Reconnect Start / End arm the canvas
    #    anchors; clicking one reconnects the endpoint.
    select_arrow(page)
    change_end = page.locator(".cl-context").get_by_role("button", name="Reconnect end", exact=True)
    assert change_end.is_visible(), "Reconnect End must be offered for a selected connector"
    change_end.click()
    page.wait_for_function("!!document.querySelector('.arrow-overlay .anchor-target[data-anchor=\"API.n\"]')")
    page.wait_for_function("[...document.querySelectorAll('.arrow-overlay .anchor-target')].some(d=>d.style.pointerEvents==='all')")
    page.locator(".arrow-overlay .anchor-target[data-anchor='API.n']").click()
    page.wait_for_function("document.querySelector('#source').value.includes('to API.n')")
    assert page.evaluate(COUNT) == objects
    rendered(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("orig=>document.querySelector('#source').value===orig", arg=original)
    rendered(page)

    # 8. The connect tool still creates a new shape on an empty-canvas drop.
    select_arrow(page)
    page.get_by_role("toolbar", name="Tools").get_by_role("button", name="Arrow", exact=True).click()
    before = page.evaluate(COUNT)
    arena = page.evaluate("()=>({x:innerWidth*0.35,y:innerHeight*0.72})")
    drag(page, {"x": arena["x"], "y": arena["y"]}, {"x": arena["x"] + 150, "y": arena["y"] + 40})
    page.wait_for_function("n=>pikchrStudio.state().scene.objects.length>n", arg=before)
    rendered(page)
    page.locator("#diagram").focus()
    page.keyboard.press("ControlOrMeta+z")
    page.wait_for_function("orig=>document.querySelector('#source').value===orig", arg=original)

    # 9. Identical anchor sets on different shapes must not reuse the previous
    #    shape's dot layer when the pointer moves directly between them.
    from browser_helpers import set_source
    set_source(page, 'A: box at (0,0)\nB: box at (3,0)\n')
    page.mouse.click(40, 500)
    page.wait_for_function('pikchrStudio.state().selectedIds.length===0')
    for name in ('A', 'B', 'A', 'B'):
        # The source drawer closes with an animation. Wait until the shape is
        # actually reachable, not merely until its model has rendered.
        page.wait_for_function("""name=>{const s=pikchrStudio.state();
          const o=s.scene.objects.find(o=>o.name===name),p=pikchrStudio.modelToScreen(o.anchors.c);
          return !!document.elementFromPoint(p.x,p.y)?.closest('#diagram')}""", arg=name)
        point = page.evaluate(ANCHOR, [name, 'c'])
        page.mouse.move(point['x'], point['y'])
        page.wait_for_function("""name=>{const s=pikchrStudio.state();
          const id=s.scene.objects.find(o=>o.name===name).id;
          const dots=[...document.querySelectorAll('.cl-dots .cl-dot')];
          return dots.length>0&&dots.every(d=>d.dataset.id===id)}""", arg=name)

    assert not errors, errors
    browser.close()
    print("PASS: endpoint handles own their hit regions, reconnect never creates shapes, invalid drops and Escape are inert, chrome clears while targeting, Reconnect Start/End actions work, connect tool still creates")
