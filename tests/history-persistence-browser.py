"""Reconnecting an anonymous arrow, then routing and relabelling it, must keep
one undoable history that survives a reload and a document switch.

The fixture is two anonymous arrows plus a box added after both, the shape a
person draws when they route a link back to a newer box. Each step goes through
the supported canvas controls (reconnect, Routing, Stroke, connector label),
so the test proves what a person sees rather than what the code holds.
"""
import os
import re
from playwright.sync_api import sync_playwright
from browser_helpers import (object_button, open_more, close_popovers, set_source, show_source,
                             open_document_menu, set_auto_apply, reveal, connector_editor, inspector_section)

STUDIO = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
INITIAL = (
    'Client: box "Client" at (0,0)\n'
    'Service: box "Service" at (2,0)\n'
    'Database: cylinder "Database" at (4,0)\n'
    'arrow from Client.e to Service.w\n'
    'arrow from Service.e to Database.w\n'
    'Shape1: box "Target" at (2,-1)\n'
)
SAVED = ("document.querySelector('#save-state').dataset.state === 'saved' && "
         "document.querySelector('#save-state').textContent === 'Saved on this browser'")

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(STUDIO + "/")
    source = page.locator("#source")

    def rendered():
        page.wait_for_function("document.querySelector('#diagram svg') && !document.querySelector('#diagram').classList.contains('stale')")

    def value():
        return source.input_value()

    def settled(expected):
        rendered()
        page.wait_for_function("text => document.querySelector('#source').value === text", arg=expected)
        page.wait_for_function(SAVED)

    def stored():
        return page.evaluate("""() => {
          const id = sessionStorage.getItem('pikchr-studio.current-document.v1')
            || localStorage.getItem('pikchr-studio.last-document.v1');
          const raw = localStorage.getItem('pikchr-studio.document.v1.' + id);
          return raw === null ? null : JSON.parse(raw).state; }""")

    def report(label):
        # Literal keys of the saved record; each must describe this document.
        record = stored()
        assert record is not None, label + ": document was not saved"
        assert record["source"] == value(), label + ": saved source is not the shown source"
        return record

    def select(name):
        # The object list and the connector editor share the ⋯ popover.
        object_button(page, name).click()

    def click_model(point):
        spot = page.evaluate("p => pikchrStudio.modelToScreen(p)", point)
        page.mouse.click(spot["x"], spot["y"])

    def accept_preview():
        page.wait_for_function("!document.querySelector('#preview-actions').hidden")
        page.locator("#preview-accept").click()

    def opened_document(title):
        open_document_menu(page)
        reveal(page, "#documents").select_option(label=title)
        page.wait_for_function("t => document.querySelector('.cl-title')?.textContent === t", arg=title)

    show_source(page)
    set_source(page, INITIAL)
    set_auto_apply(page, True)
    page.wait_for_function(SAVED)
    base = value()
    edited = []
    first_title = page.locator(".cl-title").text_content()

    # 1. The first anonymous arrow, pointed at a box that follows both arrows.
    select("arrow o4")
    open_more(page)
    page.locator(".cl-more").get_by_role("button", name="Reconnect end", exact=True).click()
    close_popovers(page)
    click_model({"x": 2, "y": -1})
    page.wait_for_function("window.pikchrStudio.state().source.includes('to Shape1.')")
    page.wait_for_function(SAVED)
    reconnected = value()
    assert "arrow from Client.e to Shape1.s" in reconnected, reconnected
    report("reconnect")
    edited.append((reconnected, "reconnect"))

    # The connector keeps one identity while routing and styling it.
    assert re.search(r"(?m)^arrow from Client\.e to Shape1\.s$", reconnected), reconnected
    conn = "arrow o6"
    select(conn)
    connector_editor(page)
    page.get_by_role("button", name="Routing", exact=True).click()
    page.get_by_role("button", name="Horizontal first", exact=True).click()
    page.wait_for_function("window.pikchrStudio.state().source.includes('then to Shape1.s')")
    page.wait_for_function(SAVED)
    routed = value()
    assert re.search(r"(?m)^arrow from Client\.e to \(Shape1\.s, Client\.e\) then to Shape1\.s$", routed), routed
    report("route")
    edited.append((routed, "route"))

    select(conn)
    inspector_section(page, "Style").locator("[role=group][aria-label=Stroke]").get_by_role("button", name="Dashed").click()
    accept_preview()
    page.wait_for_function("window.pikchrStudio.state().source.includes('to Shape1.s dashed')")
    page.wait_for_function(SAVED)
    dashed = value()
    report("stroke")
    edited.append((dashed, "stroke"))

    select(conn)
    page.get_by_label("Connector label").fill("retry")
    page.get_by_label("Label placement").select_option("above")
    page.locator(".route-label-form").get_by_role("button", name="Add label").click()
    accept_preview()
    page.wait_for_function("window.pikchrStudio.state().source.includes('\"retry\" above')")
    page.wait_for_function(SAVED)
    labelled = value()
    assert re.search(r"(?m)^arrow from Client\.e to \(Shape1\.s, Client\.e\) then to Shape1\.s dashed \"retry\" above$", labelled), labelled
    record = report("label")
    edited.append((labelled, "label"))

    # The other anonymous connector is untouched at every step.
    for text, step in edited:
        assert "arrow from Service.e to Database.w" in text, step + ": collateral connector changed"
        assert len(re.findall(r"(?m)^arrow ", text)) == 2, step + ": connector count changed"
    assert len(record["undo"]) == len(edited) + 1, record["undo"]
    assert record["redo"] == [], record["redo"]
    assert record["draft"] == [] and record["draftBase"] is None, record
    assert record["autoApply"] is True and record["applied"] is True, record

    # The object list names the same connector and the untouched one.
    names = page.locator("#objects button").all_inner_texts()
    assert any(re.match(r"arrow o6 · retry · Client → Shape1", n) for n in names), names
    assert any(re.match(r"arrow o4 · Service → Database", n) for n in names), names

    # 2. Reload restores the exact source and the whole undo history.
    page.reload()
    open_document_menu(page)
    show_source(page)
    settled(labelled)
    reloaded = report("reload")
    assert len(reloaded["undo"]) == len(edited) + 1, reloaded["undo"]

    # 3. Undo walks the same identities back, one applied step at a time.
    for expected, step in reversed(edited[:-1]):
        page.locator("#canvas-undo").click()
        settled(expected)
        assert "arrow from Service.e to Database.w" in value(), step + ": collateral connector lost on undo"
    page.locator("#canvas-undo").click()
    settled(base)
    assert "arrow from Client.e to Service.w" in value(), value()

    # 4. Redo returns the labelled connector after the reload.
    page.locator("#canvas-redo").click()
    settled(reconnected)
    assert "arrow from Client.e to Shape1.s" in value(), value()

    # 5. A new edit after Undo branches the history: the redo path is gone.
    page.locator("#canvas-undo").click()
    settled(base)
    select("Database")
    page.locator("#diagram").focus()
    page.keyboard.press("ArrowDown")
    page.wait_for_function("text => document.querySelector('#source').value !== text", arg=base)
    page.wait_for_function(SAVED)
    branched = value()
    assert 'Database: cylinder "Database" at (4, -0.1)' in branched, branched
    assert page.locator("#canvas-redo").is_disabled(), "redo survived a branched history"
    branch_record = report("branch")
    assert branch_record["redo"] == [], branch_record["redo"]
    assert branch_record["undo"][-1] == base, branch_record["undo"]

    # 6. A queued change undone before a switch leaves a queued redo, and that
    #    document still saves once reopened in a browser set to auto-apply.
    set_auto_apply(page, False)
    select("Service")
    page.locator("#diagram").focus()
    page.keyboard.press("ArrowUp")
    page.wait_for_function("window.pikchrStudio.state().queued === 1")
    page.wait_for_function(SAVED)
    page.locator("#canvas-undo").click()
    page.wait_for_function("window.pikchrStudio.state().queued === 0")
    page.wait_for_function(SAVED)
    queued_redo = stored()
    assert len(queued_redo["draftRedo"]) == 1, queued_redo["draftRedo"]
    assert page.locator("#canvas-redo").is_enabled(), "queued redo is not offered"

    reveal(page, "#new-document").click()
    page.wait_for_function("document.querySelector('#source').value === ''")
    close_popovers(page)
    show_source(page)
    set_source(page, 'Other: box "Other" at (0,0)')
    page.wait_for_function(SAVED)
    set_auto_apply(page, True)
    page.wait_for_function(SAVED)
    assert page.evaluate("localStorage.getItem('pikchr-studio.queue-mode')") == "0"

    opened_document(first_title)
    rendered()
    page.wait_for_function("text => document.querySelector('#source').value === text", arg=branched)
    try:
        page.wait_for_function(SAVED, timeout=5000)
    except Exception:
        raise AssertionError("reopened document cannot be saved: "
                             + page.locator("#save-state").inner_text()) from None
    reopened = report("reopen")
    assert len(reopened["draftRedo"]) == 1, reopened["draftRedo"]
    select("Service")
    page.locator("#diagram").focus()
    page.keyboard.press("ArrowUp")
    page.wait_for_function("text => document.querySelector('#source').value !== text", arg=branched)
    page.wait_for_function(SAVED)
    after_reopen = report("edit after reopen")
    assert len(after_reopen["draftRedo"]) == 0, after_reopen["draftRedo"]

    # The newly created document is intact.
    opened_document("Other")
    settled('Other: box "Other" at (0,0)')

    assert not errors, errors
    browser.close()
    print("PASS: anonymous connector identity across reconnect/route/stroke/label, "
          "collateral connector preserved, undo/redo across reload, branched history clears redo, "
          "queued redo survives a document switch in an auto-apply browser")
