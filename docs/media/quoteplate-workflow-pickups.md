# Workflow pickups — 11 September 2026

Status: **complete — parent-approved candidate verified and copied to public media.**

The parent inspected the final contact sheet and selected source/phone strips,
then approved the exact candidate. Media inspected all six strips extracted from
the final MP4 and ran every finalizer check before copying. The MP4 did not change
after approval.

Current work: `/tmp/quoteplate-workflow-final-20260911-b`.
Earlier preparation remains in `/tmp/quoteplate-workflow-pickups-20260911`.
The parent explicitly supplied `local final UI validated` for the isolated
`http://127.0.0.1:52560` harness (gateway 52562), with final/frozen application
source and normal local email fixture signup. The exact parent message and
current source-manifest hash are in `workflow-parent-ui-validation.json`.
The parent reported 30/32 integrated tests passed initially, both mobile timing
failures passed isolated reruns without app changes, and 25/25 Chromium component
checks passed, including real bundled OCR. Media did not run global tests.

The approved public MP4 SHA-256 is
`ac5bdd58c450360b4fc7fb590e335f940191102125a8570158ebc6b6f92175b0`.
The previous MP4 (`03a82e26…29abda`) remains under `/tmp/quoteplate-gap-film`.
All 76 baseline hashes matched before public copy; afterward all 71 preserved
source/clip/narration/metadata files still match, and all five public bundle
files match the approved staged bundle.
The old final, raw recordings and all superseded phone candidates are preserved.
No server was restarted, database reset, production tenant used or message sent.

## Actual pickups

The film stays **165 seconds / 4,950 frames / 3840×2400 / 30 fps**. Six replacement
slots total 43 seconds. The other 22 clips are previous captures retained by
hash, including unchanged Google-only signup and both licensed kitchen bookends.

| Film interval | Clip | Actual recorded action |
| --- | --- | --- |
| 0:35–0:42 | supplier-contacts | Review pasted Amber/Copper contacts; inspect Amber's saved-contact warning; remove that row; save Copper only. Confirm exactly two fictional supplier records. This demonstrates reviewed removal, not automatic merging. |
| 0:52–0:56 | shopping-source | Choose the fictional Tomato 10 kg photo with no menu selected; show its source preview and start bundled local OCR. |
| 0:56–1:00 | shopping-review | Compare decoded photo/text; check Tomato / 10 / kg and add the reviewed row. The actual draft is subsequently saved locally with menuId null. |
| 1:15–1:34 | vendor-phone | Choose the real fictional price fixture; inspect photo and recognized ₹40 rate; apply it; show one unfinished quantity, jump to that field and enter 10; review ₹400 total; submit locally and show the sent confirmation. |
| 1:46–1:50 | invoice-source | Choose the fictional invoice; show its preview and run actual local OCR. |
| 1:50–1:55 | invoice-review | Compare photo/text; check and apply billed 10 kg at ₹40. Assert physical receipt, invoice total and credit fields are unchanged. |

The main five desktop clips and first phone attempt used a unique ordinary local
fixture tenant. The phone pacing corrections each used another unique fictional
tenant through the same authorized signup route; no prior tenant was overwritten.
Passwords, sessions and quote links stayed in memory. Private-link text is masked
before raw recording; authentication was unrecorded. The normal setup guide is
collapsed through its actual controls, with no content substitution.

The phone is native 1560×2400, placed at x=2280/y=0 on the unchanged 3840×2400
canvas without scaling. `phone-pacing-2` is the adopted source. The first phone
capture completed actions too quickly; source review rejected its pacing. The
first paced candidate improved timing; the adopted revision also holds the photo
and moves to the sent confirmation. Earlier clips/evidence remain under
`superseded-phone`, `phone-pacing-1` and the original raw paths.

The current account/bootstrap changes affect loading without changing the
visible shell. Settings' loading header has no shot in this film. Website and
nearby footage shows previously unsaved contacts and is retained unchanged.
No speed claim, new public lookup or extra Settings narration was added.

## Source and audio evidence

`capture-evidence.json` records the new intervals, hashes, assertions and the
historical provenance of retained clips. It preserves earlier parent/signup,
website, nearby, supplier-confirmation and kitchen evidence unchanged.
`workflow-provenance-preflight.json` records the bounded provenance check.
The legacy renderer field `freshCaptures` contains every timeline input; the
explicit workflow changed/retained lists distinguish six new clips from reuse.

`capture-review/` contains six FFmpeg source strips. They were visually inspected,
including the warning/removal, source-photo/review/application transitions and
invoice billing fields. `phone-pacing-2/phone-strip.jpg` and `phone-detail.jpg`
show additional phone action frames: source photo, matched rate, unfinished-item
focus, completion, total and sent confirmation. Review combines sampled source
frames, actual action assertions and measured intervals; it is not a claim of
uninterrupted human playback. Only FFmpeg performs image/video transforms.

Local Kokoro narration uses the already installed model/voice. Two WAVs changed;
the other 16 retain their old hashes. All 18 WAVs total exactly 165 seconds, cues
fit their scene boundaries, and no narration peak clips. `audio-preflight.json`
in the preparation directory records these measurements. No paid services,
new model downloads or image-generation service were used.

| Scene | Narration | Relative measured speech cues |
| --- | --- | --- |
| suppliers | Review saved-contact warnings. Remove duplicates, then add the remaining supplier. | 0.200–5.2344 s within 7 s |
| replies | Use a price-list photo or paste prices. Check the photo and matched rate. / Fill the quote, then jump to unfinished items. / Review delivery and the total, then send. | 0.200–4.6587 / 7.000–9.6638 / 12.000–14.2997 s within 19 s |

Supplier WAV SHA-256:
`810f7e2286cc7a34d5c4068d4559e8de4d8ea1bcb8592a5a0bdc2529270a1fbe`.
Phone WAV SHA-256:
`b154a4d39b7542c0b91c047e562813278d516e553d5d65a93063ba9bd4497400`.
Peaks are −2.41 and −5.43 dBFS. Audio review covers measured cues, source hashes,
waveform peaks and decode checks; no uninterrupted listening session is claimed.
VTT captions are separate and optional, not burned into the video.

## Integrated tools and checks

- `prepare_workflow_pickups.mjs`: browser-free exclusive preparation, baseline
  hashes and source snapshot; rejects remote origins and missing/stale approval.
- `capture_workflow_pickups.mjs`: complete guarded adapter using normal unique
  local signup, actual contact/intake actions, fixture quote and invoice state.
  It captures only the six slots and materializes the 22 retained clips by copy.
- `workflow_pickup_actions.mjs`: bounded actual UI actions, privacy masking,
  overwrite protection and native recorder factory.
- `pickup_workflow_phone.mjs`: separate phone pacing candidate in a fresh local
  tenant, without overwriting previous captures or publishing.
- `workflow_review_strips.mjs`: FFmpeg-only samples; generation never grants review.
- `workflow-credits.txt`: licensed source attribution and truthful mixed-provenance
  description, including six new clips and 22 unchanged clips.
- `finalize_feature_film.py`: explicit workflow branch verifies new approval,
  unchanged historical signup evidence, exact changed/retained sets, narration
  hashes, raw intervals/native dimensions, action compression ≤1.5× and review
  hashes. Existing gap-edition checks remain active.

The 15 existing media contract checks pass. New modules pass syntax/lint and
media diffs pass whitespace checks. Five additional mutation checks reject an
unchanged clip relabelled new, changed retained signup, unplanned narration,
missing unfinished-item evidence and mismatched approval origin. They mutate
in-memory test copies only. The approved public bundle was copied only after the final checks passed.

The first launch attempt failed at sandboxed Chromium startup before signup or
capture. The authorized recorder then ran with browser execution permission.
Both the failed attempt and successful capture directories are retained.

## Completed final verification and public copy

Render/check only the staged `storyboard.json` in the current work directory.
The finalizer verifies exact duration/frame count/native resolution, H.264/AAC,
full decode, audio peak, all source hashes, review/contact-sheet hashes and the
matching MP4/JPG/VTT/TXT/credits bundle. It reported a staged status before parent review. The original public bundle
remained unchanged throughout review. The final copied verification now reports
`releaseStatus: passed`.

```sh
python3 -B scripts/media/finalize_feature_film.py --work /tmp/quoteplate-workflow-final-20260911-b
```

Before `--copy-public`, the parent must review the actual output images.
`parent-output-review.json` must record that actual message, status
`approved for public copy`, and matching final MP4/contact-sheet SHA-256 values.
The actual parent approval is recorded in that file. Both approval hashes match
the unchanged final output. The finalizer checked it before public copy. Parent
retains player/global tests, deployment, branch, staging and commit ownership.

Final evidence: `final-copy.log`, `verification.json`, `public-copy-verification.json`,
`visual-review.json`, `parent-output-review.json` and `output-review/samples.json`
in the current work directory. The matching MP4/JPG/VTT/TXT/credits bundle and
published storyboard/verification were copied together. The JPG retains its
previous bytes. Final duration is 165 seconds, 4,950 frames, native 3840×2400,
H.264/AAC, full decode passed, mixed peak −4.9 dBFS, maximum measured action
compression 1.000397×. No subtitle stream or burned captions.

Final contact-sheet SHA-256:
`280bd1c1e2cb584bc29b43b8b3a7b20a60c559f4a24e6c85e7e29c9aebda43b3`.

No commit, staging, branch change, application change, database reset, server
restart or external message was performed by media work. No media blockers remain.

The parent additionally inspected final encoded phone and shopping-review strips,
confirmed photo/rate/progress/completion/₹400/sent coherence, and reaffirmed
approval without a candidate change. That actual message and image hashes are
recorded in `parent-additional-output-review.json`. Parent also reran all 15
media contract tests successfully. Media file edits are frozen for parent commit.
