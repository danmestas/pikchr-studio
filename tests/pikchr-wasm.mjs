// Compiles Pikchr through the committed WebAssembly bundle, so the tests need
// neither Pikchr's C sources nor a native build. Mirrors the two native CLI
// modes the tests used: `pikchr --svg-only -` and `pikchr --studio -`.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const publicDir = path.resolve(import.meta.dirname, '../public');
const context = vm.createContext({require:createRequire(import.meta.url), process, console, __dirname:publicDir,
  __filename:path.join(publicDir, 'pikchr.js'), URL, TextDecoder, TextEncoder, setTimeout});
vm.runInContext(fs.readFileSync(path.join(publicDir, 'pikchr.js'), 'utf8'), context);
const wasm = await context.initPikchrModule({locateFile:p => path.join(publicDir, p)});
const legacy = wasm.cwrap('pikchr', 'number', ['string', 'string', 'number', 'number', 'number']);
const studioApi = wasm.cwrap('pikchr_studio', 'number', ['string', 'string', 'number']);
const PLAINTEXT_ERRORS = 1;

function take(pointer) {
  try { return wasm.UTF8ToString(pointer); } finally { wasm._free(pointer); }
}

// Like `pikchr --svg-only -`: {status, stdout, stderr}; status 1 on a render error.
export function compileSvg(source) {
  const width = wasm._malloc(8);
  try {
    const out = take(legacy(source, null, PLAINTEXT_ERRORS, width, width + 4));
    const w = new DataView(wasm.HEAPU8.buffer).getInt32(width, true);
    return {status: w < 0 ? 1 : 0, stdout: out, stderr: ''};
  } finally { wasm._free(width); }
}

// Like `pikchr --studio -`: the scene JSON text, plus a parsed copy.
export function compileStudio(source) {
  const stdout = take(studioApi(source, null, PLAINTEXT_ERRORS));
  const scene = JSON.parse(stdout);
  return {status: scene.error ? 1 : 0, stdout, stderr: '', scene};
}
