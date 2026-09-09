#!/usr/bin/env python3
"""Render silent QuotePlate kitchen bookends from continuous local stock footage.

Requires Pillow, repository-local sharp, Node.js, FFmpeg and FFprobe.
Example: python brand_bookends.py --source /path/kitchen-4k.mp4 --output /tmp/film/captures
No downloads, authentication, narration or public-asset writes are performed.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
WIDTH, HEIGHT, FPS = 3840, 2400, 30
CREAM = '#f5f1e8'


def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path),
    ]))


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def make_overlay(kind, output, serif_path, sans_path):
    # Graphics are drawn at final resolution; source footage stays in motion.
    canvas = Image.new('RGBA', (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(canvas)
    for y in range(HEIGHT):
        alpha = round(78 + 55 * (y / HEIGHT) ** 1.6) if kind == 'intro' else 121
        draw.line((0, y, WIDTH, y), fill=(7, 18, 15, alpha))
    logo_bytes = subprocess.check_output([
        'node', '-e',
        "require('sharp')(process.argv[1]).resize(672).png().toBuffer().then(b=>process.stdout.write(b))",
        str(ROOT / 'public/brand/wordmark-horizontal.svg'),
    ], cwd=ROOT)
    logo = Image.open(io.BytesIO(logo_bytes)).convert('RGBA')
    badge_x, badge_y = (288, 64) if kind == 'intro' else ((WIDTH - 772) // 2, 490)
    draw.rounded_rectangle((badge_x, badge_y, badge_x + 772, badge_y + 244), radius=24, fill=CREAM)
    canvas.alpha_composite(logo, (badge_x + 50, badge_y + (244 - logo.height) // 2))

    def text(value, x, y, size, family, centered=False):
        font = ImageFont.truetype(str(family), size)
        if centered:
            x -= draw.textlength(value, font=font) / 2
        draw.text((round(x), y), value, font=font, fill=CREAM, anchor='lt')

    if kind == 'intro':
        text('RESTAURANT PURCHASING, CONNECTED', 292, 1390, 42, sans_path)
        text('Every service starts', 288, 1480, 212, serif_path)
        text('with a purchase.', 288, 1720, 212, serif_path)
    else:
        title = 'Keep every purchase clear.'
        size = 204
        while draw.textlength(title, font=ImageFont.truetype(str(serif_path), size)) > WIDTH - 480:
            size -= 2
        text(title, WIDTH / 2, 1010, size, serif_path, True)
        text('From your menu to your next order.', WIDTH / 2, 1330, 60, sans_path, True)
        text('quoteplate.netlify.app/start', WIDTH / 2, 1510, 50, sans_path, True)
        text('Fictional product demonstration · Illustrative kitchen footage',
             WIDTH / 2, 2290, 32, sans_path, True)
    canvas.save(output)


def render_shot(source, output, graphics, name, start, duration):
    destination = output / f'kitchen-{name}.mp4'
    filters = (
        f'[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,'
        f'crop={WIDTH}:{HEIGHT},setsar=1,fps={FPS}[picture];'
        '[picture][1:v]overlay=0:0:format=auto,format=yuv420p[final]'
    )
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-threads', '2', '-ss', start, '-i', source,
        '-loop', '1', '-framerate', FPS, '-i', graphics,
        '-filter_complex_threads', '2', '-filter_complex', filters, '-map', '[final]',
        '-an', '-frames:v', duration * FPS, '-c:v', 'libx264', '-preset', 'fast',
        '-crf', '18', '-threads', '2', '-movflags', '+faststart', destination)
    info = probe(destination)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    if ((video['width'], video['height']) != (WIDTH, HEIGHT)
            or int(video['nb_frames']) != duration * FPS
            or video['r_frame_rate'] != '30/1'
            or abs(float(info['format']['duration']) - duration) > .001
            or any(s['codec_type'] == 'audio' for s in info['streams'])):
        raise ValueError(f'Unexpected output format: {destination}')
    run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-xerror',
        '-i', destination, '-f', 'null', '-')
    for label, at in [('opening', 0), ('middle', duration / 2), ('end', (duration * FPS - 1) / FPS)]:
        run('ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-ss', at, '-i', destination, '-frames:v', '1', '-vf', 'scale=960:600',
            '-update', '1', output / f'kitchen-{name}-{label}.jpg')
    return {'file': destination.name, 'sourceStart': start, 'duration': duration,
            'frames': duration * FPS, 'resolution': [WIDTH, HEIGHT], 'fps': FPS,
            'sha256': sha256(destination), 'fullDecode': 'passed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--serif', type=Path, default=Path('/System/Library/Fonts/Supplemental/Georgia.ttf'))
    parser.add_argument('--sans', type=Path, default=Path('/System/Library/Fonts/Supplemental/Arial.ttf'))
    args = parser.parse_args()
    source = args.source.resolve()
    info = probe(source)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    if video['width'] < 3840 or video['height'] < 2160 or float(info['format']['duration']) < 8:
        raise ValueError('Bookends require at least eight seconds of original 3840×2160 footage.')
    args.output.mkdir(parents=True, exist_ok=True)
    for name in ('intro', 'end'):
        make_overlay(name, args.output / f'kitchen-{name}-overlay.png', args.serif, args.sans)
    source_hash = sha256(source)
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(render_shot, source, args.output, args.output / f'kitchen-{name}-overlay.png',
                            name, start, duration)
                for name, start, duration in [('intro', .4, 6), ('end', 0, 8)]]
        results = [job.result() for job in jobs]
    if sha256(source) != source_hash:
        raise ValueError('Source changed during rendering.')
    manifest = {'source': str(source), 'sourceSha256': source_hash,
                'sourceResolution': [video['width'], video['height']],
                'sourceFps': video['r_frame_rate'],
                'fit': 'Lanczos enlarge and center crop from 16:9 to 16:10; native-resolution graphics',
                'padding': 'No still-frame or temporal padding; continuous source footage',
                'wordmarkSha256': sha256(ROOT / 'public/brand/wordmark-horizontal.svg'),
                'clips': results}
    (args.output / 'brand-bookends-verification.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
