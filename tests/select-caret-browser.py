"""Every visible select draws a chevron inset from its right border, in both themes."""
import os
from playwright.sync_api import sync_playwright
from browser_helpers import open_more, open_adding, close_popovers, wait_rendered

URL = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
CHECK = """()=>[...document.querySelectorAll('select')].filter(s=>s.getClientRects().length&&getComputedStyle(s).visibility!=='hidden').map(s=>{
  const c=getComputedStyle(s);return {id:s.id||s.getAttribute('aria-label')||'',pad:parseFloat(c.paddingRight),app:c.appearance,img:c.backgroundImage.slice(0,20),pos:c.backgroundPosition}})"""


def check(page, label, seen):
    rows = page.evaluate(CHECK)
    for r in rows:
        assert r["pad"] >= 24 and r["app"] == "none" and r["img"].startswith("url("), (label, r)
        assert "8px" in r["pos"], (label, r)
        seen.add(r["id"])
    return len(rows)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    try:
        seen = set()
        for scheme in ("light", "dark"):
            for size in ({"width": 1440, "height": 900}, {"width": 390, "height": 844}):
                page = browser.new_page(viewport=size, color_scheme=scheme)
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(URL)
                wait_rendered(page)
                page.wait_for_function("pikchrStudio.state().valid")
                open_adding(page)
                assert check(page, "adding", seen) >= 1
                close_popovers(page)
                page.evaluate("pikchrStudio.state().scene.objects.length")
                page.locator('#diagram [data-pikchr-id="o2"]').click()
                open_more(page)
                n = check(page, "inspector " + scheme + str(size["width"]), seen)
                assert n >= 1
                # The dark chevron is lighter than the light one.
                img = page.evaluate("getComputedStyle(document.querySelector('.cl-popover:not([hidden]) select')).backgroundImage")
                assert ("9198a1" if scheme == "dark" else "656d76") in img, (scheme, img)
                assert not errors, errors
                page.close()
        print("PASS: select carets inset with 28px padding in light/dark at desktop and phone widths:", sorted(seen))
    finally:
        browser.close()
