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

## Test-only environment variables

| Variable | Purpose |
| --- | --- |
| `REGRESSION_SUITE=1` | run the full R1–R11 suite, then exit with 0/1 |
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
