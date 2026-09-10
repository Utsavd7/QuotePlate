#!/usr/bin/env python3
"""Verify a completed local film bundle, then optionally copy matching public files."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ['quoteplate-product-film.mp4', 'quoteplate-product-film.jpg',
          'quoteplate-product-film.vtt', 'quoteplate-product-film.txt', 'credits.txt']


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--copy-public', action='store_true')
    args = parser.parse_args()
    work = args.work
    verification = json.loads((work / 'verification.json').read_text())
    evidence = json.loads((work / 'capture-evidence.json').read_text())
    review = json.loads((work / 'visual-review.json').read_text())
    assert verification['frames'] == 4950
    assert verification['durationSeconds'] == 165
    assert verification['resolution'] == [3840, 2400]
    assert verification['fullDecode'] == 'passed'
    assert verification['outputSha256'] == digest(work / BUNDLE[0])
    assert verification['storyboardSha256'] == digest(work / 'storyboard.json')
    assert len(evidence['shots']) == 18
    assert evidence['externalMessages'] == 0 and evidence['browserResponseMocks'] is False
    assert evidence['supplierConfirmation']['saved']
    assert review['status'] == 'passed'
    assert review['finalContactSheet'] == 'passed'
    assert set(review['clips']) == set(verification['freshCaptures'])
    for name, expected in verification['freshCaptures'].items():
        assert digest(work / 'captures' / name) == expected
        assert review['clips'][name]['sha256'] == expected
    for name, record in evidence['shots'].items():
        assert record['sha256'] == verification['freshCaptures'][name + '.mp4']
    profiles = work / 'profiles'
    assert not profiles.exists() or not any(profiles.iterdir())
    vtt = (work / BUNDLE[2]).read_text()
    assert vtt.startswith('WEBVTT\n')
    assert 'WhatsApp' in vtt and 'You send the message.' in vtt
    result = subprocess.run([
        'ffmpeg', '-hide_banner', '-i', str(work / BUNDLE[0]),
        '-vn', '-af', 'volumedetect', '-f', 'null', '-',
    ], capture_output=True, text=True, check=True)
    peak = float(re.search(r'max_volume: ([\d.-]+) dB', result.stderr)[1])
    assert peak < 0, 'Clipped output audio'
    verification.update(featureOverview=evidence, visualReview=review,
                        maxVolumeDb=peak, profilesRemoved=True,
                        bundleSha256={name: digest(work / name) for name in BUNDLE})
    (work / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n')
    if args.copy_public:
        for name, expected in verification['bundleSha256'].items():
            destination = ROOT / 'public/media' / name
            shutil.copy2(work / name, destination)
            assert digest(destination) == expected
        shutil.copy2(work / 'storyboard.json', ROOT / 'docs/media/quoteplate-product-film-164.json')
        shutil.copy2(work / 'verification.json', ROOT / 'docs/media/quoteplate-product-film-164-verification.json')
        print('Verified matching MP4/JPG/VTT/TXT/credits and storyboard copied to public media/docs.')
    print(f'165 seconds; 4950 frames; native 3840x2400; peak {peak} dB.')


if __name__ == '__main__':
    main()
