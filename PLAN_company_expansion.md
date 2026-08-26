# Plan: Grow the Job Board — Company Expansion (D2-lite)

Goal: more jobs on the board by adding validated companies to the three ATS
we already run (Greenhouse, SmartRecruiters, Ashby). No new connectors.

Why this path first: same pipeline, same filters, zero new code paths.
Every new company is pure supply. Lever (+~864 jobs) only after this.

## Rules (non-negotiable)
- MIT-licensed sources only (verify LICENSE file at download). No CC BY-NC.
- Every candidate is validated LIVE before it enters our files: the ATS
  endpoint must answer 200 with a real job list. No guessed slug goes in
  unvalidated (blueprint §12.1).
- Bootstrap data never becomes a runtime dependency — we copy identifiers
  into our own files, then the source repo can vanish.
- Measure before and after: company counts + board total, per ATS.

## Steps
1. **Baseline** — count current companies per ATS and current board total.
   Record below.
2. **Fetch sources** — clone/download ats-scrapers and FreeHire company
   lists (check LICENSE = MIT first). OpenJobs + state-of-ats-2026 as
   cross-check.
3. **Extract candidates** — pull Greenhouse board tokens, SR company IDs,
   Ashby board names from the sources. Dedupe against our existing files.
   Record: how many NEW candidates per ATS.
4. **Validate live** — run each candidate through the probe scripts
   (probeSR.mjs, probeAshby.mjs, greenhouse check). Keep only: responds
   200 + returns >0 jobs + response shape matches the ATS. Be polite:
   throttled, batched, resumable.
5. **Merge survivors** into greenhouse_companies.json / sr_companies.txt /
   ashby_boards.txt. Commit the updated lists.
6. **Run the pipeline** (or wait for the 6h cron). All existing filters
   apply automatically — new jobs arrive pre-filtered and pre-tagged.
7. **Measure after** — board total per ATS vs baseline. Run
   filterCheck.mjs 100 since the company mix changed. Eyeball the report.
8. **Record results** below and tick this task in PROJECT_CHECKLIST.md.

## Guards
- If validation pass-rate from a source is very low (<30%), distrust the
  whole source list rather than adding its survivors blindly.
- Watch the first pipeline run after merge: duration, failure count, and
  the sweep staying under its 0.25 cap.
- Render free tier + Mongo Atlas free tier: if the board grows past what
  the tier handles (slow queries), stop adding and reassess.

## Numbers (fill in)
- Baseline companies: greenhouse ___ / SR ___ / ashby ___
- Baseline board total: ___
- New candidates found: GH ___ / SR ___ / ashby ___
- Survived validation: GH ___ / SR ___ / ashby ___
- Board total after first run: ___

## Not in scope
Lever/Workable connectors, Company Registry (D1), discovery engine.
