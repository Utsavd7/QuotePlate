# QuotePlate motion product film (164 seconds)

`docs/media/quoteplate-product-film-164.json` is the edit contract.
`product_film.py` accepts **real application video recordings only** for application
shots. No image-loop, repeated-clip or freeze-frame fallback exists. Every clip is
probed before rendering and its encoded frame count is checked afterwards.

## Capture contract

Place finalized clips in `/tmp/quoteplate-motion-tour/captures`:

```json
{"file":"today.mp4","duration":6,"sourceStart":0,"playbackRate":1}
```

- `file`: plain `.mp4` or `.webm` filename. The storyboard must name the actual
  extension; there is no automatic filename substitution.
- `duration`: final on-screen seconds, in whole 1/30-second frames.
- `sourceStart`: seek offset into this clip, in seconds, at least zero.
- `playbackRate`: optional, defaults to **1**, bounded to **1–1.5**. Already condensed
  clips should specify 1. The capture helper must also keep any condensation at or
  below 1.5x; do not accelerate an already accelerated clip again. Capture editing
  may uniformly slow genuine recorded motion down to 0.85x to remove a contaminated
  ending and retain the requested duration. The exported storyboard rate stays 1.
  This capture-editing range is separate from renderer `playbackRate` validation.
- Required source coverage: `sourceStart + duration * playbackRate`. An exact 6s
  clip is valid for a 6s slot at 1x. Record a small tail when practical. Short input
  or short decoding fails; the renderer does not manufacture a hold to fill it.
- The capture itself should contain meaningful real clicks, typing, navigation,
  scrolling and time to read the resulting state. Recorded result holds are fine.
  Merely wrapping a screenshot in an MP4 is not an interactive demonstration;
  codec and duration checks do not replace human motion review.

Use 1440×900 / 30fps recordings. The renderer scales the complete app to a
1920×1200 (16:10) frame, without margins, a title strip, or cropping application
controls. Opening/closing `pictureCrop` coordinates remove their old title strip
while retaining the logo, main copy and closing disclosure. Browser audio is discarded;
only approved narration/music are used. Capture a separate fictional workspace.
No browser chrome, login/password entry, private invitation URLs, credentials or
internal-account notices should appear in the selected source interval. Preparation
frames must be outside it. Do not alter production authorization for filming.

The current timeline expects these **25 named application clips** (154s), plus the
retained 5s kitchen opening and 5s closing. Extra captured files are ignored.

| Filename | Output duration | Real action to record |
| --- | --- | --- |
| today.mp4 | 6s | Navigate Today and point out the five primary sections. |
| menu-input.mp4 | 5s | Click Add menu and explore the photo/text/website choices. |
| menu-review.mp4 | 7s | Review ingredient rows/units and the approval control. |
| nearby-search.mp4 | 6s | Enter the real area, select category/distance and run search. |
| nearby-results.mp4 | 14s | Scroll genuine returned listings and inspect a result. |
| new-purchase.mp4 | 6s | Type the purchase draft name, select ingredients and quantities. |
| vendor-quote.mp4 | 5s | Enter supplier quantities, prices and delivery terms. |
| vendor-review.mp4 | 5s | Review delivery and total, then click Send quote. |
| comparison.mp4 | 7s | Inspect competing offers and complete costs. |
| award.mp4 | 6s | Select supplier allocations, enter rationale and confirm the decision. |
| receiving.mp4 | 9s | Enter received/rejected and billed quantities/rates. |
| credits.mp4 | 8s | Enter claimed/received credit and a settlement reference. |
| supplier-orders.mp4 | 8s | Open the supplier’s own order and inspect its contents. |
| supplier-delivery-record.mp4 | 5s | Scroll/read delivery quantities and credit fields. |
| supplier-response.mp4 | 5s | Choose a response, type a reference, then save it. |
| plan-input.mp4 | 6s | Select dishes and enter portions. |
| plan-stock.mp4 | 6s | Enter usable stock, yield and confirmed arrivals. |
| plan-shortage.mp4 | 6s | Review calculated shortages and the purchase-draft action. |
| demand-select.mp4 | 8s | Choose specific ingredients and share their estimates. |
| demand-shared.mp4 | 8s | Inspect the saved estimate and its withdrawal control. |
| trading.mp4 | 6s | Edit/inspect wholesale terms, served PINs and lead time. |
| reuse-before.mp4 | 3s | Inspect matching historical rates and choose reuse. |
| reuse-after.mp4 | 3s | Review populated prices and editable current terms. |
| delivery-record.mp4 | 3s | Navigate recorded deliveries and outstanding credits. |
| delivery-cost.mp4 | 3s | Expand ingredient costs and inspect billed/accepted unit. |

Purchase creation is a single-page draft within a guided overall process, not a
separate review wizard. Vendor review must show the total/delivery and Send quote.
Supplier response must show reference and Save controls at a readable scale.

Scene-level `sourceStart` retains approved kitchen picture/audio. Shot-level
`sourceStart` seeks within a fresh recording. `audioSourceStart` independently
retains approved nearby narration/cues while replacing its visuals with a real
search recording. These fields have different scopes. Only intro/closing retain
old pictures. The fresh nearby search must use authentic results; public listings
do not guarantee stock, supplier suitability or delivery coverage.

## Preserve approved audio without generating new speech

The motion work directory has a verified copy of the previous 14 audio WAVs and
unchanged VTT/transcript. Visual-only changes to clip paths, offsets, rates and shot
cuts preserve the audio fingerprint. Changing narration, scene timing, or retained
audio sources invalidates it. The old work directory is not modified.

To repeat the verified copy in another work directory, retain the prior storyboard
whose hash matches that approved cache and run:

```sh
/tmp/quoteplate-video-update/venv/bin/python scripts/media/product_film.py reuse-audio \
  --work /tmp/quoteplate-motion-tour \
  --source-film /tmp/quoteplate-video-update/final.mp4 \
  --audio-from /tmp/quoteplate-tour-refresh \
  --previous-storyboard /tmp/quoteplate-motion-tour/previous-storyboard.json
```

This does not invoke TTS or encode video. It checks the prior storyboard, source
film and every audio hash, compares audio content/timing between storyboards, and
refuses to overwrite different narration. New narration can still be explicitly
created with `audio --model PATH --voices PATH`, using the existing local Kokoro
ONNX runtime. That is unnecessary for this motion refresh.

## Check, then render after the capture handoff

```sh
/tmp/quoteplate-video-update/venv/bin/python scripts/media/product_film.py check \
  --work /tmp/quoteplate-motion-tour \
  --source-film /tmp/quoteplate-video-update/final.mp4 \
  --music /Users/utsavdoshi/.codex/visualizations/2026/09/05/01a0700f-d89a-7b82-80a7-506642259419/video-landing-two-minute/assets/relax-beat-arulo.mp3
```

After the parent confirms that recordings are complete, use `render` with the same
arguments. No paid service, model download, application login, database or browser
profile is accessed. Python 3.11+, FFmpeg and FFprobe are required for rendering;
the local venv also contains the optional Kokoro dependencies. `--captures`,
`--storyboard` and `--font` override the defaults.

Output is **164 seconds / 4,920 frames**, H.264/AAC, 1920×1200, 30fps with fast-start.
Captures changing during encoding fail verification. The final export is fully
decoded and frame-count checked. `verification.json` records input hashes, shot
intervals and playback rates. A contact sheet samples every shot, but a human must
also watch motion and action timing; a contact sheet cannot verify interactivity.

Outputs remain in the work directory: film, poster, VTT, transcript, credits,
contact sheet and verification. Public files are not overwritten by the renderer.
Parent coordinates review and copying a matching bundle into `public/media`.

Run contract regressions without rendering or starting an application:

```sh
python3 -B scripts/media/test_product_film.py
```

Source recordings and narration are external assets. Preserve the motion work
folder when archiving the production sources; the checked-in script and storyboard
alone do not contain those recordings. `scripts/media/motion_capture.mjs` preserves the parent's generic Playwright
recorder helper. It records a visible pointer, clicks and typing, trims preparation
frames, and exports bounded-speed MP4s to this motion work directory. Its callers
supply the application actions; no session cookies, tokens or login scripts are
archived with the helper.

Capture timing uses one monotonic `performance.now()` origin immediately after
`context.newPage()`. Trim each raw recording at its recorded `shot.start`, with
offset zero. `rawDuration - ended` is a recorder tail diagnostic, **not** a leading
offset; adding it drops initial actions and leaks the next scene into the ending.
Verify the raw opening frames against the first shot when changing recorder/browser
versions. Existing manifests created with the old tail-derived offset need retrimming
from their raw recordings, including planning/demand captures made with that helper.

Before render, inspect opening, middle and final frames for actual interaction and
scene boundaries. Sample hashes can flag wholly repeated frames but cannot prove
meaningful clicks or readable results. Check every exported clip has exactly
`duration * 30` frames and sufficient video duration; a 179-frame export fails a
six-second slot. Correct the source trim/export rather than freezing, padding or
weakening renderer validation. Keep the full supplier review total and Send action
readable before submission. Render only after the corrected capture handoff.

After each measured clip ends, the helper waits 0.5s with the result untouched
before returning control to the caller. This guard is outside `shot.elapsed` and
is not an encoded freeze: it prevents next-scene preparation from leaking through
browser capture latency. Apply the same guard to vendor and planning recorders.
For existing contaminated clips, remove the contaminated trailing interval from
the actual recording and uniformly retime the remaining motion to the exact slot
(at least 0.85x). Verify the resulting first/last frames and exact frame count; do
not generate padding or repeat a still to fill the slot.

For a visual-only release, retain the previous public film as `approved-film.mp4`
in the new work directory before rendering. Preserve its exact approved AAC audio
packets when finalizing (no narration regeneration or audio re-encoding):

```sh
ffmpeg -i /tmp/quoteplate-borderless-film/quoteplate-product-film.mp4 \
  -i /tmp/quoteplate-borderless-film/approved-film.mp4 \
  -map 0:v:0 -map 1:a:0 -c copy -movflags +faststart \
  /tmp/quoteplate-borderless-film/final.mp4
```

Fully decode the final file, compare audio packet hashes with the approved film,
and refresh the published verification/output hash after remuxing. The player
uses the same 16:10 ratio and has no decorative frame or rounded clipping.
