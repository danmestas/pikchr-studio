# Pikchr Studio

Pikchr Studio is a browser authoring layer over the [Pikchr](https://pikchr.org)
diagram language. The Pikchr source text stays canonical: the studio renders it
through an opt-in `pikchr_studio()` entry point that returns ordinary SVG plus a
scene description (object IDs, source spans, geometry, anchors, dependencies),
and every drag, resize, or property change becomes a proposed edit to that
source. Each proposal is rendered by Pikchr before it can be applied, so the
diagram never shows geometry the source cannot reproduce.

## Layout

| Path | Purpose |
| --- | --- |
| `public/` | The static site: app, help, API docs, 404, licenses, icons, `_headers`. The app is `index.html` + ES modules, `pikchr.js`/`pikchr.wasm` (built), `api.html` documents the scene JSON, `help.html` is the in-app guide, `embed.html` is the read-only embed. |
| `vendor/` | `studio.patch` (the studio's changes to upstream `pikchr.y`), `studio.h` (the native API), `build.sh`, `check.cjs` (native API and legacy-equivalence checks), `MANIFEST.json` (what the checked-in wasm was built from). Pikchr's own sources are not in this repository. |
| `tests/*.test.mjs` | Node unit tests for the edit engine, worker, and stores. |
| `tests/*-browser.py` | Playwright scripts driving the real UI. `run-browser.py` serves `public/` and runs them. |
| `docs/` | The original design proposal. |
| `design/` | Source SVGs for the app icons; the PNG/ICO files in `public/` are rendered from them with `rsvg-convert` and ImageMagick. |

## Toolchain

| Tool | Version used |
| --- | --- |
| Node | 24.x |
| Python | 3.11 with `playwright` installed |
| Google Chrome | any current; the browser scripts launch `channel="chrome"` |
| Emscripten | 6.0.9 (only needed to rebuild the wasm) |
| C compiler | any `cc` for the native `pikchr` CLI used by `check.cjs` |

## Build

The prebuilt `public/pikchr.js` and `public/pikchr.wasm` are committed, so the
app runs and tests pass without building anything. Rebuilding them needs an
upstream Pikchr checkout (https://pikchr.org, check-in `a7f1c35bc0`):

```sh
PIKCHR_SRC=/path/to/pikchr npm run build
```

`vendor/build.sh` copies `pikchr.y`, `lemon.c`, `lempar.c` and `VERSION.h` from
that checkout into `vendor/build/`, applies `vendor/studio.patch`, and compiles
the native CLI (`vendor/pikchr`) and the wasm. `vendor/MANIFEST.json` records the
toolchain and hashes. Build products are ignored.

## Run

```sh
npm start            # http://127.0.0.1:8790
```

`npm start` runs `serve.py`, a static server that sends `Cache-Control: no-cache`
so the browser never mixes stale cached modules with fresh ones. Any static
server works; the app is plain HTML, ES modules, and a Web Worker.

## Interface

One full-window canvas with floating controls: ☰ (documents, examples, view,
queued changes, tools), `</>` (the source drawer), ⤓ (export), a tool palette,
a status chip, and undo/zoom chips. Selecting an object shows a toolbar above
it whose ⋯ opens the inspector. `public/help.html` describes every gesture.
The controls are declared in `index.html`; `canvas-layout.js` arranges them
into the floating chrome.

## Test

```sh
npm test             # unit, then native, then browser
npm run test:unit    # node --test tests/*.test.mjs
npm run test:native  # node vendor/check.cjs  (uses public/pikchr.js; set PIKCHR_SRC to also check upstream fixtures)
npm run test:browser # python3 tests/run-browser.py [name-filter ...]
```

The browser runner binds port 8790 because the scripts hard-code that URL. If
`npm start` is already serving this `public/` directory there, the runner reuses
that server and leaves it running; any other listener on the port is an error. Set `PIKCHR_STUDIO_SCRIPT_TIMEOUT` (seconds)
to change the per-script limit. A script that fails once and passes on retry is
reported `FLAKY`; the run only fails on a repeat failure.

## Deploy

The site is an assets-only Cloudflare Worker named `pikchr-studio`
(`wrangler.jsonc`): Cloudflare serves `public/` directly, with no Worker script.

```sh
npm run deploy       # npx wrangler@4.138.0 deploy (needs a logged-in Wrangler)
npm run dev:worker   # the same Worker locally, with its headers and 404 handling
```

- `public/_headers` sets the Content-Security-Policy and other security headers,
  and makes HTML, JS, CSS and wasm revalidate on every load (`no-cache`).
  `embed.html` alone may be framed by other sites.
- `public/.assetsignore` keeps internal pages (`ux-audit/*.html`) out of the deploy.
- Unknown paths get `public/404.html` with status 404.
- Absolute URLs (canonical links, Open Graph, `robots.txt`, `sitemap.xml`) use the
  live origin `https://pikchr-studio.daniel-mestas.workers.dev`. If the site moves to
  a custom domain, replace that origin in those files.
- CI runs `wrangler deploy --dry-run` to validate the config without credentials.

## Design rules

- **Source is canonical.** The scene JSON and the SVG are derived views of the
  Pikchr text. Object IDs are render-local and do not survive a source change.
- **Every edit is a validated Pikchr program.** A candidate is a complete
  source revision that has been rendered without error before it is offered.
- **No silent structural rewrites.** Moving an object must not quietly replace
  a relational placement (`with .n at A.s`, `below A`) with absolute
  coordinates; when the structure would change, the author chooses.
- **Constrained editor, not a drawing program.** Features exist to make
  Pikchr's own vocabulary visible and editable, not to replace it.

The native API contract is documented in `public/api.html`.

## License

Pikchr Studio is released under the [Zero-Clause BSD license](LICENSE), the same
license as [Pikchr](https://pikchr.org). The bundled `public/pikchr.wasm` is built
from Pikchr and carries its own 0BSD notice; see `public/licenses.html`.
