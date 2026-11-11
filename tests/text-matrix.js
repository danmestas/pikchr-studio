// In-page half of the text-editing matrix (text_matrix.py). One call runs a
// batch of cells on the open page and returns their failures. Each cell loads
// a source, opens the on-canvas label editor the way its entry point does,
// edits the text through the browser's own editing commands and key events,
// commits it, and checks the source, the render, the editor's geometry, the
// text bar, and undo/redo. Nothing here reaches into app internals: it uses
// the DOM, the rendered SVG and pikchrStudio.state().
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
  const slice = (s, a, b) => dec.decode(enc.encode(s).slice(a, b));
  const shown = e => !!e && e.isConnected && e.getClientRects().length > 0 && e.checkVisibility({visibilityProperty: true});
  const editor = () => document.querySelector('textarea.cl-inline-text');
  const bar = () => document.querySelector('.cl-textbar');
  const alertText = () => [...document.querySelectorAll('.cl-inline-error[role=alert]')].filter(shown).map(e => e.textContent).join(' ');
  const stateText = () => $('state')?.textContent || '';

  // ---- Pikchr source reading ---------------------------------------------
  const STRING = /"(?:\\.|[^"\\])*"/g;
  const ATTR = /^\s+(bold|italic|big|small|ljust|rjust|center|above|below|aligned|mono|monospace)\b/;
  const SIZE = /\b(?:width|wid|height|ht|radius|rad|diameter|diam)\s+[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:in|cm|mm|px|pt|%)?|\bfit\b/g;
  const decode = s => s.slice(1, -1).replace(/\\(.)/g, '$1');
  const masked = t => t.replace(STRING, m => ' '.repeat(m.length));
  // The strings of one statement with the attribute words after each.
  function strings(statement) {
    return [...statement.matchAll(STRING)].map(m => {
      const words = []; let at = m.index + m[0].length;
      for (let w; (w = ATTR.exec(statement.slice(at))); at += w[0].length) words.push(w[1]);
      return {text: decode(m[0]), words, start: m.index, end: at};
    });
  }
  // Everything that is not a string, its attribute words or a size clause.
  function skeleton(statement) {
    let out = '', last = 0;
    for (const s of strings(statement)) { out += statement.slice(last, s.start) + ' '; last = s.end; }
    return (out + statement.slice(last)).replace(SIZE, ' ').replace(/\s+/g, ' ').trim();
  }
  const sizes = statement => (skeletonless(statement).match(SIZE) || []).join(' ');
  function skeletonless(statement) { let out = '', last = 0; for (const s of strings(statement)) { out += statement.slice(last, s.start) + ' '; last = s.end; } return out + statement.slice(last); }
  function statementOf(state, object) { return slice(state.source, object.span.start, object.span.end); }

  // ---- setup -------------------------------------------------------------
  async function setSource(text) {
    if (editor()) { editor().dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})); await until(() => !editor(), 1500); }
    if (pikchrStudio.preview()) { $('preview-discard')?.click(); await until(() => !pikchrStudio.preview(), 1500); }
    // Each cell starts with nothing selected, as a fresh visit to a diagram does.
    if (st().selectedIds.length) { $('diagram').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await until(() => !st().selectedIds.length, 500); }
    if (st().source === text && st().valid && !st().queued) return true;
    const s = $('source'); s.value = text; s.dispatchEvent(new Event('input', {bubbles: true}));
    $('render').click();
    return !!await until(() => { const x = st(); return x.source === text && x.valid && !x.queued; }, 4000);
  }
  function objectFor(state, cell) {
    const objects = state.scene.objects;
    if (cell.key.startsWith('index:')) return objects[Number(cell.key.slice(6))];
    if (cell.key === 'macro') return objects.find(o => o.reason === 'Macro-expanded object');
    if (cell.key.startsWith('kind:')) return objects.find(o => o.kind === cell.key.slice(5));
    return objects.find(o => o.name === cell.key);
  }
  async function closePanels() {
    for (const b of document.querySelectorAll('.cl-more .cl-close,[aria-label="Close inspector"]')) if (shown(b)) b.click();
    document.body.classList.remove('inspector-open');
  }
  async function select(object) {
    if (!(st().object?.id === object.id && st().selectedIds.length === 1)) {
      pikchrStudio.select(object.id);
      if (!await until(() => st().object?.id === object.id && st().selectedIds.length === 1, 1500)) return false;
    }
    await frame();
    return true;
  }
  // Where a person would aim at the label: its first drawn string, or the
  // middle of the object when it has none.
  function labelPoint(object) {
    const g = document.querySelector(`#diagram [data-pikchr-id="${object.id}"]`);
    const t = [...(g?.querySelectorAll('text') || [])].map(n => n.getBoundingClientRect()).find(r => r.width > 0);
    if (t) return {x: t.left + t.width / 2, y: t.top + t.height / 2};
    const p = pikchrStudio.modelToScreen(object.center);
    return p && {x: p.x, y: p.y};
  }

  // ---- entry points --------------------------------------------------------
  async function openEditor(cell, object) {
    if (cell.entry === 'dblclick') {
      const p = labelPoint(object);
      const target = document.elementFromPoint(p.x, p.y) || $('diagram');
      target.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, detail: 2}));
    } else if (cell.entry === 'enter') {
      if (!await select(object)) return 'not selected';
      $('diagram').focus({preventScroll: true});
      $('diagram').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}));
    } else if (cell.entry === 'inspector') {
      if (!await select(object)) return 'not selected';
      const more = document.querySelector('.cl-more');
      if (!shown(more)) {
        const b = document.querySelector('.cl-context [aria-label="More options"]');
        if (shown(b)) b.click(); else $('mobile-objects')?.click();
        await until(() => shown(more), 1500);
      }
      if (shown(document.querySelector('.cl-view-objects'))) document.querySelector('.cl-back')?.click();
      const edit = await until(() => [...$('inspector').querySelectorAll('.label-row button')].find(shown), 1500);
      if (!edit) return cell.refuse ? null : 'no Edit label button in the inspector';
      const fit = [...document.querySelectorAll('.canvas-sizing [aria-label="Text fit"] button')].filter(shown);
      cell.shownFit = fit.length ? (fit.find(b => b.getAttribute('aria-pressed') === 'true')?.dataset.value || 'none') : null;
      edit.click();
    } else if (cell.entry === 'preview') {
      // A route preview is open on the connector when the label is double-clicked.
      const arrow = st().scene.objects.find(o => o.kind === 'arrow' && o !== object);
      if (!arrow || !await select(arrow)) return 'no connector to preview';
      const more = document.querySelector('.cl-more');
      if (!shown(more)) { document.querySelector('.cl-context [aria-label="More options"]')?.click() || $('mobile-objects')?.click(); await until(() => shown(more), 1500); }
      const d = $('inspector').querySelector('details.appearance-editor'); if (d && !d.open) d.querySelector(':scope > summary').click();
      [...$('inspector').querySelectorAll('.chip-row button')].find(b => b.textContent === 'Chop at edges')?.click();
      if (!await until(() => pikchrStudio.preview(), 2000)) return 'Chop did not preview';
      const p = labelPoint(object);
      const target = document.elementFromPoint(p.x, p.y) || $('diagram');
      target.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 0, detail: 2}));
    }
    return null;
  }

  // ---- editing -------------------------------------------------------------
  const key = (ta, k, extra = {}) => { const e = new KeyboardEvent('keydown', {key: k, bubbles: true, cancelable: true, ...extra}); ta.dispatchEvent(e); return e; };
  function typeText(ta, text) { ta.focus(); document.execCommand('insertText', false, text); }
  function selectAll(ta) { ta.focus(); ta.setSelectionRange(0, ta.value.length); }
  const normal = t => t.replace(/\r/g, '').replace(/\s+$/, '');

  // Apply one edit; returns {expect, commit} where expect is the label text the
  // source must hold afterwards (null: the source must not change).
  async function edit(cell, ta, failures) {
    const original = ta.value;
    switch (cell.edit) {
      case 'replace': selectAll(ta); typeText(ta, cell.typed); return {expect: cell.typed, commit: 'enter'};
      case 'newline': {
        selectAll(ta); typeText(ta, 'first');
        const e = key(ta, 'Enter', {shiftKey: true});
        if (e.defaultPrevented) failures.push({category: 'lost', message: 'Shift+Enter was swallowed instead of adding a line'});
        typeText(ta, '\n'); typeText(ta, 'second');
        return {expect: 'first\nsecond', commit: 'enter'};
      }
      case 'delete': selectAll(ta); document.execCommand('delete'); return {expect: '', commit: 'enter'};
      case 'paste': selectAll(ta); typeText(ta, 'pasted one\r\npasted two\r\n'); return {expect: 'pasted one\npasted two', commit: 'blur'};
      case 'quotes': selectAll(ta); typeText(ta, 'say "hi" C:\\temp\\'); return {expect: 'say "hi" C:\\temp\\', commit: 'enter'};
      case 'ime': {
        selectAll(ta);
        ta.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}));
        typeText(ta, 'にほん');
        // Enter confirms the candidate; it must not commit the label.
        const e = key(ta, 'Enter', {isComposing: true, keyCode: 229});
        if (!editor()) failures.push({category: 'lost', message: 'Enter during IME composition closed the editor'});
        void e;
        selectAll(ta); typeText(ta, '日本');
        ta.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data: '日本'}));
        return {expect: '日本', commit: 'enter'};
      }
      case 'escape': selectAll(ta); typeText(ta, 'discard me'); return {expect: null, commit: 'escape'};
      case 'nochange': return {expect: null, commit: 'enter'};
      case 'blur': selectAll(ta); typeText(ta, 'blurred text'); return {expect: 'blurred text', commit: 'blur'};
      case 'style': selectAll(ta); typeText(ta, 'styled'); return {expect: 'styled', commit: 'style'};
    }
    void original;
    throw new Error('unknown edit ' + cell.edit);
  }

  // ---- geometry ----------------------------------------------------------------
  const intersects = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const fmt = r => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  function lum(css) {
    const m = /rgba?\(([^)]+)\)/.exec(css); if (!m) return null;
    const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number).slice(0, 3).map(x => x / 255).map(x => x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2];
  }
  function backdrop(e) {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (!/rgba\([^)]*,\s*0\)$|transparent/.test(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  }
  function geometry(object, failures, opts, phase) {
    const ta = editor(); if (!ta) return;
    const r = ta.getBoundingClientRect(), vv = window.visualViewport;
    const view = {left: vv ? vv.offsetLeft : 0, top: vv ? vv.offsetTop : 0, right: (vv ? vv.offsetLeft + vv.width : innerWidth), bottom: (vv ? vv.offsetTop + vv.height : innerHeight)};
    const fail = message => failures.push({category: 'geometry', message: `${phase}: ${message}`});
    if (r.left < view.left - 1 || r.right > view.right + 1 || r.top < view.top - 1 || r.bottom > view.bottom + 1)
      fail(`editor ${fmt(r)} is clipped by the ${Math.round(view.right - view.left)}x${Math.round(view.bottom - view.top)} viewport`);
    // Over the label: the editor covers the middle of the object's label area.
    const p = labelPoint(object), g = document.querySelector(`#diagram [data-pikchr-id="${object.id}"]`);
    const box = g?.getBoundingClientRect();
    const onScreen = p && p.x >= view.left && p.x <= view.right && p.y >= view.top && p.y <= view.bottom;
    if (onScreen && !(p.x >= r.left - 2 && p.x <= r.right + 2 && p.y >= r.top - 24 && p.y <= r.bottom + 24))
      fail(`editor ${fmt(r)} is not over the label at ${Math.round(p.x)},${Math.round(p.y)}${box ? ' (object ' + fmt(box) + ')' : ''}`);
    // Nothing covers it: the topmost element at five points is the editor.
    const inset = 4;
    for (const [x, y] of [[r.left + inset, r.top + inset], [r.right - inset, r.top + inset], [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]]) {
      if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== ta) { fail(`editor is covered at ${Math.round(x)},${Math.round(y)} by ${hit.className?.baseVal ?? hit.className ?? hit.tagName}`); break; }
    }
    // The editor's own controls must never sit on it; anything else must not
    // cover it (the five-point hit test above).
    for (const [name, node] of [['text bar', bar()], ['toolbar', document.querySelector('.cl-context')]]) {
      if (shown(node) && intersects(node.getBoundingClientRect(), r)) fail(`the ${name} ${fmt(node.getBoundingClientRect())} overlaps the editor ${fmt(r)}`);
    }
    // The caret and text are visible against the editor in this theme.
    const cs = getComputedStyle(ta), caret = cs.caretColor === 'auto' ? cs.color : cs.caretColor;
    const a = lum(caret), b = lum(backdrop(ta));
    if (a === null || b === null) fail(`caret colour ${caret} is not visible`);
    else { const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); if (ratio < 3) fail(`caret ${caret} on ${backdrop(ta)} has contrast ${ratio.toFixed(2)} (needs 3)`); }
    if (opts.touch) {
      const tb = bar();
      if (!shown(tb)) fail('the text bar is not shown while editing');
      else {
        const t = tb.getBoundingClientRect();
        if (t.top < view.top - 1 || t.bottom > view.bottom + 1) fail(`the text bar ${fmt(t)} is off screen`);
        for (const btn of tb.querySelectorAll('button')) {
          if (!shown(btn)) continue;
          const q = btn.getBoundingClientRect();
          if (q.width < 43.5 || q.height < 43.5) { fail(`text bar button "${btn.getAttribute('aria-label')}" is ${Math.round(q.width)}x${Math.round(q.height)} (needs 44)`); break; }
        }
      }
    }
  }
  // The editor follows the label when the canvas pans and zooms under it.
  async function followsView(object, failures) {
    const before = editor()?.getBoundingClientRect(); if (!before) return;
    const d = $('diagram'), r = d.getBoundingClientRect();
    const at = {clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true};
    d.dispatchEvent(new WheelEvent('wheel', {...at, deltaX: 40, deltaY: 30}));
    await frame(); await frame();
    geometry(object, failures, {}, 'after a pan');
    d.dispatchEvent(new WheelEvent('wheel', {...at, deltaY: -60, ctrlKey: true}));
    await frame(); await frame();
    geometry(object, failures, {}, 'after a zoom');
  }

  // ---- text bar ------------------------------------------------------------------
  function barMatches(statement, object, failures) {
    const tb = bar();
    if (!shown(tb)) { failures.push({category: 'textbar', message: 'no text bar while editing'}); return; }
    const first = strings(statement)[0], words = first ? first.words : [];
    const pressed = label => tb.querySelector(`button[aria-label="${label}"]`)?.getAttribute('aria-pressed');
    const want = {Bold: words.includes('bold'), Italic: words.includes('italic'), Monospace: words.includes('mono') || words.includes('monospace')};
    for (const [label, on] of Object.entries(want)) {
      const p = pressed(label);
      if (p !== null && p !== undefined && p !== String(on)) failures.push({category: 'textbar', message: `${label} shows aria-pressed=${p}, but the label is ${on ? '' : 'not '}${label.toLowerCase()}`});
    }
    if (!['arrow', 'line', 'spline'].includes(object.kind)) {
      const bigs = words.filter(w => w === 'big').length, size = words.includes('small') ? 'small' : bigs > 1 ? 'extra large' : bigs ? 'big' : 'normal';
      const p = pressed('Text size ' + size);
      if (p !== 'true') failures.push({category: 'textbar', message: `Text size ${size} is not shown pressed`});
    }
  }

  let moved = false;
  const SHAPES = ['box', 'circle', 'ellipse', 'oval', 'cylinder', 'diamond', 'file'];
  // ---- one cell --------------------------------------------------------------------
  async function runCell(cell, opts) {
    const failures = [];
    const fail = (category, message) => failures.push({category, message});
    if (!await setSource(cell.source)) { fail('setup', 'source did not render: ' + (stateText() || '')); return failures; }
    const before = st(), object = objectFor(before, cell);
    if (!object) { fail('setup', 'object not found'); return failures; }
    // Every cell starts from the fitted view (the pan and zoom checks move it).
    // Only a view this harness panned or zoomed is fitted again; a new
    // source must arrive fitted on its own (fit-browser.py checks that too).
    if (moved) { $('fit-view')?.click(); moved = false; await frame(); }
    await until(() => st().valid && !$('diagram').classList.contains('stale'), 1500);
    await frame();
    const beforeStatement = object.span?.start >= 0 ? statementOf(before, object) : null;
    // The Text fit this label's edits must follow: Grow when the statement
    // fits, else boxes wrap and the other shapes grow; text and connectors are
    // as written. No cell saves a preference, so this is the shown default.
    const fitMode = !SHAPES.includes(object.kind) ? 'fixed' : /\bfit\b/.test(skeletonless(beforeStatement || '')) ? 'grow' : object.kind === 'box' ? 'wrap' : 'grow';
    const problem = await openEditor(cell, object);
    if (problem) { fail('setup', problem); return failures; }
    const ta = await until(editor, 1500);
    if (cell.refuse) {
      // Opening must refuse with a specific reason and change nothing.
      await sleep(50);
      const said = (ta ? alertText() : '') + ' ' + stateText() + ' ' + [...document.querySelectorAll('[role=alert]')].filter(shown).map(e => e.textContent).join(' ')
        + (cell.entry === 'inspector' ? ' ' + $('inspector').textContent : '');
      if (ta && !alertText()) fail('refusal', 'the editor opened on an object whose text cannot be edited here');
      if (!new RegExp(cell.refuse, 'i').test(said)) fail('refusal', `no reason matching /${cell.refuse}/ was shown (status: "${stateText().slice(0, 120)}")`);
      if (st().source !== before.source) fail('diff', 'a refused edit changed the source');
      if (ta) key(ta, 'Escape');
      return failures;
    }
    if (!ta) {
      const p = labelPoint(object), hit = p && document.elementFromPoint(p.x, p.y);
      fail('open', `the ${cell.entry} entry did not open the editor (status: "${stateText().slice(0, 140)}"; label at ${p && Math.round(p.x) + ',' + Math.round(p.y)} zoom ${$('zoom-level')?.textContent} viewBox ${document.querySelector('#diagram svg')?.getAttribute('viewBox')}; under ${hit ? hit.tagName + '.' + String(hit.className?.baseVal ?? hit.className) + ' in ' + (hit.closest('[data-pikchr-id]')?.getAttribute('data-pikchr-id') || hit.parentElement?.getAttribute('class')) + ' (object ' + object.id + ')' : 'nothing'})`);
      return failures;
    }
    if (cell.shownFit !== undefined && cell.shownFit !== null && cell.shownFit !== fitMode) fail('sizing', `the inspector's Text fit shows ${cell.shownFit}, but label edits follow ${fitMode}`);
    const startText = strings(beforeStatement).map(s => s.text).join('\n');
    if (ta.value !== startText) fail('open', `editor opened with ${JSON.stringify(ta.value)}, label is ${JSON.stringify(startText)}`);
    await frame();
    geometry(object, failures, opts, 'on open');
    barMatches(beforeStatement, object, failures);
    if (opts.view && cell.view) { moved = true; await followsView(object, failures); }
    const plan = await edit(cell, ta, failures);
    if (!editor()) { fail('lost', 'the editor closed while typing'); return failures; }
    const typedValue = editor().value;
    // Typing back what was there is a no-change commit.
    if (plan.expect !== null && plan.expect === startText && !['style'].includes(plan.commit)) plan.expect = null;
    // Commit.
    let styled = false;
    if (plan.commit === 'enter') { const e = key(editor(), 'Enter'); if (!e.defaultPrevented) fail('commit', 'Enter was not handled'); }
    else if (plan.commit === 'escape') key(editor(), 'Escape');
    else if (plan.commit === 'blur') editor().blur();
    else if (plan.commit === 'style') {
      const b = bar()?.querySelector('button[aria-label="Bold"]');
      if (!b || !shown(b)) { fail('textbar', 'no Bold button while editing'); key(editor(), 'Enter'); }
      else {
        const down = new MouseEvent('mousedown', {bubbles: true, cancelable: true});
        b.dispatchEvent(down);
        if (!down.defaultPrevented) fail('textbar', 'pressing the text bar would take focus from the editor');
        b.click(); styled = true;
      }
    }
    // Wait for the commit to settle.
    const settled = await until(() => {
      const x = st();
      if (!x.valid || x.queued) return false;
      if (plan.expect === null) return !editor() || alertText();
      if (styled) return x.source !== before.source && editor() && editor().value === normal(typedValue);
      return x.source !== before.source && !editor() || alertText();
    }, 4000);
    await sleep(30);
    const after = st(), committedStatus = stateText();
    if (!settled) {
      if (editor()) fail('lost', `the commit did not land; editor still open with ${JSON.stringify(editor().value)}; alert "${alertText()}"; status "${stateText().slice(0, 140)}"`);
      else if (plan.expect !== null) fail('lost', `the typed text was discarded: source unchanged, editor closed; status "${stateText().slice(0, 160)}"`);
      else fail('commit', 'did not settle');
      if (editor()) key(editor(), 'Escape');
      return failures;
    }
    if (alertText() && plan.expect !== null) {
      // A refusal must keep the typed text.
      if (editor()?.value !== typedValue) fail('lost', 'a refusal changed the typed text');
      if (!cell.mayRefuse) fail('refused', `refused ${JSON.stringify(plan.expect)}: ${alertText()}`);
      key(editor(), 'Escape');
      if (st().source !== before.source) fail('diff', 'a refusal changed the source');
      return failures;
    }
    if (plan.expect === null) {
      if (after.source !== before.source) fail('diff', `${cell.edit} wrote to the source: ${JSON.stringify(after.source.slice(0, 200))}`);
      if (editor()) fail('commit', 'the editor stayed open');
      return failures;
    }
    // (a) the text landed, escaped, and renders.
    // No edit adds or removes objects, so the object keeps its index.
    const index = before.scene.objects.indexOf(object), newObject = after.scene.objects[index];
    const newStatement = newObject?.span ? statementOf(after, newObject) : '';
    const oldStatement = beforeStatement;
    // A label that changes the shape's size may rewrite its own placement and
    // pin its neighbours (as a drag does); comments stay byte-identical and
    // nothing else may change. Otherwise only this statement changes.
    const resized = !!newObject?.bbox && (Math.abs(newObject.bbox.width - object.bbox.width) > 1e-6 || Math.abs(newObject.bbox.height - object.bbox.height) > 1e-6);
    const comments = t => t.match(/#[^\n]*|\/\*[\s\S]*?\*\//g)?.join('|') || '';
    if (!resized) {
      const head = before.source.length - slice(before.source, object.span.start, 1e9).length, tail = slice(before.source, object.span.end, 1e9).length;
      if (after.source.slice(0, head) !== before.source.slice(0, head) || after.source.slice(after.source.length - tail) !== before.source.slice(before.source.length - tail))
        fail('diff', 'text outside the edited statement changed');
    } else if (comments(masked(after.source)) !== comments(masked(before.source))) fail('diff', 'a resize changed a comment');
    const landed = strings(newStatement).map(s => s.text).join('\n');
    const fellBack = /kept its size/.test(committedStatus);
    const effective = fellBack ? 'fixed' : fitMode;
    // Wrap breaks lines at spaces (dropped) or between characters; the
    // typed text and its own line breaks survive.
    const wrapped = effective === 'wrap' && landed.replace(/\s/g, '') === plan.expect.replace(/\s/g, '')
      && plan.expect.split('\n').length <= landed.split('\n').length;
    if (landed !== plan.expect && !wrapped) fail('lost', `source holds ${JSON.stringify(landed)}, typed ${JSON.stringify(plan.expect)}: ${newStatement}`);
    const drawn = [...(document.querySelectorAll(`#diagram [data-pikchr-id="${newObject?.id}"] text`) || [])].map(t => t.textContent.replace(/\u00a0/g, ' '));
    const wantLines = plan.expect.split('\n').filter(l => l.trim());
    if ((wrapped ? landed : wantLines.join('\n')).split('\n').filter(l => l.trim()).join('\n') !== drawn.filter(l => l.trim()).join('\n')) fail('render', `render shows ${JSON.stringify(drawn)}, expected ${JSON.stringify(wantLines)}`);
    // (b) only text and size clauses change; untouched strings keep their style.
    const own = (state, o, text) => { const p = o.spans?.placement; return p && p.end > p.start ? text.replace(slice(state.source, p.start, p.end), ' ') : text; };
    if (skeleton(resized ? own(after, newObject, newStatement) : newStatement) !== skeleton(resized ? own(before, object, oldStatement) : oldStatement)) fail('diff', `statement structure changed: ${JSON.stringify(oldStatement)} -> ${JSON.stringify(newStatement)}`);
    const was = strings(oldStatement), now = strings(newStatement);
    // A style click toggles bold on every string (the text bar styles the
    // whole label); otherwise each string keeps exactly its own words.
    const bolded = !(was[0]?.words.includes('bold'));
    if (styled && now.some(n => n.words.includes('bold') !== bolded)) fail('diff', `Bold click did not ${bolded ? 'add' : 'remove'} bold: ${newStatement}`);
    for (let i = 0; i < Math.min(was.length, now.length) && !styled; i++) {
      const want = [...was[i].words].sort();
      if (want.join(' ') !== [...now[i].words].sort().join(' ')) { fail('diff', `string ${i + 1} style ${JSON.stringify(was[i].words)} became ${JSON.stringify(now[i].words)}: ${newStatement}`); break; }
    }
    // (c) sizing follows the Text fit mode; the anchor stays.
    if (newObject && SHAPES.includes(object.kind)) {
      // Every placement form keeps its Text fit: no fallback to Fixed.
      if (fellBack) fail('sizing', `Text fit ${fitMode} fell back to Fixed (${cell.placement}): ${committedStatus}`);
      const mode = effective;
      // The named default: a box wraps (several lines, same width, explicit
      // height), an oval grows (fit), never falling back.
      if (cell.expectFit && fitMode !== cell.expectFit) fail('sizing', `default Text fit for a ${object.kind} is ${fitMode}, expected ${cell.expectFit}`);
      if (cell.expectFit === 'wrap' && !(landed.split('\n').length > 1 && /\b(?:height|ht)\b/.test(skeletonless(newStatement)) && newObject.bbox.height > object.bbox.height))
        fail('sizing', 'a default box did not wrap its long label: ' + newStatement);
      if (cell.expectFit === 'grow' && !(/\bfit\b/.test(skeletonless(newStatement)) && newObject.bbox.width > object.bbox.width))
        fail('sizing', `a default ${object.kind} did not grow to its label: ` + newStatement);
      if (mode === 'wrap' && Math.abs(newObject.bbox.width - object.bbox.width) > 1e-6) fail('sizing', `Text fit is Wrap but the width changed from ${object.bbox.width.toFixed(3)} to ${newObject.bbox.width.toFixed(3)}`);
      if (mode === 'wrap' && plan.expect.trim() && !/\b(?:width|wid)\b/.test(skeletonless(newStatement)) && !/\bfit\b/.test(skeletonless(newStatement))) fail('sizing', 'Text fit is Wrap but no width is kept: ' + newStatement);
      if (mode === 'fixed' && sizes(newStatement) !== sizes(oldStatement)) fail('sizing', `Text fit is Fixed but the size clauses changed: "${sizes(oldStatement)}" -> "${sizes(newStatement)}"`);
      if (mode === 'fixed' && (Math.abs(newObject.bbox.width - object.bbox.width) > 1e-6 || Math.abs(newObject.bbox.height - object.bbox.height) > 1e-6))
        fail('sizing', `Text fit is Fixed but the size changed from ${object.bbox.width.toFixed(3)}x${object.bbox.height.toFixed(3)} to ${newObject.bbox.width.toFixed(3)}x${newObject.bbox.height.toFixed(3)}`);
      if (mode === 'grow' && plan.expect.trim() && !/\bfit\b/.test(skeletonless(newStatement))) fail('sizing', 'Text fit is Grow but the statement no longer fits: ' + newStatement);
    }
    if (newObject) {
      // The shape keeps its centre; no other shape moves; the connectors on
      // either side of it stay attached.
      const near = (a, b, tol = 1e-3) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
      const at = p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      if (!near(object.center, newObject.center)) fail('sizing', `the centre moved from ${at(object.center)} to ${at(newObject.center)}: ${newStatement}`);
      const lines = ['arrow', 'line', 'spline', 'arc', 'move'];
      for (const [i, o] of before.scene.objects.entries()) {
        const n = after.scene.objects[i];
        if (i === index || lines.includes(o.kind) || !o.center || !n?.center) continue;
        if (!near(o.center, n.center)) { fail('sizing', `${o.name || o.kind + ' ' + i} moved from ${at(o.center)} to ${at(n.center)}`); break; }
      }
      if (!lines.includes(object.kind)) {
        const next = after.scene.objects.find((o, i) => i > index && lines.includes(o.kind)), was = before.scene.objects[after.scene.objects.indexOf(next)];
        if (next && was && near(was.path?.[0] || {x: NaN, y: NaN}, object.anchors.e) && !near(next.path[0], newObject.anchors.e)) fail('sizing', `the connector after it starts at ${at(next.path[0])}, not its east edge ${at(newObject.anchors.e)}`);
        const prior = before.scene.objects[index - 1], prev = after.scene.objects[index - 1];
        const gap = (o, p) => Math.hypot(o.anchors.w.x - p.x, o.anchors.w.y - p.y);
        if (prior && lines.includes(prior.kind) && prior.path?.length && gap(object, prior.path.at(-1)) < 0.1 && Math.abs(gap(newObject, prev.path.at(-1)) - gap(object, prior.path.at(-1))) > 1e-3)
          fail('sizing', `the connector before it no longer ends at its west edge: ${at(prev.path.at(-1))} vs ${at(newObject.anchors.w)}`);
      }
    }
    if (styled) {
      // The editor reopened with the typed text; Enter writes nothing more.
      if (!editor()) fail('textbar', 'the editor did not reopen after a style click');
      else {
        barMatches(newStatement, newObject, failures);
        const mid = st().source;
        key(editor(), 'Enter');
        await until(() => !editor(), 1500);
        if (st().source !== mid) fail('diff', 'Enter after a style click changed the source again');
      }
    }
    // (f) undo and redo restore exactly.
    const committed = st().source;
    $('canvas-undo').click();
    if (!await until(() => st().source === before.source && st().valid, 3000)) fail('undo', `undo did not restore the source: ${JSON.stringify(st().source.slice(0, 160))}`);
    else {
      $('canvas-redo').click();
      if (!await until(() => st().source === committed && st().valid, 3000)) fail('undo', 'redo did not restore the committed source');
    }
    return failures;
  }

  window.textMatrix = {
    async run(cells, opts) {
      const out = [];
      for (const cell of cells) {
        let failures;
        try { failures = await runCell(cell, opts); } catch (error) { failures = [{category: 'setup', message: String(error.stack || error).slice(0, 300)}]; }
        if (editor()) { editor().dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})); await until(() => !editor(), 1000); }
        await closePanels();
        out.push({name: cell.name, failures});
      }
      if (moved) { $('fit-view')?.click(); moved = false; await frame(); }
      return out;
    },
    strings, skeleton,
  };
})();
