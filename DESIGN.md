# Workspace design system

QuotePlate is a daily purchasing tool for restaurant staff. Keep real records and the next action prominent.

- Use the shared workspace page and header from src/components/workspace. Page content is at most 82rem, with 24px gutters on laptops and 16px on phones. Narrow editing forms belong inside this common page.
- Use one main heading, one short description and one primary action. Put search, status and secondary tools together directly above records.
- Use the shared toolbar and search field. Controls are 44px tall with 8px corners; desktop control text is 14px and phone input text is 16px.
- Use the shared table surface, headings and rows. Columns depend on the records but header and row definitions must match. Keep laptop columns visible; switch to labelled rows when the content container is too narrow.
- Use Manrope and existing workspace colour tokens. Main headings use the existing 28px/24px scale, section headings 18.4px, record labels 14px and supporting table text 13px.
- Keep repeated instructions, import tools and advanced information in clearly labelled disclosures. Every existing action remains reachable.
- Cache only recent, authorized workspace reads in memory. Clear them around writes and account changes. A cancelled component must not cancel shared requests for another reader. Never invent records or hide a failed save.

The workspace-polish browser suite checks all route layouts at 1440px, 1366px and phone widths, including keyboard focus and overflow.
