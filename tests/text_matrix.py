"""Text-editing matrix: every object kind x every way its label is written x
every placement form x every way into the on-canvas editor x every edit, at
desktop and phone size, in light and dark.

For every cell the label editor is opened on that object and must:
  (a) never lose text: after any commit the source holds exactly what was
      typed, correctly escaped, and the render shows it; a refusal keeps the
      editor open with a role=alert reason and the typed text;
  (b) write a minimal diff: only that statement's strings and size clauses
      change, untouched strings keep their styles, everything else is
      byte-identical, and Escape or a no-change commit writes nothing;
  (c) size the shape as its Text fit says without moving its anchor;
  (d) sit over the label, unclipped, uncovered by the text bar, toolbar,
      sheet or keyboard, following pan and zoom, with a visible caret;
  (e) show a text bar that reflects the label's style and applies a style
      mid-edit without losing what was typed (44px targets on touch);
  (f) undo and redo exactly;
  (g) raise no console errors.
The in-page half is text-matrix.js and runs batches of cells per page. The
real-input cells here drive the keyboard, IME composition (CDP), paste, the
Text tool, touch taps and a shrinking viewport (the on-screen keyboard).
text-matrix-desktop-browser.py and text-matrix-phone-browser.py each run
half of the configurations.
"""
import os
import sys
import time
from collections import Counter
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_helpers import wait_rendered

DEADLINE = float(os.environ.get("TEXT_MATRIX_DEADLINE", "170"))
BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
HARNESS = Path(__file__).with_name("text-matrix.js")

SHAPES = ["box", "circle", "ellipse", "oval", "cylinder", "diamond", "file", "text"]
CONNECTORS = ["arrow", "line", "spline"]

# Starting text: (name, label clause for a shape, for a connector).
STARTS = [
    ("none", "", ""),
    ("one string", '"Label"', '"Label"'),
    ("several strings", '"one" "two" "three"', '"one" "two"'),
    ("bold and italic strings", '"strong" bold "slant" italic', '"strong" bold above "slant" italic below'),
    ("mono big small", '"code" mono big "fine" small', '"code" mono big above'),
    ("ljust rjust", '"left" ljust "right" rjust', '"left" ljust above'),
    ("above below", '"top" above "low" below', '"top" above "low" below'),
    ("fit", '"Label" fit', None),
    ("explicit size", '"Label" wid 1.6 ht 0.7', None),
    ("color", '"Label" color blue', '"Label" above color blue'),
    ("quotes", r'"say \"hi\""', r'"say \"hi\"" above'),
    ("backslashes", r'"C:\\dir\\"', r'"C:\\dir\\" above'),
    ("comment characters", '"# not /* a comment"', '"# not // a comment" above'),
    ("accents", '"café naïve"', '"café" above'),
    ("CJK", '"日本語"', '"日本語" above'),
    ("emoji", '"ok 🎉"', '"ok 🎉" above'),
    ("RTL", '"שלום"', '"שלום" above'),
    ("combining marks", '"e\u0301te\u0301"', '"e\u0301te\u0301" above'),
    ("very long word", '"Supercalifragilisticexpialidocious"', '"Supercalifragilisticexpialidocious" above'),
]

# Placement forms for the shape under test (X), around one anchor box.
PLACEMENTS = {
    "literal at": ("", "X: {kind} {label} at (1,0)", "X"),
    "relative": ('A: box "anchor"\n', "X: {kind} {label} at A + (2,0)", "X"),
    "unnamed chain": ('box "anchor"\narrow\n', "{kind} {label}", "index:2"),
    "expression": ('A: box "anchor"\n', "X: {kind} {label} at (A.x + 2, A.y)", "X"),
}
CONNECTOR_PLACEMENTS = {
    "from to": ('A: box "A"\nB: box "B" at (3,0)\n', "{kind} from A.e to B.w {label}", "index:2"),
    "direction": ('A: box "A"\n', "{kind} right 2 {label}", "index:1"),
    "unnamed chain": ('box "A"\n', "{kind} right 2 {label}\nbox \"B\"", "index:1"),
    "expression": ('A: box "A"\nB: box "B" at (3,1)\n', "{kind} from (A.x, A.y + 0.1) to B.w {label}", "index:2"),
}

ENTRIES = ["dblclick", "enter", "inspector"]
EDITS = ["replace", "newline", "delete", "paste", "quotes", "ime", "escape", "blur", "nochange", "style"]
TYPED = ["New label", "naïve 日本 🎉", "שלום עולם", "e\u0301te\u0301 combining", "A_very_long_unbroken_word_for_wrapping"]

# A comment and a neighbour on every source: both must stay byte-identical.
FRAME_TOP = "# keep: this comment\n"
FRAME_END = '\nZ: box "after" at (0,-2) # trailing note\n'


def cell(name, source, key, kind, start, placement, entry, edit, typed="", **extra):
    return {"name": name, "source": source, "key": key, "kind": kind, "start": start, "placement": placement,
            "entry": entry, "edit": edit, "typed": typed, **extra}


def build():
    cells = []
    n = 0
    for kind in SHAPES + CONNECTORS:
        connector = kind in CONNECTORS
        places = CONNECTOR_PLACEMENTS if connector else PLACEMENTS
        names = list(places)
        for si, (start, shape_label, line_label) in enumerate(STARTS):
            label = line_label if connector else shape_label
            if label is None:
                continue
            # The plain forms run every edit; the others two edits each, rotated.
            if start in ("none", "one string"):
                edits = EDITS
            else:
                edits = [EDITS[(si + SHAPES.index(kind) if kind in SHAPES else si) % len(EDITS)], EDITS[(si * 3 + 1) % len(EDITS)]]
            for ei, edit in enumerate(edits):
                n += 1
                placement = names[(si + ei) % len(names)]
                entry = ENTRIES[(si + ei + len(kind)) % len(ENTRIES)]
                prefix, line, key = places[placement]
                source = FRAME_TOP + prefix + line.format(kind=kind, label=label).rstrip() + FRAME_END
                typed = TYPED[n % len(TYPED)]
                # The pan and zoom check (slow: two re-renders) on every fourth cell.
                cells.append(cell(f"{kind} / {start} / {placement} / {entry} / {edit}", source, key, kind, start, placement, entry, edit, typed, view=n % 4 == 0))
    # Macro uses and [ ] members refuse with a reason, from every entry point.
    for entry in ENTRIES:
        cells.append(cell(f"macro use / one string / chain / {entry} / refuse", 'define m { box "M" }\nm\nA: box "A" at (2,0)\n', "macro", "box",
                          "one string", "chain", entry, "replace", refuse="macro"))
        cells.append(cell(f"[ ] member / one string / nested / {entry} / refuse", 'A: box "A"\n[ box "in" ]\n', "index:2", "box",
                          "one string", "nested", entry, "replace", refuse=r"\[ \]|group"))
    # Typing over an open preview: the label beside a previewed connector.
    for edit in ("replace", "escape"):
        cells.append(cell(f"box / one string / literal at / preview / {edit}", 'A: box "A"\nB: box "B" at (2,1)\narrow from A.e to B.w\n', "B", "box",
                          "one string", "literal at", "preview", edit, "Previewed"))
    return cells


CELLS = build()
if os.environ.get("TEXT_MATRIX_ONLY"):
    CELLS = [c for c in CELLS if os.environ["TEXT_MATRIX_ONLY"] in c["name"]]

CONFIGS = [
    ("desktop light", {"width": 1440, "height": 900}, False, "light"),
    ("desktop dark", {"width": 1440, "height": 900}, False, "dark"),
    ("phone light", {"width": 390, "height": 844}, True, "light"),
    ("phone dark", {"width": 390, "height": 844}, True, "dark"),
]


def cells_for(config):
    """Every cell at the desktop in light; a rotating share elsewhere, so each
    form, edit and entry still meets both themes and both sizes."""
    if config == "desktop light":
        return CELLS
    step = {"desktop dark": 7, "phone light": 3, "phone dark": 5}[config]
    return [c for i, c in enumerate(CELLS) if i % step == 0 or c["edit"] == "style" and i % 2 == 0]


STARTED = time.time()


def new_page(browser, viewport, touch, theme, errors):
    context = browser.new_context(viewport=viewport, is_mobile=touch, has_touch=touch)
    context.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append("page error: " + (error.stack or str(error))[:300]))
    page.on("console", lambda m: m.type == "error" and errors.append("console error: " + m.text[:300]))
    page.on("dialog", lambda d: (errors.append("dialog: " + d.message), d.dismiss()))
    page.add_init_script("try{localStorage.setItem('pikchr-studio.theme',%r)}catch{}" % theme)
    page.goto(BASE + "/")
    wait_rendered(page)
    page.wait_for_function("document.documentElement.dataset.theme===%r" % theme)
    page.add_script_tag(path=str(HARNESS))
    return page


def run(browser, config, viewport, touch, theme, results):
    errors = []
    page = new_page(browser, viewport, touch, theme, errors)
    cells = cells_for(config)
    for start in range(0, len(cells), 30):
        if time.time() - STARTED > DEADLINE:
            raise TimeoutError(f"Text matrix exceeded its {DEADLINE:.0f}-second deadline")
        chunk = cells[start:start + 30]
        out = page.evaluate("([cells,opts])=>textMatrix.run(cells,opts)", [chunk, {"touch": touch, "view": not touch}])
        for c, r in zip(chunk, out):
            results.append((config, c, r["failures"]))
    for name, failures in real_input(page, config, touch):
        results.append((config, {"name": name, "real": True}, failures))
    for e in errors:
        results.append((config, {"name": "page"}, [{"category": "error", "message": e}]))
    page.context.close()
    return len(cells)


# ---- real input --------------------------------------------------------------
def load(page, text):
    ok = page.evaluate("""async t=>{const s=document.getElementById('source');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('render').click();for(let i=0;i<400;i++){const x=pikchrStudio.state();if(x.source===t&&x.valid&&!x.queued)return true;await new Promise(r=>setTimeout(r,10));}return false}""", text)
    assert ok, "source did not render"


def point_of(page, key):
    return page.evaluate("""k=>{const s=pikchrStudio.state(),o=k.startsWith('index:')?s.scene.objects[+k.slice(6)]:s.scene.objects.find(o=>o.name===k);
      const g=document.querySelector(`#diagram [data-pikchr-id="${o.id}"]`),t=g&&[...g.querySelectorAll('text')].map(n=>n.getBoundingClientRect()).find(r=>r.width>0);
      if(t)return {x:t.left+t.width/2,y:t.top+t.height/2};const p=pikchrStudio.modelToScreen(o.center);return {x:p.x,y:p.y}}""", key)


def statement_text(page, key):
    """The label the source holds for one object, decoded."""
    return page.evaluate("""k=>{const s=pikchrStudio.state(),o=k.startsWith('index:')?s.scene.objects[+k.slice(6)]:s.scene.objects.find(o=>o.name===k);
      const b=new TextEncoder().encode(s.source),st=new TextDecoder().decode(b.slice(o.span.start,o.span.end));
      return textMatrix.strings(st).map(x=>x.text).join('\\n')}""", key)


def wait_source_change(page, before, timeout=4000):
    page.wait_for_function("b=>{const x=pikchrStudio.state();return x.source!==b&&x.valid&&!x.queued&&!document.querySelector('textarea.cl-inline-text')}", arg=before, timeout=timeout)


def real_input(page, config, touch):
    """Cells that need the real keyboard, IME, clipboard, pointer or a resize."""
    out = []

    def check(name, fn):
        failures = []
        try:
            fn(failures)
        except Exception as error:  # noqa: BLE001 - reported as a cell failure
            failures.append({"category": "lost" if "Timeout" in type(error).__name__ else "setup", "message": str(error).split("\n")[0][:300]})
        page.evaluate("()=>{const t=document.querySelector('textarea.cl-inline-text');if(t)t.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))}")
        out.append((name, failures))

    # Both shapes grow to fit (Text fit Grow), so typed text lands verbatim.
    source = FRAME_TOP + 'X: box "Label" fit at (1,0)\nY: box "two" "lines" fit at (3,0)\n' + FRAME_END

    def open_on(key):
        p = point_of(page, key)
        if touch:
            page.touchscreen.tap(p["x"], p["y"])
            page.wait_for_function("k=>pikchrStudio.state().object?.name===k", arg=key)
            page.locator(".cl-context [aria-label='More options'], #mobile-objects").first.wait_for(state="attached")
            page.evaluate("document.getElementById('diagram').focus()")
            page.keyboard.press("Enter")
        else:
            page.mouse.dblclick(p["x"], p["y"])
        page.locator("textarea.cl-inline-text").wait_for(timeout=2000)

    def typed_enter(failures):
        load(page, source)
        open_on("X")
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type('Typed "q" \\ é 日本')
        page.keyboard.press("Shift+Enter")
        page.keyboard.type("line two")
        before = page.evaluate("pikchrStudio.state().source")
        page.keyboard.press("Enter")
        wait_source_change(page, before)
        got = statement_text(page, "X")
        if got != 'Typed "q" \\ é 日本\nline two':
            failures.append({"category": "lost", "message": f"keyboard typing landed {got!r}"})

    def ime(failures):
        load(page, source)
        open_on("X")
        page.keyboard.press("ControlOrMeta+a")
        cdp = page.context.new_cdp_session(page)
        cdp.send("Input.imeSetComposition", {"text": "にほん", "selectionStart": 3, "selectionEnd": 3})
        page.keyboard.press("Enter")  # confirms the candidate inside the IME
        if page.locator("textarea.cl-inline-text").count() == 0:
            failures.append({"category": "lost", "message": "Enter during composition closed the editor"})
            return
        cdp.send("Input.insertText", {"text": "日本"})
        cdp.detach()
        before = page.evaluate("pikchrStudio.state().source")
        page.keyboard.press("Enter")
        wait_source_change(page, before)
        got = statement_text(page, "X")
        if got != "日本":
            failures.append({"category": "lost", "message": f"IME text landed as {got!r}"})

    def paste(failures):
        load(page, source)
        open_on("X")
        page.evaluate("navigator.clipboard.writeText('pasted one\\r\\npasted two\\r\\n')")
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.press("ControlOrMeta+v")
        before = page.evaluate("pikchrStudio.state().source")
        page.mouse.click(30, 450) if not touch else page.touchscreen.tap(200, 700)
        wait_source_change(page, before)
        got = statement_text(page, "X")
        if got != "pasted one\npasted two":
            failures.append({"category": "lost", "message": f"paste landed {got!r}"})

    def style_click(failures):
        load(page, source)
        open_on("Y")
        page.keyboard.press("End")
        page.keyboard.type(" more")
        before = page.evaluate("pikchrStudio.state().source")
        bold = page.locator(".cl-textbar button[aria-label='Bold']")
        if touch:
            box = bold.bounding_box()
            page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        else:
            bold.click()
        page.wait_for_function("b=>{const t=document.querySelector('textarea.cl-inline-text');return t&&t.value==='two\\nlines more'&&pikchrStudio.state().valid&&pikchrStudio.state().source!==b}", arg=before, timeout=4000)
        got = statement_text(page, "Y")
        stmt = page.evaluate("pikchrStudio.state().source")
        if got != "two\nlines more" or '"lines more" bold' not in stmt:
            failures.append({"category": "textbar", "message": f"style mid-edit gave {got!r}"})
        page.keyboard.press("Enter")

    def text_tool(failures):
        load(page, source)
        before = page.evaluate("pikchrStudio.state().source")
        page.locator(".cl-palette [aria-label='Text']").click()
        # An empty spot of canvas, clear of the floating toolbars.
        x, y = page.evaluate("""()=>{const d=document.getElementById('diagram').getBoundingClientRect();
          for(let fy=.2;fy<.8;fy+=.05)for(let fx=.2;fx<.8;fx+=.1){const x=d.left+d.width*fx,y=d.top+d.height*fy,h=document.elementFromPoint(x,y);
            if(h&&h.closest('#diagram')&&!h.closest('[data-pikchr-id]'))return [x,y];}return [d.left+d.width/2,d.top+d.height/2]}""")
        hit = page.evaluate("([x,y])=>{const h=document.elementFromPoint(x,y);return h.tagName+'.'+String(h.className.baseVal??h.className)+' text tool '+document.querySelector(\".cl-palette [aria-label='Text']\").getAttribute('aria-pressed')}", [x, y])
        page.touchscreen.tap(x, y) if touch else page.mouse.click(x, y)
        try:
            page.locator("textarea.cl-inline-text").wait_for(timeout=3000)
        except Exception:
            failures.append({"category": "lost", "message": f"no editor after placing text at {x:.0f},{y:.0f} on {hit}; status {page.evaluate('document.getElementById(`state`).textContent')!r}"})
            return
        page.keyboard.type("Placed text")
        page.keyboard.press("Enter")
        page.wait_for_function("()=>!document.querySelector('textarea.cl-inline-text')&&pikchrStudio.state().valid&&pikchrStudio.state().source.includes('\"Placed text\"')", timeout=4000)
        after = page.evaluate("pikchrStudio.state().source")
        if not after.startswith(before.rstrip("\n").split("\n")[0]):
            failures.append({"category": "diff", "message": "the Text tool changed other statements"})

    def keyboard_shrink(failures):
        # The on-screen keyboard: the viewport loses its lower part while editing.
        load(page, source)
        open_on("X")
        size = page.viewport_size
        page.set_viewport_size({"width": size["width"], "height": int(size["height"] * 0.55)})
        try:
            page.wait_for_timeout(300)
            msgs = page.evaluate("""()=>{const out=[],t=document.querySelector('textarea.cl-inline-text'),b=document.querySelector('.cl-textbar');
              if(!t)return ['the editor closed when the keyboard opened'];const r=t.getBoundingClientRect(),h=innerHeight;
              if(r.top<0||r.bottom>h)out.push(`editor ${Math.round(r.top)}-${Math.round(r.bottom)} is outside the ${h}px visible area`);
              if(!b||b.hidden)out.push('the text bar is hidden');else{const q=b.getBoundingClientRect();
                if(q.top<0||q.bottom>h)out.push(`text bar ${Math.round(q.top)}-${Math.round(q.bottom)} is outside the ${h}px visible area`);
                const gap=Math.max(q.top-r.bottom,r.top-q.bottom);if(gap>80)out.push(`text bar is ${Math.round(gap)}px from the editor`);}
              const s=pikchrStudio.state(),o=s.scene.objects.find(o=>o.name==='X'),g=document.querySelector(`#diagram [data-pikchr-id="${o.id}"]`).getBoundingClientRect();
              const cx=(g.left+g.right)/2,cy=(g.top+g.bottom)/2;if(!(cx>=r.left-2&&cx<=r.right+2&&cy>=r.top-24&&cy<=r.bottom+24))out.push(`editor ${Math.round(r.left)},${Math.round(r.top)} is no longer over its shape at ${Math.round(cx)},${Math.round(cy)}`);
              return out}""")
            for m in msgs:
                failures.append({"category": "geometry", "message": "keyboard open: " + m})
            page.keyboard.type("!")
            before = page.evaluate("pikchrStudio.state().source")
            page.keyboard.press("Enter")
            wait_source_change(page, before)
            if statement_text(page, "X") != "Label!":
                failures.append({"category": "lost", "message": "text typed with the keyboard open was lost"})
        finally:
            page.set_viewport_size(size)

    check("real: keyboard typing, Shift+Enter, Enter", typed_enter)
    check("real: IME composition (CDP)", ime)
    check("real: clipboard paste, blur commit", paste)
    check("real: text bar " + ("tap" if touch else "click") + " mid-edit", style_click)
    check("real: Text tool click-to-place", text_tool)
    if touch:
        check("real: on-screen keyboard shrinks the viewport", keyboard_shrink)
    return out


def main(configs):
    only = sys.argv[1:]
    results = []
    counts = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        try:
            for config, viewport, touch, theme in CONFIGS:
                if config not in configs or only and not any(o in config for o in only):
                    continue
                t = time.time()
                counts[config] = run(browser, config, viewport, touch, theme, results)
                print(f"{config}: {counts[config]} cells in {time.time() - t:.1f}s", flush=True)
        finally:
            browser.close()
    failed = [(config, c, f) for config, c, fs in results for f in fs]
    by_category = Counter(f["category"] for _, _, f in failed)
    seen = Counter()
    for config, c, f in failed:
        seen[(f["category"], config, c["name"], f["message"])] += 1
    for (category, config, name, message), n in sorted(seen.items()):
        print(f"FAIL [{category}] {config} | {name}: {message}")
    typing = sum(1 for _, c, _ in results if c.get("edit") not in (None, "nochange", "escape") and not c.get("refuse") or c.get("real"))
    print(f"{typing} of {len(results)} cells type and commit text")
    bad = len({(config, c["name"]) for config, c, _ in failed})
    print(f"{len(results) - bad}/{len(results)} cells pass in {time.time() - STARTED:.1f}s; failures by category: {dict(by_category)}")
    assert not failed, f"{len(failed)} failures in {bad} cells"
    print("PASS: text matrix (" + ", ".join(configs) + ")")
