// The Style swatches stay readable in both themes: every ink reaches WCAG AA
// (4.5:1) on both canvases and on every fill, measured on what Pikchr renders
// in light (flags 1) and dark (flags 3) mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSvg} from './pikchr-wasm.mjs';
import {FILLS, INKS} from '../public/property-ui.js';

const CANVAS = {1: '#ffffff', 3: '#161b22'};
const MIN = 4.5;
const hexOf = rgb => '#' + rgb.map(n => Number(n).toString(16).padStart(2, '0')).join('');
function colours(svg) {
  const style = svg.match(/<path[^>]*style="([^"]*)"/)[1];
  const read = attr => { const m = style.match(new RegExp(attr + ':rgb\\((\\d+),(\\d+),(\\d+)\\)')); return m && hexOf(m.slice(1)); };
  return {fill: read('fill'), stroke: read('stroke')};
}
const lum = h => {
  const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('palette lists are non-empty and start with the defaults', () => {
  assert.equal(FILLS[0], 'none');
  assert.equal(INKS[0], 'black');
});

for (const [mode, flags] of [['light', 1], ['dark', 3]]) {
  test(`every ink reads on the ${mode} canvas and on every fill`, () => {
    const failures = [];
    for (const ink of INKS) {
      const inkColour = colours(renderSvg(`box "Ab" color ${ink}`, flags)).stroke;
      const onCanvas = contrast(inkColour, CANVAS[flags]);
      if (onCanvas < MIN) failures.push(`${ink} on canvas ${onCanvas.toFixed(2)}`);
      for (const fill of FILLS.filter(f => f !== 'none')) {
        const {fill: fillColour, stroke} = colours(renderSvg(`box "Ab" fill ${fill} color ${ink}`, flags));
        const ratio = contrast(stroke, fillColour);
        if (ratio < MIN) failures.push(`${ink} on ${fill} ${ratio.toFixed(2)}`);
      }
    }
    assert.deepEqual(failures, []);
  });
}
