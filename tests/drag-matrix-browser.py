"""Placement matrix: dragging a shape moves it, whatever placement form Pikchr
allows, or refuses with a specific reason shown before the drop.

For every shape in every case, the shape is dragged 100px right and 60px down
from its centre at 1440x900. The outcome must be one of:
  (a) moved: its rendered centre moves by the drag delta (within snapping
      tolerance), no other shape moves, connectors that reference it still
      touch it, and the status says "Moved ...";
  (b) refused: the source is unchanged, a "Can't move" badge showed during the
      drag, and a specific message naming the real reason stays on screen.
A silent snap-back, or the generic "Only boxes..." message, is a failure.
"""
import os
import re
import signal
from playwright.sync_api import sync_playwright
from browser_helpers import wait_rendered, set_source, close_popovers, clear_selection


def deadline(*_):
    raise TimeoutError("Drag matrix exceeded its 170-second deadline")


signal.signal(signal.SIGALRM, deadline)
signal.alarm(170)
BASE = os.environ.get("PIKCHR_STUDIO_URL", "http://127.0.0.1:8790").rstrip("/")
SHAPES = {"box", "circle", "ellipse", "oval", "cylinder", "diamond", "file", "text"}
MOVE = "move"
# (name, source, {shape label or name: expectation}); expectation is MOVE or a
# regex the refusal message must match. Shapes are found by name, else label.
CASES = [
    ("unnamed chain", 'box "A"\narrow\nbox "B"\n', {"A": MOVE, "B": MOVE}),
    ("unnamed chain of three", 'box "A"\narrow\nbox "B"\narrow\nbox "C"\n', {"B": MOVE}),
    ("with .n at A.s + offset", 'A: box "A"\nB: box "B" with .n at A.s + (0,-0.5)\n', {"A": MOVE, "B": MOVE}),
    ("at A + offset", 'A: box "A"\nB: box "B" at A + (2,0)\n', {"A": MOVE, "B": MOVE}),
    ("at A - offset", 'A: box "A"\nB: box "B" at A - (2,0)\n', {"B": MOVE}),
    ("gap below", 'A: box "A"\nB: box "B" at 1in below A\n', {"A": MOVE, "B": MOVE}),
    ("fit + anchor offset", 'A: box "A" fit\nB: box "B" at A.e + (1,0)\n', {"A": MOVE, "B": MOVE}),
    ("size expression", 'A: box "A" wid 2*boxwid\nB: box "B" at (3,0)\n', {"A": MOVE, "B": MOVE}),
    ("owner's diagram", 'Time: oval "Zeit"\nNB: box "Not Before Time" fit with .n at 0.75in below Time.s\n'
     'arrow dashed from Time.s to NB.n "parameter" ljust\n', {"Zeit": MOVE, "Not Before Time": MOVE}),
    ("named chain", 'A: box "A"\narrow\nB: box "B"\narrow\nC: box "C"\n', {"A": MOVE, "B": MOVE, "C": MOVE}),
    ("down chain", 'down\nbox "A"\narrow\nbox "B"\narrow\nbox "C"\n', {"A": MOVE, "B": MOVE, "C": MOVE}),
    ("left chain", 'left\nbox "A"\narrow\ncircle "B"\n', {"A": MOVE, "B": MOVE}),
    ("move", 'box "A"\nmove\nbox "B"\n', {"A": MOVE, "B": MOVE}),
    ("then", 'A: box "A"\nline right then down then right\nB: box "B"\n', {"A": MOVE, "B": MOVE}),
    ("chop", 'A: circle "A"\nB: circle "B" at 1.5in right of A\narrow from A to B chop\n', {"A": MOVE, "B": MOVE}),
    ("same", 'A: box "A" wid 1.2\nB: box "B" same at A + (2,0)\n', {"B": MOVE}),
    ("every kind", 'ellipse "E"\noval "O"\ncircle "C"\ndiamond "D"\ncylinder "Y"\nfile "F"\ntext "T"\n',
     {k: MOVE for k in "EOCDYFT"}),
    ("strings and comments with at", 'A: box "at (1,1)" # placed at A\nB: box "with .n at" at A + (2,0) # at here\n',
     {"at (1,1)": MOVE, "with .n at": MOVE}),
    ("with .w at gap", 'A: box "A"\nB: box "B" with .w at 1in right of A.e\n', {"B": MOVE}),
    ("literal", 'A: box "A" at (0,0)\nB: box "B" at (2,0)\n', {"A": MOVE, "B": MOVE}),
    ("coordinate expression", 'A: box "A"\nB: box "B" at (A.x + 2, A.y)\n', {"B": MOVE}),
    ("way between", 'A: box "A"\nC: box "C" at (3,0)\nB: circle "B" at 1/2 way between A and C\n', {"B": MOVE}),
    ("nested group", 'A: box "A"\n[ C: box "C" ]\n', {"A": MOVE, "C": r"group"}),
    ("macro", 'define m { box "M" }\nm\nA: box "A"\n', {"A": MOVE, "id:o1": r"macro"}),
    # A macro use cannot be pinned, so it moves along, and the toast says so.
    ("macro follower", 'define m { box "M" }\nA: box "A"\nm\n', {"A": MOVE}),
    ("unicode", 'A: box "café 日本"\nB: oval "Zeit ü" at A + (2,0)\n', {"café 日本": MOVE, "Zeit ü": MOVE}),
]
GENERIC = re.compile(r"Only boxes|no name, so it can", re.I)


def label_of(source, obj):
    span = (obj.get("spans") or {}).get("label")
    if not span:
        return None
    raw = source.encode()[span["start"]:span["end"]].decode()
    return raw.strip('"')


def find(page, key):
    s = page.evaluate("pikchrStudio.state()")
    for o in s["scene"]["objects"]:
        if key.startswith("id:") and o["id"] == key[3:]:
            return o
        if o["kind"] in SHAPES and (o["name"] == key or label_of(s["source"], o) == key):
            return o
    raise AssertionError("no shape " + key)


def screen(page, p):
    return page.evaluate("p=>{const q=pikchrStudio.modelToScreen(p);return {x:q.x,y:q.y}}", p)


def shapes(page):
    return {o["id"]: o for o in page.evaluate("pikchrStudio.state().scene.objects") if o["kind"] in SHAPES}


def near(a, b, tol):
    return abs(a["x"] - b["x"]) <= tol and abs(a["y"] - b["y"]) <= tol


def touches(point, bbox, tol=0.06):
    return (bbox["x"] - tol <= point["x"] <= bbox["x"] + bbox["width"] + tol
            and bbox["y"] - tol <= point["y"] <= bbox["y"] + bbox["height"] + tol)


def drag(page, case, source, key, expect):
    set_source(page, source)
    page.wait_for_function("pikchrStudio.state().valid")
    # The previous drag leaves its shape selected; its toolbar may cover this one.
    clear_selection(page)
    page.wait_for_function("!pikchrStudio.state().selectedIds.length")
    obj = find(page, key)
    before = shapes(page)
    connectors = [o for o in page.evaluate("pikchrStudio.state().scene.objects")
                  if o["kind"] in ("arrow", "line") and obj["id"] in (o.get("dependencies") or [])]
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
    page.wait_for_timeout(150)
    badge = page.evaluate("(()=>{const b=document.querySelector('.drag-refusal');return b&&!b.hidden?b.textContent:''})()")
    page.mouse.up()
    try:
        page.wait_for_function("s=>{const t=pikchrStudio.state();return t.valid&&t.source!==s&&!t.queued}", arg=source,
                               timeout=3000 if expect == MOVE else 600)
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
    if expect == MOVE:
        if state["source"] == source:
            return f"FAIL {where}: snapped back; message={message!r}"
        after = {o["id"]: o for o in state["scene"]["objects"] if o["kind"] in SHAPES}
        moved = after.get(obj["id"])
        target = {"x": obj["center"]["x"] + delta["x"], "y": obj["center"]["y"] + delta["y"]}
        if not moved or not near(moved["center"], target, 0.12):
            return f"FAIL {where}: landed at {moved and moved['center']}, wanted {target}"
        others = [o.get("name") or oid for oid, o in before.items()
                  if oid != obj["id"] and (oid not in after or not near(after[oid]["center"], o["center"], 1e-3))]
        if others and not re.search(r"moved with it \(Studio can.t pin", message):
            return f"FAIL {where}: other shapes moved: {others}; source={state['source']!r}"
        for c in connectors:
            now = next((o for o in state["scene"]["objects"] if o["id"] == c["id"]), None)
            if not now or not any(touches(p, moved["bbox"]) for p in (now["path"][0], now["path"][-1])):
                return f"FAIL {where}: connector {c['id']} detached"
        if not message.startswith("Moved"):
            return f"FAIL {where}: no 'Moved' toast: {message!r}"
        return f"ok   {where}: moved -> {state['source'].strip()!r}" + (f" ({message})" if others else "")
    if state["source"] != source:
        return f"FAIL {where}: should refuse but changed source"
    if not re.search(expect, message, re.I) or not re.search(expect, hint, re.I):
        return f"FAIL {where}: refusal not specific/persistent: status={message!r} hint={hint!r}"
    if not re.search("can.t move", badge, re.I) or not re.search(expect, badge, re.I):
        return f"FAIL {where}: no refusal badge during drag: {badge!r}"
    return f"ok   {where}: refused: {message}"


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
        for line in results:
            print(line)
        failed = [r for r in results if r.startswith("FAIL")]
        print(f"{len(results) - len(failed)}/{len(results)} cells pass")
        assert not errors, errors
        assert not failed, f"{len(failed)} matrix cells failed"
        print("PASS: drag placement matrix")
    finally:
        browser.close()
