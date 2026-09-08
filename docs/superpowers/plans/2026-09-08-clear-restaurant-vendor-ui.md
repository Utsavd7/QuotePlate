# Clear restaurant and vendor UI Implementation Plan

> **For agentic workers:** use parallel agents for independent page groups; the parent owns integration and runs browser tests serially.

**Goal:** Make the existing restaurant and supplier workflows understandable to users with little technical confidence.

**Architecture:** Preserve routes, data APIs and business rules. Group navigation into five destinations, put the next task first, and reveal secondary details explicitly. Page-scoped CSS keeps the public website unaffected.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS modules, existing Playwright/Jest.

## Tasks

- [x] Parent: update `src/app/(app)/layout.tsx` and its CSS to five main links, contextual section links and utility settings. Preserve mobile dialog/focus and prefetch.
- [x] Parent: simplify OverviewWorkspace, SupplierWorkspace, reporting, RestaurantSupplierPortal and SettingsWorkspace presentation; keep all existing routes and capabilities reachable. Coordinate consistent typography, spacing and hierarchy.
- [x] Worker: simplify `src/components/procurement/*` around a visible buying sequence and next action; disclose exports/advanced details without hiding errors. Update only relevant procurement tests if accessible labels intentionally change.
- [x] Worker: simplify `src/app/quote/*`, `src/app/supplier-portal/*`, `src/app/supplier-application/*` and public supplier portal components. Preserve payloads, security and financial calculations. Keep vendor mobile entry usable.
- [x] Worker: simplify `src/components/menus/*` and `src/components/service-planning/*`; make meal selection and ingredient shortages understandable without hiding required inputs. Preserve validation and explicit quantities.
- [x] Parent: add meaningful navigation/disclosure browser coverage using the populated internal fixture, inspect desktop/mobile screenshots, update existing journey selectors for intentional UI changes.
- [x] Verify locally: lint, TypeScript and 1,095 unit/API tests pass. All 119 active browser cases were verified across the full run and targeted reruns; 15 conditional cases were skipped. Laptop checks cover 1440×900 and 1366×768, with mobile/tablet journeys and accessibility checks.

Release gate: CI must pass before merging and publishing. The live internal demo is checked again after deployment.

Acceptance: five main restaurant choices, all old features reachable, vendor quote submission and order/delivery actions work, clear errors, no invented live data, no serious accessibility regression or page overflow at mobile width.
