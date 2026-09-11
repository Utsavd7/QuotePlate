/** Replace only the two signup shots from the approved production-mode local server. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { captureSignup } from './gap_capture_helpers.mjs';
import { verifiedShots, writeCheckpoint } from './capture_checkpoint.mjs';

assert(process.argv.includes('--capture-production-signup'), 'Explicit production signup pickup flag required');
const require = createRequire(import.meta.url);
const { expect } = require('@playwright/test');
const work = process.env.QUOTEPLATE_FILM_WORK || '/tmp/quoteplate-gap-film';
// This origin is isolated to signup pickup; the normal journey stays on 52560.
const origin = 'http://127.0.0.1:52561';
const label = 'production-signup-' + randomUUID().slice(0, 8);
const pickup = path.join(work, label);
process.env.QUOTEPLATE_FILM_WORK = pickup;
const { recorder } = await import('./motion_capture.mjs');
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const write = async (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
const names = ['first-restaurant', 'first-owner'];
const story = await read(path.join(work, 'storyboard.json'));
const slots = Object.fromEntries(story.scenes.flatMap(s => s.shots).map(s => [path.parse(s.file).name, s.duration]));
const timelineFiles = new Set(story.scenes.flatMap(s => s.shots).map(s => s.file));
const prior = await read(path.join(work, 'capture-evidence.json'));
const preserved = Object.fromEntries(await Promise.all((await fs.readdir(path.join(work, 'captures')))
  .filter(name => timelineFiles.has(name) && !names.includes(path.parse(name).name))
  .map(async name => [name, await hash(path.join(work, 'captures', name))])));
const narration = Object.fromEntries(await Promise.all((await fs.readdir(path.join(work, 'audio')))
  .filter(name => name.endsWith('.wav')).map(async name => [name, await hash(path.join(work, 'audio', name))])));
const evidence = {};
const r = await recorder(null, label, { baseURL: origin });
let deniedRequests = 0;
try {
  await r.context.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
    deniedRequests++;
    return route.abort();
  });
  r.page.setDefaultTimeout(20000);
  await captureSignup(r, { origin, evidence, expect, productionGoogleOnly: true,
    clip: (rec, name, act) => rec.clip(name, slots[name], act),
    paste: async (rec, locator, value) => { await rec.move(locator); await locator.fill(value); await rec.pause(180); },
  });
  await expect(r.page.locator('input[type="password"]')).toHaveCount(0);
  await expect(r.page.getByRole('button', { name: /Create workspace with email/i })).toHaveCount(0);
  assert.equal(deniedRequests, 0, 'Unexpected external or write request');
  await r.finish();
} catch (error) {
  await r.abort();
  throw error;
}
const records = await verifiedShots(names, slots, async name => {
  const file = path.join(pickup, 'captures', name + '.mp4');
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]));
  const video = info.streams.find(s => s.codec_type === 'video');
  return { width: video.width, height: video.height, frames: +video.nb_frames, sha256: await hash(file) };
});
const timing = await read(path.join(pickup, label + '-recording.json'));
const raw = path.join(work, 'raw', path.basename(timing.raw));
await fs.copyFile(timing.raw, raw);
timing.raw = raw;
await write(path.join(work, label + '-recording.json'), timing);
const archive = path.join(pickup, 'replaced');
await fs.mkdir(archive);
for (const file of ['capture-evidence.json', 'capture-progress.json', 'verification.json', 'visual-review.json', 'contact-sheet.jpg', 'quoteplate-product-film.mp4']) {
  await fs.copyFile(path.join(work, file), path.join(archive, file));
}
for (const name of names) {
  await fs.copyFile(path.join(work, 'captures', name + '.mp4'), path.join(archive, name + '.mp4'));
  await fs.copyFile(path.join(pickup, 'captures', name + '.mp4'), path.join(work, 'captures', name + '.mp4'));
}
const rawSha256 = await hash(raw);
Object.assign(prior.shots, records);
for (const shot of timing.shots) prior.motion[shot.name] = {
  raw, rawSha256, start: shot.start, elapsed: shot.elapsed, duration: shot.duration,
  actionCompression: shot.elapsed / shot.duration, nativeResolution: timing.nativeResolution,
  recordingManifest: label + '-recording.json',
};
for (const [name, expected] of Object.entries(preserved)) assert.equal(await hash(path.join(work, 'captures', name)), expected);
for (const [name, expected] of Object.entries(narration)) assert.equal(await hash(path.join(work, 'audio', name)), expected);
prior.signup = { ...evidence.signup, deniedRequests, recordedAt: new Date().toISOString(),
  priorClipsArchived: archive, unchangedCaptureSha256: preserved, unchangedNarrationSha256: narration };
await write(path.join(work, 'capture-evidence.json'), prior);
await writeCheckpoint(path.join(work, 'capture-progress.json'), 'production Google-only signup pickup complete', prior.shots, true);
console.log('Production signup pickup complete: 2 native clips, Google enabled, password/email creation absent; 26 other clips and all narration unchanged. Review and render required.');
