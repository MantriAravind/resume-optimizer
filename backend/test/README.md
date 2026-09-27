# Optyply — Phase 1 Regression Suite

Version-controlled, reproducible regression harness (recruiter chunk-1
condition 3). The production entry point (`backend/server.js`) contains **no
test bypass of any kind** and refuses to start if any test-only environment
variable is set. The test build is **generated** from the canonical
`server.js` by `make-testlab.mjs`; if `server.js` drifts, generation fails
loudly instead of producing a stale build. The generated file is gitignored.

## Run

```powershell
cd backend
node test\make-testlab.mjs                     # regenerate from current server.js
$env:REGRESSION_SUITE="1"
node test\server_testlab.generated.js          # boots, runs the suite, exits
echo $LASTEXITCODE                              # 0 = ALL GREEN, 1 = failures
Remove-Item Env:REGRESSION_SUITE
```

## Unit fixtures (Phase 2 chunk 2)

```powershell
cd backend
node test\unit-chunk2.mjs       # no server, no database, no env vars
echo $LASTEXITCODE               # 0 = all pass, 1 = failures, 2 = server.js drifted
```

L-series (affected-profile lock): the real guard and tracker rule run against a fake
User model — locked → 423, fails closed (503) when the lock cannot be read, logs route
+ outcome only; plus a static rule that no line of `server.js` writes the lock.

Extracts the real `validateResumeDataV2`, `buildFieldMetaV2` and `buildLineMap`
from the canonical `server.js` (never copies), then runs the G-series (schema
v2: unknown fields, invalid types, zero truncation, atom-only dedupe, null
semantics) and P-series (field envelopes: source ranges, section scoping,
method/status separation, Unicode/CRLF offsets, no content in envelopes).
Prints the `server.js` sha256 it tested. All fixture data is synthetic.

## Production feature switch: `PARSE_V2` (chunk 2)

Not a test variable — a real deployment switch, read on every upload.

| Value | Behavior |
| --- | --- |
| unset / `off` / anything unrecognized | pre-chunk-2 pipeline, unchanged |
| `shadow` | users see exactly the `off` result; schema v2 + field envelopes are computed from the same raw model payload (no extra model calls), stored on the draft under `v2` (never returned to the client), one counts-only log line per upload (`chunk2 shadow: …`) |
| `on` | v2 decides: rejected or unverified payload → one retry; both rejected → explicit 422 `parse_failed`, no draft, parked file removed. Accepted drafts are stamped `draftSchemaVersion: 2`, which the current confirmation path refuses until the v2-aware confirmation ships. **Local testing only until the reviewer approves activation.** |

Boot prints `parse v2 mode: <mode>`. Rollback = set `PARSE_V2=off` (or remove it) and restart — no data migration.

## Containment: no silent truncation on the v1 path (2026-09-25)

Until the v2-aware confirmation ships, anything the legacy sanitizer would cut is
**refused, never truncated**: Save and draft autosave return 422
`content_exceeds_limits` (no write; draft and upload kept; active resume
unchanged); a parse the legacy caps would shorten records `capLoss` on the draft
(paths/counts only), shows containment notices in review, and its confirmation is
blocked even with the completeness acknowledgment. Pre-containment drafts at a
legacy cap are blocked conservatively. Covered: 600-char fields, every array cap,
whole-record drops, contact-line 120, autosave profile 200, rescue caps, and the
24,000-char model input window. Unit C-01..C-10 (C-10: 3,000 seeded random
payloads, detector ≡ actual v1 loss); harness R14a–i.

## One-time truncation assessment (read-only)

```powershell
cd backend
node scripts\audit-truncation.mjs --selftest   # synthetic checks, no database
node scripts\audit-truncation.mjs --db=prod    # reads MONGODB_URI_PROD; no writes
```

Prints internal `_id`, field path, stored vs expected count/length, status
(`affected` / `not_affected` / `undetermined`) and whether re-import is required.
Never names, emails or résumé text. A value at a cap is only `affected` when the
profile's own confirmed source text shows it continued.
Wrapped continuation lines after the last stored item count as missing; a line
that could be a wrap or the next record's header is `undetermined`, never a pass
(fix 2026-09-25 after a false `not_affected`; self-tests A-09..A-12; A-12 = a whole record lost at the record cap returns `undetermined`, never a pass — record drops below a cap are caught by the comparison, S-02). A-13/A-14: hashed id labels.

## Full source comparison (read-only, decisive)

```powershell
cd backend
node scripts\compare-profile-source.mjs --selftest   # S-01..S-15, no database
node scripts\compare-profile-source.mjs --db=prod    # reads MONGODB_URI_PROD; no writes
```

Re-extracts each structured profile's stored original file and checks every
letter of every source line against stored values (no percentage threshold).
Lines below 100% print content-free diagnostics (gap position, stored paths
anchored on the line, stored scalar values that explain the gap: an earlier
identical occurrence, or a URL stored with `https://`). Unexplained residual =
missing content. Line text goes only to a private OS-temp file — never pasted,
never committed.

## Autosave refusal is visible (reviewer follow-up 2, 2026-09-25)

`POST /me/resume/draft` refuses an over-limit edit with 422 and `sections`
(names only, never values; harness R14g).

Review-screen behavior (recruiter decision 5, 2026-09-25 — workflow step 1). The
sticky review banner always shows one autosave status: **Saving…** · **Saved** ·
**Save failed — Retry** · **Not saved — action required** · **Changed in another
tab — Reload**. A refusal shows a card "Not saved — [Section] is too large to save
without cutting content.", keeps the latest text on screen, and offers **Continue
editing** (opens that section) and **Undo latest change** (back to the last version
the server accepted) — never Retry, since repeating the same request cannot succeed.
A 409 stops autosave until reload, so a newer version is never overwritten.

Leaving during a review never confirms or discards the new resume. A waiting edit
is sent first (navigation waits up to 8 s for it); then a blocking dialog appears
only when something would be lost: refused → Continue editing / Undo latest change /
Leave without latest changes; failed or still saving → Continue editing / Retry save /
Leave without latest changes; conflict → Stay / Reload / Leave without latest changes;
a changed open entry → Continue editing / Leave without latest changes. "Leave without
latest changes" drops only the unsaved browser edit; the server draft keeps its last
saved version. The browser reload prompt appears only while something is unsaved
(saving, failed, refused, or a changed open entry).

Navigation note (recruiter, 2026-09-26): when everything is saved, leaving is not
blocked at all — the next page shows a brief, self-closing note: "Your resume review
is saved as a draft. You can return before [expiry time] to finish it." The expiry
comes from the server (`expiresAt` = draft `createdAt` + 24 h, on the upload
response and on `GET /me/resume`; one constant, `DRAFT_TTL_SECONDS`, also drives the
TTL index). Autosave never extends it (harness R16a–c).
Manual UI check: UI-11 (601-character summary → refused; undo; failed with the
backend stopped → Retry; leave in each state; reload prompt only when unsaved).

## Affected-profile lock (reviewer ruling 2026-09-25)

A profile whose saved details lost content to the legacy caps is marked
`repair.reimportRequired` by `scripts/mark-reimport-required.mjs` — the only writer;
no request path sets, changes or clears it (unit L-09, harness R15i). While marked:
`/optimize` (both paths), `/me/surgical-fit`, `/download-word`, `/download-pdf` → 423
`reimport_required` before any model call or rate-limit spend; `GET /me/resume` carries
the status so the UI shows it (Profile banner, optimizer lock screen); tracker resumes
generated before the repair are reported `resumeInvalid` and not handed out (423
`resume_invalid`; stored text untouched). The structured `/optimize` path now requires
sign-in, so the lock cannot be bypassed by dropping the token. After an approved repair
(`--unlock`), generation works again and only resumes made after the repair are valid.

```powershell
cd backend
node scripts\mark-reimport-required.mjs --selftest                 # K-01..K-11, no database
node scripts\mark-reimport-required.mjs --db=dev --list            # read-only: _id, structured, locked
node scripts\mark-reimport-required.mjs --db=prod --user=<_id> '--path=projects[0].bullets' --missing-lines=5          # dry run
node scripts\mark-reimport-required.mjs --db=prod --user=<_id> '--path=projects[0].bullets' --missing-lines=5 --apply  # writes
```

Dry run by default. `--apply` writes only `repair` (guarded; a second run writes
nothing) and prints hashes of the resume text, structured data, original file and
contact profile before and after — they must read UNCHANGED. `--unlock --apply` is for
use only after the reviewer approves the repair evidence (or to roll the lock back).

## Evidence hygiene: one fingerprint method, no raw ids (2026-09-25)

Every script whose output is shared as evidence fingerprints values with
`scripts/lib/evidence-hash.mjs`, version **h1**: SHA-256 (first 12 hex) of a
string's raw UTF-8 bytes, a file's bytes, or canonical JSON (sorted keys) for
anything else — so the same résumé text prints the same `h1:` value in the
comparison and the lock script. A different method would be `h2:`; `h1` never
changes meaning. Database ids print only as `id:<hash>`; the lock script's
`--list` is the one operator-only exception (it prints full ids so one can be
picked, and says so). Self-tests A-13/A-14, S-14/S-15, K-07/K-10/K-11.

For clean UTF-8 evidence files on Windows, run
`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` in the PowerShell
window before `node … | Out-File -Encoding utf8 …`.

## Test-only environment variables

| Variable | Purpose |
| --- | --- |
| `REGRESSION_SUITE=1` | run the full R1–R16 suite, then exit with 0/1 |
| `DRAFT_IMMUTABILITY_TEST=1` | rawText lifecycle hash self-test only |
| `SWEEP_CONCURRENCY_TEST=1` | parallel-cleanup self-test only |
| `SIZE_CEILING_TEST_MIB=<n>` | compress the BSON ceiling for boundary tests |

Any of these set against `backend/server.js` (the production entry point)
aborts startup by design.

## Database isolation & cleanup

The suite connects with `MONGODB_URI` from `backend/.env`, which must point at
the isolated development database (`optyply_dev`) — never production. All test
data lives under sentinel ids (`regr-sentinel-*`, `*-selftest-sentinel`) and is
deleted in the suite's `finally` block; the auth-bypass secret and parse stub
are disabled there as well.

## Fixtures

The résumé fixture is synthetic sentinel text assembled in
`harness.snippet.js` (`fixtureLines()`); it contains no real résumé content or
personal data. The suite logs `fixture sha256=<12 hex>` at start — a changed
hash means the fixture changed and results are not comparable to prior runs.

## Coverage (R1–R11)

Auth negatives on all protected endpoints · upload/replacement + chunk-1 field
verification · completeness gate + acknowledgment recording · original-file
byte-identity · consumed-draft replay + stale-tab 409 · stale-version
concurrency (R6a) · **fault-injected pre-commit write failure (R6b)** ·
**committed-write-with-lost-response (R6c)** · per-user ownership isolation ·
payload limits (5 MB, BSON projection, doc-gen caps) · combined 40/hr rate
limit boundary · orphan sweep on the real function + live TTL-index check ·
parallel-delete idempotency · log-sanitization mapping.

Evidence output is statuses, counts and hashes only — never résumé content,
personal data, or secrets. The manual UI checklist (UI-01…UI-10) covers the
browser layer until the Phase 5 suite owns it.
