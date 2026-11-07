"""Inspector matrix: every object kind x every way its properties are written
x every placement form, at desktop and phone width, in light and dark.

For every cell the inspector is opened on that object and must:
  (a) show no error before any action, and opening it (or Style) writes nothing;
  (b) offer every control working or disabled with a specific reason that
      quotes the source; each click changes only that clause (strings and
      comments byte-identical, the rest of the statement and program intact),
      renders valid, and picking the current value writes nothing;
  (c) say "blocked" only for a real, specific reason that fits the object,
      never on a movable shape;
  (d) keep every control inside the panel, unclipped and not overlapping, with
      selected and focus rings visible, no sideways scroll, inset select
      carets, and 44px targets on touch;
  (e) paint each colour swatch the colour the canvas draws for it in the
      current theme, and meet WCAG AA (4.5:1 text, 3:1 UI) in both themes;
  (f) undo each edit back to the exact source.
The in-page half is inspector-matrix.js. One page per viewport and theme is
reused for every cell. A failure prints its category, cell and message.
inspector-matrix-desktop-browser.py and inspector-matrix-phone-browser.py each
run half of the configurations, so each stays inside the runner's limit.
"""
import os
import sys
import time
from collections import Counter
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_helpers import wait_rendered


# Checked between batches: a SIGALRM raised inside Playwright's sync dispatcher
# can leave it spinning instead of exiting.
DEADLINE = float(os.environ.get("INSPECTOR_MATRIX_DEADLINE", "175"))
BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
HARNESS = Path(__file__).with_name("inspector-matrix.js")

SHAPES = ["box", "circle", "ellipse", "oval", "cylinder", "diamond", "file", "text"]
FILLED = [k for k in SHAPES if k != "text"]

# Placement forms for the object under test (X), around one anchor box.
PLACEMENTS = {
    "literal at": ("", 'X: {kind} {label} at (1,0) {attrs}', "X"),
    "relative": ('A: box "anchor"\n', 'X: {kind} {label} at A + (2,0) {attrs}', "X"),
    "unnamed chain": ('box "anchor"\narrow\n', '{kind} {label} {attrs}', None),
    "expression": ('A: box "anchor"\n', 'X: {kind} {label} at (A.x + 2, A.y) {attrs}', "X"),
}

# Source forms: (name, prefix lines, label, attrs for a filled shape, attrs for
# text, attrs for a connector). None means the form does not apply.
FORMS = [
    ("none", "", '"L"', "", "", ""),
    ("colour names in any case", "", '"L"', "fill LightBlue color DarkRed", "color DarkRed", "color DarkRed"),
    ("0xRGB", "", '"L"', "fill 0xdfd", "color 0xdfd", "color 0xdfd"),
    ("0xRRGGBB", "", '"L"', "fill 0xffe4e1 color 0x1a7f37", "color 0x1a7f37", "color 0x1a7f37"),
    ("decimal", "", '"L"', "fill 16777184 color 255", "color 255", "color 255"),
    ("variable", "$c = 0xff0000\n", '"L"', "fill $c", "color $c", "color $c"),
    ("expression", "", '"L"', "color 0x10*2 thickness 0.01*2", "color 0x10*2", "color 0x10*2 thickness 0.01*2"),
    # Pikchr refuses a repeated fill, color or thickness ("value is already
    # set"); the words it does accept twice are these.
    ("same keyword twice", "", '"L" bold bold', "thick thick dashed dashed", "", "thin thick dashed dashed"),
    ("thick", "", '"L"', "thick", None, "thick"),
    ("thin", "", '"L"', "thin", None, "thin"),
    ("thickness 0.03", "", '"L"', "thickness 0.03", None, "thickness 0.03"),
    ("thickness 2px", "", '"L"', "thickness 2px", None, "thickness 2px"),
    ("document thickness", "thickness = 0.03\n", '"L"', "", None, ""),
    ("keywords in the label", "", '"fill red color blue"', "", "", '"fill red color blue" above'),
    ("comment with keywords", "", '"L"', "fill aliceblue # color red thick", "color blue # fill red", "color blue # thick"),
    ("inline comment", "", '"L"', "/* fill red */ color blue", "/* color red */ color blue", "/* thick */ color blue"),
    ("unicode label", "", '"café 日本 ü"', "fill aliceblue", "color blue", '"café 日本 ü" above color blue'),
    ("bold italic", "", '"L" bold italic', "", "", None),
    ("mono", "", '"L" mono', "", "", ""),
    ("monospace", "", '"L" monospace', "", "", ""),
    ("big", "", '"L" big', "", "", ""),
    ("small", "", '"L" small', "", "", ""),
    ("ljust", "", '"L" ljust', "", "", ""),
    ("rjust", "", '"L" rjust', "", "", ""),
    ("above below", "", '"top" above "low" below', "", "", ""),
    ("dashed", "", '"L"', "dashed", None, "dashed"),
    ("dotted", "", '"L"', "dotted", None, "dotted"),
]
CONNECTOR_ONLY = [("chop", "chop"), ("both heads", "<->"), ("label above", '"x" above'), ("label below bold", '"x" below bold')]

# Connector placements: endpoints named, a bare direction, a chain, an expression.
CONNECTOR_PLACEMENTS = {
    "from to": ('A: box "A"\nB: box "B" at (2,0)\n', '{kind} from A.e to B.w {attrs}'),
    "direction": ('A: box "A"\n', '{kind} right 1 {attrs}'),
    "unnamed chain": ('box "A"\n', '{kind} {attrs}\nbox "B"'),
    "expression": ('A: box "A"\nB: box "B" at (2,1)\n', '{kind} from (A.x, A.y + 0.1) to B.w {attrs}'),
}
CONNECTORS = ["arrow", "line", "spline", "arc"]


# On a cell that clicks one control per group, the groups its source form can
# affect; the plain form of each kind clicks every control.
COLOUR = "^(Fill|Line & text|Text)/"
WEIGHT = "^Thickness presets/|Thickness in inches"
TEXT = "^(Text size|Font|Text alignment|Label placement|Text style)/"
STROKE = "^(Stroke|Ends|Heads)/"
FOCUS = {
    "colour names in any case": [COLOUR], "0xRGB": [COLOUR], "0xRRGGBB": [COLOUR], "decimal": [COLOUR],
    "variable": [COLOUR, WEIGHT], "expression": [COLOUR, WEIGHT], "same keyword twice": [WEIGHT, TEXT, STROKE],
    "thick": [WEIGHT], "thin": [WEIGHT], "thickness 0.03": [WEIGHT], "thickness 2px": [WEIGHT], "document thickness": [WEIGHT],
    "keywords in the label": [COLOUR, WEIGHT, TEXT], "comment with keywords": [COLOUR, WEIGHT, TEXT, STROKE],
    "inline comment": [COLOUR, WEIGHT, TEXT, STROKE], "unicode label": [COLOUR, WEIGHT, TEXT],
    "dashed": [STROKE, WEIGHT], "dotted": [STROKE, WEIGHT], "chop": [STROKE], "both heads": [STROKE],
    "label above": [TEXT], "label below bold": [TEXT],
}


def cell(name, source, key, kind, form, **expect):
    return {"name": name, "source": source, "key": key, "kind": kind, "form": form, "expect": expect,
            "focus": FOCUS.get(form, [TEXT, COLOUR] if form in ("bold italic", "mono", "monospace", "big", "small", "ljust", "rjust", "above below") else None)}


def shape_cells():
    out = []
    names = list(PLACEMENTS)
    for kind in SHAPES:
        attrs_index = 4 if kind == "text" else 3
        for i, form in enumerate(FORMS):
            attrs = form[attrs_index]
            if attrs is None:
                continue
            placements = names if form[0] == "none" else [names[i % len(names)]]
            for placement in placements:
                prefix, line, name = PLACEMENTS[placement]
                label = form[2]
                body = line.format(kind=kind, label=label, attrs=attrs).rstrip()
                source = form[1] + prefix + body + "\n"
                key = name or label.split('"')[1]
                need = ["^Text/" if kind == "text" else "^Fill/"] + ([] if kind == "text" else ["^Line & text/", "^Thickness presets/"])
                need += ["^Text size/", "^Font/", "^Text alignment/"]
                movable = placement != "expression"
                out.append(cell(f"{kind} / {form[0]} / {placement}", source, key, kind, form[0],
                                controls=need, **({"banner": False} if movable else {})))
    return out


def connector_cells():
    out = []
    forms = [(f[0], f[1], f[5]) for f in FORMS if f[5] is not None and f[0] not in ("bold italic", "mono", "monospace", "big", "small", "ljust", "rjust", "above below")]
    forms += [(name, "", attrs) for name, attrs in CONNECTOR_ONLY]
    names = list(CONNECTOR_PLACEMENTS)
    for kind in CONNECTORS:
        for i, (form, before, attrs) in enumerate(forms):
            placements = names if form == "none" else [names[i % len(names)]]
            for placement in placements:
                prefix, line = CONNECTOR_PLACEMENTS[placement]
                if kind == "arc" and placement == "direction":
                    line = "{kind} {attrs}"
                source = before + prefix + line.format(kind=kind, attrs=attrs).rstrip() + "\n"
                key = "kind:" + kind
                need = ["^Line & text/", "^Thickness presets/", "^Stroke/"]
                if '"' in attrs:
                    need += ["^Text size/", "^Font/", "^Label placement/", "Along the line"]
                out.append(cell(f"{kind} / {form} / {placement}", source, key, kind, form, controls=need))
    for placement in ("bare", "chain"):
        source = 'box "A"\nmove\nbox "B"\n' if placement == "chain" else 'move\n'
        out.append(cell(f"move / none / {placement}", source, "kind:move", "move", "none", banner="no outline to style"))
    return out


def other_cells():
    big = "".join(f'B{i}: box "B{i}" at ({i % 8}, {i // 8})\n' if i % 2 else f'box "c{i}" fill aliceblue\n' for i in range(40))
    return [
        cell("[ ] group / none / chain", 'box "A"\n[ box "in" ]\n', "kind:[]", "[]", "none", banner="moves as one"),
        cell("[ ] group / none / named", 'A: box "A"\nG: [ box "in" ] at A + (2,0)\n', "kind:[]", "[]", "none", banner="moves as one"),
        cell("[ ] member / fill / nested", 'A: box "A"\n[ box "in" fill aliceblue ]\n', "in", "box", "fill", banner="inside a \\[ \\] group"),
        cell("macro use / none / chain", 'define m { box "M" }\nm\nA: box "A"\n', "macro", "box", "none", macro=["Label", "Fill", "Line & text", "Thickness"]),
        cell("macro use / fill / chain", 'define m { box "M" fill aliceblue }\nA: box "A"\nm\nm\n', "macro", "box", "fill", macro=["Label", "Fill", "Line & text", "Thickness"]),
        cell("box / none / 40-object diagram", big + 'X: box "L" at (9,0)\n', "X", "box", "none", banner=False,
             controls=["^Fill/", "^Line & text/", "^Thickness presets/", "^Text size/"]),
    ]


CELLS = shape_cells() + connector_cells() + other_cells()
if os.environ.get("INSPECTOR_MATRIX_ONLY"):
    CELLS = [c for c in CELLS if os.environ["INSPECTOR_MATRIX_ONLY"] in c["name"]]
# Which cells click their controls on each page: every control on the plain
# forms at the desktop, one of each group elsewhere.
CONFIGS = [
    ("desktop light", {"width": 1440, "height": 900}, False, "light"),
    ("desktop dark", {"width": 1440, "height": 900}, False, "dark"),
    ("phone light", {"width": 360, "height": 740}, True, "light"),
    ("phone dark", {"width": 360, "height": 740}, True, "dark"),
]


def clicks_for(config, c):
    desktop_light = config == "desktop light"
    if desktop_light:
        return "all" if c["form"] == "none" else "some"
    if config == "desktop dark":
        return "some" if c["form"] in ("none", "0xRRGGBB", "colour names in any case") else None
    return "some" if c["form"] == "none" and c["name"].endswith(("literal at", "from to")) else None


def run(browser, config, viewport, touch, theme, cells, results):
    page = browser.new_page(viewport=viewport, is_mobile=touch, has_touch=touch)
    errors = []
    page.on("pageerror", lambda error: errors.append((error.stack or str(error))[:400]))
    if os.environ.get("INSPECTOR_MATRIX_DEBUG"):
        page.on("console", lambda m: print("console:", m.text, flush=True))
    page.on("dialog", lambda d: (errors.append("dialog: " + d.message), d.dismiss()))
    page.add_init_script("try{localStorage.setItem('pikchr-studio.theme',%r)}catch{}" % theme)
    page.goto(BASE + "/")
    wait_rendered(page)
    page.wait_for_function("document.documentElement.dataset.theme===%r" % theme)
    page.add_script_tag(path=str(HARNESS))
    batches = {}
    for c in cells:
        batches.setdefault(clicks_for(config, c), []).append(c)
    for clicks, group in batches.items():
        for start in range(0, len(group), 40):
            if time.time() - STARTED > DEADLINE:
                raise TimeoutError(f"Inspector matrix exceeded its {DEADLINE:.0f}-second deadline")
            chunk = group[start:start + 40]
            out = page.evaluate("([cells,opts])=>inspectorMatrix.run(cells,opts)",
                                [chunk, {"clicks": clicks, "layout": True, "contrast": True, "touch": touch, "debug": bool(os.environ.get("INSPECTOR_MATRIX_DEBUG"))}])
            for c, r in zip(chunk, out):
                results.append((config, c, r["failures"]))
    for e in errors:
        results.append((config, {"name": "page", "kind": "", "form": ""}, [{"category": "error", "message": "page error: " + e}]))
    page.close()


STARTED = time.time()


def extras(browser, results):
    """Whole-app checks that are not one inspector cell: the render cost of a
    large diagram, and typing over an open preview."""
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(BASE + "/")
    wait_rendered(page)
    page.add_script_tag(path=str(HARNESS))
    for name, failures in page.evaluate("inspectorMatrix.extras()"):
        print(f"{name}: {'ok' if not failures else 'FAIL'}", flush=True)
        results.append(("desktop light", {"name": name, "kind": "", "form": ""}, failures))
    page.close()


def main(configs, with_extras=False):
    only = sys.argv[1:]
    started = STARTED
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        try:
            if with_extras:
                extras(browser, results)
            for config, viewport, touch, theme in CONFIGS:
                if config not in configs or only and not any(o in config for o in only):
                    continue
                t = time.time()
                run(browser, config, viewport, touch, theme, CELLS, results)
                print(f"{config}: {len(CELLS)} cells in {time.time() - t:.1f}s", flush=True)
        finally:
            browser.close()
    failed = [(config, c, f) for config, c, fs in results for f in fs]
    by_category = Counter(f["category"] for _, _, f in failed)
    # One line per distinct message shape, with how many cells hit it.
    seen = Counter()
    for config, c, f in failed:
        seen[(f["category"], config, c["name"], f["message"])] += 1
    for (category, config, name, message), n in sorted(seen.items()):
        print(f"FAIL [{category}] {config} | {name}: {message}")
    cells = len(results)
    bad = len({(config, c["name"]) for config, c, _ in failed})
    print(f"{cells - bad}/{cells} cells pass in {time.time() - started:.1f}s; failures by category: {dict(by_category)}")
    assert not failed, f"{len(failed)} failures in {bad} cells"
    print("PASS: inspector matrix (" + ", ".join(configs) + ")")

