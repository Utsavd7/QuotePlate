import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifiedShots, loadCheckpoint, writeCheckpoint } from './capture_checkpoint.mjs';
const slots = { main: 2, later: 3 };
const inspect = async name => ({ width: 3840, height: 2400, frames: slots[name] * 30, sha256: 'a'.repeat(64) });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quoteplate-checkpoint-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'progress.json');
}
test('only a successfully verified export batch can replace a checkpoint', async t => {
  const file = await fixture(t);
  const records = await verifiedShots(['main'], slots, inspect);
  await writeCheckpoint(file, 'main exported', records);
  const before = await fs.readFile(file, 'utf8');
  await assert.rejects(async () => {
    const batch = await verifiedShots(['main', 'later'], slots, async name => {
      if (name === 'later') throw Error('MP4 export failed');
      return inspect(name);
    });
    await writeCheckpoint(file, 'later exported', batch);
  }, /export failed/);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  assert.deepEqual(Object.keys(await loadCheckpoint(file, slots, ['main'], inspect)), ['main']);
});
test('missing, truncated and changed files cannot be resumed', async t => {
  const file = await fixture(t);
  await writeCheckpoint(file, 'done', await verifiedShots(['main'], slots, inspect));
  await assert.rejects(loadCheckpoint(file, slots, ['main'], async () => { throw Error('ENOENT'); }), /ENOENT/);
  await assert.rejects(loadCheckpoint(file, slots, ['main'], async name => ({ ...await inspect(name), frames: 1 })), /frame count/);
  await assert.rejects(loadCheckpoint(file, slots, ['main'], async name => ({ ...await inspect(name), sha256: 'b'.repeat(64) })), /hash missing or changed/);
});
test('unsupported partial main journey fails before browser setup', async t => {
  const file = await fixture(t);
  await writeCheckpoint(file, 'later only', await verifiedShots(['later'], slots, inspect));
  await assert.rejects(loadCheckpoint(file, slots, ['main'], inspect), /Partial main-journey resume is unsupported/);
});
test('legacy name-only checkpoint cannot claim completion', async t => {
  const file = await fixture(t);
  await fs.writeFile(file, JSON.stringify({ completed: ['main'] }));
  await assert.rejects(loadCheckpoint(file, slots, ['main'], inspect), /hash missing or changed/);
});
