"""Floating chrome fits every width and every touch target is reachable:
no chrome over other chrome, a reachable palette and Select multiple on
phones, a small shape moves (not resizes) under a finger, the connector
toolbar fits, the inspector and drawer leave the selection visible, the
first fit keeps a margin, the preview bar speaks touch, and pinch zooms."""
import os
from playwright.sync_api import sync_playwright, expect
from browser_helpers import wait_rendered, set_source, set_auto_apply

BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/") + "/index.html"
CHROME = [".cl-doc", ".cl-palette", ".cl-status", ".cl-history", ".cl-zoom", ".cl-multi-pill"]

# Visible chrome rectangles, and every visible button that is not the topmost
# element at its own centre (something covers it, or it is scrolled away).
SURVEY = """chrome=>{
  const shown=e=>e&&!e.hidden&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
  const rects={},covered=[],small=[],overflow=[];
  for(const s of chrome){
    const e=document.querySelector(s);if(!shown(e))continue;
    const r=e.getBoundingClientRect();rects[s]=[r.left,r.top,r.right,r.bottom];
    if(e.scrollWidth>e.clientWidth+1)overflow.push(s);
    for(const b of e.querySelectorAll('button')){
      if(!shown(b)||b.closest('.cl-offstage'))continue;
      const q=b.getBoundingClientRect(),x=q.left+q.width/2,y=q.top+q.height/2;
      const hit=document.elementFromPoint(x,y);
      if(!hit||!b.contains(hit))covered.push(s+' '+(b.getAttribute('aria-label')||b.textContent.trim())+' @'+Math.round(x)+','+Math.round(y)+' -> '+(hit?.className?.baseVal??hit?.className??hit?.tagName));
      if(q.width<44-.5||q.height<44-.5)small.push(s+' '+(b.getAttribute('aria-label')||b.textContent.trim())+' '+Math.round(q.width)+'x'+Math.round(q.height));
    }
  }
  return {rects,covered,small,overflow};
}"""


def overlaps(a, b):
    return a[0] < b[2] - .5 and b[0] < a[2] - .5 and a[1] < b[3] - .5 and b[1] < a[3] - .5


def rendered(page):
    page.wait_for_function("document.querySelector('.cl-summary')?.textContent==='Rendered'")


def settle(page):
    page.wait_for_timeout(260)
    page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")


def object_box(page, name):
    return page.evaluate("""n=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name===n);
      const r=document.querySelector(`#diagram [data-pikchr-id="${o.id}"]`).getBoundingClientRect();
      return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,x:r.left+r.width/2,y:r.top+r.height/2}}""", name)


def rect(page, selector):
    return page.evaluate("s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}}", selector)


def touch_drag(page, cdp, a, b, steps=10):
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": a[0], "y": a[1], "id": 1}]})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": a[0] + (b[0] - a[0]) * i / steps, "y": a[1] + (b[1] - a[1]) * i / steps, "id": 1}]})
        page.wait_for_timeout(30)
    return lambda: cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    errors = []

    # 1, 2, 8: sweep widths; no chrome overlaps chrome, nothing is covered or
    # scrolled out of reach, and on touch every chrome button is 44x44.
    for touch in (False, True):
        page = browser.new_page(viewport={"width": 1440, "height": 900}, is_mobile=touch, has_touch=touch)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE)
        rendered(page)
        sizes = [(w, 900) for w in range(360, 1441, 40)] + [(701, 900), (820, 1180), (844, 390), (390, 844), (940, 700)]
        for width, height in sizes:
            page.set_viewport_size({"width": width, "height": height})
            settle(page)
            found = page.evaluate(SURVEY, CHROME)
            where = (width, height, "touch" if touch else "mouse")
            names = list(found["rects"])
            for i, a in enumerate(names):
                r = found["rects"][a]
                assert r[0] >= -.5 and r[2] <= width + .5 and r[1] >= -.5 and r[3] <= height + .5, (where, a, r)
                for b in names[i + 1:]:
                    assert not overlaps(r, found["rects"][b]), (where, a, r, b, found["rects"][b])
            assert not found["covered"], (where, found["covered"])
            assert not found["overflow"], (where, "hidden scrolling", found["overflow"])
            if touch:
                assert not found["small"], (where, found["small"])
        page.close()

    # 1: at 820x1180 on touch, tapping Export opens the export menu.
    tablet = browser.new_page(viewport={"width": 820, "height": 1180}, is_mobile=True, has_touch=True)
    tablet.on("pageerror", lambda error: errors.append(str(error)))
    tablet.goto(BASE)
    rendered(tablet)
    tablet.get_by_role("button", name="Export", exact=True).tap()
    expect(tablet.locator(".cl-export")).to_be_visible()
    tablet.close()

    for width, height in ((390, 844), (360, 740)):
        phone = browser.new_page(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True)
        phone.on("pageerror", lambda error: errors.append(str(error)))
        phone.goto(BASE)
        rendered(phone)
        settle(phone)

        # 9: the first fit leaves a margin and clears the chrome.
        top = rect(phone, ".cl-doc")["bottom"]
        bottom = min(rect(phone, ".cl-history")["top"], rect(phone, ".cl-zoom")["top"])
        for name in ("Client", "API", "Database"):
            box = object_box(phone, name)
            assert box["left"] >= 8 and box["right"] <= width - 8, (width, name, box)
            assert box["top"] >= top and box["bottom"] <= bottom, (width, name, box, top, bottom)

        # 2: Select multiple is in reach; while on, a pill says so and offers Done.
        multi = phone.locator(".cl-palette #multi-select")
        expect(multi).to_be_visible()
        r = multi.bounding_box()
        assert r["x"] >= 0 and r["x"] + r["width"] <= width, r
        multi.tap()
        expect(multi).to_have_attribute("aria-pressed", "true")
        pill = phone.locator(".cl-multi-pill")
        expect(pill).to_be_visible()
        expect(pill).to_contain_text("Selecting multiple")
        pill.get_by_role("button", name="Done").tap()
        expect(multi).to_have_attribute("aria-pressed", "false")
        expect(pill).to_be_hidden()
        # Picking another tool ends the mode.
        multi.tap()
        expect(pill).to_be_visible()
        phone.get_by_role("button", name="Box", exact=True).tap()
        expect(multi).to_have_attribute("aria-pressed", "false")
        expect(pill).to_be_hidden()
        # Touch hints name the touch action, not a key.
        assert "Escape" not in phone.locator("#state").text_content(), phone.locator("#state").text_content()
        phone.get_by_role("button", name="Select", exact=True).tap()

        # 5: a selected connector's toolbar fits, every action within reach and 44 px.
        arrow = phone.evaluate("""()=>{const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.kind==='arrow');
          const p=pikchrStudio.modelToScreen(o.center);return [p.x,p.y]}""")
        phone.touchscreen.tap(*arrow)
        phone.wait_for_function("pikchrStudio.state().object?.kind==='arrow'")
        expect(phone.locator(".cl-context")).to_be_visible()
        settle(phone)
        found = phone.evaluate(SURVEY, [".cl-context"])
        r = found["rects"][".cl-context"]
        assert r[0] >= 0 and r[2] <= width, (width, r)
        assert not found["covered"] and not found["overflow"] and not found["small"], (width, found)
        expect(phone.locator(".cl-context").get_by_role("button", name="Reconnect end")).to_be_visible()
        expect(phone.locator(".cl-context").get_by_role("button", name="More options")).to_be_visible()
        phone.close()

    # 3: on a phone a small selected shape moves from its middle; resize
    # handles sit at the corners, outside the body, and preview while dragging.
    phone = browser.new_page(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    phone.on("pageerror", lambda error: errors.append(str(error)))
    phone.goto(BASE)
    rendered(phone)
    cdp = phone.context.new_cdp_session(phone)
    api = object_box(phone, "API")
    phone.touchscreen.tap(api["x"], api["y"])
    phone.wait_for_function("pikchrStudio.state().object?.name==='API'")
    settle(phone)
    inner = phone.evaluate("""b=>{const out=[];for(const fx of [.2,.5,.8])for(const fy of [.2,.5,.8]){
        const x=b.left+(b.right-b.left)*fx,y=b.top+(b.bottom-b.top)*fy,h=document.elementFromPoint(x,y);
        if(h?.closest('[data-resize]'))out.push([fx,fy,h.closest('[data-resize]').dataset.resize]);}return out}""", api)
    assert not inner, ("resize handles swallow the body", inner)
    corners = phone.evaluate("""()=>[...document.querySelectorAll('.canvas-overlay [data-resize]')].map(g=>{
        const r=g.querySelector('rect').getBoundingClientRect();return {name:g.dataset.resize,w:r.width,h:r.height,x:r.left+r.width/2,y:r.top+r.height/2}})""")
    for c in corners:
        if len(c["name"]) == 2:
            assert c["w"] >= 43.5 and c["h"] >= 43.5, c
            assert not (api["left"] < c["x"] < api["right"] and api["top"] < c["y"] < api["bottom"]), (c, api)
    before = phone.evaluate("pikchrStudio.state().source")
    end = touch_drag(phone, cdp, (api["x"], api["y"]), (api["x"] + 50, api["y"] + 30))
    end()
    phone.wait_for_function("s=>pikchrStudio.state().source!==s&&pikchrStudio.state().valid", arg=before)
    line = [l for l in phone.evaluate("pikchrStudio.state().source").splitlines() if l.startswith("API:")][0]
    assert "wid" not in line and "ht" not in line and "at (2,0)" not in line, line
    # A corner drag resizes, with a live preview before release.
    phone.wait_for_function("pikchrStudio.state().object?.name==='API'")
    settle(phone)
    se = phone.evaluate("""()=>{const r=document.querySelector('.canvas-overlay [data-resize="se"] .resize-corner').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]}""")
    moved = phone.evaluate("pikchrStudio.state().source")
    end = touch_drag(phone, cdp, (se[0], se[1]), (se[0] + 40, se[1] + 20))
    assert phone.locator("#diagram .canvas-preview").count() >= 1, "resize previews while dragging"
    end()
    phone.wait_for_function("s=>pikchrStudio.state().source!==s&&pikchrStudio.state().valid", arg=moved)
    line = [l for l in phone.evaluate("pikchrStudio.state().source").splitlines() if l.startswith("API:")][0]
    assert "wid" in line, line

    # 9: the preview bar has visible Accept and Discard buttons on touch.
    set_auto_apply(phone, False)
    api = object_box(phone, "API")
    end = touch_drag(phone, cdp, (api["x"], api["y"]), (api["x"] - 40, api["y"] + 60))
    end()
    bar = phone.locator("#preview-actions")
    expect(bar).to_be_visible()
    for name in ("Accept", "Discard"):
        button = bar.get_by_role("button", name=name, exact=True)
        expect(button).to_be_visible()
        r = button.bounding_box()
        assert r["x"] >= 0 and r["x"] + r["width"] <= 390 and r["height"] >= 43.5 and r["width"] >= 43.5, (name, r)
    assert "Esc" not in bar.inner_text(), bar.inner_text()
    bar.get_by_role("button", name="Discard", exact=True).tap()
    expect(bar).to_be_hidden()

    # 10: a two-finger spread zooms around its midpoint.
    level = phone.locator("#zoom-level")
    start_level = int(level.text_content().rstrip("%"))
    mid = (195, 250)
    anchor = phone.evaluate("p=>pikchrStudio.screenToModel(p[0],p[1])", list(mid))

    def pts(d):
        return [{"x": mid[0] - d, "y": mid[1], "id": 1}, {"x": mid[0] + d, "y": mid[1], "id": 2}]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(30)})
    for i in range(1, 11):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(30 + 9 * i)})
        phone.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    phone.wait_for_timeout(100)
    end_level = int(level.text_content().rstrip("%"))
    assert end_level > start_level * 2, (start_level, end_level)
    after = phone.evaluate("p=>pikchrStudio.modelToScreen(p)", anchor)
    assert abs(after["x"] - mid[0]) < 6 and abs(after["y"] - mid[1]) < 6, (after, mid)
    phone.close()

    # 6, 7: desktop. The ⋯ inspector never covers the connector toolbar, and the
    # source drawer leaves the diagram (and the selection) visible beside it.
    desktop = browser.new_page(viewport={"width": 1440, "height": 900})
    desktop.on("pageerror", lambda error: errors.append(str(error)))
    desktop.goto(BASE)
    rendered(desktop)
    arrow = desktop.evaluate("""()=>{const s=pikchrStudio.state(),o=s.scene.objects.filter(o=>o.kind==='arrow')[1];
      const p=pikchrStudio.modelToScreen(o.center);return [p.x,p.y]}""")
    desktop.mouse.click(*arrow)
    desktop.wait_for_function("pikchrStudio.state().object?.kind==='arrow'")
    desktop.locator(".cl-context").get_by_role("button", name="More options").click()
    expect(desktop.locator(".cl-more")).to_be_visible()
    settle(desktop)
    found = desktop.evaluate(SURVEY, [".cl-context"])
    assert not found["covered"], found["covered"]
    assert not overlaps(found["rects"][".cl-context"], list(rect(desktop, ".cl-more").values())), (found["rects"], rect(desktop, ".cl-more"))
    desktop.keyboard.press("Escape")
    expect(desktop.locator(".cl-more")).to_be_hidden()

    desktop.locator("#diagram").focus()
    desktop.keyboard.press("Escape")
    desktop.wait_for_function("pikchrStudio.state().selectedIds.length===0")
    client = object_box(desktop, "Client")
    assert client["left"] < 404, client   # the closed drawer's footprint covers it
    desktop.get_by_role("button", name="Source", exact=True).click()
    desktop.wait_for_function("document.querySelector('.cl-drawer').classList.contains('open')")
    settle(desktop)
    drawer = rect(desktop, ".cl-drawer")
    client = object_box(desktop, "Client")
    assert client["left"] >= drawer["right"], (client, drawer)
    desktop.get_by_role("button", name="Source", exact=True).click()
    # With a selection, it is the selection that stays in view.
    desktop.locator("#fit-view").click()
    client = object_box(desktop, "Client")
    desktop.mouse.click(client["x"], client["y"])
    desktop.wait_for_function("pikchrStudio.state().object?.name==='Client'")
    desktop.get_by_role("button", name="Source", exact=True).click()
    settle(desktop)
    client = object_box(desktop, "Client")
    assert client["left"] >= rect(desktop, ".cl-drawer")["right"], client
    desktop.close()

    assert not errors, errors
    browser.close()
    print("PASS: chrome never overlaps chrome at 360-1440 px (touch and mouse), 44 px touch targets, reachable Select multiple with a Done pill, connector toolbar fits phones, small shapes move under a finger with corner resize handles, inspector and drawer keep the selection visible, fitted margin, touch preview bar, pinch zoom")
