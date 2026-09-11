# Easier procurement workflows implementation plan

User authorization: implement the agent-actionable gaps, preserving all features and the existing theme, with free services and real production records. Real customer Google consent, real restaurant participation and automatic WhatsApp business messaging remain external prerequisites.

**Goal:** reduce avoidable loading work and supplier effort; improve trustworthy contact review and local photo review.

**Architecture:** retain tenant-scoped transactions, private link grants, explicit submission and current data validation. Add small helpers to existing workflows rather than another dashboard or autonomous purchasing agent.

**Tech stack:** installed Next 16.3, React 19, Prisma 5.22 with relationJoins, PostgreSQL RLS, browser Tesseract, Jest and Playwright.

## Independent implementation slices

- [x] Loading (parent): reproduce account bootstrap timeout gap, bound and cancel the account read; render the Settings heading while data loads. Compare a combined active/invited member read with current Settings reads against real disposable PostgreSQL, retaining active actor checks, invitation filters and ordering. Ship the database change only with equivalent-result and reduced-call evidence.
- [x] Supplier quoting: show how many requested items still need checking and jump to the first incomplete input, using existing price/quantity/GST validation. Support all-items and guided layouts, unavailable items and valid zero prices; preserve typed values and final review.
- [x] Discovery: normalize exact published contact identities, deduplicate repeated website suggestions and warn about already-saved contacts across nearby, website and pasted contact reviews. Keep citations and check time visible; matching contacts do not prove one business or delivery coverage. No new fetch/provider surface.
- [x] Photo review: fix the reproduced menu OCR initialization/abort worker leak with bounded worker ownership; show on-device source previews beside editable recognition output for shopping/invoice/price lists. Dispose object URLs, retain manual fallback and explicit application.
- [x] Integration: wire loaded saved contacts to discovery helpers; inspect changes together, update README and feature documentation without overstating recognition, coverage or automation.
- [ ] Validation: focused red/green and real database tests; full unit/API, lint, type check and desktop/mobile browser suite. Verify actual controls and responsive layouts in a local isolated tenant before recording.
- [ ] Media: after final UI validation, replace changed feature footage in the existing 165-second, 3840×2400 film, retaining accurate opening/ending, optional captions and the established player. Verify source motion, no private links/credentials, duration, audio and matched public asset bundle.
- [ ] Release: inspect PR and GitGuardian, merge passing changes, verify exact Netlify revision and health, repeat read-only live demo smoke/performance checks. Record first-load variability honestly.

## Acceptance and boundaries

No production test orders or supplier messages. No paid API or hosting change. No fabricated discovery/measurement results. No passwords/private quote links in repository, screenshots or film. Existing quantities/prices are never silently overwritten. Additional helpers must not block a legitimate manual path. The user-owned scripts/show-tables.sh is excluded from this work.
