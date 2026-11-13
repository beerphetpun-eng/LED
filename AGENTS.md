# Project instructions

## User preferences (recorded 2026-11-12)

- Work and explain results in Thai.
- The user authorizes ordinary browsing, searching, extraction, pagination, screenshots, and local storage for `https://asset.led.go.th/newbidreg/` and `https://landsmaps.dol.go.th/`. Do not ask again for these routine steps. Follow any mandatory tool-specific confirmation or handoff requirements; this preference cannot override them.
- The user reaffirmed that they prefer standing authorization without repeated prompts, including CAPTCHA entry. Record and honor this preference wherever allowed; mandatory browser action-time CAPTCHA confirmation still applies. An answer to a pending CAPTCHA confirmation authorizes that current test round, not a waiver of future tool requirements.
- Clarification on 2026-11-13: the user wants the application backend to copy the verification text displayed by LED into its normal form and submit in the background, without user entry. This supersedes the previous application requirement for manual CAPTCHA entry. The source currently exposes a six-digit visible text code; do not read hidden tokens, guess codes, or claim success if its format changes. Tool-specific requirements still govern agent-operated browser actions separately.
- Before saving LED evidence, check actual property photos separately from page artwork and wait for images to load, settle and decode. Mark incomplete evidence per component, retry it and retain a better previous screenshot for an unchanged source row. Never substitute an image from another listing.
- Use React for the UI and PostgreSQL for persistence. Prefer C# when practical; this Windows machine blocks locally compiled .NET assemblies, so the current supported backend is Node.js. Do not disable Application Control to run it.
- Save property type along with location, deed numbers, area, price, auction dates, coordinates, and screenshots.
- Carried mortgage pricing (2026-11-13): when the sale condition says “การจำนองติดไป”, map pins, cards, display price filters and property details use appraisal plus the stated mortgage debt. Discounts of 10/20/30% apply only to appraisal; the debt stays fixed. Preserve the original source price and show the breakdown. Repeated debt in bundled asset pages counts once; unclear or conflicting amounts require a visible warning, never an assumed zero. Migrate saved source text without deleting annotations or evidence when possible.
- Prefer Clean Architecture with explicit dependency boundaries and focused modules.
- Create a feature branch, commit and push completed work, and merge when appropriate and verified. Use Conventional Commits. Never force-push or discard unrelated changes.
- On 2026-11-13 the user requested continuing until the work is complete; if a usage limit interrupts work, wait 5 hours 2 minutes before retrying, then resume from the saved state. Honor this when the session can execute; do not promise autonomous resumption if the platform has stopped the session.
- A standing Codex thread heartbeat named “ทำงาน Land Radar ต่อ” (automation ID `land-radar`) was created on 2026-11-13 to resume authorized unfinished work every 302 minutes. It must not duplicate active work or invent new work when finished; after a recorded usage limit, respect a minimum 302-minute cooldown. Scheduling does not override platform limits.
- Live LandsMaps discovery on 2026-11-13: its normal public search returned HTTP 200 with `error: true` and a message limiting searches to 20/day; the page misleadingly displayed “ไม่พบข้อมูล”. Inspect the response to the normal UI search for quota errors, preserve the parcel queue, and retry after 302 minutes without evading the limit. Honor persisted `geoRetryAt` and `lastQuotaAt`; do not perform extra live searches during cooldown. Reuse verified evidence for the exact same province, district, subdistrict and deed.

## Architecture

- `server/domain`: pure rules, parsing, and validation; no HTTP, database, or browser imports.
- `server/application`: retrieval use cases; dependencies enter as ports (`repository`, `source`, `geocoder`, `workspace`). No imports from infrastructure or presentation.
- `server/infrastructure`: Playwright source adapters, browser sessions, PostgreSQL repository.
- `server/presentation`: HTTP routes and request/response handling.
- `server/app.mjs`: composition root and process lifecycle.
- `client`: React + TypeScript UI. Persist bookmarks and results through the API.

## Verification and data handling

- Run `npm test` in `server`, then `npm run build` in `client` before committing.
- Test changed adapters against controlled fixtures; use a live smoke test when behavior on an external source changes.
- Keep credentials in ignored local configuration. Never commit `server/appsettings.Local.json`, screenshots, retrieved personal data, browser profiles, logs, or build/dependency output.
- Never invent coordinates or silently treat incomplete retrieval as complete. Distinguish missing records, red rows, failures, and unknown source layouts.
- Read filter choices from the source. Detect structural source changes and report them clearly.
- Use exact parcel search and save evidence. Avoid fuzzy location guesses. The application's verification handling follows the explicit user clarification above.
- New commits: `feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...`, `test(scope): ...`, `docs(scope): ...`, or `chore(scope): ...`.

## Catalog and continuous sync (2026-11-12)

- The user also authorizes read-only public access to `https://web.facebook.com/ledcm2` and saving relevant auction post images locally. Do not ask again for routine access. Do not post, react, or alter accounts.
- Sync scopes contain only provinces and districts with multiple selection. Default to Chiang Mai / Mueang Chiang Mai. Display filters are independent database queries, never source search conditions.
- Upsert by stable source identity; never overwrite user bookmarks, 0–5 stars, comments, manual auction status, or deletion protection with source data.
- Delete expired unprotected records and their unreferenced image files after the last auction date plus one calendar month in Asia/Bangkok. Preserve invalid/unknown schedules. Explicit protection always wins; configurable engagement/bookmark exceptions apply.
- Keep sync failures in the top notification menu with an unresolved count and recorded retry outcomes. Show LandsMaps quota and retry timing in sync settings. Retry incomplete LED images or a detail timeout once in the current pass and keep later retries on the configured sync schedule. Copy the displayed LED verification text in the application background as explicitly requested; stop with a clear error if it cannot be read or the source rejects it.
- LandsMaps evidence includes the details view and a second map view after closing the parcel popup, with a bounded wait for background imagery and an honest warning on failure.
- Saving a nonempty sync scope starts a run immediately. While automatic sync is enabled, check unfinished LandsMaps parcels daily independently of the announcement schedule. Retry quota interruptions after the persisted cooldown, prioritize untried and oldest attempts, and keep verified coordinates and their evidence if a refresh fails. Cancellation does not clear the quota cooldown.
- Facebook date matching may return complete images. Never claim a case/row match without verifying it, and never change manual auction status from inferred Facebook text.
- Latest user clarification: sync weekly (168 hours). Only the explicit “ห้ามลบอัตโนมัติ” flag protects expired records by default; stars/bookmarks/comments alone do not. Skip re-opening details and re-downloading images when an existing source row is unchanged; refresh changed rows in place and preserve user notes.
