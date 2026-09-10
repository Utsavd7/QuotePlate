# QuotePlate first-purchase film (165 seconds)

`docs/media/quoteplate-product-film-164.json` is the edit contract: **11 scenes,
13 application clips plus 2 branded kitchen clips, 165 seconds / 4,950 frames**, **3840×2400
(16:10), 30fps**, exported as H.264/AAC with fast-start. The earlier kitchen
opening and closing are restored from the original 3840×2160 stock footage,
cropped to fill the film with new graphics at the output resolution. Application
desktop recordings remain native 3840×2400. The phone recording is native
1560×2400 and is placed without scaling on the 3840×2400 canvas. The menu-options
clip demonstrates all four entry choices; the rest follows the first purchase.
The storyboard filename retains its historical `164` suffix.

The story follows one fictional Monsoon Table restaurant and the same purchase:
restaurant setup, menu approval, two suppliers, one request, their replies,
comparison, supplier selection, delivery and credit follow-up. The live public
approved-pilot Google entry is filmed as form filling only. Authentication happens
off camera into an isolated local workspace; filming does not create production
records or change production authorization.

## Restore the kitchen opening and closing

`brand_bookends.py` renders the earlier cream badge and headline treatment over
the original licensed 3840×2160 kitchen clip. It requires at least eight seconds
of source motion, crops to fill 16:10, and draws graphics at 3840×2400. It exports
a six-second intro and eight-second ending; the storyboard uses the first five
seconds of the intro. No borders or frozen background frames are added.

```sh
python3 scripts/media/brand_bookends.py \
  --source /path/to/licensed/kitchen-4k.mp4 \
  --output /tmp/quoteplate-menu-revision/captures
```

The helper needs Pillow, repository-local Sharp, Node.js and FFmpeg. Georgia and
Arial are the macOS defaults; provide `--serif` and `--sans` font paths elsewhere.
Its manifest records source/output hashes and full-decode checks. Keep the
original stock licence and source provenance with the archived film.

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
| kitchen-intro.mp4 | 5 | Restored kitchen opening and brand message. |
| first-restaurant.mp4 | 12 | Fill fictional restaurant and delivery details. |
| first-owner.mp4 | 9 | Fill fictional owner details; show Google entry. |
| first-workspace.mp4 | 3 | Show the new restaurant’s Today workspace. |
| menu-options.mp4 | 10 | Type/paste, camera on a phone, photo upload and permitted website link. |
| first-menu.mp4 | 18 | Add a dish, review ingredients and approve the menu. |
| first-suppliers.mp4 | 14 | Add the two example suppliers. |
| first-request.mp4 | 22 | Create, check and open the same purchase request. |
| vendor-phone.mp4 | 19 | Supplier selects a printed price list, reviews local OCR matches, fills prices, uses the item guide and sends the quote. |
| completion-comparison.mp4 | 10 | Compare complete offers. |
| completion-award.mp4 | 10 | Select the supplier and confirm. |
| completion-delivery.mp4 | 12 | Check received quantities and invoice. |
| completion-credit.mp4 | 8 | Record the missing quantity and credit owed. |
| completion-today.mp4 | 5 | Review the purchase and delivery follow-up on Today. |
| kitchen-end.mp4 | 8 | Restored kitchen closing with the first-purchase address. |

### Timing and validation

Each storyboard shot names its actual plain `.mp4` or `.webm` filename, `duration`,
`sourceStart` and optional `playbackRate`. Durations must contain whole 1/30-second
frames; offsets must be non-negative. Required source coverage is
`sourceStart + duration * playbackRate`. Renderer rates are 1–1.5. Restaurant details use 14/12 and suppliers use
16/14 to fit the edit; other clips use rate 1. Avoid repeated acceleration of
already condensed footage. Actions
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
refers to the individual application or rebuilt kitchen clips. Use locally generated
Kokoro `af_heart` narration, measured optional caption cues and the existing
licensed music bed. Only changed narration is regenerated; unchanged scenes retain
their hash-verified first-purchase audio.
Do not remux a whole previous film’s audio into this changed timeline.
Rerunning `audio` may use its hash-verified cache of this new narration.
No paid service, new model download or media purchase is needed.

Run `render` only after the complete capture handoff. `check` probes native capture
resolution, duration and narration hashes. Rendering checks each encoded shot's
frame count, rejects captures changed during encoding, fully decodes the final
export and verifies its resolution and 4,950-frame count. Contract regressions can
run without a server, login or render:

```sh
python3 -B scripts/media/test_product_film.py
```

## Final review and handoff

The 10 September 2026 phone refresh retains all fourteen non-reply source clips,
including the restaurant screens refreshed on 9 September. A 19-second phone
sequence replaces the two earlier supplier replies at 01:33–01:52. It uses the
real local app and bundled OCR with a printed-text fixture, followed by review
and an actual local quote submission. It demonstrates choosing an image, not
operating a physical camera. The second supplier's offer remains in comparison.
Only the phone narration changes; ten other narration WAVs retain their hashes.
Later optional captions shift one second and remain off by default in the player.
See [the phone refresh notes](../../docs/media/quoteplate-vendor-phone-refresh.md)
for composition and capture details.

The local recording recreates the same fictional purchase in an independent
ordinary tenant without resetting shared fixtures. Today exposes the action
link `Check delivery for First lunch purchase` inside its attention row; the
purchase title itself is not a link. Capture checks must use that action or row.

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
