/** Browser-free preparation. Never consumes an approval from an earlier film. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const prior = '/tmp/quoteplate-gap-film';
export const bundle = ['quoteplate-product-film.mp4', 'quoteplate-product-film.jpg',
  'quoteplate-product-film.vtt', 'quoteplate-product-film.txt', 'credits.txt'];
export const pickups = ['supplier-contacts.mp4', 'shopping-source.mp4', 'shopping-review.mp4',
  'invoice-source.mp4', 'invoice-review.mp4', 'vendor-phone.mp4'];
export const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });

export async function sourceHashes() {
  const result = {};
  async function walk(dir) {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) result[path.relative(root, file)] = await hash(file);
    }
  }
  await walk(path.join(root, 'src'));
  return result;
}

export async function checkBarrier(work, origin) {
  const url = new URL(origin);
  assert.equal(url.origin, origin, 'Supply a bare harness origin without credentials, path or query');
  assert.equal(url.protocol, 'http:');
  assert(['127.0.0.1', 'localhost'].includes(url.hostname), 'Local harness only');
  const plan = await read(path.join(work, 'pickup-plan.json'));
  const approval = await read(path.join(work, 'workflow-parent-ui-validation.json'));
  assert.equal(approval.status, 'local final UI validated');
  assert.equal(approval.origin, origin);
  assert.equal(approval.pickupPlanSha256, await hash(path.join(work, 'pickup-plan.json')));
  assert(approval.parentMessage?.includes('local final UI validated'));
  assert(approval.parentMessage?.includes(origin));
  assert.equal(approval.isolatedFictionalTenant, true, 'Parent must identify the isolated local capture harness');
  assert(Date.parse(approval.receivedAt) >= Date.parse(plan.preparedAt), 'Earlier film approval is insufficient');
  assert.equal(approval.uiSourceManifestSha256, await hash(path.join(work, 'ui-source-hashes.json')));
  assert.deepEqual(await sourceHashes(), await read(path.join(work, 'ui-source-hashes.json')),
    'UI changed after snapshot; prepare a fresh directory against the validated tree');
  await verifyBaseline(work);
  return approval;
}

export async function verifyBaseline(work) {
  const baseline = await read(path.join(work, 'baseline-manifest.json'));
  for (const [file, expected] of Object.entries(baseline.files)) {
    assert.equal(await hash(file), expected, 'Preserved source or public asset changed: ' + file);
  }
  return baseline;
}

export async function prepare(work) {
  const resolved = path.resolve(work);
  assert(resolved.startsWith('/tmp/') || resolved.startsWith('/private/tmp/'), 'Use a new temporary directory');
  assert(!resolved.startsWith(prior + '/') && resolved !== prior, 'Keep the old film directory untouched');
  // Exclusive directory creation: never overwrite a preparation or a prior capture.
  await fs.mkdir(resolved);
  const verification = await read(path.join(prior, 'verification.json'));
  const story = await read(path.join(prior, 'storyboard.json'));
  const evidence = await read(path.join(prior, 'capture-evidence.json'));
  assert.equal(verification.releaseStatus, 'passed');
  assert.equal(story.durationSeconds, 165);
  assert.equal(story.scenes.reduce((n, scene) => n + scene.duration, 0), 165);
  assert.equal(story.resolution, '3840x2400');
  assert.equal(story.fps, 30);
  const files = {};
  async function preserve(file, expected) {
    const actual = await hash(file);
    if (expected) assert.equal(actual, expected, 'Baseline mismatch: ' + file);
    files[file] = actual;
  }
  for (const name of bundle) {
    await preserve(path.join(prior, name), verification.bundleSha256[name]);
    await preserve(path.join(root, 'public/media', name), verification.bundleSha256[name]);
  }
  for (const [name, expected] of Object.entries(verification.freshCaptures)) await preserve(path.join(prior, 'captures', name), expected);
  for (const [name, expected] of Object.entries(verification.narrationSha256)) await preserve(path.join(prior, 'audio', name + '.wav'), expected);
  for (const record of Object.values(evidence.motion)) {
    if (!files[record.raw]) await preserve(record.raw, record.rawSha256);
  }
  for (const name of ['storyboard.json', 'capture-evidence.json', 'verification.json', 'visual-review.json', 'audio/timing.json', 'ui-source-hashes.json']) {
    await preserve(path.join(prior, name));
  }
  for (const file of [verification.sourceFilm, verification.musicSource,
    '/tmp/quoteplate-vendor-phone-film/phone-canvas.png', '/tmp/quoteplate-vendor-phone-film/printed-price-fixture.png',
    '/tmp/quoteplate-video-update/audio/kokoro-v1.0.int8.onnx', '/tmp/quoteplate-video-update/audio/voices-v1.0.bin']) await preserve(file);
  await fs.mkdir(path.join(work, 'baseline'));
  for (const name of ['storyboard.json', 'capture-evidence.json', 'verification.json', 'visual-review.json']) {
    await fs.copyFile(path.join(prior, name), path.join(work, 'baseline', name), fs.constants.COPYFILE_EXCL);
  }
  // Copy narration cache only. Retained clips and raw sources stay immutable in prior.
  await fs.cp(path.join(prior, 'audio'), path.join(work, 'audio'), { recursive: true, errorOnExist: true, force: false });
  const slots = story.scenes.flatMap(scene => scene.shots);
  const plan = { status: 'prepared; recording and publication blocked pending new parent validation',
    preparedAt: new Date().toISOString(), prior, durationSeconds: 165, frames: 4950,
    resolution: [3840, 2400], fps: 30, origin: null, recordedClips: [],
    pickups: pickups.map(file => ({ file, duration: slots.find(shot => shot.file === file).duration, status: 'planned; not recorded' })),
    retained: slots.filter(shot => !pickups.includes(shot.file)).map(shot => ({ file: shot.file,
      sha256: verification.freshCaptures[shot.file], provenance: 'unchanged previous capture; not new footage' })),
    changedNarrationScenes: ['suppliers', 'replies'],
    requiredMessage: 'local final UI validated',
    approvalFile: 'workflow-parent-ui-validation.json',
    next: 'Finalize selectors and source snapshot against the validated tree; record only after checkBarrier passes.' };
  await write(path.join(work, 'baseline-manifest.json'), { createdAt: plan.preparedAt, files });
  await write(path.join(work, 'ui-source-hashes.json'), await sourceHashes());
  await write(path.join(work, 'pickup-plan.json'), plan);
  // A proposed storyboard must never masquerade as the captured/rendered one.
  const suppliers = story.scenes.find(scene => scene.id === 'suppliers');
  suppliers.phrases = ['Review saved-contact warnings. Remove duplicates, then add the remaining supplier.'];
  suppliers.text = suppliers.phrases.join(' ');
  const replies = story.scenes.find(scene => scene.id === 'replies');
  replies.phrases = ['Use a price-list photo or paste prices. Check the photo and matched rate.',
    'Fill the quote, then jump to unfinished items.',
    'Review delivery and the total, then send.'];
  replies.text = replies.phrases.join(' ');
  // Tentative cue layout; audio preparation must measure fit before capture.
  replies.phraseStarts = [0.2, 7, 12];
  story.sources = 'Planned selective local workflow pickups, plus hash-retained footage from the previous verified film. No pickups recorded yet.';
  story.creditsFile = 'workflow-credits.txt';
  story.visualRefresh = { status: 'planned; not recorded', clips: [], plannedClips: pickups,
    retainedClips: plan.retained.map(record => record.file) };
  await write(path.join(work, 'proposed-storyboard.json'), story);
  await verifyBaseline(work);
  console.log(JSON.stringify({ work, status: plan.status, plannedPickups: pickups.length,
    retainedClips: plan.retained.length, preservedFiles: Object.keys(files).length,
    baselineMp4Sha256: verification.outputSha256 }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, work, origin] = process.argv.slice(2);
  if (mode === '--prepare' && work && !origin) await prepare(work);
  else if (mode === '--verify-baseline' && work && !origin) { await verifyBaseline(work); console.log('Baseline hashes unchanged.'); }
  else if (mode === '--check-barrier' && work && origin) { await checkBarrier(work, origin); console.log('New parent validation matches this preparation and current UI. No browser started.'); }
  else throw Error('Use --prepare <new-/tmp-directory>, --verify-baseline <directory>, or --check-barrier <directory> <origin>. This tool never records or publishes.');
}
