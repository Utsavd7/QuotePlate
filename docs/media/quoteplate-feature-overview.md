# QuotePlate major-feature overview — 165 seconds

This edit covers the main feature families, using one Monsoon Table purchase as the
central story. It is not a deep walkthrough of every feature. The native laptop
recording remains 3840×2400 at 30 fps. The 19-second phone OCR scene is recorded
again after the UI review; its native composition and the licensed kitchen motion
bookends are retained. Optional VTT captions remain separate.

| Start | Duration | Feature / real action |
| --- | ---: | --- |
| 0:00 | 5 s | Kitchen opening |
| 0:05 | 18 s | Restaurant setup and Today |
| 0:23 | 20 s | All menu input choices, ingredient review, approval |
| 0:43 | 8 s | Paste, review and import two supplier contacts |
| 0:51 | 15 s | Create and open a purchase request |
| 1:06 | 7 s | Real WhatsApp glyph, Email and Copy controls; no external send |
| 1:13 | 19 s | Phone photo/OCR, price review, item guide and quote submission |
| 1:32 | 14 s | Compare offers and confirm an award |
| 1:46 | 14 s | Received quantities, invoice and credit owed |
| 2:00 | 4 s | Today delivery follow-up |
| 2:04 | 13 s | Private workspace sharing and supplier confirmation |
| 2:17 | 5 s | Nearby discovery from real public sources |
| 2:22 | 5 s | Meal portions, stock and ingredient shortages |
| 2:27 | 5 s | Reports and supplier performance entry |
| 2:32 | 5 s | Past purchases and Repeat order |
| 2:37 | 8 s | Kitchen closing |

There is no standalone procurement-templates screen. The closing reuse shot shows
the existing Repeat order workflow, which creates a new draft from a past purchase.

Fresh captures use an isolated local tenant and actual app actions. Supplier links
and sessions stay in memory. WhatsApp and Email are shown without opening external
applications or sending messages. Nearby search must use an actual public response;
if the service is unavailable, show only the real search controls and document that
limitation. Never substitute fixture businesses as live search results.

`scripts/media/feature_overview_capture.mjs` prepares 18 fresh application clips,
including the purchase form, comparison and receiving screens. Default invocation
checks preparation without opening a browser. Use `--capture-after-ui-validation`
only after the parent confirms the refreshed build is ready. The parent controls
the server. An ordinary local signup uses random credentials in memory, entirely
off camera. A recording-only mask obscures private-link text before raw capture;
the real sharing controls remain visible and no messages are sent.

The script writes a staged storyboard with playback rate 1 for every new clip.
Use it when rendering: the recorder already bounds action compression to 1.5×,
so new footage must not inherit the older source clips' additional acceleration.

Rendering work lives in `/tmp/quoteplate-feature-overview-film`. Keep the matching
movie, poster, captions, transcript and verification together. Copy to `public/media`
only after native-resolution/source-duration checks, complete decode, frame-count,
motion/continuity review, audio and caption validation.

The completed edition contains 18 fresh app clips plus two retained signup clips
and two kitchen clips. All fresh sources render at playback rate 1; only retained
signup clips use 1.4× and 1.5×. Actual nearby requests returned HTTP 200 and five
public-source leads. The final planning shot shows the six-kilogram shortage;
reports show the ₹40/₹44 price range and ₹40 credit still owed. Separate pickups
recreated the same fictional purchase through ordinary local application APIs.

`finalize_feature_film.py --work /tmp/quoteplate-feature-overview-film --copy-public`
checks source hashes, completed-film hashes, visual-review records, frame count,
dimensions, full-decode evidence, optional captions, audio peak and removed browser
profiles before copying the matching bundle and exact rendered storyboard.
