import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Gitflow teaching example compiles as real Pikchr with readable workflow labels',()=>{
  const source=readFileSync(new URL('../public/examples/gitflow.pikchr',import.meta.url),'utf8');
  const result=spawnSync(fileURLToPath(new URL('../vendor/pikchr',import.meta.url)),['--svg-only','-'],{input:source,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout);
  assert.match(result.stdout,/<svg\b/);
  for(const lane of ['feature','develop','release','hotfix','main'])assert.match(result.stdout,new RegExp(lane,'i'));
  assert.ok((result.stdout.match(/<text\b/g)||[]).length>=15,'diagram must retain its annotations when exported without the guide');
  assert.ok((source.match(/\bcircle\b/g)||[]).length>=16,'show a lifecycle, not just branch names');
  for(const edge of [
    'FeatureMergeArrow: arrow from SearchWork.se to FeatureMerge.nw',
    'ReleaseToMain: arrow from ReleaseReady.se to ReleaseMain.nw',
    'ReleaseToDevelop: arrow from ReleaseReady.sw to ReleaseBack.ne',
    'HotfixToMain: arrow from HotfixFix.se to HotfixMain.nw',
    'HotfixToDevelop: arrow from HotfixFix.sw to HotfixBack.ne',
    'FutureToDevelop: arrow from FutureFinish.se to FutureMerge.nw',
    'NextReleaseToMain: arrow from NextRelease.se to NextMain.nw',
    'NextReleaseToDevelop: arrow from NextRelease.sw to NextBack.ne'
  ])assert.ok(source.includes(edge),'Missing workflow edge: '+edge);
});
