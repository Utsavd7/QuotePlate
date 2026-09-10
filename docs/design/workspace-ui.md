# QuotePlate workspace UI

Restaurant and supplier screens use the existing green, white and warm-grey palette, Manrope for interface text and the same QuotePlate wordmark. Keep the feature-specific content; reuse these layout rules when adding a screen.

## Layout

- Restaurant pages compose `page` from `components/workspace/workspace.module.css`. The content rail is at most 82rem, with 24px gutters on laptops and 16px on phones.
- Use `WorkspaceHeader`, `WorkspaceToolbar` and `WorkspaceSearch` for page titles and tools. Detail pages put a back link before the shared header. Forms, progress steps and tables align with the page content.
- The desktop sidebar stays fixed. Section navigation stays below the mobile header when scrolling. The footer uses the same content alignment and sits after the page content.
- Use the shared section gap (24px), panel padding (20px; 16px on phones), panel radius (10px) and control radius (8px). Keep wide tables inside their own scroll region, never wider than the document.
- Quote, application and supplier-workspace pages use `PublicSupplierShell`, with one 70rem rail and aligned brand header/footer. Larger 48px public form controls help phone users; restaurant controls are at least 44px.

## Typography and icons

| Purpose | Standard |
| --- | --- |
| Page title | 28px, weight 750; 24px on phones |
| Section title | `--type-h2`, weight 750 |
| Subheading | `--type-h3`, weight 750 |
| Restaurant controls and table text | 14px; text-entry fields become 16px on phones |
| Labels | Weight 600 |
| Buttons and navigation | Weight 650 |
| Ordinary text | Weight 400 |
| Action icons | 16px |
| Sidebar icons | 18px |
| Lucide strokes | 1.75 |

Use icons with visible labels for actions. Decorative icons are hidden from assistive technology. Brand glyphs such as WhatsApp keep their original shape. Keep focus outlines, meaningful disabled states, and readable numeric columns.

## Workflow

Give each page a plain title, a short explanation and a clear next action. Keep advanced options in existing disclosures. Saving a draft, preparing a message, submitting a quote and confirming an award remain separate explicit actions. Never hide a feature just to make a screen look simpler.

`tests/e2e/internal-demo.spec.ts` checks populated pages, title typography, header/footer alignment, page overflow and the fixed sidebar. It also verifies that Settings can still save. Supplier quoting and onboarding tests exercise the public forms separately. Use fictional local records for these checks; production data and credentials do not belong in screenshots or fixtures.
