# Short product film and release plan

Goal: Update the existing product film to include nearby discovery and private supplier collaboration, at no more than 150 seconds, then open and merge the PR after checks. User explicitly authorized editing, PR and merge.

Use existing actual app recordings and fresh recordings of the new features, with consistent local synthetic narration, music, captions and a transcript. The 149-second storyboard covers menu intake, live public nearby search, quotes, award, receiving, private portal, planning and selected demand sharing. Fictional restaurant records stay labelled; listings are not claimed to prove current stock. No paid generation service.

- [x] Capture the new workflows and render 149 seconds using local Kokoro and FFmpeg.
- [x] Update poster, captions, transcript and landing copy; test playback, duration, accessibility and media decoding.
- [ ] Complete independent code review, open PR, require successful CI, and merge.
- [ ] Apply the additive production migration through the existing gated workflow and verify the hosting release where required for the merged features.

Verified export: 149.021 seconds, H.264/AAC, 1920×1080, 18,641,606 bytes, fast-start metadata, full decode without errors, 32 in-range caption cues. Local narration was checked by local speech recognition. Premerge review also added portal identity binding against cross-tab cookie replacement, with real database no-write regression coverage. Unit 1,040/1,040 and database 47/47 passed.

Added user request: autoplay on scroll. Use a visibility observer to start muted at 50% visibility, pause offscreen/hidden tabs, respect manual pauses and reduced motion, preserve native controls, enable captions by default, and retain preload=none before the video enters view. Verify natural scrolling, anchor navigation, manual pause/resume, reduced motion and errors on desktop/mobile.

Added user request: show a prominent keyboard-accessible Unmute video button over the visible silent player. Only its click enables sound; native volume changes also update the prompt. Keep it above the native controls, hide it when offscreen or after unmuting, and test both directions.

Autoplay/unmute verification: all eight video browser cases passed on desktop and mobile, including initial silence, visible unmute action, native re-muting, scroll pause/resume, remembered manual pause, captions, media errors and reduced-motion manual playback. Lint, typecheck and all 1,040 unit tests passed.
