#!/usr/bin/env python3
"""Verify a completed local film bundle, then optionally copy matching public files."""
import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ['quoteplate-product-film.mp4', 'quoteplate-product-film.jpg',
          'quoteplate-product-film.vtt', 'quoteplate-product-film.txt', 'credits.txt']


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path),
    ]))


def validate_gap_evidence(work, story, evidence, review, verification):
    """Tie final-gap claims to the actual recorded intervals and reviewed render."""
    workflow = bool(story.get('workflowPickup'))
    if workflow:
        validate_workflow_evidence(work, story, evidence, verification)
    else:
        assert evidence['parentValidation']['status'] == 'local final UI validated'
        assert evidence['parentValidation']['origin'] == 'http://127.0.0.1:52560'
        assert evidence['parentValidation']['parentMessage'].strip()
        assert evidence['parentValidation']['uiSourceManifestSha256'] == digest(work / 'ui-source-hashes.json')
    assert digest(Path(verification['musicSource'])) == verification['musicSha256']
    assert digest(Path(verification['sourceFilm'])) == verification['sourceSha256']
    assert set(verification['narrationSha256']) == {scene['id'] for scene in story['scenes']}
    for name, expected in verification['narrationSha256'].items():
        assert digest(work / 'audio' / f'{name}.wav') == expected
    assert evidence['signup']['fresh'] and evidence['signup']['googleEnabled']
    assert evidence['signup']['pilotRestrictionVisible'] is False
    assert evidence['signup']['authenticationRecorded'] is False
    assert evidence['signup'].get('productionGoogleOnly') is True, 'Replace local signup clips with actual production Google-only UI'
    assert evidence['signup'].get('passwordFieldAbsent') is True
    assert evidence['signup'].get('emailCreateControlAbsent') is True
    assert evidence['signup']['origin'] == 'http://127.0.0.1:52561'
    assert evidence['signup']['formSubmitted'] is False and evidence['signup']['deniedRequests'] == 0
    retained = evidence['signup']['unchangedCaptureSha256']
    assert set(retained) == set(verification['freshCaptures']) - {'first-restaurant.mp4', 'first-owner.mp4'}
    if not workflow:
        for name, expected in retained.items():
            assert verification['freshCaptures'][name] == expected
    retained_audio = evidence['signup']['unchangedNarrationSha256']
    assert set(retained_audio) == {name + '.wav' for name in verification['narrationSha256']}
    if not workflow:
        for name, expected in retained_audio.items():
            assert verification['narrationSha256'][Path(name).stem] == expected
    assert evidence['shopping']['realOCR'] and evidence['shopping']['reviewed'] and evidence['shopping']['savedDraft']
    assert evidence['shopping']['menuSelected'] is False and evidence['shopping']['savedMenuId'] is None
    assert evidence['invoice']['realOCR'] and evidence['invoice']['reviewed'] and evidence['invoice']['applied']
    assert evidence['invoice']['physicalCountsTotalCreditsUnchanged']
    assert evidence['website']['explicitLookup'] and evidence['website']['requests'] == 1
    assert evidence['website']['resultsMocked'] is False
    assert evidence['website']['saved'] or (evidence['website']['unavailableText'] and evidence['website']['narrationReflectsUnavailable'])
    assert evidence['nearby']['resultsMocked'] is False
    assert evidence['phone']['realOCR'] and evidence['phone']['realSubmission'] and evidence['phone']['upscaled'] is False
    assert review['outputSha256'] == verification['outputSha256']
    assert review['contactSheetSha256'] == digest(work / 'contact-sheet.jpg')
    assert review['motionAndContinuity'] == 'passed'
    assert review['audioReview'] == 'passed'
    assert review['captionsOffByDefault'] is True
    assert review['noBurnedCaptions'] is True
    assert set(evidence['motion']) == set(evidence['shots'])
    checked = {}
    for scene in story['scenes']:
        for shot in scene['shots']:
            name = Path(shot['file']).stem
            if name.startswith('kitchen-'):
                assert evidence['reuse'][shot['file']]['sha256'] == verification['freshCaptures'][shot['file']]
                continue
            motion = evidence['motion'][name]
            raw = Path(motion['raw'])
            assert raw.resolve().is_relative_to((work / 'raw').resolve())
            if raw not in checked:
                checked[raw] = (digest(raw), probe(raw))
            actual_hash, info = checked[raw]
            assert actual_hash == motion['rawSha256'], 'Raw source changed: ' + name
            stream = next(s for s in info['streams'] if s['codec_type'] == 'video')
            native = [1560, 2400] if name == 'vendor-phone' else [3840, 2400]
            assert [stream['width'], stream['height']] == motion['nativeResolution'] == native
            assert motion['start'] >= 0 and motion['elapsed'] > 0
            assert motion['start'] + motion['elapsed'] <= float(info['format']['duration']) + .05
            assert motion['duration'] == shot['duration']
            compression = motion['elapsed'] / motion['duration']
            assert math.isclose(compression, motion['actionCompression'])
            assert compression * shot.get('playbackRate', 1) <= 1.5, 'Double acceleration: ' + name


def validate_workflow_evidence(work, story, evidence, verification):
    """Require explicit new provenance while preserving historical signup/source facts."""
    pickup = evidence['workflowPickup']
    plan = json.loads((work / 'pickup-plan.json').read_text())
    baseline = json.loads((work / 'baseline/verification.json').read_text())
    old = json.loads((work / 'baseline/capture-evidence.json').read_text())
    old_story = json.loads((work / 'baseline/storyboard.json').read_text())
    manifest = json.loads((work / 'baseline-manifest.json').read_text())
    for name in ('verification.json', 'capture-evidence.json', 'storyboard.json', 'visual-review.json'):
        assert digest(work / 'baseline' / name) == manifest['files'][str(Path(plan['prior']) / name)]
    assert pickup['baselineManifestSha256'] == digest(work / 'baseline-manifest.json')
    assert pickup['pickupPlanSha256'] == digest(work / 'pickup-plan.json')
    approval = json.loads((work / 'workflow-parent-ui-validation.json').read_text())
    assert pickup['approval'] == approval
    subprocess.run(['node', str(ROOT / 'scripts/media/prepare_workflow_pickups.mjs'),
                    '--check-barrier', str(work), approval['origin']], check=True, capture_output=True)
    changed = {'supplier-contacts.mp4', 'shopping-source.mp4', 'shopping-review.mp4',
               'invoice-source.mp4', 'invoice-review.mp4', 'vendor-phone.mp4'}
    assert set(pickup['changedClips']) == changed == set(story['workflowPickup']['changedClips'])
    retained = set(baseline['freshCaptures']) - changed
    assert set(pickup['retainedClips']) == retained == set(story['workflowPickup']['retainedClips'])
    assert set(story['visualRefresh']['clips']) == changed
    assert len(retained) == 22
    for name, expected in baseline['freshCaptures'].items():
        actual = verification['freshCaptures'][name]
        if name in changed:
            assert actual != expected, 'Unchanged footage cannot be called a new pickup'
        else:
            assert actual == expected, 'Unplanned changed capture: ' + name
            key = Path(name).stem
            if key in old['motion']:
                current = evidence['motion'][key]
                assert {k: v for k, v in current.items() if k != 'raw'} == {k: v for k, v in old['motion'][key].items() if k != 'raw'}
    for key in ('signup', 'parentValidation', 'website', 'nearby', 'supplierConfirmation', 'reuse'):
        assert evidence[key] == old[key], 'Historical evidence must stay unchanged: ' + key
    changed_audio = {'suppliers', 'replies'}
    assert set(pickup['changedNarrationScenes']) == changed_audio
    for name, expected in baseline['narrationSha256'].items():
        actual = verification['narrationSha256'][name]
        assert (actual != expected) if name in changed_audio else (actual == expected)
    for current, previous in zip(story['scenes'], old_story['scenes'], strict=True):
        excluded = {'phrases', 'text', 'phraseStarts'} if current['id'] in changed_audio else set()
        assert {k: v for k, v in current.items() if k not in excluded} == {k: v for k, v in previous.items() if k not in excluded}
    actions = evidence['workflowActions']
    contact = actions['contactPickup']
    assert contact['savedContactWarning'] and contact['duplicateRemovedByUser'] and contact['remainingSupplierSaved']
    assert contact['savedSupplierCount'] == 2 and contact['automaticDeduplicationClaimed'] is False
    for mode in ('shopping', 'invoice'):
        assert all(actions[mode + 'Preview'][key] for key in ('visible', 'decoded', 'reviewedAlongsideText'))
    phone = actions['phonePickup']
    assert all(phone[key] for key in ('sourcePreview', 'realOCR', 'unfinishedQuantity', 'jumpFocusedQuantity', 'allItemsComplete', 'realLocalSubmission'))
    assert phone['totalPaise'] == '40000'
    assert pickup['uniqueFictionalTenant'] and pickup['externalMessages'] == pickup['productionWrites'] == 0
    for name in changed:
        motion = evidence['motion'][Path(name).stem]
        recording = json.loads((work / motion['recordingManifest']).read_text())
        assert recording['raw'] == motion['raw']
        shot_name = 'phone-native' if name == 'vendor-phone.mp4' else Path(name).stem
        interval = next(s for s in recording['shots'] if s['name'] == shot_name)
        assert all(interval[key] == motion[key] for key in ('start', 'elapsed', 'duration'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--copy-public', action='store_true')
    args = parser.parse_args()
    work = args.work
    verification = json.loads((work / 'verification.json').read_text())
    evidence = json.loads((work / 'capture-evidence.json').read_text())
    review = json.loads((work / 'visual-review.json').read_text())
    story = json.loads((work / 'storyboard.json').read_text())
    if (work / 'pickup-plan.json').exists():
        assert story.get('workflowPickup') and evidence.get('workflowPickup'), 'Workflow pickups not complete'
    assert verification['frames'] == 4950
    assert verification['durationSeconds'] == 165
    assert verification['resolution'] == [3840, 2400]
    assert verification['fullDecode'] == 'passed'
    assert verification['outputSha256'] == digest(work / BUNDLE[0])
    assert verification['storyboardSha256'] == digest(work / 'storyboard.json')
    expected = {Path(shot['file']).stem for scene in story['scenes'] for shot in scene['shots'] if not shot['file'].startswith('kitchen-')}
    # Legacy editions retained signup outside the recorder checkpoint.
    if not story.get('edition'):
        expected -= {'first-restaurant', 'first-owner'}
    assert set(evidence['shots']) == expected
    assert set(verification['freshCaptures']) == {shot['file'] for scene in story['scenes'] for shot in scene['shots']}
    assert evidence['externalMessages'] == 0 and evidence['browserResponseMocks'] is False
    assert evidence['supplierConfirmation']['saved']
    assert review['status'] == 'passed'
    assert review['finalContactSheet'] == 'passed'
    assert set(review['clips']) == set(verification['freshCaptures'])
    for name, expected in verification['freshCaptures'].items():
        assert digest(work / 'captures' / name) == expected
        assert review['clips'][name]['sha256'] == expected
        assert review['clips'][name]['review'] == 'passed'
    for name, record in evidence['shots'].items():
        assert record['sha256'] == verification['freshCaptures'][name + '.mp4']
    if story.get('edition') == 'procurement-gaps-2026-09-11':
        validate_gap_evidence(work, story, evidence, review, verification)
    profiles = work / 'profiles'
    assert not profiles.exists() or not any(profiles.iterdir())
    vtt = (work / BUNDLE[2]).read_text()
    assert vtt.startswith('WEBVTT\n')
    assert 'WhatsApp' in vtt and 'You send the message.' in vtt
    current = probe(work / BUNDLE[0])
    video = next(s for s in current['streams'] if s['codec_type'] == 'video')
    assert [video['width'], video['height']] == [3840, 2400]
    assert int(video['nb_frames']) == 4950 and video['r_frame_rate'] == '30/1'
    assert float(current['format']['duration']) == 165
    assert all(s['codec_type'] != 'subtitle' for s in current['streams'])
    assert video['codec_name'] == 'h264'
    assert next(s for s in current['streams'] if s['codec_type'] == 'audio')['codec_name'] == 'aac'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-xerror', '-i', str(work / BUNDLE[0]), '-f', 'null', '-'], check=True)
    result = subprocess.run([
        'ffmpeg', '-hide_banner', '-i', str(work / BUNDLE[0]),
        '-vn', '-af', 'volumedetect', '-f', 'null', '-',
    ], capture_output=True, text=True, check=True)
    peak = float(re.search(r'max_volume: ([\d.-]+) dB', result.stderr)[1])
    assert peak < 0, 'Clipped output audio'
    verification.update(featureOverview=evidence, visualReview=review,
                        maxVolumeDb=peak, profilesRemoved=True,
                        releaseStatus='staged; awaiting parent output review' if story.get('workflowPickup') and not args.copy_public else 'passed',
                        bundleSha256={name: digest(work / name) for name in BUNDLE})
    verification.pop('releaseBlocker', None)
    if story.get('workflowPickup'):
        verification['captureProvenance'] = {
            'newClips': evidence['workflowPickup']['changedClips'],
            'retainedClips': evidence['workflowPickup']['retainedClips'],
            'note': 'The legacy freshCaptures map hashes all timeline inputs; only newClips were newly recorded.',
        }
    (work / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n')
    if args.copy_public:
        if story.get('workflowPickup'):
            approval = json.loads((work / 'parent-output-review.json').read_text())
            assert approval['status'] == 'approved for public copy'
            assert approval['outputSha256'] == verification['outputSha256']
            assert approval['contactSheetSha256'] == digest(work / 'contact-sheet.jpg')
            assert approval['parentMessage'].strip(), 'Record actual parent image review before publication'
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
