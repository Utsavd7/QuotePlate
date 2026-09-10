# Supplier phone refresh — 165 seconds

The replies scene is now 19 seconds (01:33–01:52). Every other scene retains
its previous duration and approved video source. The comparison starts at 01:52,
delivery at 02:12, Today at 02:32, and the approved kitchen ending at 02:37.

The phone flow uses the real local QuotePlate app and bundled OCR worker:
choose a printed-text fixture image, review Tomato 40/kg, fill the blank rate,
use the one-item guide, review delivery/total, and submit a quote for 10 kg / INR 400.
It demonstrates choosing an image; it does not claim to operate a physical camera.
The same Monsoon Table / Amber Fresh Produce names, 11 September delivery date
and 10 September deadline match the retained story. Copper Pot's INR 440 offer
remains in the retained comparison.

The responsive phone viewport is 390×600 CSS pixels, recorded at native
1560×2400 with browser zoom 4. The moving recording is placed without scaling
at x=2280 on a 3840×2400 canvas beside editorial labels. No device frame,
decorative border, screenshot padding or simulated app response is used.

Only `replies.wav` is newly synthesized with local Kokoro ONNX `af_heart`.
The other ten narration WAVs retain their hashes. Optional VTT cues after the
phone scene move one second later; captions remain off by default in the player.

Working sources and capture commands are in `/tmp/quoteplate-vendor-phone-film`.
`capture.cjs` creates a unique ordinary local tenant; sessions/private links stay
in memory. `phone-helper.mjs` records the native phone surface. No shared fixture
reset, production write or external supplier message is part of this workflow.

Re-render from the repository root after captures are finalized:

```sh
python3 -B scripts/media/product_film.py render \
  --work /tmp/quoteplate-vendor-phone-film \
  --storyboard docs/media/quoteplate-product-film-164.json \
  --source-film /tmp/quoteplate-borderless-film/final.mp4 \
  --music /Users/utsavdoshi/.codex/visualizations/2026/09/07/01a07bc0-a32f-7390-992c-4cf6ecd01f0f/quoteplate-first-purchase-4k/relax-beat-arulo.mp3
```

The storyboard filename retains its historical `164` suffix; the checked content
and renderer contract are 165 seconds / 4,950 frames. The renderer writes only to
the working directory. Copy the movie, poster, credits, VTT and transcript to
`public/media` only after full decode, frame-count and source-hash verification.
