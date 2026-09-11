/** FFmpeg-only source strips; generating samples never grants visual approval. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { hash, pickups } from './prepare_workflow_pickups.mjs';

const [work] = process.argv.slice(2);
assert(work && process.argv.length === 3, 'Supply completed pickup work directory');
const output = path.join(work, 'capture-review');
await fs.mkdir(output, { recursive: true });
const report = {};
for (const name of pickups) {
  const file = path.join(work, 'captures', name);
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]));
  const video = info.streams.find(s => s.codec_type === 'video');
  assert.equal(video.width, 3840); assert.equal(video.height, 2400);
  const frames = +video.nb_frames;
  const samples = [3, Math.floor(frames * .2), Math.floor(frames * .4), Math.floor(frames * .6), Math.floor(frames * .8), frames - 4];
  const selection = samples.map(frame => `eq(n,${frame})`).join('+');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', file,
    '-vf', `select='${selection}',scale=960:600,tile=3x2:nb_frames=6:padding=8:margin=8:color=0xf6f7f5`,
    '-frames:v', '1', '-q:v', '2', path.join(output, path.parse(name).name + '.jpg')]);
  report[name] = { sha256: await hash(file), sampleFrames: samples,
    stripSha256: await hash(path.join(output, path.parse(name).name + '.jpg')), review: 'pending' };
}
await fs.writeFile(path.join(output, 'workflow-samples.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Six FFmpeg source strips generated; inspection remains required.');
