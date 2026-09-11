# QuotePlate local film pipeline

The current public film includes six completed workflow pickups and 22 unchanged
clips, including Google-only signup and the licensed kitchen bookends. Parent
image review and finalizer checks passed before public copy. See
[workflow pickup handoff](../../docs/media/quoteplate-workflow-pickups.md) for the
current artifacts, provenance, checks and final hash. The signup-only account
below documents the preserved previous edition.

The production Google-only signup pickup is complete. Both replacement clips
were visually reviewed and checked for an enabled Google control, no password
field and no email-based workspace creation control. The corrected final render, contact-sheet review and full publication checks
passed. The matching public bundle is copied and the release hold is cleared.

The current edition has **18 scenes, 26 application clips and two unchanged
kitchen bookends, 165 seconds / 4,950 frames, 3840×2400 at 30 fps**. All storyboard
playback rates are 1. The corrected final render passed full decode, native
resolution, frame count, audio peak (−4.9 dBFS), source and bundle hash checks.
The replacement also verifies production-signup correctness from actual UI.

See [current timeline, provenance and handoff](../../docs/media/quoteplate-gap-film.md)
and `docs/media/quoteplate-gap-film-165.json`. Work and preserved raw footage are
in `/tmp/quoteplate-gap-film`. The historical published storyboard filename keeps
its `164` suffix. The release status in the published verification is authoritative.

The existing local FFmpeg, Playwright and Kokoro pipeline uses no paid services.
Browser-free preparation uses:

```sh
node scripts/media/feature_overview_capture.mjs --gap-update
```

The full journey recorder requires `--capture-after-ui-validation` and the
parent's recorded build validation. **Do not rerun the full journey for the signup
correction.** Preserve the other 26 clips and audio. A future signup pickup must
use the actual production-mode form, record fictional form entry and Google
hover only, and assert password and email-based creation controls are absent.
No DOM replacements, authentication submissions or database writes are needed.

```sh
node scripts/media/pickup_google_signup.mjs --capture-production-signup
```

This dedicated recorder allows only read requests to port 52561, archives the
replaced footage and evidence, and verifies all other capture/audio hashes before
updating the checkpoint. The normal journey origin stays on port 52560.

After any approved replacement, review the actual clips and rendered contact
sheet, regenerate hash-bound review evidence and run the existing finalizer:

```sh
python3 scripts/media/finalize_feature_film.py --work /tmp/quoteplate-gap-film
# Only after corrected production signup and complete review pass:
python3 scripts/media/finalize_feature_film.py --work /tmp/quoteplate-gap-film --copy-public
```

The finalizer copies MP4, JPG, separate VTT, transcript and credits together with
the matching storyboard and verification. Captions remain optional and are not
burned into frames. Parent owns player checks and release; media work does not
start servers, reset shared databases, send supplier messages or commit changes.

Browser-free regression checks:

```sh
node --test scripts/media/test_capture_checkpoint.mjs
python3 -B scripts/media/test_product_film.py
```

## Capture and review mechanics

Desktop recording uses a physical 3840×2400 viewport with native Chromium zoom
8/3 to preserve the 1440×900 CSS layout. The phone is recorded at 1560×2400 and
composited without upscaling. The visible cursor reflects actual form actions.
No screenshot substitutes, freeze padding or fabricated public contacts/results
are permitted. Raw intervals and playback rates must combine to no more than
1.5× action compression. The current maximum is 1.000397×.

Raw recording trim starts at each shot's measured start, with zero leading
offset. Recorder tail time must not be added to the start. A short guard after
each action prevents the following scene's preparation from entering its export.
Every exported clip must contain exactly duration × 30 frames.

Keep authentication and private supplier links in memory. Temporary profiles are
removed after capture. Retained clips and narration are accepted only by hash;
changed narration is generated with the existing local Kokoro model and voice.
Keep the original licensed kitchen and music provenance with the work archive.

Review combines opening/middle/end frames, action assertions, raw intervals,
visible values and the final contact sheet. Narration/caption cues, decoded audio,
source hashes and audio peaks are checked separately. The review record describes
what was actually inspected; generating samples alone is not visual approval.

For earlier editions, see the
[feature overview](../../docs/media/quoteplate-feature-overview.md) and
[phone refresh](../../docs/media/quoteplate-vendor-phone-refresh.md).
