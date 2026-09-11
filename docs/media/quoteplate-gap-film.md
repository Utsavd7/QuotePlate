# Final procurement update — 165-second local film

New workflow pickup preparation is tracked in
[quoteplate-workflow-pickups.md](quoteplate-workflow-pickups.md). That revision has
six new pickups after parent UI validation and a completed parent-approved public
copy. See that handoff for the current film/hash. The completed status below
describes the preserved previous film only.

Status: **complete — corrected bundle verified and copied to public media.**
The two signup clips were replaced with actual production-mode
Google-only UI on port 52561. Visual review and browser assertions passed:
Google enabled, no password field, no email-based creation control, no form
submission or write request. The corrected full render, final contact-sheet
review, decode, frame/audio/source-hash checks and matching public copy all
passed. The release hold is cleared; media scripts lint and all 15 media
regression checks passed. Parent reports all 12 player checks covered.

Only the two requested signup clips changed; the other 26 clips and all 18
narration WAVs retain their hashes. Replaced clips and original evidence are
archived under `/tmp/quoteplate-gap-film/production-signup-751b8f52/replaced`.

The film was captured and rendered after the parent's explicit UI validation.
The local film is exactly 165 seconds / 4,950 frames at native 3840×2400. All 28
source review strips and the final contact sheet were inspected; the parent also
reviewed shopping, invoice and website strips, both corrected signup strips,
and the corrected final contact sheet. Mixed audio peaks at −4.9 dBFS.
No server was started/restarted by media work and no database was reset.

The final assets and technical verification are in `/tmp/quoteplate-gap-film`.
The corrected signup strips and rendered contact sheet passed visual review. The finalizer requires actual production-form evidence,
unchanged remaining clip/audio hashes and a newly reviewed final output.
`contact-sheet.jpg` samples every rendered shot. Its history midpoint shows a
real loading transition; the opening and ending source frames show Repeat order
and the new draft. Review combines frame inspection, real action assertions and
measured source intervals; it is not a claim of uninterrupted human playback.
Audio review checks narration/cues against the actions, duration, hashes, decoded
sound and peak, without claiming an uninterrupted human listening session.

Preparation completed: all 18 narration WAVs total exactly 165 seconds; 12 were
generated locally and six reused by matching hash. Every cue fits its scene and
all WAV peaks remain below clipping. The website-unavailable narration variant
is also ready. Evidence is `/tmp/quoteplate-gap-film/audio-preflight.json`; a
speech-only preview is `/tmp/quoteplate-gap-film/narration-preview.m4a`. These
preparation checks are supplemented by the completed finalizer pass. The 15
existing media contract checks and the storyboard structural checks pass.

The edit contract is `quoteplate-gap-film-165.json`: **165 seconds, 4,950 frames,
3840×2400, 30 fps**, 26 application clips plus the same two licensed kitchen
bookends. The matching public bundle and historical `quoteplate-product-film-164.json`
filename are updated only by the finalizer after review and full verification.

The live website lookup returned a published sales email from Shubham Trading
Company's contact page, with source and check time; the contact was explicitly
applied and saved only to a local capture tenant. Nearby discovery returned HTTP
200 and five actual public leads. Both OCR helpers and the phone quote used the
real bundled reader. Maximum measured action compression was 1.000397×; all
storyboard playback rates are 1. Two selector interruptions retained nine verified
clips, and their original raw footage/provenance was preserved.

| Start | Duration | Recorded action / narration intent |
| --- | ---: | --- |
| 0:00 | 5 s | Same kitchen opening, unchanged source hash. |
| 0:05 | 6 s | Fresh restaurant name and delivery-address entry. |
| 0:11 | 6 s | Fresh owner entry and enabled Google control (4 s), then Today (2 s). No pilot label or authentication recorded. |
| 0:17 | 18 s | All four menu entry choices (7 s); dish, ingredients and approval (11 s). |
| 0:35 | 7 s | Paste, review and import the two fictional supplier contacts. |
| 0:42 | 10 s | Enter an actual supplier website and click Check website (3 s); review published source, use a contact and explicitly save locally (7 s), or show the real unavailable state. |
| 0:52 | 17 s | Choose a shopping-list photo and start local reading (4 s); review recognized text, check the row and apply it (4 s); save the purchase with no menu selected (9 s). |
| 1:09 | 6 s | Create private quote links; show WhatsApp and Email, click Copy. No external send. |
| 1:15 | 19 s | Same native phone composition: price-list photo, actual OCR, matched rate review, guided entry, total and local quote submission. |
| 1:34 | 12 s | Compare ₹400/₹440 offers (6 s), choose and confirm the supplier (6 s). |
| 1:46 | 18 s | Choose an invoice photo and start reading (4 s); review and apply billed quantity/rate (5 s); manually enter physical receipt and invoice total (4 s); save missing quantity and ₹40 credit (5 s). |
| 2:04 | 3 s | Today delivery follow-up. |
| 2:07 | 11 s | Private workspace sharing (3 s), supplier business and delivery confirmation, then orders (8 s). |
| 2:18 | 4 s | Nearby public listings or the actual unavailable/controls state. |
| 2:22 | 5 s | Meal portions, usable stock and six-kilogram shortage. |
| 2:27 | 5 s | Price reports and delivery/credit performance. |
| 2:32 | 5 s | Purchase history and Repeat order into a new draft. |
| 2:37 | 8 s | Same kitchen closing, unchanged source hash. |

The two OCR sequences and website lookup have separate source and review clips.
Their actual reading/network wait can be removed between clips without speeding
actions beyond 1.5×. No loading-speed claim, screenshot substitutes or freeze
padding. Pasted-text alternatives remain visible. Invoice assistance fills only
billed quantities and unit rates; physical receipts, total and credits stay manual.

## Capture conditions

- Parent validation of the final local build was received. Shopping-list,
  invoice, website and all other journey captures completed. Production signup
  replacement also completed on the separately approved server at port 52561.
- `/start` must show an enabled **Continue with Google** control and no old pilot
  restriction. Filming only enters fictional form details and hovers the control;
  it never submits signup or follows Google. A separate ordinary local tenant is
  created through the normal local signup/signin flow, with random credentials
  kept in memory. No internal demo seed or banner.
- Actual public supplier candidate: [Shubham Trading Company's contact page](https://www.shubhamtradingco.in/contact),
  inspected during preparation on 11 September 2026 and successfully checked by
  the application during capture. No response is fabricated, and provider
  availability is not assumed. The contact is saved only to the isolated local
  tenant and excluded from the fictional quote grants. Its appearance implies
  neither an endorsement nor an existing restaurant relationship.
- Existing local FFmpeg/FFprobe, Playwright, Sharp and Kokoro are available. Assets
  are staged in `/tmp/quoteplate-gap-film`; prior artifacts in
  `/tmp/quoteplate-feature-overview-film` remain untouched. No paid services or
  new model downloads.

## Preparation and guarded recording

```sh
node scripts/media/feature_overview_capture.mjs --gap-update
```

This browser-free command validates the 165-second contract, checks and copies
the approved kitchen hashes, stages the existing narration cache, makes two
fictional printed OCR fixtures and snapshots application source hashes. It writes
`capture-plan.json`, `planned-storyboard.json`, `reuse-manifest.json` and
`ui-source-hashes.json`. It does not claim capture or review completion.

After the parent sends the barrier message, the media worker records the exact
message in `/tmp/quoteplate-gap-film/parent-ui-validation.json`, with `status`
equal to `local final UI validated`, `origin` equal to the harness origin,
`parentMessage` containing the actual message, and `uiSourceManifestSha256`
matching the validated source snapshot. This records the existing approval; it is
not a second approval request. Refresh preparation against the parent's validated
tree before recording that acknowledgement. The recorder rejects changed source
hashes and absent acknowledgement. A fresh run refuses to overwrite app captures.

```sh
node scripts/media/feature_overview_capture.mjs --gap-update --capture-after-ui-validation
```

After a selector interruption, `--resume-gap` retains only checkpoint-verified
exports and their original raw intervals/hashes. It recreates the same fictional
purchase through normal actions in a fresh local tenant without exporting those
completed clips again. Completed shots are exported on recovery; the failing
shot is not marked complete. Recording manifests use unique run identifiers.
Earlier raw recordings and the original approved feature-overview film are preserved.

The production signup pickup uses its own recorder and allows only read requests
to the parent-owned production-mode origin `http://127.0.0.1:52561`. It records
fictional fields and Google hover without authentication, then archives/replaces
only the two signup clips. The main journey remains on port 52560. The finalizer
checks production-form assertions and unchanged remaining clip/narration hashes.

```sh
node scripts/media/pickup_google_signup.mjs --capture-production-signup
```

Fresh clips render at playback rate 1. Their raw recording intervals and hashes
record actual action compression; the finalizer checks that a second acceleration
does not exceed 1.5×. Sessions and private supplier links remain in memory. The
existing privacy mask protects private-link text before raw recording.

## Local narration and render

The installed model and voices match the previous narration cache by SHA-256.
Generate speech while waiting for UI validation:

```sh
/tmp/quoteplate-video-update/venv/bin/python -B scripts/media/product_film.py audio \
  --work /tmp/quoteplate-gap-film \
  --storyboard docs/media/quoteplate-gap-film-165.json \
  --source-film /tmp/quoteplate-borderless-film/final.mp4 \
  --model /tmp/quoteplate-video-update/audio/kokoro-v1.0.int8.onnx \
  --voices /tmp/quoteplate-video-update/audio/voices-v1.0.bin
```

Unchanged scene audio is reused only when phrases, timing, duration, model, voice
and WAV hash all match. A website-unavailable narration variant is prepared
separately. After capture, use the **staged `storyboard.json`** for audio/check/render:
it reflects the actual website outcome. The historical source film remains a
hashed CLI input; its picture and mixed soundtrack are not inserted into this edit.

Use the existing licensed `relax-beat-arulo.mp3` under the current visualization
workspace as `--music`. Render only when all application captures pass review.
Do not reuse a previous whole-film soundtrack against the revised timeline.

## Final review and publication

Run `review_feature_captures.py` for every shot, including retained bookends.
Inspect opening, middle and end frames, plus OCR/review/apply/save action frames.
Review actual motion and continuity, then the rendered contact sheet and audio.
Do not mark reviews passed from sample generation alone.

The finalizer retains the full native/frame/audio/source-hash checks and verifies
the raw intervals' combined action compression. The gap edition also requires:

- `visual-review.json` tied to the final MP4 and contact-sheet hashes, with actual
  motion/continuity and audio review results;
- signup, shopping-list-without-menu and invoice-billing assertions from capture;
- actual website/nearby evidence and narration matching an unavailable response;
- separate VTT, captions off by default and no burned captions, verified with the
  parent-owned player checks; cleaned browser profiles.

```sh
python3 scripts/media/finalize_feature_film.py --work /tmp/quoteplate-gap-film
# Only after source, contact-sheet, audio and player review:
python3 scripts/media/finalize_feature_film.py --work /tmp/quoteplate-gap-film --copy-public
```

Publish the matching MP4/JPG/VTT/TXT/credits bundle together. The historical
published storyboard and verification files update only in that final copy step.
Media ownership is limited to `scripts/media`, `docs/media` and `public/media`.
No application changes, main README changes, branch switches or commits.

Final corrected MP4 SHA-256:
`03a82e26ef8f7ac07ba7fa575b14bbc30b50c8695249a6d8914ed22bef29abda`.
Final copy log: `/tmp/quoteplate-gap-film/google-finalize.log`.
The published verification contains `releaseStatus: passed` and the matching
MP4/JPG/VTT/TXT/credits hashes. No commit or branch change was made by media work.
