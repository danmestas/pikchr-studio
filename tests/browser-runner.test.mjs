import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

const harness = `
import contextlib, importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location('runner', 'tests/run-browser.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.port_free = lambda: False
runner.serves_this_studio = lambda: True
runner.wait_for_server = lambda: True
attempts = iter(json.loads(sys.argv[1]))
runner.run_script = lambda path: next(attempts)
output = io.StringIO()
with contextlib.redirect_stdout(output):
    code = runner.main(['workflow'])
print(json.dumps({'code': code, 'output': output.getvalue()}))
`;
const run = attempts => JSON.parse(execFileSync('python3', ['-c', harness, JSON.stringify(attempts)], {
  cwd: new URL('..', import.meta.url), encoding: 'utf8',
  env: {...process.env, PIKCHR_STUDIO_TAIL: '2'},
}));

test('browser retry preserves the original failure when the retry passes', () => {
  const {code, output} = run([[1, 'first stdout', 'original traceback'], [0, 'recovered', '']]);
  assert.equal(code, 0);
  assert.match(output, /FLAKY workflow-browser.py/);
  assert.match(output, /Attempt 1 failed/);
  assert.match(output, /first stdout/);
  assert.match(output, /original traceback/);
  assert.match(output, /0 pass, 1 flaky, 0 fail/);
});

test('browser retry preserves both failures and fails the run', () => {
  const {code, output} = run([[1, '', 'original traceback'], [2, '', 'retry traceback']]);
  assert.equal(code, 1);
  assert.match(output, /Attempt 1 failed/);
  assert.match(output, /original traceback/);
  assert.match(output, /Attempt 2 failed/);
  assert.match(output, /retry traceback/);
  assert.match(output, /0 pass, 0 flaky, 1 fail/);
});

test('browser failure diagnostics honor the per-attempt tail limit', () => {
  const {output} = run([[1, 'discarded\nkeep one\nkeep two', ''], [0, '', '']]);
  assert.doesNotMatch(output, /discarded/);
  assert.match(output, /keep one/);
  assert.match(output, /keep two/);
});

test('clean browser passes neither retry nor print failure diagnostics', () => {
  const {code, output} = run([[0, 'passed', '']]);
  assert.equal(code, 0);
  assert.match(output, /1 pass, 0 flaky, 0 fail/);
  assert.doesNotMatch(output, /Attempt .* failed/);
});
