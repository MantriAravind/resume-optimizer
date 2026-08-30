# Optyply — Master Project Document & Checklist

One document, end to end: what exists, what the blueprint planned, what the
audit found, and every task from here to "finished." Replaces the previous
PROJECT_CHECKLIST.md and absorbs the Aug 21 "International Student Job Board
Project Blueprint v2" (audited below; original archived in Downloads, this
file is the operational truth).

Lives in the repo. Updated as part of every session's closing commit.
Mark `[x]` only when the "Done when" condition is literally met.

Last updated: 2026-08-27 (late)

---

# PART I — WHAT OPTYPLY IS

A job board + AI resume optimizer for international students (F1/CPT/OPT/
STEM OPT) at optyply.com. The honest promise: **jobs that won't reject you
for needing a visa** — postings that explicitly require citizenship or a
clearance, or explicitly refuse sponsorship, are removed. The filter
confirms a job does NOT refuse sponsorship; it never claims a job WILL
sponsor. Evidence-backed sponsorship badges come only after the
sponsorship-data engine exists (Part IV, Phase E).

Stack: React/Vite on Vercel · Node/Express on Render (free tier, sleeps) ·
MongoDB Atlas · Clerk auth (production, Google OAuth published) · Anthropic
API (Haiku analyze / Sonnet optimize, 30-day Mongo analyze cache) ·
Chrome/Puppeteer PDF + docx Word export · GitHub Actions pipeline every 6h
with concurrency guard. Repo: MantriAravind/resume-optimizer (public).
Local: C:\Users\Mantr\resume-optimizer, Windows/PowerShell.

---

# PART II — CURRENT STATE (verified, as of 2026-08-25)

## Live product
- optyply.com live: A record + www CNAME (Namecheap), SSL, www 308→apex.
- Auth end to end: Clerk production (5/5 DNS), forced post-auth redirect to
  /jobs, RequireResume guard (fails open only if backend unreachable — by
  design, documented in App.jsx). Google OAuth on own Google Cloud client,
  consent screen "In production," privacy/ToS links wired. Verified by an
  external user: Google sign-in → onboarding → resume upload → extraction →
  board.
- Onboarding is a hard gate: signed-in users without a resume cannot reach
  the board (Aravind's deliberate design; revisit only with A3 evidence).
- Board: ~61,966 jobs total; **~53,750 visible to students** after licensed-
  profession hiding (companies GH 7,693 / Ashby 3,794 / SR 4,158).
  Full expansion story: PLAN_company_expansion.md. Original employer Apply URLs preserved; frontend only calls our
  API, never ATS providers (matches blueprint §18).
- Honesty sweep COMPLETE: landing, pricing (/pricing + landing section),
  FAQ, privacy, terms, contact, onboarding copy all truthful. No fake
  tiers, no fake caps, no fake support promises. Rebrand ResumeAI→Optyply
  done everywhere incl. tab title. support@optyply.com forwards to Gmail.
- Landing job count is dynamic (jobCount.toLocaleString()) — self-corrects.

## Pipeline & filtering
- ~98 description disqualifier patterns (citizenship, clearance, ITAR,
  no-sponsorship; incl. labelled-field "Sponsorship Available: No").
- US-location allow-list (fail-safe: unknown locations dropped).
- Contract/part-time filter. Age gate at fetch, 30-day window, real
  first_published dates.
- Title layer in jobCategory.mjs (single shared module, three exports):
  categorizeJob (field tag), requiresLicense (silent licence barriers,
  reversible flag), isHourlyJob (store/route/food-service — drop at fetch,
  wired into shared isDisqualified as title-only check across all three
  fetchers). Documented traps: bare cook (Cook County), bare host (Airbnb
  Host teams), driver/server/warehouse compounds only, CSR caught by
  franchise store-number signature.
- purgeHourly.mjs: dry-run default, 10% share cap, deletes by scanned _id
  list. Ran once: 3,614 deleted (Domino's 3,274), 39,617 → 36,003.
- filterCheck.mjs spot-checker (Greenhouse-only sampling; logic shared).

## Validation & business
- DSO email SENT 2026-08-25 (may an F1 student earn revenue from a
  self-built product; does OPT/STEM OPT change it). Awaiting reply.
- Zero students have confirmed willingness to pay. Interview questions
  drafted (Part IV, A2). Google-test friend = candidate #1.
- No payment processor, no legal entity, no prices anywhere on the site —
  deliberately, until validation answers arrive.

---

# PART III — BLUEPRINT AUDIT (Aug 21 doc vs reality)

## Adopted and already true
| Blueprint says | Status |
|---|---|
| Direct-source first, preserve employer Apply URLs | Done since day one |
| Frontend never calls ATS directly (§18) | True |
| One connector per ATS, shared normalization | True (FetchJobs shared helpers) |
| Excluded-class visa filtering with conservative rules (§17) | True — our disqualifiers ARE the Excluded class |
| Never interpret silence as sponsorship (§3.2) | True — core honesty rule |
| Bootstrap sources must never be runtime dependencies (§4) | True — pipeline runs on own slug files |
| Mass-drop protection (§16.2) | Partial — MAX_SWEEP_SHARE exists; must return to ~0.25 (C2) |

## Blueprint right, not yet built (the real gaps)
| Gap | Blueprint § | Why it matters | Task |
|---|---|---|---|
| Company Registry (DB collection: status/confidence/evidence/lastValidated) | §10 | 36% of Greenhouse slugs confirmed dead; flat text files can't track health | D1 |
| Safe closure rule: failed sync must never close jobs; only successful scans close | §16 | UNVERIFIED in our pipeline — if a failed fetch marks jobs stale, that's silent data loss | C1 (verify first) |
| SyncRun metrics + anomaly alerts | §19–20 | Pipeline runs blind; a broken fetcher would be noticed by accident | D3 |
| Content hash to skip unchanged descriptions | §13.2 | Saves compute; matters at scale, not now | D4 |
| Discovery engine (career crawler, Wayback, urlscan, Common Crawl) | §11 | How tomorrow's new ATS customers enter the board | E2 |
| needs_rediscovery / ATS-migration workflow | §16.3 | Dead slugs currently just rot | D1 includes |

## Deferred or rejected, with reasons (decisions, not omissions)
- **Workday, iCIMS, Oracle, SAP (§8 Tier 2–3):** rejected for solo scale.
  Enterprise connectors are a team's quarter each. ATS expansion = Lever
  (~864 jobs, scripts exist) + Workable only, added AFTER categorization so
  they arrive pre-tagged. Revisit only if the business proves out.
- **Admin dashboard (§18.1):** rejected — Aravind is the admin; scripts +
  filter-report.md serve the need at this scale. Revisit at first hire.
- **4-hour cadence (§13.1):** stays 6h. Zero users notice; GH Actions
  minutes and ATS politeness win.
- **Positive/Likely visa classes (§17):** deferred until the sponsorship
  engine (E1) exists. Showing "likely sponsors" without stored evidence
  violates the product's one non-negotiable: never overpromise sponsorship.
- **Full TypeScript restructure (§28):** rejected — working .mjs modules
  with heavy comments beat a rewrite. Adopt the *shape* (connectors/
  discovery/ingestion separation) as files grow, not a migration project.
- **Feashliaa CC BY-NC dataset:** never import without permission (§21).
  MIT sources (ats-scrapers, FreeHire, OpenJobs, state-of-ats-2026) OK for
  bootstrap AFTER licence check at import time.
- **Blueprint's blind spot, corrected here:** it contains no validation, no
  pricing, no user research. Part IV's Phase A (validation) outranks every
  engineering phase. Architecture serves the business question, not the
  other way around.

---

# PART IV — THE ROADMAP: EVERY REMAINING TASK

Ordered by phase; within a phase, by priority. Calendar-gated items first
always.

## Phase A — Validation (HIGHEST PRIORITY; blocks pricing, gates business)
- [x] **A1. DSO email** — sent 2026-08-25. When the reply arrives: read
  together, record the decision verbatim in Part V.
- [ ] **A2. Five student conversations.** Questions (drafted, tune freely):
  1. Walk me through the last time you applied for jobs — step by step.
  2. How do you currently figure out whether a company will sponsor you?
  3. In the last three months, what have you spent money on for your job
     search — anything at all?
  4. How many hours a week on applications, and which part do you most
     wish would disappear?
  5. (Only after they use the product, pairs with A3:) If this cost money
     next month, would you keep using it — and what's the most you'd
     grudgingly pay?
  Rules: never pitch first; product stays unexplained until Q4; write
  answers verbatim; only BEHAVIOR counts as evidence ("I paid $40 for a
  resume review"), not opinions ("I'd totally pay").
  Done when: five real conversations, answers written in Part V.
- [ ] **A3. Watch one student use the product** — say nothing, take notes.
  Google OAuth blocker is cleared. Done when: notes in Part V.
- [ ] **A4. Write the go/no-go pricing decision down, including the case
  against.** Structural notes so far: board stays free (acquisition,
  near-zero marginal cost); optimizer is the metered thing (~5¢/run, a
  heavy student = $3–5/mo); consider a per-job-search pack over a monthly
  subscription (students churn when the search ends); Q3's answer sets the
  price ceiling.
- [x] **A5. Fabrication check** — RESOLVED 2026-08-26. First audit looked
  like fabrication; Aravind's testimony established every flagged skill
  (PHI/PII, Redshift, healthcare) was user-confirmed in the wizard, and
  reading /optimize showed a 10-rule prompt + code gate (inventedBullets,
  inventedSections, cert stripping) already enforcing honesty. Shipped on
  top: aggressive-but-honest weaving (scan every bullet before skills-list
  fallback), gap-naming feedback, EXACTLY-ONE-skills-section rule (Rule 4/
  Rule 10 collision produced duplicates), and all-green review highlighting
  of every AI-introduced word in every section (word-boundary matching —
  "RDS" no longer marks inside "standards"). Decision on record: invented
  bullets REFUSED even as an option; skills-list fallback + named gap is
  the honest ceiling. Known small gap: the "where they went" feedback prose
  is model-written and once claimed bullet placement that didn't happen —
  compute it in code someday (see Phase C add-ons).

## Phase B — Close out the product shell
- [ ] **B1. Waitlist capture (was 1.4).** Both "Join the waitlist" buttons
  currently link to /signup. Done when: click records email + interest in
  a Mongo collection and thanks the user. Small backend endpoint + tiny UI.
- [ ] **B2. Site-wide font fix** — 'Plus Jakarta Sans' referenced in CSS
  but never loaded; body text falls back to serif. One <link> in
  index.html. Verify on /pricing and landing after.
- [ ] **B3. "there / Free plan" sidebar bug** — name fallback renders bare
  "there" when sign-up had no first name.
- [ ] **B4. Clerk sign-up page theming** — default Clerk look; match Space
  Grotesk/warm theme via Clerk appearance config.
- [ ] **B5. In-app account deletion** — privacy page promises email
  deletion in 30 days (keepable now); this is the roadmap button it
  references. Includes deleting stored resume text.
- [ ] **B6. Remove dead attachOnly code.**
- [ ] **B7. Concise/Standard toggle is fake** (font size only). Make real
  or remove — an honesty item, same class as the pricing pages.

## Phase C — Pipeline correctness & safety (verify before building)
- [ ] **C1. VERIFY the safe-closure rule (blueprint §16).** Read what each
  fetcher does when a company fetch FAILS: do existing jobs survive
  untouched? Only successful scans may mark jobs missing. If violated, fix
  before anything else in this phase — silent data loss.
- [ ] **C2. MAX_SWEEP_SHARE back to ~0.25** (raised to 0.50 for one-time
  backlog clear; at 0.50 a future bug can delete half the board
  unchallenged).
- [ ] **C3. Field filter end to end (was 3.3).** Fetchers already tag
  field + needsLicense. Verify: did backfillCategories.mjs run (check a
  Mongo doc)? Server accepts ?field=? UI dropdown in first filter
  position? Done when: a student picks "Tech" and sees only Tech.
- [x] **C4. Labelled-field disqualifier verified clean** across three
  filterChecks at 36k→62k scale. Done 2026-08-26.
- [ ] **C5. Weekly filterCheck routine** — `node filterCheck.mjs 100`
  after any pipeline change and ~weekly. Read together: "look US" count,
  unknown list for real US cities, "Passed but suspicious". Known noise:
  Exadel Georgia country/state collision.
- [ ] **C6. Extend filterCheck to sample SR + Ashby** — Greenhouse-only
  today; SR/Ashby title mixes (franchise floods) invisible to it. Starting
  points: srCheck.mjs, ashbyCheck.mjs.
- [ ] **C7. Rate-limit the optimize endpoint** — any signed-in user can
  burn API budget. Until built: check Anthropic console spend weekly.
- [ ] **C8. Key rotation + git-history scan** — repo is PUBLIC; scan
  history for MongoDB URI, RapidAPI, Anthropic keys; rotate anything ever
  committed. (PDFSHIFT key already deleted from Render 2026-08-17.)
- [x] **C9a. Zero-yield SR company prune — EXECUTED 2026-08-27.**
  measureSRYield.mjs: 3,620 of 4,158 companies (87%) contribute zero jobs;
  538 supply all ~17.4k SR jobs. pruneSRCompanies.mjs (preview→apply):
  live list cut to 538; removed 3,620 SAVED to sr_pruned_companies.txt for
  re-audition + sr_companies.backup.txt committed — reversibility built in.
  Drop-sample eyeball found grab/fartherfinance/lely (real companies, zero
  filtered yield — overseas or dead boards; restorable by one line if they
  revive). VERIFIED by the next manual run: 55m30s (was 2h42m — a third),
  538/538 answered, 0 failed, SR jobs 17,385 vs 17,408 pre-prune (the
  3,620 cut companies contributed ~23 jobs), listings 277k → 111k.
  Remaining runtime is the ~29.7k detail calls for REAL jobs — the future
  lever there is E3 description handling, not more pruning. Board 59,530.
- [x] **C9f. Domino's pattern war — CONCLUDED 2026-08-27.** SR expansion
  re-imported 2,439 Domino's store jobs that dodged the original patterns.
  Five hardening rounds against REAL titles: plural pizza makers; franchise
  store-number signature generalized to managers/supervisors/team leads;
  restaurant-leadership compounds (Raising Cane's); wage-in-title
  ("$17.50 Hourly Pay"); dash/prefix/suffix number shapes; two-tier role
  anchoring after the preview caught "(711) Senior Manager, Talent
  Acquisition" (Arlo — req number, not store number: loose roles now
  glued-only); Domino's-brand-adjacent managers ("Dominos General Manager -
  North Everett"). Purged 2,380 + 143. Accepted residue: bare "Assistant
  Manager"/"CSR" titles indistinguishable from corporate (~200 jobs) —
  matching them would hide real jobs. KEY FACT: the Dominos slug also
  carries REAL corporate roles (Platform Engineer, Marketing Technology) —
  company-level bans are wrong; title patterns are the right tool.
- [ ] **C9b. Compute "where they went" in code** — the optimize feedback
  prose is model-written and has claimed bullet placement that didn't
  happen; derive each landed skill's section programmatically.
- [x] **C9c. License-flag hiding** — SHIPPED 2026-08-26. Protocol run in
  full: measured (8,042 flagged, 12.9%), sampled 20/20 genuinely gated,
  discovered the /jobs query filter + compound index ALREADY existed in
  server.js but had never behaved on prod (deploy lag). Added rule 0 to
  requiresLicense: a title whose HEAD contains \blicensed\b is gated
  (Licensed Psychologist/Optician/Loan Consultant were all false before);
  head-only so "Software Engineer, Licensed Products" survives. Backfilled
  with preview→write (8,217 hidden; the 10 Tech/E&S hits eyeballed = PLS
  surveyors + PE civil engineers, all correct). Board search "licensed":
  hundreds → 20 residual mid-title cases (accepted; minor item below).
- [x] **C9d. Gym/spa/wellness floor titles** — SHIPPED 2026-08-26 after
  Aravind found Equinox's entire board (spa desk, style advisor,
  membership sales, personal trainer) on the site. New isHourlyJob
  pattern group, 26 tests incl. traps (AI Model Trainer, Agile Coach,
  Membership Growth PM all survive) + regression sweep (host/cook/
  Domino's/licensed). purgeHourly preview eyeballed (40/40 hourly),
  213 deleted. NOTE: Claude's working copy nearly regressed the bare-host
  fix — caught by grep before staging; lesson logged in Part VI.
- [ ] **C9e. Mid-title licensed residue (minor)** — ~20 titles like
  "Neurology - CA Licensed", "Assistant GM, Licensed Cosmetologist"
  survive the head-only rule. Possible pattern: licensed + profession
  noun anywhere. Low value; only if it grows.
- [ ] **C9. Group duplicate postings** — same job per location ("New York,
  NY +2 more" + picker). Designed and previewed; needs backend change.
  Blueprint §16 dedupe, our variant.

## Phase D — The registry & operations (blueprint's core, right-sized)
- [ ] **D1. Company Registry (blueprint §10, biggest structural gap).**
  Replace flat slug files with a Mongo collection per mapping:
  {companyName, atsType, atsIdentifier, careerUrl, status(active/
  needs_validation/needs_rediscovery/disabled), confidence, discoveredBy,
  evidenceUrl, lastValidatedAt, lastSuccessfulSyncAt, consecutiveFailures}.
  Includes the migration workflow: repeated failures → needs_rediscovery
  instead of silent rot. Migrate existing slug files in as status=active
  with discoveredBy=legacy. Done when: fetchers read companies from the
  registry and a dead slug flips to needs_rediscovery automatically.
- [x] **D2. Bootstrap import** — DONE 2026-08-25/26 in flat-file form
  (registry doesn't exist yet): 5 MIT repos → extractCandidates.mjs →
  validateCandidates.mjs (live 200+jobs check, cloud-run via
  validate-candidates.yml) → staged merges → board 31,398→61,990.
  9,434 companies added; 74 dead GH slugs pruned via dead_slugs.json.
  Full story: PLAN_company_expansion.md. When D1 (registry) is built,
  migrate these lists in as discoveredBy=bootstrap.
- [ ] **D3. SyncRun metrics + anomaly alert (blueprint §19–20, minimum
  viable).** Each pipeline run writes one SyncRun doc {ats, companies
  attempted/succeeded, jobs fetched/new/closed, duration}. Alert = the GH
  Actions job FAILS LOUDLY (non-zero exit → email) when: an ATS success
  rate collapses, or job count swings beyond a threshold vs last run. No
  dashboards — a failing Action IS the alert at this scale.
- [ ] **D4. Content hashing** — skip re-processing unchanged descriptions
  (blueprint §13.2). Do with D3; cheap once SyncRun exists.
- [ ] **D5. ATS expansion: Lever, then Workable** — AFTER C3 so new
  sources arrive pre-tagged. Lever scripts exist (leverCheck.mjs,
  probeLever.mjs, lever_companies.txt, ~864 jobs). Each enters via the D1
  registry, never new flat files.
- [ ] **D6. Broken-Apply detection (blueprint §18)** — periodic sample
  check that Apply URLs resolve; suppress jobs whose Apply is dead. Trust
  item: a student's wasted click is the product breaking its one promise.

## Phase E — The moat (only after Phase A proves the business)
- [ ] **E1. Sponsorship-data engine** — USCIS H-1B Employer Data Hub + DOL
  LCA disclosure files; conservative company-name matching;
  evidence-backed badges ONLY ("Sponsored 142 H-1B visas in FY2023"),
  never "will sponsor you". Unlocks the parked H1B directory tab AND
  blueprint §17's Positive/Likely classes, now with stored evidence,
  rule versioning, and a manual audit set — as §17.1 requires.
- [ ] **E2. Discovery engine, right-sized (blueprint §11)** — start with
  Method A only (employer career-page crawler: domain → /careers →
  detect ATS host → extract identifier → validate → registry) plus
  conservative slug probing (guessSlugs.mjs exists). Wayback/urlscan/
  Common Crawl only if coverage demands it.
- [ ] **E-logo. Company logos on job cards** — Aravind's blueprint
  (Company_Logo_Integration_Blueprint.docx) audited 2026-08-27: right
  architecture (company-level branding record, domain as key, provider
  adapter, initials fallback). Right-sized v1 = its Phase 1 only:
  companies collection (registry-LITE — the first real slice of D1),
  Brandfetch as single provider (free 500k/mo; its brand-search also
  solves name→domain per the blueprint's no-guessing rule), enrichment
  script preview-first for the ~1,600 companies WITH jobs, company object
  in /jobs API, fixed-size logo container + deterministic initials
  fallback. needs_review for ambiguous domains; eyeball top ~100 by job
  count. Blueprint Phases 2-3 (workers, revalidation crons, SSRF crawler,
  dashboards) deferred. $0 at current scale. NEXT ACTION (Aravind):
  create Brandfetch account, get client ID into Render env.
- [ ] **E3. Rewrite cost trim** — trim job descriptions before sending to
  the AI; do NOT downgrade the model.
- [ ] **E4. Save for later / Hide job** — persist per-user (~2–4 hrs);
  Tracker grows into saved → applied → interviewing.
- [ ] **E5. Usage metering** — only after A4 sets the pricing model.
- [ ] **E6. Rename decision** — parked pending E1. Candidates:
  SponsorBoard (honest only post-engine), OpenToSponsor, ClearToApply.
  No "Visa" in the name (Visa Inc.). Check Interstride/MyVisaJobs first.
- [ ] **E7. Legal review of privacy/terms by an attorney** — REQUIRED
  before any money is charged. Pages are truthful plain-language and say
  so.
- [ ] **E8. Blueprint §29 stakeholder decisions, Aravind's answers on
  record:** US-only ✓ full-time-only ✓ (both enforced). Still to decide
  and write in Part V: internships on/off; excerpt-vs-full description
  display (currently storing 500-char excerpt — decide consciously);
  raw-snapshot retention if D4 adds snapshots.

## Definition of DONE for the whole project
Every box above checked, and: five students interviewed with at least one
credible payment signal (or a written no-go decision); DSO answer recorded
and complied with; registry-driven pipeline with safe closure, SyncRun
metrics and loud failure alerts; sponsorship badges live with evidence; a
price on /pricing that a real person can actually pay, backed by a payment
processor and an entity — or an explicit written decision to stay free.

---

# PART V — DECISION LOG (append-only; verbatim answers live here)
- 2026-08-25: DSO email sent. Awaiting reply.
- 2026-08-25/26: Company expansion executed end to end; board doubled to
  61,990. Details + lessons in PLAN_company_expansion.md.
- 2026-08-26: A5 resolved (see A5). Aravind proposed allowing fully
  invented bullets for confirmed skills to maximize match; Claude refused
  on fabrication grounds; agreed alternative shipped: honest aggressive
  weaving + gap-naming feedback. "100% match" goal dropped as not
  legitimate (Aravind's words) — maximize honestly, show the gap.
- 2026-08-26: needsLicense jobs to be HIDDEN, not badged (Aravind, after
  reading live titles). Implementation pending (C9c).
- 2026-08-27 (close): SR prune VERIFIED — 55m30s vs 2h42m. Logo feature
  scoped from Aravind's blueprint (see E-logo); Brandfetch chosen; $0.
  Optyply brand-logo concepts drafted (aperture-O + wordmark), parked.
- 2026-08-27: SR prune executed (C9a) + Domino's pattern war concluded
  (C9f). Board ~59,400. Purge preview caught the Arlo false positive that
  reasoning missed — third time the preview-eyeball protocol earned its
  keep (Airbnb host, Cook County, Arlo).
- 2026-08-26 (evening): License hiding + wellness patterns shipped (C9c,
  C9d above). Visible board ~53,750 of ~61,966.
- 2026-08-26: SR scheduled cron measured at 2h42m → C9a promoted to
  urgent. Ashby 14m, Greenhouse 33m — both healthy.
- 2026-08-26: Rollback capability confirmed for Aravind: git revert +
  Vercel "Promote to Production" / Render "Rollback" are the tools; never
  git reset --hard on pushed commits. Gap noted: no error tracking — a
  user's optimize failure is invisible unless they email support@ (future
  item: basic error visibility).
- 2026-08-26: Field dropdown NOT built (Aravind: keywords over
  segregation; field tags stay in data). Target role made mandatory at
  onboarding + profile instead; board pre-ranks by it.
- (A2 interview answers go here, verbatim.)
- (A3 observation notes go here.)
- (A4 pricing decision + case against goes here.)
- (E8 remaining stakeholder answers go here.)

---

# PART VI — STANDING RULES (how we work; hard-won)
- Measure before building; preview before purging. The purge preview
  caught the Airbnb "Host" false positive that reasoning alone missed.
- Verify on localhost before pushing (VITE_BACKEND_URL in
  frontend/.env.local, remove after; restart backend after every .js
  change). The redirect fix "failed" locally purely because that env var
  was missing — check environment before suspecting code.
- Read the real error before patching. Read numbers together (US-look +
  foreign-slip), never optimize one in isolation.
- Use the actual file, never reconstruct from memory. Complete files only.
- Fail-safe allow-lists beat blocklists for open-ended text.
- Bare-word regexes are landmines (cook/host/driver/server/warehouse);
  compounds only, and document each trap next to the pattern.
- Deletion scripts: dry-run default, share cap, delete by scanned _id list.
- Filter changes ship only after filterCheck + eyeballing the report.
- Failed sync must never close jobs (verify: C1). Only successful scans
  close.
- Claude's working copies drift: a staged file nearly resurrected the
  bare-host bug because it predated a fix applied only in Aravind's repo.
  Before staging any regenerated file, grep it for every fix applied
  since it was uploaded.
- Anything that matters lives in the repo — not Downloads, not chat
  memory. This file updates in every session's closing commit.
- PowerShell: no `&&`; Move-Item needs -Force; em dashes break .Replace()
  (use -replace with [^"]* anchors or ASCII fragments); watch for "(1)"
  download suffixes; `q` exits the git pager.
- node --check misses ESM syntax errors; test by importing.
- Honesty is the product. Every claim on the site must be literally true
  today, or labeled as a plan. When a page and reality disagree, the page
  is the bug.

---
## Session log 2026-08-28
- FIXED+PUSHED: location filter � Georgia state/country collision, 16 missing post-Soviet/Balkan countries, Panama City FL, British Columbia/Columbia SC, European code-first postal format (JD Sports leak), Vancouver WA shield. Commits e864d5f, 36e9755, 01c5279.
- PURGED: 212 foreign jobs closed reversibly across two sweeps (179 + 33) via purgeForeign.mjs. Decision reaffirmed: never delete records for filter bugs � fix at source, purge via tooling.
- FIXED+PUSHED: fetchAshby displays US location on dual-location jobs (48f6178). server.js/JobBoard.jsx (19ba983): card logos, duplicate folding w/ company-name normalization, stable pagination (id sort tiebreaker). Verified on optyply.com production.
- LOGOS: coverage 83.7% -> ~89.5%. enrichCompanies gained --retry/--dry + whole-domain scoring (6bf3bc5). 46 overrides in branding_overrides.json. applyOverride.mjs added (5654229). Zipline squatter fixed (flyzipline.com vs Retail Zipline).
- C2 DONE: MAX_SWEEP_SHARE verified 0.25 all three fetchers, local + origin/main.
- ACCEPTED RESIDUALS: dark-variant logos (Equinox, Horizon3ai, Ready) � revisit only if users mention. filterCheck "looks US" heuristic misreads ", IN" as Indiana � report polish, low priority.
- OPEN POLICY QUESTION: contract-to-hire jobs on a "full-time only" board � ask students before deciding.
- VALIDATION: messaged friends re: student conversation #1. NEXT SESSION PRIORITY: schedule + hold it. After that: optimizer fabrication fix (A5 findings, still top engineering priority).

---
## Session log 2026-08-28 (evening)
- SHIPPED (54e76ed, verified on production): E4 save/hide jobs � JobMark model + /me/job-marks endpoints (snapshot fields survive 30-day prune; one row per user+job, saved/hidden mutually exclusive). Board: x -> Hide menu on cards, Save-for-later beside Share in detail head, hidden jobs filtered from list. Tracker: Applied/Saved/Hidden tabs with Unsave/Unhide, layout fixes (width 1400, heading aligned with Profile).
- SHIPPED same commit: card redesign � logo 72px base/56px two-pane inline, chips full width, list column 37% -> 45%.
- SHIPPED same commit: Support page at /support + sidebar item. Gmail-compose primary button (mailto is dead on machines with no mail app � observed), mailto secondary, clipboard fallback. support@optyply.com verified end-to-end: redirect works, Gmail filter created (never-spam + important).
- NOTE: "Upgrade to Pro" button audited � routes to /pricing (honesty-swept). No fake claim.
- E4 DONE. Mark [x] when checklist next open.

- 2026-08-28 late: B3 DONE � first/last name Required in Clerk (production) + display-name fallback chain in SidebarLayout; literal 'there' can no longer render as a name. B7 CLOSED by removal � /app standalone optimizer route deleted entirely (decision: board's Optimize modal is the one path; ToolPage.jsx recoverable from git history). Fabrication fix now has a single door to guard.

- 2026-08-28 late: B3 DONE � first/last name Required in Clerk (production) + display-name fallback chain in SidebarLayout; literal 'there' can no longer render as a name. B7 CLOSED by removal � /app standalone optimizer route deleted entirely (decision: board's Optimize modal is the one path; ToolPage.jsx recoverable from git history). Fabrication fix now has a single door to guard. Teaser story posted on Instagram � reveal post due within ~1 week.
