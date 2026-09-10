#!/usr/bin/env python3
"""Create labelled opening/middle/end review strips from real capture footage."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--clips', nargs='*')
    args = parser.parse_args()
    output = args.work / 'capture-review'
    output.mkdir(exist_ok=True)
    names = args.clips or list(json.loads((args.work / 'capture-evidence.json').read_text())['shots'])
    report = {}
    for name in names:
        source = args.work / 'captures' / (name + '.mp4')
        info = json.loads(subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(source),
        ]))
        video = next(stream for stream in info['streams'] if stream['codec_type'] == 'video')
        frames = int(video['nb_frames'])
        assert (video['width'], video['height']) == (3840, 2400)
        selected = [3, frames // 2, frames - 4]
        frame_dir = output / name
        frame_dir.mkdir(exist_ok=True)
        selection = '+'.join(f'eq(n,{frame})' for frame in selected)
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-i', str(source), '-vf', f"select='{selection}',scale=960:600",
            '-fps_mode', 'vfr', '-frames:v', '3', str(frame_dir / '%02d.png'),
        ], check=True)
        strip = Image.new('RGB', (2880, 640), '#f6f7f5')
        draw = ImageDraw.Draw(strip)
        for index, frame in enumerate(selected):
            with Image.open(frame_dir / f'{index + 1:02}.png') as image:
                strip.paste(image, (index * 960, 40))
            draw.text((index * 960 + 12, 12), f'{name} / frame {frame} / {frame / 30:.2f}s', fill='#173c32')
        strip.save(output / (name + '.jpg'), quality=92)
        report[name] = {
            'frames': frames, 'resolution': [video['width'], video['height']],
            'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sampleFrames': selected, 'humanReview': 'pending',
        }
    (output / 'samples.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Created {len(report)} review strips. Samples support visual review; they do not establish motion.')


if __name__ == '__main__':
    main()
