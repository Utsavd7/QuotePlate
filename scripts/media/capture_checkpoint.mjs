/** Only exported, verified MP4s can enter a resumable capture checkpoint. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';

export async function verifiedShots(names, slots, inspect) {
  const records = {};
  for (const name of names) {
    assert(slots[name], 'Unknown capture: ' + name);
    const file = await inspect(name);
    assert.equal(file.width, 3840, name + ' width');
    assert.equal(file.height, 2400, name + ' height');
    assert.equal(file.frames, slots[name] * 30, name + ' frame count');
    assert.match(file.sha256, /^[a-f0-9]{64}$/, name + ' digest');
    records[name] = { duration: slots[name], completed: true, sha256: file.sha256 };
  }
  return records;
}

export async function loadCheckpoint(file, slots, required, inspect) {
  const progress = JSON.parse(await fs.readFile(file, 'utf8'));
  assert(Array.isArray(progress.completed), 'Invalid checkpoint');
  const names = [...new Set(progress.completed)];
  if (names.length && required.some(name => !names.includes(name))) {
    throw Error('Partial main-journey resume is unsupported. Use a new QUOTEPLATE_FILM_WORK directory and capture without --resume-completed; existing footage is preserved.');
  }
  if (names.includes('supplier-confirmation') && !names.includes('workspace-sharing')) {
    throw Error('Supplier confirmation requires the workspace-sharing clip. Use a new QUOTEPLATE_FILM_WORK directory for a full capture.');
  }
  const records = await verifiedShots(names, slots, inspect);
  for (const name of names) {
    assert.equal(progress.preservedSha256?.[name], records[name].sha256,
      name + ' checkpoint hash missing or changed; use a new QUOTEPLATE_FILM_WORK directory for full capture');
  }
  return records;
}

export async function writeCheckpoint(file, stage, records, complete = false) {
  const value = { stage, completed: Object.keys(records), complete,
    preservedSha256: Object.fromEntries(Object.entries(records).map(([name, record]) => [name, record.sha256])) };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  await fs.rename(file + '.tmp', file);
}
