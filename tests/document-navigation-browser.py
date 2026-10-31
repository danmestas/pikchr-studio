"""Saved documents remain reachable without enabling advanced tools."""
import os
from playwright.sync_api import expect, sync_playwright
from browser_helpers import open_document_menu, set_source, reveal, open_document

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
FIRST = 'A: box "First" at (0,0)\n'
SECOND = 'B: box "Second" at (0,0)\n'

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/")
    open_document_menu(page)
    expect(page.locator("#advanced-mode")).not_to_be_checked()
    documents = page.locator("#documents")
    source = page.locator("#source")

    def saved(text):
        page.wait_for_function("text => document.querySelector('#source').value === text && "
                               "document.querySelector('#save-state').dataset.state === 'saved'", arg=text)

    def reachable():
        open_document_menu(page)
        rows = page.locator(".cl-recent button")
        expect(rows.first).to_be_visible()
        assert rows.count() == documents.locator("option").count()
        page.locator("#new-document").focus()
        page.keyboard.press("Tab")
        expect(page.locator("#open-document")).to_be_focused()
        page.keyboard.press("Tab")
        expect(page.locator("#choose-example")).to_be_focused()
        page.keyboard.press("Tab")
        expect(rows.first).to_be_focused()

    set_source(page, FIRST)
    saved(FIRST)
    first = documents.input_value()
    reveal(page, "#new-document").click()
    page.wait_for_function("document.querySelector('#source').value === ''")
    set_source(page, SECOND)
    saved(SECOND)
    second = documents.input_value()
    assert first != second
    reachable()
    assert documents.locator("option").count() == 2
    open_document(page, id=first)
    saved(FIRST)
    expect(source).to_have_value(FIRST)
    for target, text in ((second, SECOND), (first, FIRST)):
        reachable()
        open_document(page, id=target)
        expect(documents).to_have_value(target)
        saved(text)

    # Advanced tools changes other controls, never basic document navigation.
    for advanced in (True, False):
        open_document_menu(page)
        page.locator("#advanced-mode").set_checked(advanced)
        reachable()
    page.reload()
    saved(FIRST)
    reachable()
    expect(page.locator("#advanced-mode")).not_to_be_checked()
    open_document(page, id=second)
    saved(SECOND)
    reachable()
    open_document(page, id=first)
    saved(FIRST)
    assert not errors, errors
    browser.close()
    print("PASS: default-mode saved documents are visible and keyboard reachable; "
          "independent sources survive switching, advanced-mode toggles, and reload")
