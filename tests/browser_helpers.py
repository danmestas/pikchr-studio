"""User-visible setup for browser tests; no hidden application-state changes.

Studio has one layout: a full-viewport canvas with floating chrome. Controls
live in the ☰ menu, the ⋯ selection popover, the export menu or the source
drawer. These helpers open whichever container holds a control, the way a
person would, before the test interacts with it.
"""
import re
from playwright.sync_api import expect

MENU = '.cl-menu'
MORE = '.cl-more'
EXPORT = '.cl-export'
DRAWER = '.cl-drawer'

def _open(page, panel, button):
    if page.locator(panel).is_hidden():
        page.locator(button).click()
        expect(page.locator(panel)).to_be_visible()

def wait_rendered(page):
    """Wait until the app chrome exists (an empty program renders no SVG)."""
    page.set_default_timeout(10000)
    page.wait_for_function("window.pikchrStudio && document.querySelector('.cl-doc')")

def open_document_menu(page):
    wait_rendered(page)
    _open(page, MENU, '.cl-doc [aria-label="Menu"]')

def close_popovers(page):
    page.evaluate("document.querySelectorAll('.cl-popover:not([hidden])').forEach(p=>p.opener?p.opener.click():p.hidden=true)")

def open_more(page):
    """Open the ⋯ inspector popover for the current selection."""
    if page.locator(MORE).is_hidden():
        button = page.locator('.cl-context [aria-label="More options"]')
        if button.is_visible():
            button.click()
        else:
            open_document_menu(page)
            page.locator('#mobile-objects').click()
        expect(page.locator(MORE)).to_be_visible()

def open_export(page):
    _open(page, EXPORT, '.cl-doc [aria-label="Export"]')

def show_source(page):
    wait_rendered(page)
    if 'open' not in (page.locator(DRAWER).get_attribute('class') or ''):
        page.locator('.cl-doc [aria-label="Source"]').click()
    expect(page.locator('#source')).to_be_visible()

def hide_source(page):
    if 'open' in (page.locator(DRAWER).get_attribute('class') or ''):
        page.locator('.cl-doc [aria-label="Source"]').click()

def set_source(page, text):
    """Type a whole program through the source drawer, wait for its render
    (or its error), then close the drawer."""
    show_source(page)
    page.locator('#source').fill(text)
    render_source(page)
    page.wait_for_function("""(text)=>{const s=window.pikchrStudio.state();const d=document.querySelector('#diagnostic');
      return s.source===text&&(s.valid||(d&&d.textContent.trim().length>0))}""", arg=text)
    hide_source(page)

def reveal(page, selector):
    """Open the menu, popover, drawer and <details> that contain selector."""
    where = page.evaluate("""sel=>{const e=document.querySelector(sel);if(!e)return null;
      return {menu:!!e.closest('.cl-menu'),more:!!e.closest('.cl-more'),exp:!!e.closest('.cl-export'),drawer:!!e.closest('.cl-drawer')}}""", selector)
    if where:
        if where['menu']:
            open_document_menu(page)
        elif where['more']:
            open_more(page)
        elif where['exp']:
            open_export(page)
        elif where['drawer']:
            show_source(page)
        else:
            close_popovers(page)   # a canvas control: uncover the canvas
    target = page.locator(selector)
    for details in target.locator('xpath=ancestor::details').all():
        if details.get_attribute('open') is None:
            details.locator(':scope > summary').click()
    return target

def open_label_dialog(page):
    """The label sizing dialog opens from ⋯ › Label options…"""
    open_more(page)
    page.locator('.cl-label-options').click()
    dialog = page.locator('[aria-labelledby="canvas-label-title"]')
    expect(dialog).to_be_visible()
    return dialog

def edit_label(page, text, mode='grow'):
    dialog = open_label_dialog(page)
    dialog.get_by_label('Canvas label', exact=True).fill(text)
    dialog.get_by_label('Text sizing', exact=True).select_option(mode)
    done = dialog.get_by_role('button', name='Done', exact=True)
    expect(done).to_be_enabled()
    done.click()
    expect(dialog).not_to_be_visible()

def object_button(page, name):
    if not page.locator('#objects').is_visible():
        open_document_menu(page)
        page.locator('#mobile-objects').click()
        expect(page.locator(MORE)).to_be_visible()
        details = page.locator('#objects').locator('xpath=ancestor::details[1]')
        if details.count() and details.get_attribute('open') is None:
            details.locator(':scope > summary').click()
    return page.locator('#objects').get_by_role('button', name=re.compile(r'^' + re.escape(name) + r'(?: ·|$)'))

def shape_option(page, field, name):
    picker = page.get_by_role('combobox', name=field, exact=True)
    options = picker.locator('option')
    for index in range(options.count()):
        option = options.nth(index)
        text = option.text_content()
        if text == name or text.endswith(' (' + name + ')'):
            picker.select_option(option.get_attribute('value'))
            return
    raise AssertionError('Missing shape option ' + name)

def open_example(page, key):
    open_document_menu(page)
    page.locator('#choose-example').click()
    page.locator('#example-picker [data-key="' + key + '"]').click()
    page.locator('#example-picker [data-use]').click()
    page.wait_for_function("!document.querySelector('#example-picker').open")

def queue_mode(page):
    """Switch to queue mode: changes wait for Apply all instead of applying."""
    open_document_menu(page)
    page.locator('#auto-apply').uncheck()
    close_popovers(page)

def prepare_legacy(page):
    """Queue mode with anchors shown, for tests that inspect queued drafts."""
    open_document_menu(page)
    page.locator('#auto-apply').uncheck()
    page.locator('#anchors').check()
    close_popovers(page)

def render_source(page):
    """Render now with the source drawer's Render button (normally automatic)."""
    show_source(page)
    page.locator('.cl-drawer-head').get_by_role('button', name='Render', exact=True).click()

def open_menu_details(page, title, within='#creation-tools'):
    """Open a named <details> section inside the ☰ menu."""
    open_document_menu(page)
    if within == '#creation-tools' and not page.locator('#creation-tools').is_visible():
        page.locator('#mobile-add').click()   # "Add by coordinates" reveals the form
    summary = page.locator(within + ' summary').filter(has_text=re.compile('^' + re.escape(title) + '$'))
    if summary.locator('..').get_attribute('open') is None:
        summary.click()

def menu_click(page, selector):
    """Click a control that lives in a menu or popover, then close it so the
    canvas is uncovered again (what a person does next)."""
    reveal(page, selector).click()
    close_popovers(page)

def set_auto_apply(page, on):
    """☰ › Changes › Auto-apply, then close the menu."""
    box = reveal(page, '#auto-apply')
    box.check() if on else box.uncheck()
    close_popovers(page)
