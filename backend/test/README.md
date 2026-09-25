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
(fix 2026-09-25 after a false `not_affected`; self-tests A-09..A-12; A-12 = a whole record lost at the record cap returns `undetermined`, never a pass — record drops below a cap are caught by the comparison, S-02).

## Full source comparison (read-only, decisive)

```powershell
cd backend
node scripts\compare-profile-source.mjs --selftest   # S-01..S-13, no database
node scripts\compare-profile-source.mjs --db=prod    # reads MONGODB_URI_PROD; no writes
```

Re-extracts each structured profile's stored original file and checks every
letter of every source line against stored values (no percentage threshold).
Lines below 100% print content-free diagnostics (gap position, stored paths
anchored on the line, stored scalar values that explain the gap: an earlier
identical occurrence, or a URL stored with `https://`). Unexplained residual =
missing content. Line text goes only to a private OS-temp file — never pasted,
never committed.

## Test-only environment variables

| Variable | Purpose |
| --- | --- |
| `REGRESSION_SUITE=1` | run the full R1–R14 suite, then exit with 0/1 |
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
