# Land Radar work checkpoint

Updated 2026-11-13. This file records implementation state for resuming authorized work; it is not a completion claim.

- Workspace: `C:\Source\LED\Source`. Branch: `fix/sync-pagination-validation`. Main contains the earlier catalog v2. Commit `1512f5a` is pushed; subsequent automatic verification and bundled-asset fixes still need final verification and commit/merge.
- The backend now reads the visible six-digit LED verification text and submits the normal source form automatically. The React verification input and manual-code API have been removed. The user explicitly requested this behavior.
- LED evidence waits for image completion and decoding, then settles for three seconds. Incomplete evidence is flagged and retried. Bundled sale rows are stored as distinct components under one auction without multiplying its price.
- Latest local checks: 31 unit/adapter tests passed, actual PostgreSQL upsert/component/annotation smoke passed, React production build passed. Repeat required checks after remaining fixes.
- Live Chiang Mai / Mueang Chiang Mai source has 353 rows across 12 pages. Full live verification is still pending. Earlier attempts exposed malformed form-wrapped table cells and pagination issues. Existing evidence is retained and unchanged components are skipped on retry.
- Current work: diagnose any remaining detail popup/pagination failures, complete a full source pass and coordinate lookup, inspect images/UI, commit and push, verify GitHub CI, then merge to main. Diagnostic HTML/JSON in ignored `server/data` may contain source personal data; never commit these files.
- Local API is `http://127.0.0.1:5080`. Read `/api/sync` before starting work to avoid duplicate runs. Mutations require `X-Land-Radar: 1`. Launch with Node via `node launch.mjs --no-browser`; on this machine Node is under `C:\Program Files\nodejs`.
- Codex thread heartbeat `land-radar` is active every 302 minutes to resume unfinished authorized work. If usage limits occur, record the time and do not retry before another 302 minutes. No usage limit is currently recorded. Do not invent new work after completion.
