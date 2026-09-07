# Short product film and release plan

Goal: Update the existing product film to include nearby discovery and private supplier collaboration, at no more than 150 seconds, then open and merge the PR after checks. User explicitly authorized editing, PR and merge.

Use existing actual app recordings and fresh recordings of the new features, with consistent local synthetic narration, music, captions and a transcript. The 149-second storyboard covers menu intake, live public nearby search, quotes, award, receiving, private portal, planning and selected demand sharing. Fictional restaurant records stay labelled; listings are not claimed to prove current stock. No paid generation service.

- [x] Capture the new workflows and render 149 seconds using local Kokoro and FFmpeg.
- [ ] Update poster, captions, transcript and landing copy; test playback, duration, accessibility and media decoding.
- [ ] Complete independent code review, open PR, require successful CI, and merge.
- [ ] Apply the additive production migration through the existing gated workflow and verify the hosting release where required for the merged features.

Verified export: 149.021 seconds, H.264/AAC, 1920×1080, 18,641,606 bytes, fast-start metadata, full decode without errors, 32 in-range caption cues. Local narration was checked by local speech recognition. Premerge review also added portal identity binding against cross-tab cookie replacement, with real database no-write regression coverage. Unit 1,040/1,040 and database 47/47 passed.
