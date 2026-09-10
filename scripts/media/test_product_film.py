"""Contract regressions only: no video encoding, TTS, network or app server."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('product_film', Path(__file__).with_name('product_film.py'))
film = importlib.util.module_from_spec(spec)
spec.loader.exec_module(film)


class MotionContractTests(unittest.TestCase):
    def setUp(self):
        self.shot = {'file': 'today.mp4', 'duration': 6, 'sourceStart': 0}
        self.info = {'format': {'format_name': 'mov,mp4', 'duration': '6'},
                     'streams': [{'codec_type': 'video', 'codec_name': 'h264', 'duration': '6', 'nb_frames': '180', 'width': 3840, 'height': 2400}]}

    def test_lower_resolution_source_is_not_upscaled_to_claim_4k(self):
        self.info['streams'][0].update(width=1440, height=900)
        with self.assertRaisesRegex(ValueError, 'native 3840x2400'):
            film.validate_clip(Path('today.mp4'), self.shot, self.info)

    def test_exact_duration_clip_is_accepted(self):
        self.assertEqual(film.validate_clip(Path('today.mp4'), self.shot, self.info)['requiredThroughSeconds'], 6)

    def test_seek_and_rate_consume_source_time(self):
        shot = self.shot | {'sourceStart': 1, 'playbackRate': 1.5}
        with self.assertRaisesRegex(ValueError, 'needs 10.000s'):
            film.validate_clip(Path('today.mp4'), shot, self.info)

    def test_webm_video_tag_beats_longer_audio_container(self):
        info = {'format': {'format_name': 'matroska,webm', 'duration': '20'}, 'streams': [
            {'codec_type': 'video', 'codec_name': 'vp9', 'tags': {'DURATION': '00:00:05.000000000'}}]}
        with self.assertRaisesRegex(ValueError, 'only 5.000s'):
            film.validate_clip(Path('today.webm'), self.shot | {'file': 'today.webm'}, info)

    def test_image_renamed_as_mp4_is_rejected(self):
        self.info['streams'][0]['codec_name'] = 'mjpeg'
        with self.assertRaisesRegex(ValueError, 'not an image'):
            film.validate_clip(Path('today.mp4'), self.shot, self.info)

    def test_one_frame_movie_is_rejected(self):
        self.info['streams'][0]['nb_frames'] = '1'
        with self.assertRaisesRegex(ValueError, 'one-frame'):
            film.validate_clip(Path('today.mp4'), self.shot, self.info)

    def test_invalid_shot_contracts(self):
        for override in [{'file': 'today.png'}, {'file': '../today.mp4'}, {'sourceStart': -1},
                         {'sourceStart': float('nan')}, {'duration': .01}, {'duration': 0},
                         {'playbackRate': 1.51}, {'playbackRate': float('inf')}, {'playbackRate': True}]:
            with self.subTest(override=override), self.assertRaises(ValueError):
                film.validate_shot(self.shot | override)

    def test_renderer_seeks_and_trims_without_still_padding(self):
        with patch.object(film, 'ffmpeg') as encoder, patch.object(film, 'probe', return_value=self.info):
            film.render_video_shot(Path('today.mp4'), self.shot | {'sourceStart': 2, 'playbackRate': 1.5}, 'scale=1920:1080', Path('out.mp4'))
        args = encoder.call_args.args
        self.assertEqual(args[:2], ('-ss', 2))
        vf = args[args.index('-vf') + 1]
        self.assertIn('trim=duration=9.0,setpts=(PTS-STARTPTS)/1.5', vf)
        self.assertNotIn('tpad', vf)
        self.assertNotIn('-loop', args)

    def test_short_decode_fails_instead_of_freezing(self):
        self.info['streams'][0]['nb_frames'] = '179'
        with patch.object(film, 'ffmpeg'), patch.object(film, 'probe', return_value=self.info):
            with self.assertRaisesRegex(ValueError, 'too short'):
                film.render_video_shot(Path('today.mp4'), self.shot, 'scale=1920:1080', Path('out.mp4'))

    def test_visual_changes_keep_audio_but_script_changes_do_not(self):
        story = json.loads((film.ROOT / 'docs/media/quoteplate-product-film-164.json').read_text())
        changed = copy.deepcopy(story)
        changed['scenes'][1]['shots'][0].update(file='alternate.webm', sourceStart=2, playbackRate=1.25)
        self.assertEqual(film.audio_fingerprint(story), film.audio_fingerprint(changed))
        changed['scenes'][1]['phrases'][0] = 'Different speech.'
        self.assertNotEqual(film.audio_fingerprint(story), film.audio_fingerprint(changed))

    def test_checked_in_timeline_is_165_seconds_and_motion_only(self):
        story = film.load_story(film.ROOT / 'docs/media/quoteplate-product-film-164.json')
        self.assertEqual(sum(s['duration'] for s in story['scenes']), 165)
        self.assertTrue(all(s.get('shots') and 'sourceStart' not in s for s in story['scenes']))
        self.assertTrue(all(shot['file'].endswith('.mp4') for s in story['scenes'] for shot in s.get('shots', [])))


if __name__ == '__main__':
    unittest.main()
