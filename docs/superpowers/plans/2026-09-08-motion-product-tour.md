# Replace still frames with a recorded product walkthrough

The previous refresh matched the redesigned UI but used held screenshots, which did not demonstrate interaction. Replace all 25 application shots with recordings of real clicks, typing, navigation, saves and results in an isolated fictional restaurant. Preserve the approved narration, captions, 164-second timeline, kitchen opening/closing, shared palette and player controls. No internal demo login, banner or private invitation URL appears in the public film.

Use a separate populated fixture; actual nearby search goes through the normal live map providers. Trim preparation and reading pauses with a maximum 1.5x recording speed. Require video inputs with enough decoded frames; never silently fall back to stills. Align clips to the recording's monotonic start, excluding encoder tail padding, and review first/last frames for cross-scene contamination.

Validate media contracts, every output's duration/frame count, temporal frame samples, narration/caption hashes, full decode, browser playback and muted scroll autoplay. Open and merge a PR, then verify the exact live media hashes. After this release, perform the requested dashboard UI and speed audit in the browser using fictional demo records.
