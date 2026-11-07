"""Placement matrix: dragging a shape moves it, whatever placement form Pikchr
allows, or refuses with a specific reason shown before the drop.

For every shape in every case, the shape is dragged 100px right and 60px down
from its centre at 1440x900. The outcome must be one of:
  (a) moved: its rendered centre moves by the drag delta (within snapping
      tolerance); the shapes placed against it (listed per case) move by the
      same amount and their statements are unchanged; every other shape stays
      put; both ends of every connector still touch the shapes they touched;
      strings and comments are byte-identical; only statements of the dragged
      shape, connectors and pinned shapes change; the live preview painted
      during the drag; and the status says "Moved ...";
  (b) refused: the source is unchanged, a "Can't move" badge showed during the
      drag, and a specific message naming the real reason stays on screen.
A silent snap-back, or the generic "Only boxes..." message, is a failure.
A drop that rounds to no movement changes nothing and says so.
"""
import os
import re
import signal
from playwright.sync_api import sync_playwright
from browser_helpers import wait_rendered, set_source, clear_selection


def deadline(*_):
    raise TimeoutError("Drag matrix exceeded its 175-second deadline")


signal.signal(signal.SIGALRM, deadline)
signal.alarm(175)
BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
SHAPES = {"box", "circle", "ellipse", "oval", "cylinder", "diamond", "file", "text"}


def move(*along, contains=None):
    """Expect a move; `along` are the keys of shapes placed against the dragged one."""
    return {"along": list(along), "contains": contains}


# (name, source, {shape key: expectation}). A key is a name, a label, or id:oN.
# An expectation is move(...) or a regex the refusal message must match.
CASES = [
    ("unnamed chain", 'box "A"\narrow\nbox "B"\n', {"A": move(), "B": move()}),
    ("unnamed chain of three", 'box "A"\narrow\nbox "B"\narrow\nbox "C"\n', {"B": move()}),
    ("with .n at A.s + offset", 'A: box "A"\nB: box "B" with .n at A.s + (0,-0.5)\n', {"A": move("B"), "B": move()}),
    ("at A + offset", 'A: box "A"\nB: box "B" at A + (2,0)\n', {"A": move("B"), "B": move()}),
    ("at A - offset", 'A: box "A"\nB: box "B" at A - (2,0)\n', {"B": move()}),
    ("gap below", 'A: box "A"\nB: box "B" at 1in below A\n', {"A": move("B"), "B": move()}),
    ("fit + anchor offset", 'A: box "A" fit\nB: box "B" at A.e + (1,0)\n', {"A": move("B"), "B": move()}),
    ("size expression", 'A: box "A" wid 2*boxwid\nB: box "B" at (3,0)\n', {"A": move(), "B": move()}),
    ("owner's diagram", 'Time: oval "Zeit"\nNB: box "Not Before Time" fit with .n at 0.75in below Time.s\n'
     'arrow dashed from Time.s to NB.n "parameter" ljust\n', {"Zeit": move("Not Before Time"), "Not Before Time": move()}),
    ("named chain", 'A: box "A"\narrow\nB: box "B"\narrow\nC: box "C"\n', {"A": move(), "B": move(), "C": move()}),
    ("down chain", 'down\nbox "A"\narrow\nbox "B"\narrow\nbox "C"\n', {"A": move(), "B": move(), "C": move()}),
    ("left chain", 'left\nbox "A"\narrow\ncircle "B"\n', {"A": move(), "B": move()}),
    ("move", 'box "A"\nmove\nbox "B"\n', {"A": move(), "B": move()}),
    ("then", 'A: box "A"\nline right then down then right\nB: box "B"\n', {"A": move(), "B": move()}),
    ("arrow with length", 'A: box "A"\narrow 1\nB: box "B"\n', {"A": move(), "B": move()}),
    ("chop", 'A: circle "A"\nB: circle "B" at 1.5in right of A\narrow from A to B chop\n', {"A": move("B"), "B": move()}),
    ("same", 'A: box "A" wid 1.2\nB: box "B" same at A + (2,0)\n', {"B": move()}),
    ("every kind", 'ellipse "E"\noval "O"\ncircle "C"\ndiamond "D"\ncylinder "Y"\nfile "F"\ntext "T"\n',
     {k: move() for k in "EOCDYFT"}),
    ("strings and comments with at", 'A: box "at (1,1)" # placed at A\nB: box "with .n at" at A + (2,0) # at here\n',
     {"at (1,1)": move("with .n at"), "with .n at": move()}),
    ("block comment with a bracket", 'A: box "A"\nB: box "B"\n/* old: [ box ] */\n[ box "in" ]\nC: box "C"\n', {"B": move()}),
    ("inline comment with at", 'A: box "A"\nbox "2" /* at A */ fill red\n', {"2": move()}),
    ("with .w at gap", 'A: box "A"\nB: box "B" with .w at 1in right of A.e\n', {"B": move()}),
    ("literal", 'A: box "A" at (0,0)\nB: box "B" at (2,0)\n', {"A": move(), "B": move()}),
    ("coordinate expression", 'A: box "A"\nB: box "B" at (A.x + 2, A.y)\n', {"B": move(contains=r"B: box \"B\" at \(A\.x \+ ")}),
    ("variable", '$x = 1.5\nA: box "A"\nB: box "B" at ($x, 0)\n', {"B": move(contains=r"B: box \"B\" at \(\$x \+ ")}),
    ("way between", 'A: box "A"\nC: box "C" at (3,0)\nB: circle "B" at 1/2 way between A and C\n',
     {"B": move(contains=r"1/2 way between A \+ \(.*\) and C \+ ")}),
    ("nested group", 'A: box "A"\n[ C: box "C" ]\n', {"A": move(), "C": r"group"}),
    ("macro", 'define m { box "M" }\nm\nA: box "A"\n', {"A": move(), "id:o1": r"macro"}),
    # A macro use cannot be pinned, so it moves along, and the toast says so.
    ("macro follower", 'define m { box "M" }\nA: box "A"\nm\n', {"A": move("id:o2")}),
    ("unicode", 'A: box "café 日本"\nB: oval "Zeit ü" at A + (2,0)\n', {"café 日本": move("Zeit ü"), "Zeit ü": move()}),
]
GENERIC = re.compile(r"Only boxes|no name, so it can", re.I)
TEXTS = re.compile(r'"(?:\\.|[^"\\])*"|/\*[\s\S]*?\*/|#[^\n]*|//[^\n]*')


def label_of(source, obj):
    span = (obj.get("spans") or {}).get("label")
    if not span:
        return None
    return source.encode()[span["start"]:span["end"]].decode().strip('"')


def find(state, key):
    for o in state["scene"]["objects"]:
        if key.startswith("id:") and o["id"] == key[3:]:
            return o
        if o["kind"] in SHAPES and (o["name"] == key or label_of(state["source"], o) == key):
            return o
    raise AssertionError("no shape " + key)


def screen(page, p):
    return page.evaluate("p=>{const q=pikchrStudio.modelToScreen(p);return {x:q.x,y:q.y}}", p)


def near(a, b, tol):
    return abs(a["x"] - b["x"]) <= tol and abs(a["y"] - b["y"]) <= tol


def touched(point, objects, tol=0.1):
    return {o["id"] for o in objects if o["kind"] in SHAPES and o.get("bbox")
            and o["bbox"]["x"] - tol <= point["x"] <= o["bbox"]["x"] + o["bbox"]["width"] + tol
            and o["bbox"]["y"] - tol <= point["y"] <= o["bbox"]["y"] + o["bbox"]["height"] + tol}


def line_owners(source, objects):
    """For each source line, the objects whose statement spans it."""
    data, owners, start = source.encode(), [], 0
    for line in data.split(b"\n"):
        end = start + len(line)
        owners.append([o for o in objects if o["span"]["start"] >= 0 and o["span"]["start"] < end + 1 and o["span"]["end"] > start])
        start = end + 1
    return owners


def check_move(where, source, state, message, obj, delta, along, contains, objects_before):
    after = {o["id"]: o for o in state["scene"]["objects"]}
    before = {o["id"]: o for o in objects_before}
    moved = after.get(obj["id"])
    target = {"x": obj["center"]["x"] + delta["x"], "y": obj["center"]["y"] + delta["y"]}
    if not moved or not near(moved["center"], target, 0.12):
        return f"landed at {moved and moved['center']}, wanted {target}"
    actual = {"x": moved["center"]["x"] - obj["center"]["x"], "y": moved["center"]["y"] - obj["center"]["y"]}
    for oid, o in before.items():
        if o["kind"] not in SHAPES or oid == obj["id"] or "nested" in (o.get("reason") or "").lower() and oid not in along:
            continue
        want = actual if oid in along else {"x": 0, "y": 0}
        got = {"x": after[oid]["center"]["x"] - o["center"]["x"], "y": after[oid]["center"]["y"] - o["center"]["y"]}
        if not near(got, want, 1e-3):
            return f"{o.get('name') or oid} moved by {got}, wanted {want}; source={state['source']!r}"
    for oid, c in before.items():
        if c["kind"] not in ("arrow", "line"):
            continue
        for end in (0, -1):
            was, now = touched(c["path"][end], objects_before), touched(after[oid]["path"][end], state["scene"]["objects"])
            if not was <= now:
                return f"connector {oid} end {end} detached from {sorted(was - now)}; source={state['source']!r}"
    if TEXTS.findall(source) != TEXTS.findall(state["source"]):
        return f"strings or comments changed: {state['source']!r}"
    old, new = source.split("\n"), state["source"].split("\n")
    if len(old) != len(new):
        return f"line count changed: {state['source']!r}"
    owners = line_owners(source, objects_before)
    for i, (a, b) in enumerate(zip(old, new)):
        if a == b:
            continue
        ok = [o for o in owners[i] if o["id"] == obj["id"] or o["kind"] in ("arrow", "line", "move")
              or (o["id"] not in along and near(after[o["id"]]["center"], o["center"], 1e-3))]
        if not owners[i] or len(ok) != len(owners[i]):
            return f"line {i + 1} changed but should not: {a!r} -> {b!r}"
    if contains and not re.search(contains, state["source"]):
        return f"source does not keep its form ({contains}): {state['source']!r}"
    if not message.startswith("Moved"):
        return f"no 'Moved' toast: {message!r}"
    if along and not re.search(r"placed against it|moved with it", message):
        return f"toast does not say what moved along: {message!r}"
    return None


def drag(page, case, source, key, expect):
    set_source(page, source)
    page.wait_for_function("pikchrStudio.state().valid")
    # The previous drag leaves its shape selected; its toolbar may cover this one.
    clear_selection(page)
    page.wait_for_function("!pikchrStudio.state().selectedIds.length")
    initial = page.evaluate("pikchrStudio.state()")
    obj = find(initial, key)
    start = screen(page, obj["center"])
    # Model delta of a 100px, 60px screen move.
    origin = screen(page, {"x": 0, "y": 0}), screen(page, {"x": 1, "y": 1})
    sx, sy = origin[1]["x"] - origin[0]["x"], origin[1]["y"] - origin[0]["y"]
    delta = {"x": 100 / sx, "y": 60 / sy}
    page.evaluate("document.querySelector('#state').textContent=''")
    page.mouse.move(start["x"], start["y"])
    page.mouse.down()
    page.mouse.move(start["x"] + 50, start["y"] + 30, steps=4)
    page.mouse.move(start["x"] + 100, start["y"] + 60, steps=4)
    moving = isinstance(expect, dict)
    live = False
    if moving:
        try:
            page.wait_for_function("!!document.querySelector('#diagram svg .live-drag')", timeout=2000)
            live = True
        except Exception:
            pass
    page.wait_for_timeout(150)
    badge = page.evaluate("(()=>{const b=document.querySelector('.drag-refusal');return b&&!b.hidden?b.textContent:''})()")
    page.mouse.up()
    try:
        page.wait_for_function("s=>{const t=pikchrStudio.state();return t.valid&&t.source!==s&&!t.queued}", arg=source,
                               timeout=3000 if moving else 600)
    except Exception:
        pass
    page.wait_for_timeout(100)
    state = page.evaluate("pikchrStudio.state()")
    message = page.evaluate("document.querySelector('#state').textContent")
    # The refusal stays on screen after the drop, next to the shape.
    hint = page.evaluate("(()=>{const b=document.querySelector('.drag-refusal');return b&&!b.hidden&&b.getBoundingClientRect().width>0?b.textContent:''})()")
    where = f"{case} / {key}"
    if GENERIC.search(message) or GENERIC.search(hint) or GENERIC.search(badge):
        return f"FAIL {where}: generic refusal: {message or badge}"
    if moving:
        if state["source"] == source:
            return f"FAIL {where}: snapped back; message={message!r}"
        if not live:
            return f"FAIL {where}: no live preview during the drag"
        along = {find(initial, k)["id"] for k in expect["along"]}
        problem = check_move(where, source, state, message, obj, delta, along, expect["contains"], initial["scene"]["objects"])
        return f"FAIL {where}: {problem}" if problem else f"ok   {where}: {state['source'].strip()!r} ({message})"
    if state["source"] != source:
        return f"FAIL {where}: should refuse but changed source"
    if not re.search(expect, message, re.I) or not re.search(expect, hint, re.I):
        return f"FAIL {where}: refusal not specific/persistent: status={message!r} hint={hint!r}"
    if not re.search("can.t move", badge, re.I) or not re.search(expect, badge, re.I):
        return f"FAIL {where}: no refusal badge during drag: {badge!r}"
    return f"ok   {where}: refused: {message}"


def tiny_drag(page):
    """A drop that rounds to no movement leaves the source alone."""
    source = 'A: box "A" at (0,0)\n'
    set_source(page, source)
    clear_selection(page)
    p = screen(page, {"x": 0, "y": 0})
    page.evaluate("document.querySelector('#state').textContent=''")
    page.mouse.move(p["x"], p["y"])
    page.mouse.down()
    page.mouse.move(p["x"] + 3.3, p["y"], steps=3)
    page.mouse.up()
    page.wait_for_function("document.querySelector('#state').textContent.length>0")
    page.wait_for_timeout(300)
    state = page.evaluate("pikchrStudio.state()")
    message = page.evaluate("document.querySelector('#state').textContent")
    if state["source"] != source or state["queued"]:
        return f"FAIL tiny drag: source changed to {state['source']!r}"
    if not message.startswith("Not moved"):
        return f"FAIL tiny drag: message {message!r}"
    return "ok   tiny drag: no-op"


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="chrome")
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(BASE + "/")
        wait_rendered(page)
        results = []
        for case, source, expectations in CASES:
            for key, expect in expectations.items():
                try:
                    results.append(drag(page, case, source, key, expect))
                except Exception as error:
                    results.append(f"FAIL {case} / {key}: {str(error).splitlines()[0]}")
        results.append(tiny_drag(page))
        for line in results:
            print(line)
        failed = [r for r in results if r.startswith("FAIL")]
        print(f"{len(results) - len(failed)}/{len(results)} cells pass")
        assert not errors, errors
        assert not failed, f"{len(failed)} matrix cells failed"
        print("PASS: drag placement matrix")
    finally:
        browser.close()
