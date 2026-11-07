// In-page half of tests/inspector-matrix-browser.py. One call checks a batch
// of cells on the open page and returns their failures; the Python side only
// builds cells, picks pages and prints. Everything here drives the inspector
// the way its own controls do (click, change, Enter) and reads the DOM, the
// rendered SVG and pikchrStudio.state(); nothing reaches into app internals.
(() => {
  const $ = id => document.getElementById(id);
  const st = () => pikchrStudio.state();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  async function until(f, ms = 3000) {
    const t = performance.now();
    for (;;) { const v = f(); if (v) return v; if (performance.now() - t > ms) return null; await sleep(4); }
  }
  const enc = new TextEncoder(), dec = new TextDecoder();
  const bytes = s => enc.encode(s);
  const slice = (s, a, b) => dec.decode(bytes(s).slice(a, b));
  const TEXTS = /"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|#[^\n]*|\/\/[^\n]*/g;
  const texts = s => s.match(TEXTS) || [];
  const mask = s => s.replace(TEXTS, m => ' '.repeat(m.length));
  const shown = e => !!e && e.getClientRects().length > 0 && e.checkVisibility({visibilityProperty: true, opacityProperty: false});
  const ins = () => $('inspector');
  const panel = () => document.querySelector('.cl-more');

  // ---- colours -----------------------------------------------------------
  const probe = document.createElement('canvas').getContext('2d');
  function rgba(css) {
    const m = /rgba?\(([^)]+)\)/.exec(css || '');
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    probe.fillStyle = '#000'; probe.fillStyle = css;
    const h = probe.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(h)) return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1);
    return rgba(h);
  }
  const over = (fg, bg) => { const a = fg[3]; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)).concat(1); };
  const lum = c => { const v = c.slice(0, 3).map(x => x / 255).map(x => x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const hex = c => '#' + c.slice(0, 3).map(n => Math.round(n).toString(16).padStart(2, '0')).join('');
  // The opaque colour behind an element: its own and its ancestors'
  // backgrounds composited over the page.
  function backdrop(e) {
    const layers = [];
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let out = [255, 255, 255, 1];
    for (const c of layers.reverse()) out = over(c, out);
    return out;
  }
  const opacity = e => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };

  // ---- source helpers ----------------------------------------------------
  async function setSource(text) {
    if (st().source === text && st().valid && !st().queued) return true;
    const s = $('source'); s.value = text; s.dispatchEvent(new Event('input', {bubbles: true}));
    $('render').click();
    return !!await until(() => { const x = st(); return x.source === text && x.valid && !x.queued; }, 4000);
  }
  function objectFor(state, key) {
    if (key.startsWith('kind:')) return state.scene.objects.find(o => o.kind === key.slice(5));
    if (key === 'macro') return state.scene.objects.find(o => o.reason === 'Macro-expanded object');
    return state.scene.objects.find(o => o.id === key) || state.scene.objects.find(o => o.name === key)
      || state.scene.objects.find(o => o.spans?.label && slice(state.source, o.spans.label.start, o.spans.label.end) === '"' + key + '"');
  }
  async function select(id) {
    if (!(st().object?.id === id && st().selectedIds.length === 1)) {
      $('diagram').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
      pikchrStudio.select(id);
      if (!await until(() => st().object?.id === id && st().selectedIds.length === 1, 1500)) return false;
    }
    const more = panel();
    if (!shown(more)) {
      const b = document.querySelector('.cl-context [aria-label="More options"]');
      if (shown(b)) b.click(); else $('mobile-objects').click();
      await until(() => shown(more), 1500);
    }
    const back = document.querySelector('.cl-view-objects');
    if (shown(back)) document.querySelector('.cl-back')?.click();
    return !!await until(() => shown(document.querySelector('.cl-view-properties')) && ins().childElementCount, 1500);
  }
  function openStyle() {
    const d = ins().querySelector('details.appearance-editor');
    if (d && !d.open) d.querySelector(':scope > summary').click();
    return d;
  }
  // Swatches paint asynchronously in dark mode (one probe render per batch).
  async function painted() {
    await until(() => [...ins().querySelectorAll('.style-swatch[data-colour]:not([data-colour=none])')]
      .every(b => b.style.getPropertyValue('--swatch')), 1500);
    await frame();
  }
  const visibleAlerts = () => [...ins().querySelectorAll('[role=alert],.style-error,.property-error,.size-error')]
    .filter(e => shown(e) && e.textContent.trim()).map(e => e.textContent.trim());

  // ---- controls ----------------------------------------------------------
  // A control's key survives the inspector being rebuilt after each render.
  const nameOf = e => (e.getAttribute('aria-label') || e.textContent.trim().replace(/\s+/g, ' ')).slice(0, 60);
  const groupOf = e => e.closest('[role=group][aria-label]')?.getAttribute('aria-label') || e.closest('section[aria-label]')?.getAttribute('aria-label') || '';
  const keyOf = e => groupOf(e) + '/' + nameOf(e);
  // Controls in scope: every value control outside Advanced & source and the
  // Suggested routes gallery (which previews before applying). Openers
  // (label editor, Custom, Elbow, Waypoints, Reconnect, Show source) and the
  // sizing group (sizing-browser.py) are not value controls.
  const OPENERS = /^(Edit label|Add label|Custom .* colour|Elbow|Waypoints|Reconnect (start|end)|Show in source|Show source|Inspect generating source|Detach .*|Update label|Remove label)$/;
  function controls() {
    return [...ins().querySelectorAll('button,select,input')].filter(e => shown(e)
      && !e.closest('.inspector-advanced,.inspector-routes,.inspector-routes-slot,.canvas-sizing')
      && !OPENERS.test(nameOf(e)) && !(e.tagName === 'INPUT' && e.type !== 'number'));
  }
  const find = key => controls().find(e => keyOf(e) === key) || null;
  // What a control may touch in its statement: its own keywords and values.
  function vocabulary(key) {
    const [group] = key.split('/');
    if (/^(Fill)$/.test(group)) return ['fill'];
    if (/^(Line & text|Text)$/.test(group)) return ['color'];
    if (/Thickness/.test(key)) return ['thickness', 'thick', 'thin'];
    if (/^(Text size|Font|Text alignment)$/.test(group)) return ['big', 'small', 'bold', 'italic', 'mono', 'monospace', 'ljust', 'rjust', 'center'];
    if (group === 'Heads') return ['->', '<-', '<->', 'arrow', 'line'];
    if (group === 'Stroke') return ['dashed', 'dotted'];
    if (group === 'Ends') return ['chop'];
    if (group === 'Label placement') return ['above', 'below'];
    if (key === 'Text style/Along the line') return ['aligned'];
    return null;   // structural (route, reverse): checked only for confinement
  }
  const valueToken = t => /^[-+]?(?:0x[0-9a-f]+|\d+(?:\.\d*)?|\.\d+)(?:in|cm|mm|pt|px|%)?$/i.test(t) || /^[a-z]+$/i.test(t) && CSS.supports('color', t);
  const tokens = s => mask(s).match(/<->|<-|->|[^\s,()]+/g) || [];
  function removed(a, b) {
    const left = new Map();
    for (const t of tokens(b)) left.set(t, (left.get(t) || 0) + 1);
    const out = [];
    for (const t of tokens(a)) { const n = left.get(t) || 0; if (n) left.set(t, n - 1); else out.push(t); }
    return out;
  }
  const statementOf = (source, object) => object?.span?.start >= 0 ? slice(source, object.span.start, object.span.end) : null;

  // The colour Pikchr drew for an object: fill of its first closed path, or
  // the stroke (and label) colour.
  function drawn(id, role) {
    const g = document.querySelector(`#diagram svg [data-pikchr-id="${id}"]`);
    if (!g) return null;
    if (role === 'fill') { const p = [...g.querySelectorAll('path,polygon,ellipse,circle')].find(p => /fill:rgb/.test(p.getAttribute('style') || '')); return p ? rgba(/fill:(rgb\([^)]*\))/.exec(p.getAttribute('style'))[1]) : null; }
    const p = [...g.querySelectorAll('path,ellipse,circle')].find(p => /stroke:rgb/.test(p.getAttribute('style') || ''));
    if (p) return rgba(/stroke:(rgb\([^)]*\))/.exec(p.getAttribute('style'))[1]);
    const t = g.querySelector('text[fill]');
    return t ? rgba(t.getAttribute('fill')) : null;
  }
  const close = (a, b) => a && b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= 2);
  const swatchColour = b => { const v = b.style.getPropertyValue('--swatch').trim(); return v ? rgba(v) : null; };

  // ---- checks ------------------------------------------------------------
  const GENERIC = /Only supported named native shapes|can.t move this \w+ by dragging|Edit this \[\]|cannot safely rewrite this|expression must be edited in source|Studio cannot restyle this connector safely/i;
  const KIND_WORDS = {box: 'boxes', circle: 'circles', ellipse: 'ellipses', oval: 'ovals', cylinder: 'cylinders', diamond: 'diamonds', file: 'files', text: 'text'};
  function banners(cell, object, fail) {
    const notes = [...ins().querySelectorAll('.inspector-status,[role=note]')].filter(shown).map(e => e.textContent.trim());
    for (const text of notes) {
      if (!/blocked/i.test(text)) continue;
      if (GENERIC.test(text)) fail('banner', `generic banner: ${text}`);
      const listed = /Studio moves ([^.]*?), not ([^.]*)/.exec(text);
      if (listed && KIND_WORDS[object.kind] && new RegExp('\\b' + KIND_WORDS[object.kind] + '\\b').test(listed[1]))
        fail('banner', `banner contradicts the object (${object.kind}): ${text}`);
      if (/^Editing is blocked/.test(text) && controls().some(e => !e.disabled))
        fail('banner', `"Editing is blocked" while controls are enabled: ${text}`);
    }
    const blocked = notes.some(t => /blocked/i.test(t));
    if (cell.expect?.banner === false && blocked) fail('banner', `banner where nothing is blocked: ${notes.join(' | ')}`);
    if (cell.expect?.banner && !notes.some(t => new RegExp(cell.expect.banner, 'i').test(t)))
      fail('banner', `missing banner /${cell.expect.banner}/: ${notes.join(' | ') || 'none'}`);
    if (object.editable && blocked) fail('banner', `movable ${object.kind} shows a blocked banner: ${notes.join(' | ')}`);
  }
  function disabledReasons(source, fail) {
    for (const e of controls().filter(e => e.disabled)) {
      const box = e.closest('.style-control') || e.closest('.inspector-row');
      const note = box?.querySelector('.style-locked')?.textContent || '';
      const reason = note || (e.title && e.title !== nameOf(e) && !/^(none|[a-z]+)$/.test(e.title) ? e.title : '');
      if (!reason.trim()) { fail('disabled', `${keyOf(e)} is disabled without a reason`); continue; }
      if (GENERIC.test(reason)) fail('disabled', `${keyOf(e)} has a generic reason: ${reason}`);
      const quoted = /"([^"]+)"/.exec(reason);
      if (e.closest('.appearance-editor,.text-style-group') && !(quoted && mask(source).includes(quoted[1].replace(/"(?:\\.|[^"\\])*"/g, m => ' '.repeat(m.length)))))
        fail('disabled', `${keyOf(e)} reason does not quote the source outside strings and comments: ${reason}`);
    }
  }
  // Every visible control inside the panel, no overlaps, rings unclipped,
  // no horizontal scroll, inset carets, 44px targets on touch.
  function ringOf(e) {
    const c = getComputedStyle(e), r = e.getBoundingClientRect();
    let out = 0;
    if (c.outlineStyle !== 'none') out = Math.max(out, parseFloat(c.outlineWidth) + Math.max(0, parseFloat(c.outlineOffset)));
    for (const m of (c.boxShadow === 'none' ? '' : c.boxShadow).matchAll(/(?:rgba?\([^)]*\)\s*)?(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px/g))
      if (!/inset/.test(m[0])) out = Math.max(out, Math.abs(+m[1]) + Math.abs(+m[2]) + +m[3] + +m[4]);
    return {left: r.left - out, right: r.right + out, top: r.top - out, bottom: r.bottom + out, out};
  }
  function clipFor(e) {
    let box = {left: -Infinity, right: Infinity, top: -Infinity, bottom: Infinity};
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
      const r = n.getBoundingClientRect();
      const left = r.left + n.clientLeft, top = r.top + n.clientTop;
      const scrollsY = n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(c.overflowY);
      box = {left: Math.max(box.left, left), right: Math.min(box.right, left + n.clientWidth),
        top: Math.max(box.top, scrollsY ? top - n.scrollTop : top), bottom: Math.min(box.bottom, scrollsY ? top - n.scrollTop + n.scrollHeight : top + n.clientHeight)};
    }
    return box;
  }
  const inside = (r, b, tol = 0.5) => r.left >= b.left - tol && r.right <= b.right + tol && r.top >= b.top - tol && r.bottom <= b.bottom + tol;
  async function layout(touch, fail) {
    const all = [...ins().querySelectorAll('button,input,select,summary,textarea')].filter(shown);
    const p = panel(), pr = p.getBoundingClientRect();
    for (const n of [p, ...p.querySelectorAll('*')]) {
      if (!shown(n)) continue;
      const c = getComputedStyle(n);
      if (/auto|scroll|hidden/.test(c.overflowX) && n.scrollWidth > n.clientWidth + 1 && n.tagName !== 'INPUT' && n.tagName !== 'SELECT' && n.tagName !== 'TEXTAREA')
        fail('layout', `${n.className || n.tagName} scrolls sideways (${n.scrollWidth} > ${n.clientWidth})`);
    }
    for (const e of all) {
      const r = e.getBoundingClientRect();
      if (r.left < pr.left - .5 || r.right > pr.right + .5) fail('layout', `${keyOf(e)} is outside the panel (${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(pr.left)}-${Math.round(pr.right)})`);
      else if (!inside({left: r.left, right: r.right, top: r.top, bottom: r.bottom}, clipFor(e))) fail('layout', `${keyOf(e)} is clipped`);
      if (touch && !e.disabled && e.tagName !== 'SUMMARY' && (r.width < 43.5 || r.height < 43.5)) fail('touch', `${keyOf(e)} is ${Math.round(r.width)}x${Math.round(r.height)} on touch`);
      if (e.tagName === 'SELECT') {
        const c = getComputedStyle(e);
        if (c.appearance !== 'none' || !c.backgroundImage.startsWith('url(') || parseFloat(c.paddingRight) < 24) fail('layout', `${keyOf(e)} caret is not inset`);
      }
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.contains(b) || b.contains(a)) continue;
      const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
      const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (w > 1.5 && h > 1.5) fail('layout', `${keyOf(a)} overlaps ${keyOf(b)} by ${Math.round(w)}x${Math.round(h)}`);
    }
    // Selected rings as drawn, then the focus ring of each control.
    const active = document.activeElement;
    for (const e of all) {
      if (e.disabled) continue;
      const pressed = ringOf(e);
      if (pressed.out && !inside(pressed, clipFor(e))) fail('layout', `${keyOf(e)} selected ring is clipped`);
      e.focus({preventScroll: true, focusVisible: true});
      if (!e.matches(':focus-visible')) continue;
      const ring = ringOf(e);
      if (!inside(ring, clipFor(e))) fail('layout', `${keyOf(e)} focus ring is clipped`);
    }
    active?.focus?.({preventScroll: true});
  }
  function contrast(fail) {
    const seen = new Set();
    for (const e of ins().querySelectorAll('*')) {
      if (!shown(e) || e.closest('svg') && e.tagName !== 'svg') continue;
      const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      const control = e.matches('button,input,select,summary');
      if (!own && !control && e.tagName !== 'svg') continue;
      if (e.closest(':disabled') || e.closest('[aria-disabled=true]')) continue;
      const c = getComputedStyle(e), bg = backdrop(e.tagName === 'svg' ? e.parentElement : e), a = opacity(e);
      if (own) {
        const fg = rgba(c.color); fg[3] *= a;
        const r = ratio(over(fg, bg), bg);
        const key = 'text:' + (e.className || e.tagName) + hex(over(fg, bg)) + hex(bg);
        if (r < 4.5 && !seen.has(key)) { seen.add(key); fail('contrast', `text "${e.textContent.trim().slice(0, 30)}" (${e.className || e.tagName}) ${r.toFixed(2)}:1`); }
      }
      if (e.tagName === 'svg') {
        const fg = rgba(c.stroke !== 'none' ? c.stroke : c.color); fg[3] *= a;
        const r = ratio(over(fg, bg), bg);
        if (r < 3 && !seen.has('icon' + hex(bg))) { seen.add('icon' + hex(bg)); fail('contrast', `icon in ${keyOf(e.closest('button') || e)} ${r.toFixed(2)}:1`); }
      }
      // A swatch or text field needs a visible boundary; text buttons are
      // identified by their label.
      if (e.matches('.style-swatch,input[type=number],input[type=text],input[type=color]')) {
        const parentBg = backdrop(e.parentElement);
        const border = parseFloat(c.borderTopWidth) > 0 ? ratio(over(rgba(c.borderTopColor), parentBg), parentBg) : 0;
        const fill = ratio(backdrop(e), parentBg);
        const swatch = swatchColour(e), body = swatch ? ratio(swatch, parentBg) : 0;
        const before = getComputedStyle(e, '::before');
        const ring = before.content !== 'none' && parseFloat(before.borderTopWidth) > 0 ? ratio(over(rgba(before.borderTopColor), parentBg), parentBg) : 0;
        if (Math.max(border, fill, body, ring) < 3 && !seen.has('ui' + keyOf(e))) { seen.add('ui' + keyOf(e)); fail('contrast', `${keyOf(e)} boundary ${Math.max(border, fill, body, ring).toFixed(2)}:1`); }
      }
      if (e.matches('[aria-pressed=true]')) {
        const parentBg = backdrop(e.parentElement), border = ratio(over(rgba(c.borderTopColor), parentBg), parentBg);
        const shadow = /rgba?\([^)]*\)/g.exec(c.boxShadow === 'none' ? '' : c.boxShadow.split('),').at(-1) + ')');
        const ring = shadow ? ratio(over(rgba(shadow[0]), parentBg), parentBg) : 0;
        if (Math.max(border, ring) < 3 && !e.matches('.style-swatch') && !seen.has('pressed' + keyOf(e))) { seen.add('pressed' + keyOf(e)); fail('contrast', `${keyOf(e)} selected state ${Math.max(border, ring).toFixed(2)}:1`); }
      }
    }
  }
  // A pressed colour swatch shows the colour the canvas draws.
  function swatchesMatch(object, fail) {
    for (const role of ['fill', 'color']) {
      const b = ins().querySelector(`.style-swatches[aria-label="${role === 'fill' ? 'Fill' : object.kind === 'text' ? 'Text' : 'Line & text'}"] .style-swatch[aria-pressed=true][data-colour]`);
      if (!b || b.dataset.colour === 'none') continue;
      const want = drawn(object.id, role), got = swatchColour(b);
      if (want && !close(want, got)) fail('swatch', `${role} swatch ${b.dataset.colour} paints ${got && hex(got)}, canvas draws ${hex(want)}`);
    }
  }

  // Click one control and check the edit, then undo it.
  async function exercise(cell, objectId, key, fail) {
    const e = find(key);
    if (!e || e.disabled) return;
    const before = st().source, object = st().scene.objects.find(o => o.id === objectId);
    // A toggle (Bold, Along the line) turns off when pressed; a choice in a
    // group (swatch, preset, size) is the current value.
    const pressed = e.getAttribute('aria-pressed') === 'true' && !e.matches('.text-style-toggle') && groupOf(e) !== 'Ends';
    const status = $('state').textContent = '';
    const notes = () => [...ins().querySelectorAll('.cl-route-note,.route-style-status')].map(n => n.textContent).join(' ');
    const notesBefore = notes();
    if (e.tagName === 'SELECT') {
      const next = [...e.options].find(o => !o.selected && !o.disabled);
      if (!next) return;
      e.value = next.value; e.dispatchEvent(new Event('change', {bubbles: true}));
    } else if (e.tagName === 'INPUT') {
      e.value = String(Number(e.value || e.placeholder || 0.015) + 0.01);
      e.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    } else e.click();
    if (pressed) {
      // The no-op is synchronous; one frame shows any proposal it started.
      await new Promise(r => requestAnimationFrame(r));
      if (st().source !== before || st().queued || pikchrStudio.preview()) fail('control', `${key}: picking the current value ${pikchrStudio.preview() ? 'started a preview' : 'changed the source'}`);
      if (pikchrStudio.preview()) $('preview-discard').click();
      return undoTo(before, key, fail);
    }
    const settle = () => until(() => { const x = st(); return x.source !== before && x.valid && !x.queued && ins().querySelector('.appearance-editor,.connector-rows,.text-style-group')
      || pikchrStudio.preview() && 'preview'
      || (/not applied|can.t|cannot|unavailable|Use a colour/i.test($('state').textContent) || notes() !== notesBefore && /not available|can.t|cannot/i.test(notes())) && 'refused'; }, 2500);
    let ok = await settle();
    // Route-style chips preview first, like every connector restyle; accept it.
    if (ok === 'preview') { $('preview-accept').click(); ok = await until(() => { const x = st(); return x.source !== before && x.valid && !x.queued && !pikchrStudio.preview(); }, 2500); }
    if (!ok || ok === 'refused') {
      const why = visibleAlerts().join(' | ') || ins().querySelector('.cl-route-note')?.textContent || $('state').textContent;
      fail(/can.t rewrite|Edit it in Source|must be edited/i.test(why) ? 'control' : 'control', `${key}: no edit (${why || 'nothing happened'})`);
      return undoTo(before, key, fail);
    }
    const after = st().source, now = st().scene.objects.find(o => o.id === objectId) || st().object;
    if (JSON.stringify(texts(before)) !== JSON.stringify(texts(after))) fail('minimal', `${key}: strings or comments changed: ${JSON.stringify(after)}`);
    const a = object.span, b = now?.span;
    if (!b || slice(before, 0, a.start) !== slice(after, 0, b.start) || slice(before, a.end) !== slice(after, b.end))
      fail('minimal', `${key}: changed outside the statement: ${JSON.stringify(after)}`);
    else {
      const vocab = vocabulary(key);
      const gone = removed(statementOf(before, object), statementOf(after, now));
      const stray = vocab ? gone.filter(t => !vocab.includes(t) && !valueToken(t)) : [];
      if (stray.length) fail('minimal', `${key}: removed ${stray.join(' ')} from ${JSON.stringify(statementOf(before, object))} -> ${JSON.stringify(statementOf(after, now))}`);
    }
    if (visibleAlerts().length) fail('error', `${key}: error after edit: ${visibleAlerts().join(' | ')}`);
    if (/^(Fill|Line & text|Text)$/.test(groupOf(e)) && now) {
      await painted();
      const role = groupOf(e) === 'Fill' ? 'fill' : 'color';
      const b2 = ins().querySelector(`.style-swatches[aria-label="${groupOf(e)}"] .style-swatch[aria-pressed=true]`);
      if (!b2 || b2.dataset.colour !== e.dataset.colour) fail('control', `${key}: the clicked swatch is not shown as current`);
      else if (b2.dataset.colour !== 'none') {
        const want = drawn(now.id, role), got = swatchColour(b2);
        if (want && !close(want, got)) fail('swatch', `${key} paints ${got && hex(got)}, canvas draws ${hex(want)}`);
      }
    }
    return undoTo(before, key, fail);
  }
  async function undoTo(before, key, fail) {
    if (st().source !== before) {
      $('canvas-undo').click();
      if (!await until(() => st().source === before && st().valid, 2500)) fail('undo', `${key}: undo gave ${JSON.stringify(st().source)}`);
    }
  }

  async function runCell(cell, opts) {
    const failures = [], fail = (category, message) => failures.push({category, message});
    if (!await setSource(cell.source)) { fail('setup', 'source did not render: ' + ($('diagnostic')?.textContent || '')); return failures; }
    const state = st(), object = objectFor(state, cell.key);
    if (!object) { fail('setup', 'no object ' + cell.key); return failures; }
    if (!await select(object.id)) { fail('setup', 'could not open the inspector'); return failures; }
    const before = st().source;
    if (visibleAlerts().length) fail('error', 'error on open: ' + visibleAlerts().join(' | '));
    openStyle();
    await painted();
    if (visibleAlerts().length) fail('error', 'error after opening Style: ' + visibleAlerts().join(' | '));
    if (st().source !== before || st().queued) fail('error', 'opening the inspector changed the source');
    for (const need of cell.expect?.controls || [])
      if (!controls().some(e => new RegExp(need).test(keyOf(e)))) fail('missing', `no control /${need}/ (have ${controls().map(keyOf).join(', ')})`);
    if (cell.expect?.macro) {
      const rows = [...ins().querySelectorAll('.macro-values dt')].map(d => d.textContent);
      for (const need of cell.expect.macro) if (!rows.includes(need)) fail('missing', `macro use has no read-only ${need} row (rows: ${rows.join(', ') || 'none'})`);
      const detach = [...ins().querySelectorAll('button')].filter(b => /^Detach/.test(b.textContent));
      if (!detach.length) fail('missing', 'macro use offers no Detach');
      for (const b of detach) if (b.disabled && !ins().querySelector('.inspector-detach-reason')) fail('disabled', `${b.textContent} is disabled without a shown reason`);
      if (controls().length) fail('control', `macro use shows editable-looking controls: ${controls().map(keyOf).join(', ')}`);
    }
    banners(cell, st().scene.objects.find(o => o.id === object.id), fail);
    disabledReasons(before, fail);
    let t = performance.now();
    if (opts.layout) await layout(opts.touch, fail);
    if (opts.debug) console.log('layout ms', Math.round(performance.now() - t)); t = performance.now();
    if (opts.contrast) { contrast(fail); swatchesMatch(object, fail); }
    if (opts.debug) console.log('contrast ms', Math.round(performance.now() - t)); t = performance.now();
    if (opts.clicks) {
      let keys = controls().map(keyOf);
      if (opts.clicks === 'some') {
        // One unpressed and the pressed control of each group.
        const groups = new Map();
        for (const e of controls()) {
          const g = groupOf(e) || keyOf(e), entry = groups.get(g) || {};
          if (e.getAttribute('aria-pressed') === 'true') entry.on ??= keyOf(e); else if (!e.disabled) entry.off ??= keyOf(e);
          groups.set(g, entry);
        }
        keys = [...groups.values()].flatMap(g => [g.on, g.off].filter(Boolean))
          .filter(key => !cell.focus || cell.focus.some(f => new RegExp(f).test(key)));
      }
      for (const key of [...new Set(keys)]) {
        const t0 = performance.now();
        await exercise(cell, object.id, key, fail);
        if (opts.debug) console.log(cell.name, key, Math.round(performance.now() - t0));
        if (st().object?.id !== object.id || !shown(panel())) await select(object.id);
        openStyle();
      }
    }
    return failures;
  }
  // Uncaught errors are charged to the cell that raised them, with a stack.
  const thrown = []; Error.stackTraceLimit = 40;
  addEventListener('error', e => thrown.push(String(e.error?.stack || e.message).slice(0, 500)));
  addEventListener('unhandledrejection', e => thrown.push(String(e.reason?.stack || e.reason).slice(0, 500)));
  async function extras() {
    const out = [];
    // Render plus undo of a style edit on a 60-object diagram: 650 ms at 31
    // objects before byteOffsetToIndex and moveRefusal stopped scanning the
    // whole document per object.
    {
      const failures = [], source = Array.from({length: 60}, (_, i) => i % 3 ? `B${i}: box "B${i}" at (${i % 10}, ${Math.floor(i / 10)})\n` : `box "é${i}"\n`).join('');
      if (!await setSource(source) || !await select(st().scene.objects.find(o => o.name === 'B1').id)) failures.push({category: 'setup', message: 'large diagram did not open'});
      else {
        openStyle();
        let best = Infinity;
        for (let k = 0; k < 3; k++) {
          const t = performance.now();
          ins().querySelector(`.style-swatch[data-colour="${k % 2 ? 'white' : 'aliceblue'}"]`).click();
          await until(() => st().source !== source && st().valid && ins().querySelector('.style-swatch'));
          $('canvas-undo').click();
          await until(() => st().source === source && st().valid && ins().querySelector('.style-swatch'));
          best = Math.min(best, performance.now() - t);
          openStyle();
        }
        if (!(best < 150)) failures.push({category: 'perf', message: `style edit plus undo on 60 objects took ${best.toFixed(0)} ms (budget 150)`});
      }
      out.push(['render cost, 60 objects', failures]);
    }
    // Typing over an open preview renders the typed source, not the old scene.
    {
      const failures = [], source = 'A: box "A"\nB: box "B" at (2,1)\narrow from A.e to B.w chop\n', next = 'A: box "A"\narrow right 1 <->\n';
      await setSource(source); await select(st().scene.objects.find(o => o.kind === 'arrow').id); openStyle();
      [...ins().querySelectorAll('.chip-row button')].find(b => b.textContent === 'Chop at edges')?.click();
      if (!await until(() => pikchrStudio.preview(), 2000)) failures.push({category: 'setup', message: 'Chop did not preview'});
      thrown.length = 0;
      const s = $('source'); s.value = next; s.dispatchEvent(new Event('input', {bubbles: true})); $('render').click();
      if (!await until(() => st().source === next && st().valid, 3000)) failures.push({category: 'error', message: 'typed source did not render'});
      await sleep(50);
      for (const stack of thrown.splice(0)) failures.push({category: 'error', message: 'uncaught: ' + stack});
      out.push(['typing over a preview', failures]);
    }
    return out;
  }
  window.inspectorMatrix = {
    extras,
    async run(cells, opts) {
      const out = [];
      for (const cell of cells) {
        if (opts.debug) console.log('cell', cell.name);
        let failures;
        try { failures = await runCell(cell, opts); } catch (error) { failures = [{category: 'setup', message: String(error.stack || error).slice(0, 300)}]; }
        await sleep(0);
        for (const stack of thrown.splice(0)) failures.push({category: 'error', message: 'uncaught: ' + stack});
        out.push({name: cell.name, failures});
      }
      return out;
    },
  };
})();
