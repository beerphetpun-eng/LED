# Project instructions

## User preferences (recorded 2026-11-12)

- Work and explain results in Thai.
- The user authorizes ordinary browsing, searching, extraction, pagination, screenshots, and local storage for `https://asset.led.go.th/newbidreg/` and `https://landsmaps.dol.go.th/`. Do not ask again for these routine steps. Follow any mandatory tool-specific confirmation or handoff requirements; this preference cannot override them.
- Use React for the UI and PostgreSQL for persistence. Prefer C# when practical; this Windows machine blocks locally compiled .NET assemblies, so the current supported backend is Node.js. Do not disable Application Control to run it.
- Save property type along with location, deed numbers, area, price, auction dates, coordinates, and screenshots.
- Prefer Clean Architecture with explicit dependency boundaries and focused modules.
- Create a feature branch, commit and push completed work, and merge when appropriate and verified. Use Conventional Commits. Never force-push or discard unrelated changes.

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
- Use exact parcel search and save evidence. Avoid fuzzy location guesses and automatic CAPTCHA solving.
- New commits: `feat(scope): ...`, `fix(scope): ...`, `refactor(scope): ...`, `test(scope): ...`, `docs(scope): ...`, or `chore(scope): ...`.
