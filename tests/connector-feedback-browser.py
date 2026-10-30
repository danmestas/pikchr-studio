"""Connector capability feedback: labels say what is actually editable, direct
reconnect actions close the inspector and announce the current action, and a
source-order rejection cancels the pick instead of leaving it waiting."""
import os
import re
from playwright.sync_api import sync_playwright, expect
from browser_helpers import open_more, close_popovers, object_button, set_source

BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790")
SOURCE = """A: box "A" at (0,0)
B: box "B" at (2,0)
C: box "C" at (0,-2)
E: arrow from A.e to B.w
Q: arrow from (0,2) to (1,2)
S: spline from A.n to B.n
L: arrow from A.w to C.w
Z: box "Z" at (4,0)
"""


def canvas_id(page, name):
    return page.evaluate("""n=>{const g=[...document.querySelectorAll('#diagram [data-pikchr-id]')]
      .find(e=>(e.getAttribute('aria-label')||'').split(',')[0]===n);return g&&g.getAttribute('data-pikchr-id')}""", name)


def aria(page, name):
    return page.locator('#diagram [aria-label^="' + name + ',"]').get_attribute('aria-label')


def editing(page, name):
    object_button(page, name).click()
    page.wait_for_function("document.querySelector('#inspector dt')")
    return page.evaluate("""()=>{const d=[...document.querySelectorAll('#inspector dt')]
      .find(n=>n.textContent==='Editing');return d?d.nextElementSibling.textContent:''}""")


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE)
    set_source(page, SOURCE)

    # Canvas labels describe connector capabilities, not shape placement.
    assert 'endpoints editable' in aria(page, 'E'), aria(page, 'E')
    assert 'route editable' in aria(page, 'E'), aria(page, 'E')
    q = aria(page, 'Q')
    assert 'styles editable' in q and 'endpoints editable' not in q, q
    s = aria(page, 'S')
    assert 'styles editable' in s and 'endpoints editable' not in s, s
    assert aria(page, 'A') == 'A, movable', aria(page, 'A')

    # A free line has no shape endpoint, so its direct reconnect buttons are
    # disabled rather than offered and then refused.
    object_button(page, 'Q').click()
    for name in ('Change start', 'Change end'):
        button = page.locator('.cl-context').get_by_role('button', name=name, exact=True)
        expect(button).to_be_visible()
        expect(button).to_be_disabled()
        assert 'no editable shape endpoint' in (button.get_attribute('title') or '')
    assert page.locator('.arrow-overlay').count() == 0
    open_more(page)
    for name in ('Reconnect start', 'Reconnect end'):
        button = page.get_by_role('button', name=name, exact=True)
        expect(button).to_be_disabled()
        assert 'no shape endpoint' in (button.get_attribute('title') or ''), button.get_attribute('title')
    close_popovers(page)
    # Dragging a connector body points at what that connector can do.
    box = page.locator('#diagram [data-pikchr-id="' + canvas_id(page, 'E') + '"]').bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] / 2 + 8, box['y'] + box['height'] / 2 + 6, steps=3)
    page.mouse.up()
    expect(page.locator('#state')).to_contain_text('handles in Endpoints')

    # The inspector separates styling from endpoint reconnection truthfully.
    e = editing(page, 'E')
    assert 'Endpoints' in e and 'routing' in e and 'styles' in e, e
    q = editing(page, 'Q')
    assert 'styles' in q.lower() and 'Endpoints' not in q, q
    close_popovers(page)

    # Selecting a connector and choosing a direct reconnect closes the
    # inspector (so the canvas is uncovered) and names the active action.
    object_button(page, 'E').click()
    open_more(page)
    page.get_by_role('button', name='Reconnect start', exact=True).click()
    expect(page.locator('.cl-more')).to_be_hidden()
    status = page.locator('#state').inner_text()
    assert 'Reconnecting the start' in status, status
    assert 'Escape' in status, status
    assert page.locator('#state').is_visible()
    assert page.evaluate("document.querySelector('#diagram').dataset.tool") == 'from'
    before = page.locator('#source').input_value()
    page.locator('#diagram [data-pikchr-id="' + canvas_id(page, 'C') + '"]').click()  # defined before E
    page.wait_for_function("s=>document.querySelector('#source').value!==s", arg=before)
    after = page.locator('#source').input_value()
    assert re.search(r'E: arrow from C\.\w+ to B\.w', after), after
    assert page.evaluate("document.querySelector('#diagram').dataset.tool") == 'select'
    assert 'Reconnected the start' in page.locator('#state').inner_text()

    # Escape cancels a reconnect and says so; the source is unchanged.
    object_button(page, 'E').click()
    open_more(page)
    page.get_by_role('button', name='Reconnect end', exact=True).click()
    expect(page.locator('.cl-more')).to_be_hidden()
    page.keyboard.press('Escape')
    expect(page.locator('#state')).to_contain_text('Cancelled. No change applied.')
    assert page.evaluate("document.querySelector('#diagram').dataset.tool") == 'select'
    assert page.locator('#source').input_value() == after

    # A target declared later in the source is reconnected rather than
    # rejected: the editor relocates the connector, so both endpoints can
    # point at it.
    for name, pattern in (('Reconnect start', r'L: arrow from Z\.\w+ to C\.w'),
                          ('Reconnect end', r'L: arrow from Z\.\w+ to \w[\w.]*')):
        object_button(page, 'L').click()
        open_more(page)
        page.get_by_role('button', name=name, exact=True).click()
        expect(page.locator('.cl-more')).to_be_hidden()
        before = page.locator('#source').input_value()
        page.locator('#diagram [data-pikchr-id="' + canvas_id(page, 'Z') + '"]').click()  # defined after L
        page.wait_for_function("s=>document.querySelector('#source').value!==s", arg=before)
        after = page.locator('#source').input_value()
        assert re.search(pattern, after), after
        assert 'Reconnected the ' + ('start' if name.endswith('start') else 'arrowhead') in page.locator('#state').inner_text()
        assert page.evaluate("document.querySelector('#diagram').dataset.tool") == 'select'

    # A grouped shape is not a top-level target, so the pick is cancelled with
    # the reason instead of left waiting.
    close_popovers(page)
    set_source(page, SOURCE + 'Group1: [ H: box "H" at (0,6) ]\n')
    object_button(page, 'E').click()
    open_more(page)
    page.get_by_role('button', name='Reconnect start', exact=True).click()
    expect(page.locator('.cl-more')).to_be_hidden()
    kept = page.locator('#source').input_value()
    page.locator('#diagram [data-pikchr-id="' + canvas_id(page, 'H') + '"]').click()
    page.wait_for_function("document.querySelector('#diagram').dataset.tool==='select'")
    rejected = page.locator('#state').inner_text()
    assert 'cannot be used as a connection target' in rejected, rejected
    assert page.locator('#source').input_value() == kept
    set_source(page, SOURCE)

    # Creating a connector reports what happened instead of redirecting the
    # author to handles for a shape that was just made.
    close_popovers(page)
    page.get_by_role('button', name='Arrow', exact=True).click()
    page.locator('#diagram [data-pikchr-id="' + canvas_id(page, 'A') + '"]').click()
    page.locator('#diagram [data-pikchr-id="' + canvas_id(page, 'B') + '"]').click()
    page.wait_for_function("document.querySelector('#state').textContent.includes('Connected')")
    assert 'Connected A to B' in page.locator('#state').inner_text()
    made = canvas_id(page, 'Link1')
    label = page.locator('#diagram [data-pikchr-id="' + made + '"]').get_attribute('aria-label')
    assert 'endpoints editable' in label, label

    # The layout's contextual toolbar drives the same direct action through
    # the studio API, which must cancel back to Select like the dock button.
    close_popovers(page)
    object_button(page, 'E').click()
    open_more(page)
    page.evaluate("window.pikchrStudio.reconnect('to')")
    expect(page.locator('.cl-more')).to_be_hidden()
    assert 'Reconnecting the arrowhead' in page.locator('#state').inner_text()
    assert page.evaluate("document.querySelector('#diagram').dataset.tool") == 'to'
    page.keyboard.press('Escape')
    expect(page.locator('#state')).to_contain_text('Cancelled. No change applied.')

    assert not errors, errors
    browser.close()
    print("PASS: truthful connector labels, inspector split, direct reconnect closes inspector,")
    print("      current-action status, Escape cancel, source-order rejection cancels, connected status")