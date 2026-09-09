# QuotePlate first-purchase film (164 seconds)

`docs/media/quoteplate-product-film-164.json` is the edit contract: **11 scenes,
15 fresh application clips, 164 seconds / 4,920 frames**, native **3840×2400
(16:10), 30fps**, exported as H.264/AAC with fast-start. No kitchen footage,
discovery footage or audio from an earlier film is used.

The story follows one fictional Monsoon Table restaurant and the same purchase:
restaurant setup, menu approval, two suppliers, one request, their replies,
comparison, supplier selection, delivery and credit follow-up. The live public
approved-pilot Google entry is filmed as form filling only. Authentication happens
off camera into an isolated local workspace; filming does not create production
records or change production authorization.

## Record the clips

Use `scripts/media/motion_capture.mjs`, which exports
`recorder(browser, label, options)`. It returns `page`, `context`,
`clip(name, duration, async ({page, click, type, move, pause}) => { ... })` and
`finish()` / `abort()`. Callers supply the real application actions and in-memory session
handoff; the helper launches its own temporary persistent Chromium context.
Prepare each scene outside `clip`, use the visible pointer helpers inside it,
and call `finish()` to close the recorder and export the clips.

The default work directory is `/tmp/quoteplate-first-purchase`; override it with
`QUOTEPLATE_FILM_WORK`. Captures go in `captures/`, original recordings in `raw/`,
and measured shot timings in `<label>-recording.json`.

- Physical recording viewport: **3840×2400**, device scale factor 1. Native Chrome
  zoom **8/3** preserves the **1440×900 CSS laptop layout**. The helper checks CSS
  dimensions, pixel ratio and loaded fonts before each shot. Device scale factor
  alone is insufficient; do not upscale a smaller recording.
- The helper changes only its process's Playwright VP8 capture settings to
  **24 Mbps** (`qmax=20`, four threads); it does not patch installed dependencies.
  Trimmed clips are encoded as H.264 at 30fps with browser audio discarded.
- Keep cookies and private supplier-link handoffs in memory. Do not archive session
  state, credentials, URLs, authentication scripts or browser profiles. The helper
  rejects a storage-state filename and deletes its temporary profile during
  `finish()` or `abort()`; clean up any profile left by an interrupted run before archiving.
- Keep authentication, private-link retrieval and scene preparation outside selected
  intervals. Record ordinary fictional local records, without internal demo-account
  promotion or banners. No browser chrome or secrets should appear in raw footage.

| Clip | Seconds | Visible action / result |
| --- | ---: | --- |
| first-start.mp4 | 6 | Public approved-pilot entry. |
| first-restaurant.mp4 | 14 | Fill fictional restaurant and delivery details. |
| first-owner.mp4 | 9 | Fill fictional owner details; show Google entry. |
| first-workspace.mp4 | 3 | Show the new restaurant’s Today workspace. |
| first-menu.mp4 | 18 | Add a dish, review ingredients and approve the menu. |
| first-suppliers.mp4 | 16 | Add the two example suppliers. |
| first-request.mp4 | 22 | Create, check and open the same purchase request. |
| vendor-reply-a.mp4 | 9 | First supplier enters, reviews and sends a quote. |
| vendor-reply-b.mp4 | 9 | Second supplier replies to the same request. |
| completion-comparison.mp4 | 10 | Compare complete offers. |
| completion-award.mp4 | 10 | Select the supplier and confirm. |
| completion-delivery.mp4 | 12 | Check received quantities and invoice. |
| completion-credit.mp4 | 8 | Record the missing quantity and credit owed. |
| completion-today.mp4 | 10 | Review the purchase and delivery follow-up on Today. |
| first-cta.mp4 | 8 | Show the first-purchase entry call to action. |

### Timing and validation

Each storyboard shot names its actual plain `.mp4` or `.webm` filename, `duration`,
`sourceStart` and optional `playbackRate`. Durations must contain whole 1/30-second
frames; offsets must be non-negative. Required source coverage is
`sourceStart + duration * playbackRate`. Renderer rates are 1–1.5; current finalized
clips all use rate 1. Do not accelerate an already condensed clip again. Actions
may be condensed up to 1.5x; this is not a promise of application loading speed.

Trim raw recordings at **`shot.start`, offset zero**. `rawDuration - ended` is a
recorder-tail diagnostic, not a leading offset. Adding it drops opening actions
and can leak the next scene. The helper waits 0.5s after each measured shot before
allowing preparation for the next scene. Exports read an extra 0.15s from that
real guard, normalize the first timestamp and cap the exact output frame count;
this avoids losing a frame at a source-frame boundary. No freeze-frame padding
is generated. Check raw opening frames after browser/recorder changes.

Inspect each clip's opening, middle and final frames. If browser latency leaves a
contaminated ending, retrim genuine source motion and uniformly retime it to the
slot (no slower than 0.85x), then verify again. Every finalized clip must contain
exactly `duration * 30` frames. Fix or recapture short inputs; never freeze, loop,
pad with screenshots or weaken validation. Recorded reading time is useful, but
an MP4 containing a still is not an interactive demonstration.

## Generate new narration, validate, render

Use Python 3.11+, local FFmpeg/FFprobe and the installed Kokoro ONNX dependencies.
Set `KOKORO_MODEL` and `KOKORO_VOICES` to the existing local model/voices files and
`FILM_MUSIC` to the existing licensed Relax Beat MP3. Use the local Python
interpreter containing those dependencies in the commands below.

```sh
python3 scripts/media/product_film.py audio \
  --work /tmp/quoteplate-first-purchase \
  --source-film /tmp/quoteplate-borderless-film/final.mp4 \
  --model "$KOKORO_MODEL" --voices "$KOKORO_VOICES"

python3 scripts/media/product_film.py check \
  --work /tmp/quoteplate-first-purchase \
  --source-film /tmp/quoteplate-borderless-film/final.mp4 \
  --music "$FILM_MUSIC"

python3 scripts/media/product_film.py render \
  --work /tmp/quoteplate-first-purchase \
  --source-film /tmp/quoteplate-borderless-film/final.mp4 \
  --music "$FILM_MUSIC"
```

`--source-film` remains required, probed and hashed for CLI/cache compatibility.
The current storyboard has no scene-level `sourceStart` or `audioSourceStart`:
**none of that file's picture or audio is reused**. Shot-level `sourceStart: 0`
refers only to the fresh clips. Use newly generated local Kokoro `af_heart`
narration, measured optional caption cues and the existing licensed music bed.
Do not use `reuse-audio` or remux the previous film's audio into this release.
Rerunning `audio` may use its hash-verified cache of this new narration.
No paid service, new model download or media purchase is needed.

Run `render` only after the complete capture handoff. `check` probes native capture
resolution, duration and narration hashes. Rendering checks each encoded shot's
frame count, rejects captures changed during encoding, fully decodes the final
export and verifies its resolution and 4,920-frame count. Contract regressions can
run without a server, login or render:

```sh
python3 -B scripts/media/test_product_film.py
```

## Final review and handoff

Watch the complete film with audio; inspect text legibility, actual actions, scene
boundaries, supplier review totals and Send controls, and continuity of the same
request through delivery. Check narration and captions against the visible values.
A contact sheet samples every shot but cannot establish motion or readable timing.

The work directory receives `quoteplate-product-film.mp4`, poster JPG, VTT,
transcript TXT, `credits.txt`, `contact-sheet.jpg` and `verification.json` with input
and output hashes and shot intervals. The renderer does not overwrite public
assets. Parent coordinates review and copying the matching bundle to `public/media`,
including player checks for subtitles, replay and an end CTA actually in view.
Archive only reviewed media, manifests and narration from the work directory;
exclude private authentication material and temporary profiles. The repository
contains the generic helper and edit contract, not the external captures or models.
