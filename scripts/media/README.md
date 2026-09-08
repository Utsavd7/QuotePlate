# QuotePlate product film (164 seconds)

The checked-in storyboard is `docs/media/quoteplate-product-film-164.json`.
`product_film.py` generates local Kokoro narration, measured captions, a transcript,
and a 1920×1080 / 30fps H.264/AAC film. It never calls a paid service or downloads
models. Inputs and outputs are explicit; it does not read application credentials,
browser profiles, deployment settings, or databases, or overwrite public media.

## Capture handoff

Place these clean PNG captures in `/tmp/quoteplate-tour-refresh/captures`.
1440×900 or 1920×1080 is preferred. Capture the actual redesigned application with
fictional records, no browser chrome, loading states, menus covering the subject,
passwords, private invitation URLs, or internal-account banners/identifiers.
Use a separate fictional capture workspace. Do not change application authorization
or remove a production banner for filming. Retain meaningful page headings and
the current five-section navigation, especially in the orientation.

| Filename | Required visible state |
| --- | --- |
| today.png | Today overview; Today, Purchases, Suppliers, Menu, Reports all visible |
| menu-input.png | Menu input choices: photo, manual text, permitted website import |
| menu-review.png | Extracted ingredients, quantities, units and approval/review controls |
| new-purchase.png | Single-page purchase draft: ingredients, quantities and delivery/reply timing |
| nearby-search.png | Authentic Andheri East area/category/distance search in the redesigned UI |
| nearby-results.png | Actual public supplier listing results from that search |
| vendor-review.png | Supplier reviews delivery and total before sending their quote |
| vendor-quote.png | Supplier's private quote reply; no invitation URL/token |
| comparison.png | Multiple offers and complete costs |
| award.png | Item-level supplier choice and rationale |
| receiving.png | Received/rejected and billed quantities/rates |
| credits.png | Claimed/received credits and settlement fields |
| delivery-record.png | Supplier delivery evidence, incomplete deliveries and outstanding credits |
| supplier-orders.png | Supplier's own orders |
| supplier-delivery-record.png | Landscape crop: delivery record quantities and credit fields |
| supplier-response.png | Landscape crop: response form including reference and Save action |
| plan-input.png | Plan meals: dishes and portions |
| plan-stock.png | Usable stock, yield and confirmed arrivals |
| plan-shortage.png | Calculated shortage and purchase-draft action; no specific numbers required |
| demand-select.png | Selected ingredient estimates and share action; no private supplier URL |
| demand-shared.png | Saved estimate and withdrawal context |
| trading.png | Wholesale terms, served PIN codes and lead-time declaration |
| reuse-before.png | Matching historical prices offered for review |
| reuse-after.png | Reused prices and editable current quantities/terms |
| delivery-cost.png | Delivery record ingredient costs: billed cost per accepted unit |

`reports.png` is optional and is not required by the render. Reports is named in
the opening navigation orientation. Purchase creation is a single-page draft
within a guided overall process, not a separate multi-step review wizard.

The storyboard specifies the exact hold duration for each capture. Only intro
(0–5s) and closing (old 159–164s) retain visuals from the approved **164-second**
source. Nearby discovery uses fresh search/results captures and retains only the
old 21–41s audio and measured cues. `sourceStart` selects retained picture/audio;
`audioSourceStart` selects retained audio independently of fresh `shots`. Public
listings are authentic captures, not a guarantee of current stock or suitability.
All application scenes use the new captures. Missing captures fail instead of
falling back to old UI.

## Local invocation

Existing local runtime and models (outside the repository):

- Python: `/tmp/quoteplate-video-update/venv/bin/python`
- Model: `/tmp/quoteplate-video-update/audio/kokoro-v1.0.int8.onnx`
- Voices: `/tmp/quoteplate-video-update/audio/voices-v1.0.bin`
- Approved 164s source: `/tmp/quoteplate-video-update/final.mp4`
- Licensed music: `/Users/utsavdoshi/.codex/visualizations/2026/09/05/01a0700f-d89a-7b82-80a7-506642259419/video-landing-two-minute/assets/relax-beat-arulo.mp3`

From the repository root, generate narration (no captures needed):

```sh
/tmp/quoteplate-video-update/venv/bin/python scripts/media/product_film.py audio \
  --work /tmp/quoteplate-tour-refresh \
  --source-film /tmp/quoteplate-video-update/final.mp4 \
  --model /tmp/quoteplate-video-update/audio/kokoro-v1.0.int8.onnx \
  --voices /tmp/quoteplate-video-update/audio/voices-v1.0.bin
```

Once the capture handoff is complete:

```sh
/tmp/quoteplate-video-update/venv/bin/python scripts/media/product_film.py render \
  --work /tmp/quoteplate-tour-refresh \
  --source-film /tmp/quoteplate-video-update/final.mp4 \
  --music /Users/utsavdoshi/.codex/visualizations/2026/09/05/01a0700f-d89a-7b82-80a7-506642259419/video-landing-two-minute/assets/relax-beat-arulo.mp3
```

Use `check` instead of `render` with the same arguments to validate inputs without
encoding. `--captures`, `--storyboard` and `--font` can override their defaults.
Requires local FFmpeg/FFprobe, numpy, soundfile and kokoro-onnx. The existing venv
contains the Python dependencies. Model/voice files must already exist.

Outputs are in the work directory: `quoteplate-product-film.mp4`, `.jpg`, `.txt`,
`.vtt`, `credits.txt`, `contact-sheet.jpg`, `audio/timing.json`, and `verification.json`. Sentence/phrase cues are
measured from separately generated speech, not estimated by word count. A scene
that cannot fit at up to 1.15× speed fails for an editorial rewrite; speech is never
silently truncated. Audio caches bind to narration, model and voice-file hashes.
The final film is frame-bounded at 164s; AAC container duration may include a small
encoder tail, but must remain at or below 165s. Rendering performs a full decode.

Review frames and listen before publishing. Parent owns release and copying the
matching MP4, poster, transcript, captions and credits into `public/media` together.
Do not rerun the older `audio/generate.py`: its unused fourth clip contains an
obsolete demo invitation. This storyboard has no such invitation. Do not use the
old `render-public.py` for this refresh: it retains 141 seconds of old visuals.
