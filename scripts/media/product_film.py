#!/usr/bin/env python3
"""Local-only QuotePlate film authoring. See README.md beside this file."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import textwrap
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WIDTH, HEIGHT, FPS, SAMPLE_RATE = 3840, 2400, 30, 48000


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def ffmpeg(*args, **kwargs):
    return run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', *args], **kwargs)


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(path),
    ]))


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def required(path):
    if not path or not path.is_file():
        raise ValueError(f'Required local asset is missing: {path}')
    return path


def audio_source_start(scene):
    return scene.get('audioSourceStart', scene.get('sourceStart'))


def audio_fingerprint(story):
    """Visual-only edits must not invalidate or regenerate approved speech."""
    scenes = [{key: scene.get(key) for key in ('id', 'at', 'duration', 'phrases', 'text', 'phraseStarts', 'sourceCues')}
              | {'audioSourceStart': audio_source_start(scene)} for scene in story['scenes']]
    return hashlib.sha256(json.dumps(scenes, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_shot(shot):
    filename = shot.get('file', '')
    if not isinstance(filename, str) or Path(filename).name != filename or '\\' in filename or Path(filename).suffix.lower() not in ('.webm', '.mp4'):
        raise ValueError('Application shots require plain .webm or .mp4 filenames; still images are not accepted.')
    duration, start, rate = shot.get('duration'), shot.get('sourceStart'), shot.get('playbackRate', 1)
    if not finite_number(duration) or duration <= 0 or not math.isclose(duration * FPS, round(duration * FPS), abs_tol=1e-7):
        raise ValueError(f'{filename}: duration must be positive and contain a whole number of output frames.')
    if not finite_number(start) or start < 0:
        raise ValueError(f'{filename}: sourceStart must be a finite, non-negative number.')
    if not finite_number(rate) or not 1 <= rate <= 1.5:
        raise ValueError(f'{filename}: playbackRate must be between 1 and 1.5; prefer 1.')


def validate_clip(path, shot, info=None):
    """Reject short footage before encoding. Encoded frame counts are checked too."""
    validate_shot(shot)
    info = info if info is not None else probe(required(path))
    video = next((s for s in info['streams'] if s['codec_type'] == 'video'), None)
    formats = set(info['format'].get('format_name', '').split(','))
    if not video or video.get('codec_name') not in ('h264', 'hevc', 'vp8', 'vp9', 'av1') or not formats.intersection({'mov', 'mp4', 'matroska', 'webm'}):
        raise ValueError(f'{path.name}: expected a real MP4/WebM video stream, not an image or audio file.')
    if video.get('nb_frames') not in (None, 'N/A') and int(video['nb_frames']) < 2:
        raise ValueError(f'{path.name}: a one-frame clip is not an application recording.')
    raw_duration = video.get('duration')
    if raw_duration in (None, 'N/A'):
        # WebM frequently stores duration as a stream tag, not stream.duration.
        tag = next((v for k, v in video.get('tags', {}).items() if k.upper() == 'DURATION'), None)
        if tag:
            h, m, s = tag.split(':')
            raw_duration = int(h) * 3600 + int(m) * 60 + float(s)
        else:
            raw_duration = info['format'].get('duration')
    try:
        available = float(raw_duration)
    except (ValueError, TypeError):
        raise ValueError(f'{path.name}: a measurable video duration is required.') from None
    needed = shot['sourceStart'] + shot['duration'] * shot.get('playbackRate', 1)
    if not math.isfinite(available) or available + .001 < needed:
        raise ValueError(f'{path.name}: needs {needed:.3f}s of source footage but only {available:.3f}s is available. Recapture; no still/freeze fallback.')
    if video.get('width', 0) < WIDTH or video.get('height', 0) < HEIGHT:
        raise ValueError(f'{path.name}: native {WIDTH}x{HEIGHT} application footage is required; do not upscale lower-resolution captures.')
    return {'durationSeconds': available, 'requiredThroughSeconds': needed, 'codec': video['codec_name']}


def load_story(path):
    story = json.loads(path.read_text())
    at = 0
    ids = set()
    for scene in story['scenes']:
        if scene['id'] in ids or scene['at'] != at or scene['duration'] <= 0:
            raise ValueError('Scene identifiers and timeline must be unique and contiguous.')
        ids.add(scene['id'])
        at += scene['duration']
        if 'sourceStart' not in scene:
            for shot in scene['shots']:
                validate_shot(shot)
            if not math.isclose(sum(shot['duration'] for shot in scene['shots']), scene['duration'], abs_tol=1e-7):
                raise ValueError(f"Capture durations do not match: {scene['id']}")
        if audio_source_start(scene) is not None and not scene.get('sourceCues'):
            raise ValueError('Reused scenes require measured source caption cues.')
    if at != story['durationSeconds'] or at > 165 or at != 165:
        raise ValueError('This film must be exactly 165 seconds.')
    return story


def stamp(seconds):
    milliseconds = round(seconds * 1000)
    return f'{milliseconds // 3600000:02}:{milliseconds // 60000 % 60:02}:{milliseconds // 1000 % 60:02}.{milliseconds % 1000:03}'


def export_text(story, timing, work):
    cues = []
    for scene in story['scenes']:
        for cue in timing[scene['id']]['cues']:
            start, end = scene['at'] + cue['start'], scene['at'] + cue['end']
            if not scene['at'] <= start < end <= scene['at'] + scene['duration']:
                raise ValueError(f"Caption outside scene: {scene['id']}")
            lines = textwrap.wrap(cue['text'], width=54, break_long_words=False)
            if len(lines) > 2:
                raise ValueError(f"Caption needs a shorter narration phrase: {cue['text']}")
            cues.append(f'{stamp(start)} --> {stamp(end)}\n' + '\n'.join(lines))
    (work / 'quoteplate-product-film.vtt').write_text('WEBVTT\n\n' + '\n\n'.join(cues) + '\n')
    transcript = [
        'QuotePlate — 2:45 product film',
        'An overview of QuotePlate’s major feature families, following one fictional restaurant’s first purchase. '
        'Actual local application recordings with illustrative licensed kitchen opening and closing footage. '
        'Restaurant details and Google entry are shown for approved pilot owners; authentication is completed off camera. '
        'Communication controls create drafts for the user to send. '
        'Actions may be condensed; this is not a claim of loading speed. '
        'Synthetic American-English narration.',
    ]
    transcript.extend(scene['text'] for scene in story['scenes'])
    transcript.append('Start your first purchase: https://quoteplate.netlify.app/start')
    (work / 'quoteplate-product-film.txt').write_text('\n\n'.join(transcript) + '\n')
    (work / 'credits.txt').write_text(Path(__file__).with_name('credits.txt').read_text())


def generate_audio(args, story):
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    required(args.model)
    required(args.voices)
    required(args.source_film)
    audio_dir = args.work / 'audio'
    audio_dir.mkdir(parents=True, exist_ok=True)
    engine = Kokoro(str(args.model), str(args.voices))
    signature = {'model': digest(args.model), 'voices': digest(args.voices), 'voice': 'af_heart', 'recipe': 2}
    storyboard_hash, source_hash = digest(args.storyboard), digest(args.source_film)
    timing = {}
    previous_path = audio_dir / 'timing.json'
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
    for scene in story['scenes']:
        name, duration = scene['id'], scene['duration']
        output = audio_dir / f'{name}.wav'
        starts = scene.get('phraseStarts', [0] * len(scene['phrases']))
        if len(starts) != len(scene['phrases']):
            raise ValueError(f'Phrase start count does not match: {name}')
        key = hashlib.sha256(json.dumps({'phrases': scene['phrases'], 'starts': starts, 'duration': duration, **signature}, sort_keys=True).encode()).hexdigest()
        source_start = audio_source_start(scene)
        if source_start is not None:
            ffmpeg('-ss', source_start, '-i', args.source_film, '-t', duration,
                   '-vn', '-af', f'apad,atrim=duration={duration}', '-ar', SAMPLE_RATE,
                   '-ac', '2', '-c:a', 'pcm_s16le', output)
            row = {'kind': 'approved source mix', 'duration': duration, 'cues': scene['sourceCues'], 'sourceStart': source_start}
        elif previous.get('scenes', {}).get(name, {}).get('key') == key and output.exists() and previous['scenes'][name].get('wavSha256') == digest(output):
            row = previous['scenes'][name]
            print(f'Audio reused: {name}', flush=True)
        else:
            for speed in (1.05, 1.10, 1.15):
                parts = []
                for phrase in scene['phrases']:
                    samples, sr = engine.create(phrase, voice='af_heart', speed=speed, lang='en-us')
                    active = np.flatnonzero(np.abs(samples) > 0.001)
                    if not len(active):
                        raise ValueError(f'No speech generated: {name}')
                    samples = samples[max(0, active[0] - round(.035 * sr)):min(len(samples), active[-1] + round(.06 * sr))]
                    parts.append(samples)
                cursor = .2
                for start, part in zip(starts, parts):
                    cursor = max(cursor, start) + len(part) / sr + .22
                occupied = cursor - .22 + .2
                if occupied <= duration:
                    break
            else:
                raise ValueError(f'{name}: speech needs {occupied:.2f}s in {duration}s. Shorten narration; no truncation allowed.')
            samples = np.zeros(round(duration * sr), dtype=np.float32)
            cursor = round(.2 * sr)
            cues = []
            for phrase, start, part in zip(scene['phrases'], starts, parts):
                cursor = max(cursor, round(start * sr))
                samples[cursor:cursor + len(part)] = part
                cues.append({'start': round(cursor / sr, 4), 'end': round((cursor + len(part)) / sr, 4), 'text': phrase})
                cursor += len(part) + round(.22 * sr)
            peak = float(np.max(np.abs(samples)))
            if peak > .9:
                samples *= .9 / peak
            sf.write(str(output), samples, sr, subtype='PCM_16')
            row = {'key': key, 'kind': 'local Kokoro', 'duration': duration, 'speechWithPauses': round(occupied, 3), 'speed': speed, 'cues': cues}
        row['wavSha256'] = digest(output)
        timing[name] = row
        write_json(previous_path, {'storyboardSha256': storyboard_hash, 'audioFingerprint': audio_fingerprint(story), 'sourceSha256': source_hash, **signature, 'scenes': timing})
        print(f'Audio ready: {name}, {duration}s', flush=True)
    export_text(story, timing, args.work)


def reuse_audio(args, story):
    """Copy hash-verified speech, without TTS, from an approved prior storyboard."""
    previous_story = json.loads(required(args.previous_storyboard).read_text())
    old_timing = json.loads(required(args.audio_from / 'audio/timing.json').read_text())
    if old_timing['storyboardSha256'] != digest(args.previous_storyboard) and old_timing.get('audioFingerprint') != audio_fingerprint(previous_story):
        raise ValueError('Previous storyboard does not match the approved audio cache.')
    if audio_fingerprint(previous_story) != audio_fingerprint(story):
        raise ValueError('Narration/timing changed. Audio reuse is limited to visual-only edits.')
    if old_timing['sourceSha256'] != digest(required(args.source_film)):
        raise ValueError('Approved source film does not match the prior audio cache.')
    for scene in story['scenes']:
        name = scene['id']
        source = required(args.audio_from / 'audio' / f'{name}.wav')
        if digest(source) != old_timing['scenes'][name]['wavSha256']:
            raise ValueError(f'Prior narration cache was modified: {name}')
    destination = args.work / 'audio'
    destination.mkdir(parents=True, exist_ok=True)
    for scene in story['scenes']:
        name = scene['id']
        target = destination / f'{name}.wav'
        if target.exists() and digest(target) != old_timing['scenes'][name]['wavSha256']:
            raise ValueError(f'Refusing to overwrite different narration: {target}')
        if not target.exists():
            shutil.copyfile(args.audio_from / 'audio' / target.name, target)
    old_timing.update(storyboardSha256=digest(args.storyboard), audioFingerprint=audio_fingerprint(story))
    write_json(destination / 'timing.json', old_timing)
    export_text(story, old_timing['scenes'], args.work)
    for filename in ('quoteplate-product-film.vtt', 'quoteplate-product-film.txt'):
        if digest(args.audio_from / filename) != digest(args.work / filename):
            raise ValueError(f'Approved text unexpectedly changed: {filename}')
    print('Approved audio and captions copied unchanged; no TTS or video rendering performed.')


def validate_inputs(args, story):
    source = probe(required(args.source_film))
    required(args.music)
    source_ends = [s[k] + s['duration'] for s in story['scenes'] for k in ('sourceStart', 'audioSourceStart') if k in s]
    if source_ends and float(source['format']['duration']) < max(source_ends):
        raise ValueError('Source film is too short; use the approved 164-second film.')
    timing = json.loads(required(args.work / 'audio/timing.json').read_text())
    if timing['storyboardSha256'] != digest(args.storyboard) and timing.get('audioFingerprint') != audio_fingerprint(story):
        raise ValueError('Storyboard changed: regenerate narration and captions first.')
    if timing['sourceSha256'] != digest(args.source_film):
        raise ValueError('Approved source changed: regenerate reused audio first.')
    missing = [shot['file'] for s in story['scenes'] for shot in s.get('shots', []) if not (args.captures / shot['file']).is_file()]
    if missing:
        raise ValueError('Missing fresh captures: ' + ', '.join(missing))
    media_info = {}
    for scene in story['scenes']:
        for shot in scene.get('shots', []):
            path = args.captures / shot['file']
            if shot['file'] not in media_info:
                media_info[shot['file']] = probe(required(path))
            validate_clip(path, shot, media_info[shot['file']])
    for scene in story['scenes']:
        path = required(args.work / 'audio' / f"{scene['id']}.wav")
        if timing['scenes'][scene['id']]['wavSha256'] != digest(path):
            raise ValueError(f"Narration cache changed: {scene['id']}")
    return timing


def video_options():
    return ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-threads', '2', '-pix_fmt', 'yuv420p', '-r', FPS]


def render_video_shot(source, shot, frame_filter, output):
    validate_shot(shot)
    rate = shot.get('playbackRate', 1)
    vf = (f"trim=duration={shot['duration'] * rate},setpts=(PTS-STARTPTS)/{rate},"
          f'{frame_filter},fps={FPS}')
    ffmpeg('-ss', shot['sourceStart'], '-i', source, '-vf', vf,
           '-frames:v', round(shot['duration'] * FPS), *video_options(), output)
    encoded = next(s for s in probe(output)['streams'] if s['codec_type'] == 'video')
    if int(encoded.get('nb_frames', 0)) != round(shot['duration'] * FPS):
        raise ValueError(f"{shot['file']}: decoded footage is too short. No repeat, still, or freeze-frame padding is allowed.")


def render(args, story):
    timing = validate_inputs(args, story)
    capture_hashes = {shot['file']: digest(args.captures / shot['file']) for scene in story['scenes'] for shot in scene.get('shots', [])}
    export_text(story, timing['scenes'], args.work)
    edit = args.work / 'edit'
    edit.mkdir(exist_ok=True)
    font = args.font
    if not font:
        font = next((p for p in (Path('/System/Library/Fonts/Supplemental/Arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')) if p.is_file()), None)
    required(font)
    # Local filter files avoid shell interpolation; filter paths are quoted/escaped separately.
    def filter_path(path):
        return str(path.resolve()).replace('\\', '\\\\').replace(':', '\\:').replace("'", "'\\''")
    chunks, tracks = [], []
    music_duration = float(probe(args.music)['format']['duration'])
    for scene in story['scenes']:
        name, duration = scene['id'], scene['duration']
        if 'sourceStart' in scene:
            output = edit / f'{name}.mp4'
            crop = scene.get('pictureCrop')
            crop_filter = f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']}," if crop else ''
            ffmpeg('-ss', scene['sourceStart'], '-i', args.source_film, '-vf', f'{crop_filter}scale={WIDTH}:{HEIGHT},setsar=1,fps={FPS}',
                   '-frames:v', round(duration * FPS), *video_options(), output)
            chunks.append(output)
        else:
            for index, shot in enumerate(scene['shots']):
                output = edit / f'{name}-{index}.mp4'
                # Match the 16:10 laptop recording: no margins, title strip or UI crop.
                vf = f'scale={WIDTH}:{HEIGHT},setsar=1'
                render_video_shot(args.captures / shot['file'], shot, vf, output)
                chunks.append(output)
        voice = args.work / 'audio' / f'{name}.wav'
        track = edit / f'{name}-mix.wav'
        if audio_source_start(scene) is not None:
            ffmpeg('-i', voice, '-ar', SAMPLE_RATE, '-ac', '2', '-t', duration, '-c:a', 'pcm_s16le', track)
        else:
            mix = (f'[0:a]loudnorm=I=-17:TP=-2:LRA=9,apad,atrim=duration={duration}[voice];'
                   f'[1:a]volume=0.07,atrim=duration={duration}[bed];'
                   '[voice][bed]amix=inputs=2:duration=first:normalize=0,'
                   f'alimiter=limit=0.88:level=false,afade=t=in:d=0.12,afade=t=out:st={duration-.2}:d=0.2[a]')
            ffmpeg('-i', voice, '-stream_loop', '-1', '-ss', scene['at'] % music_duration, '-i', args.music,
                   '-filter_complex', mix, '-map', '[a]', '-ar', SAMPLE_RATE, '-ac', '2', '-t', duration, '-c:a', 'pcm_s16le', track)
        tracks.append(track)
        print(f'Rendered: {name}', flush=True)
    def concat_file(name, paths):
        listing = edit / name
        listing.write_text(''.join("file '" + str(p.resolve()).replace("'", "'\\''") + "'\n" for p in paths))
        return listing
    output = args.work / 'quoteplate-product-film.mp4'
    ffmpeg('-f', 'concat', '-safe', '0', '-i', concat_file('picture.txt', chunks),
           '-f', 'concat', '-safe', '0', '-i', concat_file('sound.txt', tracks),
           '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
           '-ar', SAMPLE_RATE, '-ac', '2', '-t', story['durationSeconds'], '-movflags', '+faststart', output)
    info = probe(output)
    if any(digest(args.captures / name) != value for name, value in capture_hashes.items()):
        raise ValueError('A capture changed during rendering. Rerun with the completed capture handoff.')
    video = next(stream for stream in info['streams'] if stream['codec_type'] == 'video')
    audio = next(stream for stream in info['streams'] if stream['codec_type'] == 'audio')
    seconds = float(info['format']['duration'])
    if not 163.99 <= seconds <= 165 or int(video['nb_frames']) != 165 * FPS or (video['width'], video['height']) != (WIDTH, HEIGHT):
        raise ValueError('Export duration, frame count or resolution does not match the storyboard.')
    ffmpeg('-xerror', '-i', output, '-f', 'null', '-')
    poster_at = next(scene['at'] + min(3, scene['duration'] / 2) for scene in story['scenes'] if scene['id'] == 'end')
    ffmpeg('-ss', poster_at, '-i', output, '-frames:v', '1', '-q:v', '2', args.work / 'quoteplate-product-film.jpg')
    # Include every capture, not only one frame per scene, so reviewers see each cut.
    sheet_frames = edit / 'contact-frames'
    sheet_frames.mkdir(exist_ok=True)
    frame_index = 0
    for scene in story['scenes']:
        at = scene['at']
        shots = scene.get('shots', [{'duration': scene['duration']}])
        for shot in shots:
            label = sheet_frames / f'{frame_index:02}.txt'
            label.write_text(f"{stamp(at)} / {scene['id']}")
            vf = (f"scale=480:270,pad=480:300:0:0:color=0x172521,drawtext=fontfile='{filter_path(font)}':"
                  f"textfile='{filter_path(label)}':expansion=none:fontsize=15:fontcolor=white:x=10:y=277")
            ffmpeg('-ss', at + shot['duration'] / 2, '-i', output, '-vf', vf,
                   '-frames:v', '1', '-q:v', '3', sheet_frames / f'frame-{frame_index:02}.jpg')
            frame_index += 1
            at += shot['duration']
    ffmpeg('-framerate', '1', '-i', sheet_frames / 'frame-%02d.jpg',
           '-vf', f'tile=4x{(frame_index + 3) // 4}:nb_frames={frame_index}:padding=8:margin=8:color=0xf6f7f5',
           '-frames:v', '1', '-q:v', '3', args.work / 'contact-sheet.jpg')
    write_json(args.work / 'verification.json', {
        'durationSeconds': seconds, 'frames': int(video['nb_frames']), 'resolution': [WIDTH, HEIGHT],
        'videoCodec': video['codec_name'], 'audioCodec': audio['codec_name'], 'fullDecode': 'passed',
        'storyboardSha256': digest(args.storyboard), 'sourceSha256': digest(args.source_film),
        'outputSha256': digest(output), 'freshCaptures': capture_hashes, 'posterAtSeconds': poster_at,
        'brandSources': story.get('brandSources', []),
        'videoShots': [shot for scene in story['scenes'] for shot in scene.get('shots', [])],
    })
    print(f'Film ready: {output} ({seconds:.3f}s)', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['audio', 'reuse-audio', 'check', 'render'])
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--source-film', type=Path, required=True)
    parser.add_argument('--storyboard', type=Path, default=ROOT / 'docs/media/quoteplate-product-film-164.json')
    parser.add_argument('--captures', type=Path)
    parser.add_argument('--model', type=Path)
    parser.add_argument('--voices', type=Path)
    parser.add_argument('--music', type=Path)
    parser.add_argument('--font', type=Path)
    parser.add_argument('--audio-from', type=Path)
    parser.add_argument('--previous-storyboard', type=Path)
    args = parser.parse_args()
    args.work = args.work.resolve()
    args.captures = args.captures or args.work / 'captures'
    story = load_story(required(args.storyboard))
    if args.action == 'audio':
        args.work.mkdir(parents=True, exist_ok=True)
        generate_audio(args, story)
    elif args.action == 'reuse-audio':
        if not args.audio_from or not args.previous_storyboard:
            parser.error('reuse-audio requires --audio-from and --previous-storyboard')
        reuse_audio(args, story)
    elif args.action == 'check':
        validate_inputs(args, story)
        print('All capture and narration inputs are ready; no rendering performed.')
    else:
        render(args, story)


if __name__ == '__main__':
    main()
