"""Isolated real-browser regressions for route review, reuse and portable exports."""
import json
import re
import struct
import tempfile
from pathlib import Path
from browser_helpers import show_source, reveal, set_source, set_auto_apply, open_document_menu, object_button
from playwright.sync_api import sync_playwright, expect


with sync_playwright() as pw, tempfile.TemporaryDirectory(prefix="pikchr-reuse-test-") as directory:
    browser = pw.chromium.launch(channel="chrome")
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:8790/?advanced=1")
    page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")

    def open_details(selector):
        # .document-menu is the ☰ menu; .component-tools lives inside it.
        open_document_menu(page)
        if selector != ".document-menu":
            details = page.locator(selector)
            if details.get_attribute("open") is None:
                details.locator("summary").first.click()

    source = page.locator("#source")
    baseline = 'A: box "Start" at (0,0)\nB: box "Finish" at (4,0)\nObstacle: box "Obstacle" width 1 height 1 at (2,0)\nO: arrow "flow" from A.e to B.w color blue\n'
    set_source(page, baseline)
    expect(page.locator("#state")).to_contain_text("Rendered 4 objects")
    set_auto_apply(page, True)
    def select(name, additive=False):
        object_button(page, name).click(modifiers=["Shift"] if additive else [])

    def settled(text=None):
        if text is not None:
            expect(source).to_have_value(text)
        page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")
        expect(page.locator("#queue-list li")).to_have_count(0)

    # The same canvas changes in review, while source/history remain untouched.
    select("O")
    before_svg = page.locator("#diagram").inner_html()
    reveal(page, "#tidy-route").click()
    review = page.get_by_role("dialog", name="Proposed route")
    expect(review.get_by_role("button", name="Use route", exact=True)).to_be_enabled()
    expect(source).to_have_value(baseline)
    assert page.locator("#diagram").inner_html() != before_svg
    review.get_by_role("button", name="Cancel", exact=True).click()
    expect(review).not_to_be_visible()
    settled(baseline)
    expect(page.locator("#diagram [data-pikchr-id]")).to_have_count(4)
    reveal(page, "#tidy-route").click()
    expect(review.get_by_role("button", name="Use route", exact=True)).to_be_enabled()
    review.get_by_role("button", name="Use route", exact=True).click()
    expect(source).not_to_have_value(baseline)
    assert "then to" in source.input_value()
    settled()
    reveal(page, "#canvas-undo").click()
    settled(baseline)

    # Selecting only both endpoint shapes includes their internal named edge.
    select("A")
    select("B", additive=True)
    reveal(page, "#copy-selection").click()
    reveal(page, "#paste-selection").click()
    expect(page.locator("#objects button")).to_have_count(7)
    pasted = source.input_value()
    assert 'A2: box "Start"' in pasted and 'B2: box "Finish"' in pasted
    assert 'O2: arrow "flow" from A2.e to B2.w' in pasted
    assert pasted.count("Obstacle:") == 1
    reveal(page, "#canvas-undo").click()
    settled(baseline)
    expect(page.locator("#objects button")).to_have_count(4)

    select("A")
    select("B", additive=True)
    open_details(".component-tools")
    reveal(page, "#component-name").fill("Start and finish")
    reveal(page, "#save-component").click()
    expect(page.locator("#components option")).to_have_count(1)
    expect(page.locator("#components option")).to_have_text("Start and finish")
    reveal(page, "#insert-component").click()
    expect(page.locator("#objects button")).to_have_count(7)
    assert 'O2: arrow "flow" from A2.e to B2.w' in source.input_value()
    reveal(page, "#canvas-undo").click()
    settled(baseline)

    # Downloads are actual assets, not just a button/status success.
    open_details(".document-menu")
    with page.expect_download() as png_event:
        reveal(page, "#export-png").click()
    png_path = Path(directory) / "diagram.png"
    png_event.value.save_as(png_path)
    png = png_path.read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    width, height = struct.unpack(">II", png[16:24])
    assert width > 0 and height > 0
    select("A")
    with page.expect_download() as svg_event:
        reveal(page, "#export-selection").click()
    svg_path = Path(directory) / "selection.svg"
    svg_event.value.save_as(svg_path)
    svg = svg_path.read_text()
    assert "<svg" in svg and "viewBox=" in svg
    assert "selection-outline" not in svg and "canvas-overlay" not in svg

    # Restoring adds document copies and leaves both current source and ID alone.
    page.wait_for_function("document.querySelector('#documents').value !== 'Current diagram'")
    active = page.locator("#documents").input_value()
    document_count = page.locator("#documents option").count()
    with page.expect_download() as backup_event:
        reveal(page, "#backup-workspace").click()
    backup_path = Path(directory) / "workspace.json"
    backup_event.value.save_as(backup_path)
    backup = json.loads(backup_path.read_text())
    assert backup["version"] == 1 and len(backup["documents"]) == document_count
    assert any(record["state"]["source"] == baseline for record in backup["documents"])
    with page.expect_file_chooser() as chooser:
        reveal(page, "#restore-workspace").click()
    chooser.value.set_files(backup_path)
    expect(page.locator("#state")).to_contain_text("Restored " + str(document_count) + " document copies")
    expect(page.locator("#documents option")).to_have_count(document_count * 2)
    expect(page.locator("#documents")).to_have_value(active)
    settled(baseline)
    assert not errors, errors
    context.close()
    browser.close()
    print("PASS: same-canvas route preview/cancel/apply/Undo; connected subgraph copy/paste; reusable components; real PNG/selection SVG downloads; backup restore copies preserve active document")
