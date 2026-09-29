"""Browser regression for opening a diagram from a #z= link."""
import base64
import zlib
from browser_helpers import wait_rendered, set_source
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8790/"


def payload(text):
    c = zlib.compressobj(wbits=-15)
    return base64.urlsafe_b64encode(c.compress(text.encode()) + c.flush()).decode().rstrip("=")


VECTOR = "SsqvUFAqLE0sKqpUslZILCrKL7dWAAsWl5SmZOYrKaRl5uQoGFSkWqQZpBgBBgA"
VECTOR_SOURCE = 'box "quarry"; arrow; box "studio" fill 0xe8f0d2'
UNICODE_SOURCE = 'box "café → ✓"'

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors, requests = [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("request", lambda request: requests.append(request.url))

    def current_source():
        return page.evaluate("window.pikchrStudio.state().source")

    def settled(text):
        page.wait_for_function("t => window.pikchrStudio.state().source === t", arg=text)
        page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")
        assert page.evaluate("location.hash") == ""

    # Fragment on load: opens rendered, fragment cleared, unsaved work kept.
    page.goto(BASE)
    wait_rendered(page)
    set_source(page, 'box "my unsaved work"')
    page.goto(BASE + "#z=" + VECTOR)
    page.reload()
    wait_rendered(page)
    settled(VECTOR_SOURCE)
    page.wait_for_function("document.querySelector('#diagram svg')?.textContent.includes('studio')")

    # The earlier work survives as its own saved document; a reload does not re-import.
    page.reload()
    wait_rendered(page)
    assert current_source() == VECTOR_SOURCE

    saved = page.evaluate("Object.keys(localStorage).filter(k=>k.includes('.document.v1.')).map(k=>JSON.parse(localStorage[k]).state.source)")
    assert 'box "my unsaved work"' in saved, saved

    # hashchange while the studio is open, with non-ASCII text.
    page.evaluate("h => { location.hash = h }", "z=" + payload(UNICODE_SOURCE))
    settled(UNICODE_SOURCE)

    # Corrupt payload: clear message, nothing changed, studio usable.
    page.evaluate("h => { location.hash = h }", "z=AAAA!!")
    page.wait_for_function("document.querySelector('#state').textContent.includes('could not be read')")
    assert current_source() == UNICODE_SOURCE
    assert page.evaluate("location.hash") == ""
    set_source(page, 'box "still works"')
    assert current_source() == 'box "still works"'

    # The source never leaves the browser.
    assert not [u for u in requests if "#z=" in u or VECTOR in u], requests
    assert not errors, errors
    browser.close()
    print("PASS: link import on load and hashchange, fragment cleared, unsaved work kept, Unicode, corrupt payload, no network use")
