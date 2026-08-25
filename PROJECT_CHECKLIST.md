# International Student Job Board — Master Project Checklist

**Single source of truth. One document, updated as work completes.**

Last updated: 21 August 2026
Repo: `MantriAravind/resume-optimizer` · Latest commit: `2f401dc`

---

## How to use this document

Every task has three parts:

- **What** — the work itself
- **Why** — what breaks or stays broken without it
- **Done when** — an objective test, so "done" is not a judgement call

Mark a task `[x]` only when the *Done when* condition is literally true. A task that
"mostly works" is not done; half-finished work that looks finished is how a board ends up
serving jobs nobody can apply to.

Phases run in order. Within a phase, tasks can be done in any order unless noted.

---

## Where the project stands today

**The product works.** A student can search 40,241 jobs, filter out roles that would reject
them for visa status, optimize a resume against a posting, apply, and track what they sent.
Three job sources refresh themselves every few hours without supervision.

**Nobody has used it.** No student has been observed using the product, and none has been
asked whether they would pay for it.

That gap — a working product with unverified demand — is what this plan is ordered around.

| | |
|---|---|
| Jobs on the board | 40,241 |
| Sources live | Greenhouse (25,752), SmartRecruiters (11,399), Ashby (3,090) |
| Filter patterns | 97, audited weekly |
| Registered users | 1 (the founder) |
| Revenue | $0 |
| Payment processor | none |

---

# PHASE 0 — Already complete

Recorded so progress is visible and so nobody rebuilds it. Nothing here needs action.

### Sourcing
- [x] Greenhouse connector, 5,441 company boards, refreshing every 4 hours
- [x] Ashby connector, 585 boards, refreshing every 2 hours
- [x] SmartRecruiters connector, 259 companies, refreshing every 4 hours
- [x] All three run in GitHub Actions on separate concurrency groups
- [x] Every source writes one identical job shape using shared helper functions
- [x] Sweeps scoped per source, so no connector can delete another's jobs
- [x] Mass-deletion guard on every sweep (aborts above 25%)
- [x] A failed fetch never closes jobs — only companies that answered are swept
- [x] Lever evaluated and declined on measurement (~864 jobs, 2% gain); scripts retained

### Filtering
- [x] 97 disqualifier patterns covering citizenship, clearance, ITAR/export control,
      no-sponsorship phrasings, and licensed-profession titles
- [x] `filterCheck.mjs` audits the real filter against live data, not a copy
- [x] Location allow-list — a job is US only if it shows a US signal
- [x] Structured country codes used where the ATS provides them

### Product
- [x] Two-pane job board with ranked search, filters, duplicate grouping
- [x] Resume optimizer with ten anti-fabrication gates
- [x] Application tracker with the resume actually sent, and a return prompt
- [x] Closed-posting detection surfaced in the detail pane for all three sources
- [x] DSO confirmed monetization is permitted

---

# PHASE 1 — Ready for a first real user

**Goal: a stranger can sign up, use the product, and not encounter a promise it cannot keep.**

Small work, large consequence. Everything here blocks having users at all, and none of it
takes more than a few hours.

- [ ] **1.1 Buy a domain**
  - **What:** purchase one `.com`, point DNS at Vercel
  - **Why:** production auth cannot be enabled without a verified domain. This one $12
    purchase has blocked the item below for over three weeks
  - **Done when:** the site loads on the new domain over HTTPS

- [ ] **1.2 Move Clerk to production keys**
  - **What:** add the domain in Clerk, verify DNS, swap the environment keys on Vercel
  - **Why:** the sign-in box currently says "Development mode". Dev instances are rate
    limited and unsupported for real traffic, and login is the only door into the product
  - **Done when:** the sign-in screen shows no development banner, and a fresh account can
    sign up and reach the board
  - **Blocked by:** 1.1

- [ ] **1.3 Make the pricing page honest**
  - **What:** the page advertises $12 Pro, $39 Team and "Cancel anytime", reachable from a
    button on every page. Either remove the prices or label them clearly as planned
  - **Why:** there is no payment processor and no entity. The page currently promises a
    subscription that cannot be bought or cancelled
  - **Done when:** nothing on the page states a price that can be paid today

- [ ] **1.4 Capture interest instead of taking money**
  - **What:** wire the Upgrade button to record the click and capture an email, with copy
    saying Pro is not open yet
  - **Why:** this is the willingness-to-pay signal that has been missing since the start.
    It needs no processor and no entity, because asking is not charging
  - **Done when:** clicking Upgrade stores a row (email, tier clicked, timestamp) and the
    person sees an honest confirmation

- [ ] **1.5 Remove dead code from the tracker build**
  - **What:** the `attachOnly` path in `server.js` and its caller in `OptimizeModal.jsx`
    can never execute while direct applies are untracked
  - **Why:** code that cannot run is a trap for whoever reads it next, including you
  - **Done when:** no reference to `attachOnly` remains and the tracker still works end to end

---

# PHASE 2 — Prove someone wants this

**Goal: five real conversations, and a decision made on evidence rather than assumption.**

This is the phase that has not moved in four working sessions. Every task below is
conversation, not code.

- [ ] **2.1 Draft five questions**
  - **What:** a short interview script about how students currently search, what they do
    when a posting turns out to require citizenship, and what they would pay to avoid it
  - **Why:** unstructured chats produce agreement, not information. People say "that sounds
    useful" to be kind
  - **Done when:** five questions exist, none of which can be answered "yes" out of politeness

- [ ] **2.2 Talk to five F-1/OPT students**
  - **What:** five conversations, using the script
  - **Why:** no student has ever confirmed they would pay. Every pricing and feature
    decision so far has been a guess
  - **Done when:** five conversations are complete and written up

- [ ] **2.3 Watch one student use the product**
  - **What:** sit with someone, give them no instructions, and watch
  - **Why:** every serious bug this month was found by looking at the real thing. The
    product has never been observed in someone else's hands
  - **Done when:** one session is complete and the friction points are written down

- [ ] **2.4 Decide, in writing**
  - **What:** based on 2.2 and 2.3, write down whether to charge, what for, and how much —
    or whether the answer is that nobody would pay
  - **Why:** the decision should be recorded so a bad month later does not quietly rewrite
    what students actually said
  - **Done when:** a short written decision exists, including the case against

---

# PHASE 3 — Make the machine trustworthy

**Goal: the board keeps working without supervision, and quietly breaking becomes impossible.**

The connectors work. What is missing is knowing when they stop working.

- [ ] **3.1 Build the Company Registry**
  - **What:** replace the flat files (`greenhouse_companies.json`, `ashby_boards.txt`,
    `sr_companies.txt`) with one database collection holding: company, ATS, identifier,
    status (`active` / `needs_validation` / `needs_rediscovery` / `disabled`), confidence,
    evidence URL, last validated, last successful sync
  - **Why:** the current lists decay silently. 36% of Greenhouse slugs are dead, 20 Ashby
    boards fail every single run, and nothing distinguishes "company left this ATS" from
    "the request timed out". This is the single biggest structural gap in the system
  - **Done when:** all three connectors read companies from the registry, and a failing
    company is marked rather than silently retried forever

- [ ] **3.2 Record every sync run**
  - **What:** a `SyncRun` collection — source, start, end, companies attempted, answered,
    jobs saved, jobs swept, errors
  - **Why:** right now a run's outcome exists only in a GitHub Actions log that scrolls away.
    There is no way to answer "when did SmartRecruiters start failing?"
  - **Done when:** every scheduled run writes a row, and the last 30 runs can be listed

- [ ] **3.3 Alert on anomalies**
  - **What:** notify when a source's job count drops sharply, a connector's success rate
    collapses, or a sweep aborts on the guard
  - **Why:** the guards already prevent disaster, but nobody is told when one fires. A
    source could be dead for days
  - **Done when:** an artificial failure produces a notification you actually receive

- [ ] **3.4 Two-strike closure for fragile sources**
  - **What:** require two consecutive successful scans confirming a job's absence before
    closing it
  - **Why:** one flaky response currently removes real jobs. The blueprint calls this out
    and it costs little
  - **Done when:** a job absent from exactly one successful scan survives until the next

- [ ] **3.5 Weekly filter audit as routine**
  - **What:** `node filterCheck.mjs 100`, read both the suspicious and over-blocked lists
  - **Why:** three real leaks were found this week and every one was found by reading
    output, never by reading code
  - **Done when:** the audit has been run and reviewed for two consecutive weeks

---

# PHASE 4 — Grow supply

**Goal: more companies, not more platforms.**

Ordered deliberately. Every source so far came from tech job repos, which is why the board
is tech-heavy and why healthcare and finance companies on the same platforms were never found.

- [ ] **4.1 Bootstrap import from open company lists**
  - **What:** import company/ATS mappings from `ats-scrapers`, `FreeHire`, `OpenJobs` and
    `state-of-ats-2026`; validate every mapping against the live API before activating
  - **Why:** these are existing, MIT-licensed company registries — potentially thousands of
    companies for a few hours of work. All four repos were confirmed live
  - **Done when:** each source's license is checked and recorded, candidates are validated,
    and the count of genuinely new companies per ATS is measured
  - **Note:** do not import any non-commercial-licensed dataset. Check, do not assume

- [ ] **4.2 Career-page discovery**
  - **What:** from a company's own domain, follow `/careers`, detect the ATS host pattern,
    extract the identifier, validate it
  - **Why:** the blueprint is right that this is the strongest evidence — the mapping comes
    from the employer themselves. It also detects migrations, which nothing currently does
  - **Done when:** given a list of company domains, the crawler produces validated registry
    entries with evidence URLs

- [ ] **4.3 Archive and index discovery**
  - **What:** Wayback and urlscan.io for recently seen ATS URLs; Common Crawl for bulk
  - **Why:** these are free, and they reach companies no tech job repo covers
  - **Done when:** at least one method adds validated companies the bootstrap import missed

- [ ] **4.4 Reconsider Lever and Workable**
  - **What:** re-measure Lever once the registry has more companies; measure Workable, which
    is a single call with descriptions included, the same easy shape as Ashby
  - **Why:** Lever was declined at 864 jobs because the company list was small. More
    companies changes the arithmetic. Workable's yield has never been measured
  - **Done when:** both are measured against the expanded registry and a written decision exists

- [ ] **4.5 Workday**
  - **What:** the largest source by volume. Needs tenant, shard and site discovered from a
    real career URL; POST-based paginated API
  - **Why:** it is where large-employer jobs live, and none of them are on the board today
  - **Done when:** a measurement script reports jobs, runtime and filter behaviour, and a
    written decision follows
  - **Note:** hardest connector. Do this only after 4.1–4.3 have grown the registry

---

# PHASE 5 — Visa intelligence

**Goal: say something true about sponsorship that no competitor can say.**

The filter currently removes jobs that refuse sponsorship. It cannot confirm that a job
sponsors. That distinction is the product's honesty and must not blur.

- [ ] **5.1 Sponsorship data engine**
  - **What:** ingest the USCIS H-1B Employer Data Hub and DOL LCA disclosure files; match
    employers conservatively to companies in the registry
  - **Why:** it converts a negative promise ("won't reject you") into a factual positive
    ("sponsored 142 H-1B visas in FY2023")
  - **Done when:** a company page can show a sponsorship count sourced from government data,
    with the year and source stated
  - **Note:** verify current dataset URLs and years before starting. Name matching is the
    hard part — "Stripe" versus "STRIPE, INC." — and a wrong match is worse than no badge

- [ ] **5.2 Evidence-backed classification**
  - **What:** store the matched pattern and text snippet alongside every filter decision
  - **Why:** today a job is dropped with no record of why. Evidence makes audits fast and
    mistakes correctable
  - **Done when:** any filtered job can be explained by showing the rule and the sentence

- [ ] **5.3 Never claim what cannot be proven**
  - **What:** a standing review that no label anywhere says a job will sponsor
  - **Why:** past sponsorship is not a promise about this role or this applicant
  - **Done when:** every visa-related label on the site states a fact, not a prediction

---

# PHASE 6 — Operate

**Goal: run it without reading logs.**

- [ ] **6.1 Admin dashboard** — job counts by source, sync success, companies needing
      validation, mass-deactivation warnings, filter overrides
- [ ] **6.2 Apply-link health** — detect and suppress broken Apply destinations
- [ ] **6.3 Cost controls** — hash descriptions to skip unchanged AI work; trim job text
      before sending to the optimizer
- [ ] **6.4 Legal review** — ATS terms, content-republication limits, and a decision on
      full descriptions versus excerpts
- [ ] **6.5 Key rotation and history audit** — scan git history for committed secrets;
      rotate MongoDB, OpenAI and any other keys

---

# Deliberately not doing

Recorded so these are not reopened without new information.

| Decision | Reason |
|---|---|
| No job aggregators (Indeed, LinkedIn, ZipRecruiter) | They are competitors, not suppliers. APIs closed or paid, terms forbid scraping, LinkedIn has sued. A student can already search Indeed — the point is filtering it cannot do |
| No "Sponsors visa" badge until Phase 5 | The filter proves a job does not refuse. It cannot prove a job sponsors |
| No saved / hidden folders in the tracker | Applied only. Tabs earn their place when there is more than one thing to hold |
| No status pipeline (applied → interviewing → offer) | A log stays true without maintenance; a pipeline does not |
| Applied status is one-way | Removing the row is the way back, and it reads as what it is |
| Direct applies are not tracked | Produced rows with no resume, and copy the product could not stand behind |
| Greenhouse slug guessing | Measured at 1.3%. Exhausted |
| iCIMS, Taleo, SuccessFactors | No public API. HTML scraping breaks unattended, and the pipeline runs unsupervised |

---

# Working rules

Earned, not theoretical. Each one comes from something that went wrong.

- **Measure before building.** `ashbyCheck` and `srCheck` answered "will the filter survive
  this source" before a line of connector code existed. `srCheck` found three real filter
  bugs — two of which were already leaking on live sources
- **Read the real output.** Every serious bug this month was found by looking at the board,
  a report, or a resume. None were found by reading code
- **Verify against the artifact, not the plan.** The Greenhouse slug guesser looked like a
  2.3% success until the company names were checked. Then it was 0.7%
- **Test on localhost before pushing**, and remove `VITE_BACKEND_URL` from
  `frontend/.env.local` afterwards
- **Complete files, never snippets**
- **A downloadable prototype before any UI work**
- **Restart the backend after every backend change**
- **`node --check` does not catch ESM syntax errors** — use `new vm.SourceTextModule(src)`
- **Filenames are case-sensitive in CI** — `FetchJobs.mjs` capital F, `fetchAshby.mjs` lower
- **Windows** — `move` needs `-Force`; watch for `(1)` suffixes and stripped extensions

---

# Progress

| Phase | Tasks | Done |
|---|---|---|
| 0 — Complete | 18 | 18 |
| 1 — First user | 5 | 0 |
| 2 — Validation | 4 | 0 |
| 3 — Trustworthy | 5 | 0 |
| 4 — Supply | 5 | 0 |
| 5 — Visa intelligence | 3 | 0 |
| 6 — Operate | 5 | 0 |
| **Total remaining** | **27** | **0** |

---

**Next task: 1.1 — buy a domain.**
