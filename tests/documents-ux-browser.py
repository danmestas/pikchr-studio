"""Documents, menu and export UX: per-document retained diagram, rename, delete,
dialog focus, download confirmation, export availability, focus return, zoom label."""
import os
import re
from playwright.sync_api import expect, sync_playwright
from browser_helpers import (open_document_menu, open_export, export_item, set_selection_only,
                             set_source, close_popovers, open_document, wait_rendered, open_advanced)

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/")
    wait_rendered(page)
    documents = page.locator("#documents")
    feedback = page.locator("#canvas-feedback")

    def saved():
        page.wait_for_function("document.querySelector('#save-state').dataset.state === 'saved'")

    def new_document(source):
        open_document_menu(page)
        page.locator("#new-document").click()
        set_source(page, source)
        saved()
        return documents.input_value()

    def diagram_text():
        return page.evaluate("document.querySelector('#diagram').textContent")

    # ---- 8. the zoom chip always shows a percentage ----
    assert re.fullmatch(r"\d+%", page.locator("#zoom-level").inner_text()), page.locator("#zoom-level").inner_text()
    assert page.locator("#fit-view").inner_text() == "Fit"

    # ---- 1. an invalid document never shows another document's diagram ----
    q = new_document('box "Q"\n')
    set_source(page, 'box "Q"\nbogus\n')
    saved()
    other = new_document('box "Other"\n')
    never = new_document('bogus\n')
    open_document(page, id=other)
    page.wait_for_function("document.querySelector('#diagram').textContent.includes('Other')")
    open_document(page, id=q)
    page.wait_for_function("document.querySelector('#source').value.includes('bogus')")
    page.wait_for_function("document.querySelector('#diagnostic').textContent.trim().length > 0")
    text = diagram_text()
    assert "Q" in text and "Other" not in text, text
    assert "stale" in page.locator("#diagram").get_attribute("class")
    open_document(page, id=never)
    page.wait_for_function("document.querySelector('#source').value === 'bogus\\n'")
    page.wait_for_function("document.querySelector('#diagnostic').textContent.trim().length > 0 && !document.querySelector('#diagram svg')")
    assert page.locator("#diagram svg").count() == 0, diagram_text()
    assert "Other" not in diagram_text() and "Q" not in diagram_text()
    assert "Last valid" not in page.locator("#state").inner_text()

    # ---- 2. rename: explicit, cancellable, and it stops the automatic name ----
    open_document(page, id=other)
    title = page.locator(".cl-title")
    expect(title).to_have_text("Other")
    title.click()
    field = page.locator(".cl-title-input")
    expect(field).to_be_focused()
    field.fill("Scratch")
    page.keyboard.press("Escape")
    expect(page.locator(".cl-title-input")).to_have_count(0)
    expect(title).to_have_text("Other")
    expect(title).to_be_focused()
    page.keyboard.press("Enter")
    field = page.locator(".cl-title-input")
    field.fill("Architecture")
    page.keyboard.press("Enter")
    expect(title).to_have_text("Architecture")
    saved()
    set_source(page, 'box "Renamed label"\n')
    saved()
    expect(title).to_have_text("Architecture")
    page.reload()
    wait_rendered(page)
    expect(page.locator(".cl-title")).to_have_text("Architecture")
    assert "Architecture" in documents.locator("option").all_text_contents(), documents.locator("option").all_text_contents()

    # ---- 2. delete: confirmation says what happens to stored data ----
    open_document_menu(page)
    key = lambda doc: page.evaluate("id => localStorage.getItem('pikchr-studio.document.v1.' + id) !== null", doc)
    assert key(never)
    row = page.locator(".cl-recent-row", has=page.locator(f'button[data-id="{never}"]'))
    row.get_by_role("button", name=re.compile("^Delete")).click()
    confirm = page.locator(".cl-recent-confirm")
    expect(confirm).to_be_visible()
    note = confirm.inner_text()
    assert "from this browser" in note and "cannot be undone" in note and "Backups you downloaded are not affected" in note, note
    confirm.get_by_role("button", name="Cancel").click()
    expect(confirm).to_have_count(0)
    assert key(never)
    row.get_by_role("button", name=re.compile("^Delete")).click()
    confirm.get_by_role("button", name="Delete", exact=True).click()
    page.wait_for_function("id => !document.querySelector(`#documents option[value=\"${id}\"]`)", arg=never)
    assert not key(never)
    # Deleting the open document opens another one, never an empty ghost of the deleted one.
    active = documents.input_value()
    row = page.locator(".cl-recent-row", has=page.locator(f'button[data-id="{active}"]'))
    row.get_by_role("button", name=re.compile("^Delete")).click()
    confirm.get_by_role("button", name="Delete", exact=True).click()
    page.wait_for_function("id => !document.querySelector(`#documents option[value=\"${id}\"]`)", arg=active)
    assert not key(active)
    assert documents.input_value() != active
    close_popovers(page)

    # ---- 3. Examples dialog: menu closes, one Escape closes the dialog, focus returns ----
    open_document_menu(page)
    page.locator("#choose-example").click()
    expect(page.locator("#example-picker")).to_be_visible()
    expect(page.locator(".cl-menu")).to_be_hidden()
    page.keyboard.press("Escape")
    expect(page.locator("#example-picker")).to_be_hidden()
    expect(page.locator('.cl-doc [aria-label="Menu"]')).to_be_focused()

    # ---- 7. picking a recent document returns focus to the menu button ----
    open_document(page, id=q)
    expect(page.locator('.cl-doc [aria-label="Menu"]')).to_be_focused()

    # ---- 7. Escape from Find returns focus to whatever opened it ----
    page.locator("#diagram").focus()
    page.keyboard.press("/")
    expect(page.locator(".cl-more")).to_be_visible()
    expect(page.locator("#object-search")).to_be_focused()
    page.keyboard.press("Escape")
    expect(page.locator(".cl-more")).to_be_hidden()
    expect(page.locator("#diagram")).to_be_focused()
    page.locator('.cl-zoom [aria-label="Find object"]').click()
    expect(page.locator(".cl-more")).to_be_visible()
    expect(page.locator("#object-search")).to_be_focused()
    page.keyboard.press("Escape")
    expect(page.locator('.cl-zoom [aria-label="Find object"]')).to_be_focused()

    # ---- 10. Advanced is always in the menu, collapsed, and the menu fits ----
    open_document_menu(page)
    advanced = page.locator("details.cl-advanced")
    expect(advanced.locator("summary")).to_be_visible()
    assert advanced.get_attribute("open") is None
    open_advanced(page)
    expect(page.locator("#backup-workspace")).to_be_visible()
    expect(page.locator("#restore-workspace")).to_be_visible()
    fits = page.evaluate("(()=>{const m=document.querySelector('.cl-menu');return [m.scrollHeight,m.clientHeight]})()")
    assert fits[0] <= fits[1], fits
    close_popovers(page)

    # ---- 4/5/6. export: downloads confirm, source ignores Selection only, invalid disables images ----
    new_document('A: box "A"\nB: box "B" at (2,0)\n')
    for group, name, filename in (("Download", "SVG", "diagram.svg"), ("Download", "PNG", "diagram.png"), ("Download", "Source", "diagram.pikchr")):
        with page.expect_download() as transfer:
            export_item(page, group, name).click()
        assert transfer.value.suggested_filename == filename
        expect(page.locator("#state")).to_have_text("Downloaded " + filename)
        expect(feedback).to_have_text("Downloaded " + filename)
        close_popovers(page)
    page.locator('#diagram [data-pikchr-id="o1"]').click()
    set_selection_only(page, True)
    for name in ("Pikchr source",):
        expect(export_item(page, "Copy", name)).to_be_disabled()
    expect(export_item(page, "Download", "Source")).to_be_disabled()
    expect(page.locator("#export-note")).to_have_text("Source always exports the whole document")
    expect(export_item(page, "Download", "SVG")).to_be_enabled()
    set_selection_only(page, False)
    expect(export_item(page, "Download", "Source")).to_be_enabled()
    expect(page.locator("#export-note")).to_be_hidden()
    close_popovers(page)

    set_source(page, 'A: box "A"\nbogus\n')
    page.wait_for_function("document.querySelector('#diagnostic').textContent.trim().length > 0")
    for group, name in (("Copy", "SVG"), ("Download", "SVG"), ("Download", "PNG")):
        item = export_item(page, group, name)
        expect(item).to_be_disabled()
        assert item.get_attribute("title") == "Fix the syntax error to export"
    expect(page.locator("#export-note")).to_have_text("Fix the syntax error to export")
    expect(export_item(page, "Download", "Source")).to_be_enabled()
    expect(export_item(page, "Copy", "Pikchr source")).to_be_enabled()
    close_popovers(page)

    # ---- 11. Export and the Source drawer never overlap ----
    page.locator('.cl-doc [aria-label="Source"]').click()
    expect(page.locator(".cl-drawer")).to_have_class(re.compile("open"))
    page.locator('.cl-doc [aria-label="Export"]').click()
    expect(page.locator(".cl-export")).to_be_visible()
    assert "open" not in page.locator(".cl-drawer").get_attribute("class")
    assert page.locator('.cl-doc [aria-label="Source"]').get_attribute("aria-pressed") == "false"

    assert not errors, errors
    browser.close()
    print("PASS: per-document retained diagram, rename, delete with confirmation, dialog and Find focus, "
          "download confirmation, export availability, Advanced disclosure, export vs drawer")
