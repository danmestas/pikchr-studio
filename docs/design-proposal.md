# Proposal: Pikchr Studio — Source-Aware Interactive Authoring

**Status:** Concrete design proposal  
**Target:** The Pikchr source checkout in `home/`  
**Primary deliverable:** An opt-in authoring API and a browser prototype built on the existing Pikchr fiddle  
**Compatibility requirement:** Existing Pikchr source, SVG output, and the `pikchr()` C API continue to work unchanged

## 1. Decision

Build Pikchr Studio as an authoring layer over the existing Pikchr parser and geometry engine, not as a second renderer and not as a general-purpose constraint solver.

The source remains canonical. Rendering in authoring mode produces two synchronized outputs:

1. ordinary SVG, annotated with stable object identifiers; and
2. a scene description containing source spans, resolved geometry, anchors, dependencies, and the edits the selected construct supports.

Dragging an object or path handle asks an edit engine for a small ranked set of Pikchr-native source changes. The UI previews the nearest valid rendered result and its source diff. The author accepts one candidate; Studio never silently performs a structural rewrite.

This preserves Pikchr's small deterministic renderer while making its geometric language visible and learnable.

## 2. Why this fits the current implementation

The checked-out implementation already contains most of the runtime facts an authoring tool needs:

- `PToken` in `home/pikchr.y` retains token text and length.
- `PObj` retains resolved object geometry, path data, bounding information, entry/exit points, property state, and calculation masks.
- `PClass.xOffset` knows how named anchors map onto each object class.
- Position and route semantics pass through a limited set of functions: `pik_set_at`, `pik_set_from`, `pik_add_to`, `pik_evenwith`, and `pik_after_adding_attributes`.
- `pik_elist_render` dispatches each object to its class renderer, providing one place to associate emitted SVG with a stable object identifier.
- `home/fiddle/` already supplies a browser UI, debounced rendering, a Web Worker, a WebAssembly build, and a JavaScript `cwrap` bridge.

The missing capability is provenance. Pikchr can resolve a program into geometry, but it does not currently retain a complete explanation of which source construct produced each geometric relationship. Studio should add that explanation as optional data rather than reconstruct it from finished SVG.

## 3. User experience

The prototype has three panes:

- **Source:** editable Pikchr text.
- **Diagram:** rendered SVG with selectable objects, anchors, handles, and guides.
- **Change:** ranked intent candidates, a source diff, and a short explanation.

Selecting an object highlights both the SVG object and its source statement. The diagram overlays its bounding box, center, compass anchors, and relevant dependencies.

During a drag, Studio shows a temporary ghost at the pointer and asks the Worker for candidate edits. A candidate is always a complete, renderable source program. The diagram displays the geometry produced by that candidate—not arbitrary geometry that Pikchr cannot reproduce.

For example, moving `Database` beneath `API` might yield:

```diff
- Database: cylinder "DB" at (3.1, 2.7)
+ Database: cylinder "DB" below API
```

Other candidates may preserve an explicit offset or align a named edge. The author can cycle through candidates before accepting one.

For a path, selecting a segment or vertex exposes the constructs Pikchr already supports: endpoints, intermediate path points, directions, and `until even with`. The first version edits existing path structure; it does not invent an obstacle-avoiding router.

## 4. Architecture

### 4.1 Authoring data is opt-in

Keep the current render path untouched unless an authoring caller requests inspection data. Add an options-based API alongside `pikchr()` in `home/pikchr.h.in`.

The public design should follow this shape; exact C ownership names may be adjusted to match project conventions:

```c
typedef struct PikchrStudioResult PikchrStudioResult;

typedef struct PikchrStudioOptions {
  unsigned int version;
  unsigned int flags;
} PikchrStudioOptions;

int pikchr_studio_render(
  const char *source,
  const char *css_class,
  unsigned int render_flags,
  const PikchrStudioOptions *options,
  PikchrStudioResult **result
);

const char *pikchr_studio_svg(const PikchrStudioResult *result);
const char *pikchr_studio_scene_json(const PikchrStudioResult *result);
const char *pikchr_studio_error(const PikchrStudioResult *result);
void pikchr_studio_result_free(PikchrStudioResult *result);
```

The existing `pikchr()` function remains the stable minimal embedding API. Authoring mode may cost more memory because it retains spans and dependencies; ordinary rendering should not pay that cost.

### 4.2 Source provenance

Extend internal tokens and objects only when authoring mode is enabled.

Each source span records byte offsets into the original UTF-8 input. Line and column values can be derived by the host. Byte offsets avoid ambiguity and support exact text replacement.

Each object receives a stable render-local identifier and retains:

- its complete statement span;
- spans for its object label, class, text, and editable attributes;
- the macro invocation span and definition span when applicable;
- the source construct responsible for placement;
- object and anchor dependencies referenced by that construct;
- geometry before SVG scaling; and
- a capability mask describing safe edit operations.

Capture this information at parser semantic-action boundaries instead of attempting to infer it after rendering:

- `pik_tokenize`: original input and macro-expansion origin stack;
- `pik_elem_new`: object identity and statement start;
- `pik_set_at`: placement dependency and anchor;
- `pik_set_from` / `pik_add_to`: path endpoint and vertex dependencies;
- `pik_evenwith`: alignment dependency;
- `pik_after_adding_attributes`: final statement range and resolved edit capabilities.

### 4.3 Scene description

Authoring mode emits versioned JSON. A representative object is:

```json
{
  "schema": 1,
  "objects": [
    {
      "id": "o7",
      "kind": "cylinder",
      "name": "Database",
      "statement": { "start": 42, "end": 80 },
      "placement": { "start": 66, "end": 75 },
      "bbox": { "x": 2.1, "y": 1.4, "width": 1.2, "height": 0.8 },
      "center": { "x": 2.7, "y": 1.8 },
      "anchors": {
        "n": { "x": 2.7, "y": 1.4 },
        "s": { "x": 2.7, "y": 2.2 },
        "e": { "x": 3.3, "y": 1.8 },
        "w": { "x": 2.1, "y": 1.8 }
      },
      "dependsOn": [
        { "object": "o3", "anchor": "center", "reason": "below" }
      ],
      "capabilities": ["move", "align", "offset"]
    }
  ]
}
```

The production schema should include all compass anchors, path vertices, entry/exit points, diagnostics, macro origins, diagram bounds, and a source hash. Numeric geometry remains in Pikchr's resolved coordinate system; the UI uses the SVG view box to transform it to pixels.

### 4.4 SVG association

In authoring mode, `pik_elist_render` wraps each renderable object in a group such as:

```html
<g data-pikchr-id="o7">...</g>
```

This is preferable to hit-testing raw SVG primitives. A single Pikchr object may render as several SVG elements, especially paths, cylinders, arrowheads, and text.

The normal renderer should continue emitting its current SVG unless the authoring flag is set.

### 4.5 Edit transactions

Do not expose a generic AST mutation API in the first release. Expose a narrow proposal operation:

```text
source + sourceHash + objectId + gesture + pointerGeometry
  -> ranked candidate source replacements
  -> render each candidate
  -> return candidate source, diff, geometry, explanation, and score
```

The browser sends a Worker message like:

```json
{
  "type": "propose-edit",
  "data": {
    "source": "...",
    "sourceHash": "...",
    "objectId": "o7",
    "gesture": "move",
    "target": { "x": 2.7, "y": 2.9 }
  }
}
```

The reply contains at most five candidates. Each candidate includes a replacement span, replacement text, complete preview SVG or scene delta, geometric error, score components, and a human-readable rationale.

A stale source hash causes the Worker to reject the edit and request a rerender. This avoids applying a replacement to source that changed during a drag.

## 5. Initial snapping vocabulary

The first version should deliberately support a small set of constructs documented in `home/doc/position.md`, `place.md`, `locattr.md`, and `pathattr.md`.

Generate candidates in this order:

1. Preserve the existing expression while changing only its numeric offset.
2. Default directional placement relative to a named object: above, below, left, or right.
3. Anchor-to-anchor placement using `at` or `with EDGE at`.
4. Horizontal or vertical edge/center alignment.
5. A relative offset from a named object or anchor.
6. A mixed position using the x-coordinate of one place and y-coordinate of another, when already idiomatic in the surrounding source.
7. An absolute position as the final fallback.

Candidate ranking is deterministic:

```text
score =
    geometric_error
  + source_edit_size
  + dependency_churn
  + construct_complexity
  + absolute_coordinate_penalty
  + unnamed_reference_penalty
```

Hard rules precede scoring:

- never rewrite outside the selected statement in version one;
- never modify a macro definition from an expanded object drag;
- never introduce a reference to an object declared later;
- reject a candidate that does not parse and render successfully;
- reject a candidate whose selected object cannot be matched after rendering;
- prefer explicit object names over ordinal or `last` references;
- use fixed tie-breaking so the same input always yields the same ranking.

## 6. Routing scope

Routing should be delivered in two stages.

**Stage one: path editing.** Select endpoints and existing vertices; drag them to named anchors or alignment guides; rewrite only the relevant `from`, `to`, direction, vertex, or `until even with` clause. This is achievable with the existing path model in `PObj` and the semantic seams in `pik_set_from`, `pik_add_to`, and `pik_evenwith`.

**Later stage: assisted rerouting.** Given fixed object positions and explicit clearance, search for a small orthogonal route and express it using Pikchr path clauses. This must be optional, deterministic, bounded by a work limit, and presented as candidates. It is not part of the minimum viable prototype because obstacle avoidance introduces a separate search problem and can obscure author intent.

## 7. Browser prototype changes

Use the current files rather than creating a new application:

- `home/fiddle/fiddle.html`: add an SVG overlay layer, inspector, candidate list, diff view, and accept/cancel controls.
- `home/fiddle/fiddle.js`: add object selection, pointer gestures, coordinate transforms, guide rendering, keyboard candidate cycling, and source replacement.
- `home/fiddle/pikchr-worker.js`: add `inspect` and `propose-edit` messages and wrap the new exported C functions.
- `home/fiddle/GNUmakefile`: export the authoring API and ensure returned buffers are freed correctly.

The prototype may continue using the textarea. A code-editor dependency is unnecessary until source mapping and edits work reliably.

The current fiddle inserts renderer output with `innerHTML`. Authoring mode must treat only Pikchr-generated SVG as renderable and place diagnostics/diffs through text-safe DOM APIs. The new JSON result must never be interpolated into HTML.

## 8. File-level implementation map

| File | Proposed responsibility |
|---|---|
| `home/pikchr.y` | Source spans, macro origins, object IDs, dependency capture, scene serialization, candidate generation, and annotated SVG groups |
| `home/pikchr.h.in` | Versioned opt-in authoring API while preserving `pikchr()` |
| `home/fiddle/pikchr-worker.js` | Worker protocol, WASM calls, buffer lifetime, stale-source checks |
| `home/fiddle/fiddle.js` | Selection, overlays, gestures, candidate previews, diffs, source application |
| `home/fiddle/fiddle.html` | Inspector and candidate UI structure/styles |
| `home/fiddle/GNUmakefile` | WASM exports for authoring functions |
| `home/tests/studio/` | Scene JSON goldens, edit cases, macro cases, invalid/stale requests |
| `home/doc/studio-api.md` | C API, ownership, schema, compatibility, and security limits |
| `home/doc/studio-authoring.md` | Interaction behavior and supported transformations |

Generated `pikchr.c` should remain generated from `pikchr.y`; it should not become the hand-edited source of this feature.

## 9. Delivery slices

### Slice 1: Inspectable rendering

Add source spans, IDs, object groups, and versioned scene JSON. Update the fiddle so selecting SVG highlights the originating statement and displays anchors and resolved geometry.

This slice is useful on its own: it teaches the language and provides better diagnostics without performing rewrites.

### Slice 2: Object movement proposals

Support dragging named box-like objects and generate the seven placement candidate classes above. Show candidate ghosts and source diffs; require explicit acceptance.

Limit the initial object set to box, circle, ellipse/oval, cylinder, diamond, file, text, and dot. Move and path objects can follow after their semantics are tested separately.

### Slice 3: Path endpoint and vertex editing

Expose path endpoints and vertices; support snapping to object anchors and `even with` guides; rewrite existing path clauses without automatic obstacle routing.

### Slice 4: Hardening and embedding

Document the API, stabilize the JSON schema, add resource limits, test native and WASM builds, and create an integration example for a host editor.

## 10. Testing

The existing `home/tests/*.pikchr` corpus should remain a renderer-regression suite. Studio adds machine-checkable tests because the current HTML-oriented visual test output is insufficient for authoring contracts.

Required test groups:

- **Source mapping:** every rendered object maps to the correct byte span, including comments, Unicode text, nested blocks, and macros.
- **Scene geometry:** object bounds, anchors, vertices, and dependencies match fixed JSON goldens.
- **Compatibility:** ordinary `pikchr()` output is byte-identical when authoring mode is not enabled.
- **Round trip:** each proposed edit parses, renders, identifies the same selected object, and lands within the declared geometric tolerance.
- **Determinism:** the same source and gesture return candidates in the same order.
- **Locality:** accepted version-one edits change only the advertised source span.
- **Macro safety:** expanded objects can be inspected, but unsafe definition-level rewrites are refused with an explanation.
- **Worker protocol:** malformed, oversized, and stale requests fail without mutating source.
- **Memory:** native and WASM stress tests render and free repeated authoring results without leaks.

Add a compact C test harness for API/ownership tests and browser tests for selection, dragging, candidate switching, accept, cancel, and source-change invalidation.

## 11. Success criteria for the prototype

The prototype is successful when a new author can:

1. paste an existing Pikchr diagram into the fiddle;
2. click any top-level named object and see its statement, bounds, anchors, and placement dependencies;
3. drag a supported object and receive at least one valid, deterministic Pikchr-native candidate;
4. compare the old and proposed source before accepting;
5. accept the edit and obtain ordinary Pikchr source that renders without Studio;
6. cancel the edit without changing the source;
7. edit the source manually and immediately regain synchronized selection and geometry; and
8. perform all of the above without changing normal `pikchr()` callers or normal SVG output.

For an initial usability study, give five users three tasks: align two boxes, move a cylinder below a named box, and reconnect an arrow to a different anchor. At least four users should complete all tasks without consulting the position or path documentation, and each final program must use ordinary Pikchr syntax rather than hidden metadata.

## 12. Explicit non-goals

The first release will not:

- replace Pikchr's parser or renderer;
- add hidden editor metadata to Pikchr source;
- provide general graph layout;
- freely reposition multiple existing objects as a global constraint solution;
- automatically rewrite macro definitions;
- guarantee pixel-identical text metrics across browsers and native builds;
- add a large editor framework or code-editor dependency; or
- implement automatic obstacle-avoiding routing.

These exclusions keep the proposal aligned with Pikchr's main strengths: small size, deterministic textual input, embeddability, and deliberate author-controlled geometry.

## 13. Main risks and mitigations

**Parser provenance becomes invasive.** Keep it behind an authoring flag and capture data at the small number of semantic functions that already establish geometry.

**Stable identity is difficult after a rewrite.** Use explicit object labels when present; otherwise derive a render-local fingerprint from statement span, kind, and occurrence. Reject a candidate when identity is ambiguous.

**Candidate generation produces surprising code.** Start with a narrow vocabulary, show the diff and rationale, require acceptance, and measure ranking quality with recorded gestures.

**Macro expansion obscures editable source.** Report both invocation and definition origins, but make invocation-level inspection read-only until a safe macro-edit policy is designed.

**Authoring features bloat the renderer.** Compile them conditionally or isolate them so normal builds can omit candidate generation and JSON serialization.

**Interactive rendering becomes slow.** Debounce source edits as today, evaluate only nearby objects, cap candidates at five, cache the parsed/inspected baseline where feasible, and move all rendering/search work into the existing Worker.

## 14. Recommendation

Approve Slices 1 and 2 as the first project: inspectable rendering plus object-movement proposals. They establish the essential round trip—source to geometry to manipulation to reviewed source—without prematurely committing to automatic routing or a general solver.

The first technical spike should prove one vertical path using a named box:

```text
parse source
  -> emit object ID, source span, bounds, and anchors
  -> select the object in the existing fiddle
  -> drag it near another named object
  -> propose `below`, an explicit offset, and an absolute fallback
  -> preview each rendered candidate
  -> accept one textual replacement
```

If that path is reliable, the architecture is sound enough to expand across object classes and then into path editing.
