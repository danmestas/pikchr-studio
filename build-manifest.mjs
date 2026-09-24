// Writes vendor/MANIFEST.json describing the toolchain and inputs behind the
// checked-in public/pikchr.wasm, so a reader can tell which source and
// compiler produced it without rebuilding.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const run = (cmd, cwd = root) => {
  try { return execSync(cmd, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
  catch { return 'unknown'; }
};
const emcc = run('emcc --version').split('\n')[0] || 'unknown';
const fossilInfo = run('fossil info', join(root, '..', 'home'));
const checkin = (fossilInfo.match(/^checkout:\s+([0-9a-f]+)/m) || [])[1] || 'unknown';

const manifest = {
  built: new Date().toISOString(),
  emcc,
  node: process.version,
  upstreamFossilCheckin: checkin,
  inputs: {
    'vendor/studio.patch': sha256(join(root, 'vendor', 'studio.patch')),
  },
  outputs: {
    'public/pikchr.wasm': sha256(join(root, 'public', 'pikchr.wasm')),
    'public/pikchr.js': sha256(join(root, 'public', 'pikchr.js')),
  },
};
writeFileSync(join(root, 'vendor', 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote vendor/MANIFEST.json');
