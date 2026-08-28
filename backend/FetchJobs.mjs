import mongoose from 'mongoose'
import { categorizeJob, requiresLicense, isHourlyJob } from './jobCategory.mjs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import dotenv from 'dotenv'
dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── MongoDB Job Schema ──────────────────────────────────────────────────────
const jobSchema = new mongoose.Schema({
  id:              { type: String, unique: true },
  title:           String,
  company:         String,
  companySlug:     String,
  location:        String,
  isRemote:        Boolean,
  description:     String,
  applyUrl:        String,
  postedAt:        Date,
  sponsorBadge:    Boolean,
  ats:             String,
  // Which field the job belongs to (Tech, Healthcare, Legal...). Set from the
  // TITLE by categorizeJob(). Powers the board's field dropdown.
  field:           String,
  // True when the TITLE names a role needing a US state licence or bar admission —
  // nurse, attorney, teacher, electrician. These postings never mention citizenship
  // because they do not need to: the barrier is the licence, not a sentence in the
  // text, so the 173-pattern disqualifier filter cannot see them at all.
  //
  // Flagged, not deleted. A wrong rule is fixed by editing a word and the jobs come
  // back; a wrong delete needs a full re-fetch, and anything expired at source is
  // gone for good. The first version of this filter had five false positives on real
  // data, including two sales jobs — which is the argument in one line.
  needsLicense:    Boolean,
  fetchedAt:       { type: Date, default: Date.now },
  experienceLevel: String,
  workType:        String,
  state:           String,
  salaryMin:       Number,
  salaryMax:       Number,
  employmentType:  String,
  yearsMin:        Number,
  yearsMax:        Number,
})

const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

// ── FRESHNESS WINDOW ────────────────────────────────────────────────────────
// Module scope on purpose: the fetch-time age gate and the purge at the end of
// the run MUST use the same number. Two copies would drift the moment one is
// edited, and the board would silently keep jobs it claims to have removed.
// 30, not 14. The original 14 was chosen while the pipeline was reading updated_at,
// which meant months-old postings were being kept anyway — so 14 was never really in
// force. With first_published giving true ages, a strict 14 days left only ~13,000
// jobs, thin enough that a filtered search returns almost nothing. 30 days is still
// well inside a normal hiring cycle. Tighten it again once there is usage data
// showing students prefer a fresher, smaller board.
const MAX_AGE_DAYS = 30

// The sweep deletes jobs it did not see at the source this run, and aborts if
// that share looks implausible.
//
// Briefly raised to 0.50 for a one-time cleanup: ~18,100 rows saved by the old
// code carried postedAt copied from updated_at, so their dates read as recent and
// the age purge could not see them. Only the sweep could, and at 41% the 0.25
// guard blocked it. That cleanup removed 18,149 rows and the board settled at
// ~26,100. The very next run swept 92 — 0.35% — which is what a normal run looks
// like. Back to 0.25 and it should stay there.
const MAX_SWEEP_SHARE = 0.25

// The real posting date. Greenhouse gives two dates and they mean different things:
//   first_published — when the job went live. This is what a student cares about.
//   updated_at      — when a recruiter last edited it. A six-month-old posting with a
//                     typo fix yesterday has updated_at = yesterday.
// Using updated_at made stale jobs look brand new. first_published is not on every
// posting, so updated_at stays as the fallback.
// ONE function, used by both the age gate and the saved postedAt, so the date we
// filter on can never differ from the date we show.
function postedDate(job) {
  const raw = job.first_published || job.updated_at
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

// ── HTML handling ────────────────────────────────────────────────────────
function stripHtml(html = '') {
  return html
    // NUMERIC ENTITIES FIRST, and generically.
    //
    // &nbsp; was decoded here but &#xa0; was not — the same non-breaking space, written
    // the other way. SmartRecruiters uses the numeric form, and four AECOM postings read
    // "sponsorship&#xa0;is not available for this role" and sailed straight through the
    // filter: every pattern expects whitespace between the noun and the negation, and
    // what it got was a literal ampersand-hash string.
    //
    // Decoding the whole numeric range rather than adding &#xa0; to the list, because
    // the same trap applies to every character an employer's editor might emit that way
    // — &#8217; for an apostrophe, &#8211; for a dash. One special case would have fixed
    // one sentence and left the class of bug in place.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ')
    // \s does not match a non-breaking space in JavaScript, so U+00A0 is collapsed
    // explicitly. Otherwise a decoded &#xa0; survives as a character that looks like a
    // space, prints like a space, and does not match \s+ in any pattern.
    .replace(/[\s\u00a0\u2007\u202f]+/g, ' ')
    .trim()
}

function normalize(text = '') {
  return text.toLowerCase()
    .replace(/u\.s\.a\./g, 'us').replace(/u\.s\./g, 'us').replace(/u\.s\b/g, 'us')
    .replace(/\s+/g, ' ')
}

// ── CITIZENSHIP / CLEARANCE / SPONSORSHIP DISQUALIFIERS ─────────────────────
const DISQUALIFIER_PATTERNS = [
  /\b(us|u s)?\s*citizenship\s*:?\s*(is\s+)?(required|requirement)\b/,
  /\bcitizenship\s*:\s*this\s+position\s+requires\b/,
  /\brequires?\s+(us\s+|u s\s+)?citizenship\b/,
  /\bwill\s+require\s+(us\s+|u s\s+)?citizenship\b/,
  /\bmust\s+be\s+a?\s*(us|u s)?\s*citizen\b/,
  /\b(us|u s)\s+citizens?\s+only\b/,
  /\bonly\s+(us|u s)\s+citizens?\b/,
  /\bcitizens?\s+(are\s+)?required\b/,
  /\bsecurity\s+clearance\s+(is\s+)?(required|requirement)\b/,
  /\b(require|requires|will require|must have|must possess|must hold|must obtain)\s+(an?\s+)?(active\s+|current\s+)?(security\s+)?clearance\b/,
  /\bactive\s+(security\s+)?clearance\b/,
  /\bclearance\s+required\s*:?\s*(active|public|secret|top)\b/,
  /\bclearance\s*:\s*(active\s+|current\s+|ability to obtain\s+|able to obtain\s+)?(a\s+)?(top[\s-]?secret|secret|public\s+trust|ts\/sci|ts-sci|ts\s+sci)\b/,
  /\bclearance\s+required\b/,
  /\bpublic\s+trust\s+(clearance|required)\b/,
  /\b(ability to obtain|must be able to obtain|eligible to obtain|able to obtain)\s+(a\s+)?(public\s+trust|security|secret|ts\/sci)?\s*clearance\b/,
  /\bactive\s+(top[\s-]?secret|public\s+trust|ts\/sci)\b/,
  /\b(requires?|must have|must hold|must possess)\s+(a\s+|an\s+)?(active\s+|current\s+)?(public\s+trust|top[\s-]?secret|ts\/sci)\b/,
  /\btop\s+secret\b/, /\bts\/sci\b/, /\bts\s+sci\b/, /\bts-sci\b/, /\bsecret\s+clearance\b/, /\bdod\s+clearance\b/,
  // Catch-all clearance patterns — "obtain and maintain", filler words, bare mention (aggressive by design)
  /\bsecurity\s+clearance\b/,
  /\b(obtain|maintain|hold|possess|acquire|eligible|able|ability|require|requires|required)\b[^.]{0,40}\bsecurity\s+clearance\b/,
  /\b(obtain|maintain)\b[^.]{0,30}\bclearance\b/,
  /\bsecurity\s+clearance\b[^.]{0,40}\b(required|is required|must|eligib)/,
  /\b\(clearance\s+required\)/,
  /\bclearance\b.{0,20}\bus\s+citizen\b/,
  /\bus\s+citizen\b.{0,20}\bclearance\b/,
  /\bno\s+(visa\s+)?sponsorship\b/,
  // "No new H-1B sponsorship is available for this role."
  //
  // The rule above needs "no" sitting next to "sponsorship"; this posting puts two
  // words between them, and the rest of the sentence reads POSITIVELY ("is available"),
  // so nothing anchored on a negated verb sees it either.
  //
  // The gap is a fixed list of modifiers rather than \w+ on purpose. A general gap
  // catches "there is no cap on sponsorship" and "no plans to change sponsorship" —
  // both of which mean the opposite of a disqualifier.
  /\bno\s+(new\s+|additional\s+|further\s+|current\s+|future\s+|ongoing\s+|employer\s+|employment\s+|work\s+|immigration\s+|us\s+|u\.s\.\s+|h-?1b\s+|h1-?b\s+|green\s+card\s+|visa\s+)+sponsorship\b/,
  // "This position does not include sponsorship for United States work authorization now
  // or in the future." Three AECOM postings, all refusals, none caught: the negation
  // rules look for "offer", "provide" or "sponsor" as the verb, and "include" was not
  // among them.
  //
  // Sponsorship has to follow almost immediately. A twenty-character window matched
  // "does not include relocation but sponsorship is available" — the opposite meaning —
  // so only adjacent qualifiers are allowed in between.
  /\b(does|do|will|would|can|shall)\s+not\s+include\s+(any\s+|visa\s+|work\s+|employment\s+|immigration\s+|us\s+|u\.s\.\s+)*sponsorship\b/,
  // A LABELLED FIELD whose answer is "No".
  //
  //     Visa Sponsorship Available:  No
  //     Minimum Requirements:        combination of education and experience...
  //
  // Flattened into plain text that becomes "visa sponsorship available no minimum
  // requirements combination of education", which reads like "no minimum requirements" —
  // harmless, and completely wrong. Seven Allegiant Air maintenance postings passed the
  // filter this way, on an airline that does not sponsor.
  //
  // The nearby rules all expect a negated verb or "no" sitting before the noun. Here the
  // negation is the ANSWER to a form field, after it.
  //
  // A full stop before "no" is deliberately not matched: "sponsorship available. No
  // minimum experience is required" is a different sentence and means the opposite.
  /\b(visa\s+|work\s+|employment\s+)?sponsorship\s+(available|offered|provided|eligible)\s*:?\s+no\b/,
  /\b(will\s+not|cannot|can not|unable to|not able to|does not|do not|won't|are not able to|is not able to)\s+(offer|provide|sponsor)\b/,
  /\b(unable|not able)\s+to\s+(offer|provide)\s+(work\s+)?(visa\s+)?sponsorship\b/,
  /\b(does|do)\s+not\s+(offer|provide)\s+(work\s+)?(visa\s+)?sponsorship\b/,
  /\b(is\s+)?not\s+open\s+to\s+(visa\s+)?sponsorship\b/,
  /\bsponsorship\s*:?\s*(is\s+)?not\s+(available|offered|provided)\b/,
  /\bsponsorship\s+not\s+available\b/,
  // "Employer work visa sponsorship AND SUPPORT ARE NOT PROVIDED for this role."
  //
  // Found live on the board after seven hardening rounds. The patterns above expect the
  // negation to sit right next to "sponsorship" ("sponsorship is not provided"), and
  // this posting puts three words in between while switching to a plural verb and a
  // past participle — so both of the closest patterns missed by a hair.
  //
  // Bounded to a single sentence so an unrelated later negative ("we offer sponsorship.
  // Parking is not provided.") cannot be stitched into a false match. The semicolon is
  // in that boundary too: "we provide sponsorship for all roles; overtime pay is not
  // offered" is two clauses and only the first is about sponsorship.
  //
  // The gap was 40 and is now 75. A SmartRecruiters posting read "sponsorship
  // opportunities for US employment authorization are not available" — 46 characters
  // between the noun and the negation, so it missed by six. Widening alone introduced a
  // false positive immediately, which is why the semicolon boundary went in with it.
  /\b(visa\s+|work\s+|employment\s+|immigration\s+)?sponsorship\b[^.!?;]{0,75}?\b(is|are|will|would|can|shall)\s+not\s+(be\s+)?(provided|offered|available|supported|considered|granted)\b/,
  /\b(visa\s+)?sponsorship\s+(is\s+)?(not\s+available|unavailable)\b/,
  /\bwithout\s+(employer\s+)?sponsorship\b/,
  /\bmust\s+be\s+(legally\s+|lawfully\s+)?authorized\s+to\s+work\b[^.]{0,40}\bwithout\b/,
  // Allow a longer qualifier run: "not eligible for employment-based immigration
  // sponsorship" has four words between "for" and "sponsorship".
  /\bnot\s+eligible\s+for\s+([\w-]+\s+){0,5}sponsorship\b/,
  /\bineligible\s+for\s+(\w+\s+){0,3}sponsorship\b/,
  /\bno\s+h-?1b\s+or\s+opt\s+(visa\s+)?sponsorship\b/,
  /\bregret\s+that\s+we\s+are\s+unable\s+to\s+(offer|provide)/,
  /\bgreen\s+card\s+(is\s+)?required\b/,
  /\bgc\s+required\b/,
  /\bpermanent\s+resident\s+(is\s+)?required\b/,
  /\bmust\s+be\s+(us\s+|u s\s+|united states\s+)?citizens?\b/,
  /\bcitizens?\s+or\s+(lawful\s+)?permanent\s+residents?\b/,
  /\bpermanent\s+residents?\s+or\s+citizens?\b/,
  /\b(must\s+not|not|does\s+not|will\s+not|cannot|can not)\s+require\s+(visa\s+)?sponsorship\b/,
  /\bsponsorship\s+(now\s+or\s+in\s+the\s+future|in\s+the\s+future)\b/,
  /\bmust\s+be\s+a?\s*(lawful\s+)?permanent\s+residents?\b/,
  // "work authorization that does not now or in the future require sponsorship of a visa"
  // — a no-sponsorship demand written as a property of the candidate. Found on 53 jobs.
  /\bdoes\s+not\s+(now\s+(and|or)\s+in\s+the\s+future\s+)?require\s+(the\s+)?sponsorship\b/,
  /\bwill\s+not\s+require\s+(visa\s+|immigration\s+|employer\s+)?sponsorship\b/,
  // Bare "U.S. Citizen" in an eligibility list ("Eligibility Requirements: US Citizen",
  // "U.S. Citizen (no dual citizenship)"). Excludes "citizenship status", which is EEO
  // boilerplate rather than a requirement.
  /\b(u\.?\s?s\.?|united\s+states|american)\s+citizens?\b(?!\s*(status|hip))/,
  // Clearance levels named without the word "security": "Active Secret or higher
  // clearance", "TS clearance with SCI eligibility".
  /\b(top\s+secret|ts\/?sci|ts|sci|secret|confidential)\b[^.]{0,25}\bclearance\b/,
  /\bclearance\b[^.]{0,25}\b(sci|ts\/?sci|top\s+secret|polygraph)\b/,
  // "can not take over, transfer, or sponsor any visa type" — the negation attaches to a
  // LIST of verbs, so the verb-adjacent patterns above miss it. Anchored on "or sponsor"
  // so a positive sentence ("we cannot guarantee timelines, we support sponsorship")
  // cannot match.
  /\b(can\s?not|cannot|will\s+not|unable\s+to|do(es)?\s+not)\b[^.]{0,60}\bor\s+sponsor\b/,
  // "We do not currently sponsor immigration visas" — negation + SPONSOR as a verb with
  // no "sponsorship" noun, so the noun-anchored patterns miss it.
  /\b(do(es)?\s+not|will\s+not|cannot|can\s?not|are\s+not|is\s+not)\s+(currently\s+|presently\s+|at\s+this\s+time\s+)?sponsor\b/,
  // "must be U.S. work authorized with no current or future sponsorship needs"
  /\bno\s+(current\s+(or|and)\s+future\s+|future\s+|ongoing\s+)?sponsorship\s+(need|requirement)/,
  // "US Person; clearance eligible" — a bare ITAR requirement in a semicolon list, with
  // none of the "must be a" wording the other U.S. Person patterns expect.
  /\bu\.?\s?s\.?\s+person\b\s*[;,:]?\s*(clearance|security|itar|eligib)/,
  /\bclearance\s+eligib\w+/,
  // "we are not able to consider applicants that require sponsorship, now or in the
  // future" — the negation attaches to CONSIDER (the applicant), not to a sponsorship
  // verb, so the verb-anchored patterns miss it entirely. Found on 41 jobs.
  /\b(not\s+(\w+\s+){0,3}able\s+to|cannot|can\s?not|unable\s+to|do(es)?\s+not|will\s+not)\s+(consider|accept|hire|employ|entertain|review)\b[^.]{0,80}\b(require|requiring|need|needing|request)\w*\s+(visa\s+|immigration\s+|employer\s+|work\s+)?sponsorship\b/,
  // Same idea, reversed: "applicants requiring sponsorship will not be considered".
  /\b(requir\w+|need\w+)\s+(visa\s+|immigration\s+|employer\s+|work\s+)?sponsorship\b[^.]{0,60}\b(will\s+not|cannot|can\s?not)\s+be\s+(considered|accepted|hired|employed)\b/,
  // "must be able to fully access information and technology subject to US export
  // controls" — an export-control gate. Access is limited to U.S. Persons, which an F-1
  // student is not, so this excludes the student even though no visa word appears.
  /\bsubject\s+to\s+(u\.?\s?s\.?\s+|united\s+states\s+|american\s+)?export\s+control/,
  /\baccess\b[^.]{0,60}\bexport\s+control/,
  // Bare "U.S. Person status" listed as a requirement (ITAR). A U.S. Person is a citizen,
  // green-card holder or asylee — never an F-1 student — so this is a hard exclusion.
  /\bu\.?\s?s\.?\s+person(s)?\s+(status|requirement|only|eligibility)\b/,
  // "required that this candidate be a US citizen" — a citizenship demand without the
  // "must be" wording the patterns above look for.
  /\b(be|being|is)\s+an?\s+(u\.?\s?s\.?|united\s+states|american)\s+citizens?\b/,
  // "US citizens and green card holders" — phrased as who may apply, not as a "must be".
  /\b(u\.?\s?s\.?|united\s+states|american)\s+citizens?\s+(and|or|\/)\s*(lawful\s+)?(permanent\s+residents?|green\s+card\s+holders?)\b/,
  // "authorized to work in the United States WITHOUT the need for work visa or residency
  // sponsorship" — the qualifier list varies too much to enumerate, so anchor on the work-
  // authorisation wording. Requiring that anchor keeps positives like "relocation without
  // cost, plus visa sponsorship" from matching.
  /\b(authoriz\w+|eligible|legally\s+entitled|permitted)\b[^.]{0,100}\bwithout\b[^.]{0,60}\bsponsorship\b/,
  // "is not CURRENTLY able to offer sponsorship" — an adverb between "not" and "able to"
  // broke the tighter pattern above. Allow a couple of filler words.
  /\bnot\s+(\w+\s+){0,3}able\s+to\s+(offer|provide|sponsor|support|extend|assist\s+with)\b/,
  // Work authorisation for a FOREIGN country as the requirement ("Eligible to work in
  // Germany") — a US-based student cannot meet it. US wording is excluded.
  /\b(eligible|authoriz\w+|permitted|right)\s+to\s+work\s+in\s+(?!the\s+us|the\s+united\s+states|us\b|usa\b)(the\s+)?(uk|eu|united\s+kingdom|germany|france|spain|italy|netherlands|ireland|poland|portugal|sweden|canada|india|australia|singapore|japan|brazil|mexico|switzerland|belgium|austria|denmark|norway|finland|romania|ukraine|israel|turkey|czech)\b/,
  // "No H-1B, OPT, or visa sponsorship will be provided or accepted." — a flat refusal
  // phrased as a noun, which none of the verb-based patterns above catch.
  /\bno\s+(h-?1b|opt|cpt|f-?1|tn|e-?3|visa|immigration|employment|work)\b[^.]{0,60}\bsponsorship\b/,
  // DoD SkillBridge places transitioning US service members — active-duty US military
  // service is a hard prerequisite no international student can meet.
  /\bskillbridge\b/,
  /\b(currently\s+)?serving\s+on\s+active\s+duty\b/,
  // Bare "US citizenship" as a listed requirement. Greenhouse flattens bullet lists, so
  // these arrive as "...up to 20% of the time US citizenship Bachelor's degree...", with
  // none of the "must be a" wording the patterns above expect. Found live on 10 Esri
  // jobs. "citizenship status" is excluded — that is EEO boilerplate, not a requirement.
  /\b(u\s?s|u\.s\.|united states|american)\s+citizenship\b(?!\s+status)/,
  // Public Trust / suitability determinations are US-government-only, and a polygraph
  // requirement is likewise unavailable to a visa holder.
  /\bpublic\s+trust\b[^.]{0,60}\b(position|clearance|eligib|determination|investigation|background|suitability|required)/,
  /\b(obtain|maintain|hold|eligible\s+for|able\s+to\s+obtain)\b[^.]{0,40}\bpublic\s+trust\b/,
  /\bpolygraph\b/,
  // ---- Hedged / softened non-sponsorship wording (found via a live Roblox posting) ----
  // Catches "may not be able to ... support future H-1B sponsorship" and the coordinated
  // "work authorization related to certain U.S. visa categories" phrasing the tighter
  // patterns above miss. Tuned NOT to fire on positives ("we support sponsorship",
  // "does not support Internet Explorer").
  /\bwork\s+authorization\s+related\s+to\s+(certain\s+)?(us|u s|united states)?\s*visa\s+categor/,
  /\b(will\s+not|cannot|can\s?not|unable\s+to|not\s+able\s+to|does\s+not|do\s+not|won'?t|are\s+not\s+able\s+to|is\s+not\s+able\s+to|not\s+be\s+able\s+to|may\s+not\s+be\s+able\s+to)\s+support\s+(work\s+|visa\s+|h-?1b\s+|immigration\s+|future\s+)*sponsorships?\b/,
  // "without ... visa sponsorship" with an intervening qualifier (Alumni Ventures:
  // "without current or future employer-sponsored visa sponsorship"). Requires a
  // visa/employer qualifier before "sponsorship", so positives like "relocation without
  // cost, plus visa sponsorship" do NOT match.
  /\bwithout\s+(the\s+need\s+(for\s+)?|requiring\s+|current\s+or\s+future\s+|any\s+)*(employer[\s-]?sponsored\s+|employer\s+|company\s+|visa\s+|immigration\s+|work\s+)+sponsorship\b/,
  // ── EXPORT CONTROL / ITAR / 'U.S. Person' ──────────────────────────────────
  // These jobs never say 'citizen', so the patterns above miss them. ITAR and EAR
  // legally restrict roles to US persons, which excludes F1/OPT students. Anduril and
  // most defense/aerospace employers phrase it this way. Tuned to catch the restriction
  // without flagging data jobs that merely mention 'export' or 'controlled vocabularies'.
  /\bmust\s+be\s+a?\s*(us|united states)\s+persons?\b/,
  /\b(us|united states)\s+persons?\s+(status\s+)?(is\s+)?(required|only)\b/,
  /\b(restricted|limited)\s+to\s+(us|united states)\s+persons?\b/,
  /\bitar\b/,
  /\bear\s+controlled\b/,
  /\bexport\s+administration\s+regulations\b/,
  /\bexport[\s-]?control(led)?\s+(information|data|technology|technical data|materials?|items?|regulations?|requirements?|laws?|restrictions?|facilit)/,
  /\baccess\s+to\s+export[\s-]?controlled\b/,
  /\bsubject\s+to\s+(itar|ear|export[\s-]?control)/,
]

function isDisqualified(plainText = '', title = '') {
  // Title-only check, never run on descriptions: half of all postings say
  // 'as a team member you will' in the body. The title is the signal.
  if (title && isHourlyJob(title)) return true
  const norm = normalize(plainText)
  return DISQUALIFIER_PATTERNS.some(re => re.test(norm))
}

// ── CONTRACT / PART-TIME DISQUALIFIER (hardened against false positives) ───
// Multiple rounds of real-data auditing (60 live Greenhouse companies, 501 jobs)
// found several false-positive traps this needed guarding against:
//  - "contractor"/"contract" used as a business/industry term ("Preferred Contractor",
//    "roofing contractors", "government contracts", "smart contract")
//  - Greenhouse form-field leaks: "Job Type (Permanent, fixed term, internship) Permanent"
//    lists ALL possible dropdown options, with "Permanent" as the actual selected value
//  - Benefits-eligibility exclusion clauses: "temporary or intern roles will not be
//    eligible for [benefit]" describes OTHER workers' eligibility, not this job's type
//  - Blanket company policy statements: "Benefits vary for full-time/part-time
//    employment" or "we offer part-time opportunities where possible" describe general
//    company policy/culture, not a declaration that THIS specific role is part-time
const CONTRACT_FALSE_POSITIVES = [
  /\bsmart\s+contract/, /\bgovernment\s+contracts?\b/, /\bcontract\s+negotiations?\b/,
  /\bcontract\s+law\b/, /\bcontract\s+review\b/, /\bmanag(e|ing)\s+contracts?\b/,
  /\bdrafting\s+contracts?\b/, /\bcontract\s+management\b/, /\bcontract\s+compliance\b/,
  /\b(roofing|general|licensed|preferred|certified)\s+contractors?\b/,
]
function isContractOrPartTime(plainText = '', title = '') {
  const t = (title + ' ' + plainText).toLowerCase()

  if (/\([^)]*\bcontracts?\b[^)]*\)/i.test(title)) return true

  const ptMatch = t.match(/\bpart[\s-]?time\b/)
  if (ptMatch) {
    const idx = ptMatch.index
    const window = t.slice(Math.max(0, idx - 25), idx + ptMatch[0].length + 30)
    const isBlanketPolicy = /\bfull[\s-]?time\b/.test(window) || /\bopportunities\b/.test(window)
    if (!isBlanketPolicy) return true
  }

  // Explicit contract-type signals (field-format — high precision, e.g. YLD's
  // "Employment Type: Contract (B2B)" + "Contract Length: 6 months"). Placed BEFORE the
  // false-positive list so a definitive contract field still wins even if the body also
  // mentions something like "smart contract".
  if (/\b(employment|job|position)\s+type\s*:\s*[^.\n]{0,25}\b(contract|b2b|freelance|fixed[\s-]?term|temporary|temp)\b/.test(t)) return true
  if (/\bcontract\s+(length|duration|term)\s*:/.test(t)) return true
  if (/\bcontract\s*\(\s*b2b\s*\)/.test(t)) return true
  const hasFalsePositive = CONTRACT_FALSE_POSITIVES.some(re => re.test(t))
  if (hasFalsePositive) return false

  const triggerMatch = t.match(/\b(contractors?|temporary|temp position|fixed[\s-]?term)\b/)
  if (triggerMatch) {
    const idx = triggerMatch.index
    const window = t.slice(Math.max(0, idx - 60), idx + triggerMatch[0].length + 60)
    if (/\bpermanent\b/.test(window)) return false
    if (/\b(eligible|will not)\b/.test(window)) return false
    return true
  }

  if (/\bcontract\s+(position|role|basis|engagement|assignment)\b/.test(t)) return true
  return false
}

// ── US LOCATION ──────────────────────────────────────────────────────────
// ── LOCATION: allow-list ─────────────────────────────────────────────────────
// This used to be a blocklist: keep everything unless it *looked* foreign. That leaked
// five separate times ("Remote EU", "UK (Remote)", "Remote - EMEA", ...) because there
// are endless ways to write a foreign location, and each new phrasing meant another
// patch. So the question is flipped: a job is US only if it SHOWS a US signal.
// Unrecognised phrasings now drop by default instead of leaking through.
//
// The order matters:
//   1. STRONG US signal wins outright — a dual-location job like "London; New York"
//      is genuinely open to a US applicant, so it stays.
//   2. Explicit foreign, with no strong US signal → dropped.
//   3. WEAK US signal (a bare 2-letter state code) → kept. Checked after foreign
//      because codes collide with countries ("Munich, DE" is Germany, not Delaware).
//   4. Only vague words ("Remote", "Hybrid", "Multiple locations") → kept, because
//      silently deleting real US jobs is worse than showing an occasional foreign one.
//      classifyLocation() reports these so the checker can surface the pile.
//   5. Anything else → dropped. This is the whole point of the allow-list.

const US_STRONG = [
  'united states','u.s.a','usa','u.s.','us only','remote - us','remote, us','remote (us',
  'remote us','us remote','anywhere in the us','nationwide','puerto rico',
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware',
  'florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky',
  'louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi',
  'missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico',
  'new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania',
  'rhode island','south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming','district of columbia',
  'washington dc','washington d.c','san francisco','los angeles','san diego','san jose',
  'chicago','seattle','boston','austin','denver','atlanta','miami','houston','dallas',
  'phoenix','philadelphia','detroit','minneapolis','portland','charlotte','nashville',
  'pittsburgh','baltimore','st. louis','salt lake city','kansas city','las vegas',
  'san antonio','columbus','indianapolis','raleigh','orlando','tampa','sacramento',
  'cincinnati','cleveland','milwaukee','new orleans','oklahoma city','albuquerque',
  'tucson','omaha','boulder','palo alto','mountain view','sunnyvale','santa clara',
  'menlo park','cupertino','redmond','bellevue','brooklyn','manhattan','arlington va',
  // common US shorthand seen instead of a full city name
  'nyc','new york city','sf bay','dc metro','d.c.','bronx','queens ny','staten island',
  // more US cities/campuses surfaced by live samples
  'el segundo','greensboro','midland','odessa','san angelo','fayetteville','temple tx',
  'waco','abilene','amarillo','lubbock','wichita falls','tyler tx','beaumont','killeen',
  'cornell university','nyu','new york university','harvard','stanford','mit ','yale',
  'princeton university','columbia university','duke university','ucla','usc ','berkeley',

  // "Parish" is a Louisiana-only administrative term — a reliable US signal.
  'parish',
  // Arizona and other small US cities found in the allow-list's `unknown` bucket
  'sierra vista','flagstaff','kingman','yuma','casa grande','bullhead city','prescott',
  'lake havasu','sedona','tempe','glendale az','peoria az','surprise az','goodyear',
  'maricopa','san tan valley','oro valley','marana','buckeye','avondale','apache junction',
  // US regional shorthand that appears instead of a city
  'bay area','silicon valley','socal','norcal','tri-state','midwest','new england',
  'east coast','west coast','pacific northwest','south florida','southern california',
  'northern california','greater boston','greater seattle','dmv area','bay-area',
  // more US cities seen in live samples
  'fort lauderdale','boca raton','san luis obispo','delray beach','peabody','roslyn',
  'new canaan','darien','greenwich','ardmore','cambridge','modesto','merced','flushing',
  'jersey city','newark','hoboken','stamford','hartford','providence','albany','buffalo',
  'rochester','syracuse','richmond','norfolk','virginia beach','charleston','savannah',
  'jacksonville','st. petersburg','fort myers','naples fl','sarasota','gainesville',
  'birmingham','montgomery','huntsville','memphis','knoxville','chattanooga','louisville',
  'lexington','columbia','greenville','asheville','durham','chapel hill','wilmington',
  'des moines','madison','green bay','ann arbor','grand rapids','lansing','toledo','akron',
  'dayton','fort wayne','south bend','peoria','springfield','wichita','tulsa','little rock',
  'shreveport','baton rouge','mobile','jackson ms','boise','spokane','tacoma','eugene',
  'reno','fresno','bakersfield','stockton','irvine','pasadena','santa monica','long beach',
  'anaheim','riverside','oakland','berkeley','santa barbara','ventura','carlsbad',
  'scottsdale','mesa','chandler','colorado springs','fort collins','provo','ogden',
  'anchorage','honolulu','el paso','laredo','corpus christi','arlington tx','plano',
  'frisco','irving','fort worth','round rock','allen tx','mclean','reston','herndon',
  'bethesda','rockville','annapolis','wilmington de','princeton','trenton','allentown',
  'harrisburg','scranton','white plains','yonkers','stamford ct','norwalk',
]

// Country/region level. These OUTRANK a US city match, because plenty of US city names
// also exist abroad — "Cambridge, UK" must not be kept just because Cambridge, MA exists.
const FOREIGN_COUNTRIES = [
  'emea','apac','latam','anz','international','united kingdom','uk','england','scotland',
  'wales','ireland','canada','india','singapore','germany','australia','france','netherlands',
  'spain','italy','portugal','sweden','norway','denmark','finland','switzerland','belgium',
  'austria','poland','romania','ukraine','czech','hungary','greece','turkey','israel',
  'japan','china','korea','taiwan','hong kong','thailand','vietnam','malaysia','indonesia',
  'philippines','pakistan','bangladesh','sri lanka','new zealand','south africa','nigeria',
  'kenya','egypt','brazil','brasil','mexico','argentina','chile','colombia','peru','uruguay',
  'united arab emirates','saudi arabia','qatar','morocco','bulgaria','serbia','croatia',
  'slovakia','slovenia','lithuania','latvia','estonia','iceland','luxembourg','malta',
  // Post-Soviet + Balkan states that were missing — 'Uzbekistan' fell to `unknown`,
  // which fails safe, but explicit is better than lucky. 'georgia' CANNOT go here:
  // it collides with the US state and is handled by the disambiguation block in
  // classifyLocation() instead.
  'uzbekistan','kazakhstan','kyrgyzstan','tajikistan','turkmenistan','armenia',
  'azerbaijan','belarus','moldova','russia','albania','bosnia','montenegro','kosovo',
  'north macedonia','cyprus',
  'europe','asia','africa','oceania','latin america','middle east','worldwide',
]

const FOREIGN_MARKERS = [
  'emea','apac','latam','anz','international','united kingdom','england','scotland','wales',
  'canada','india','singapore','ireland','germany','australia','france','netherlands',
  'spain','italy','portugal','sweden','norway','denmark','finland','switzerland','belgium',
  'austria','poland','romania','ukraine','czech','hungary','greece','turkey','israel',
  'japan','china','korea','taiwan','hong kong','thailand','vietnam','malaysia','indonesia',
  'philippines','pakistan','bangladesh','sri lanka','new zealand','south africa','nigeria',
  'kenya','egypt','brazil','mexico','argentina','chile','colombia','peru','uruguay',
  'united arab emirates','saudi arabia','qatar','morocco',
  'london','manchester','edinburgh','glasgow','dublin','belfast','toronto','vancouver',
  'montreal','calgary','ottawa','bangalore','bengaluru','hyderabad','chennai','mumbai',
  'pune','gurgaon','gurugram','noida','kolkata','ahmedabad','new delhi','berlin','munich',
  'frankfurt','hamburg','cologne','stuttgart','sydney','melbourne','brisbane','perth',
  'amsterdam','rotterdam','madrid','barcelona','lisbon','porto','stockholm','copenhagen',
  'oslo','helsinki','zurich','geneva','brussels','prague','warsaw','krakow','budapest',
  'bucharest','istanbul','dubai','abu dhabi','riyadh','doha','cairo','lagos','nairobi',
  'tel aviv','tokyo','osaka','shanghai','beijing','shenzhen','seoul','taipei','bangkok',
  'jakarta','manila','kuala lumpur','sao paulo','buenos aires','santiago','bogota',
  'auckland','wellington','vienna','europe','asia','africa','oceania','latin america',
  // added after a live sample showed these landing in `unknown` instead of `foreign`
  'paris','milan','rome','naples','turin','florence','venice','sofia','bulgaria','serbia',
  'belgrade','croatia','zagreb','slovakia','slovenia','lithuania','latvia','estonia',
  'monterrey','guadalajara','fortaleza','curitiba','brasilia','recife','porto alegre',
  'belo horizonte','medellin','lima','quito','caracas','panama','costa rica','guatemala',
  'montevideo','asuncion','la paz','santo domingo','san salvador','tegucigalpa',
  'remoto','hibrido','teletrabajo','anywhere in europe','anywhere in the world','worldwide',
  'global remote','remote global','marseille','lyon','nice, france','bordeaux','toulouse',
  'valencia','seville','malaga','bilbao','antwerp','ghent','utrecht','eindhoven','the hague',
  'gothenburg','malmo','aarhus','bergen','tampere','basel','bern','lausanne','graz','salzburg',
  'katowice','wroclaw','gdansk','poznan','brno','ostrava','cluj','timisoara','iasi',
  'thessaloniki','ankara','izmir','jerusalem','haifa','beirut','amman','kuwait','bahrain',
  'muscat','karachi','lahore','islamabad','dhaka','colombo','kathmandu','hanoi','ho chi minh',
  'da nang','cebu','davao','surabaya','bandung','penang','johor','christchurch','hamilton',
  'accra','kampala','dar es salaam','addis ababa','casablanca','tunis','algiers','durban',
  'cape town','johannesburg','pretoria',
  'middle east','remote international',
  // Capitals of the post-Soviet additions above. 'tbilisi' matters most: it is the
  // give-away that a bare 'Georgia' means the country, not the state.
  'tbilisi','yerevan','baku','tashkent','almaty','astana','minsk','kyiv','kiev','chisinau',
]

// Vague-but-plausibly-US phrasings. Kept (never silently deleted) and reported as
// 'ambiguous' so the checker can show exactly what is landing here.
const VAGUE_WORDS = /^(?:\s|remote|hybrid|on-?site|in-?office|flexible|anywhere|various|multiple|locations?|office|offices|home|based|work|from|field|travel|tbd|n\/?a|other|and|or|the|any|all|several|different|\d+|[-–—,;:.()\/|+&])+$/i

// "São Paulo" must match "sao paulo", "Zürich" must match "zurich" — without this the
// accented spelling falls through to `unknown` and looks like a lost US job.
function deaccent(t) {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
// Whole-word containment. Plain .includes() matched "Paris" inside Louisiana's
// "Caddo Parish" and dropped real US jobs as French — every marker must sit on word
// boundaries. Markers with their own punctuation (u.s., n/a) are matched loosely.
function hasWord(haystack, needle) {
  if (/[^a-z0-9 ]/.test(needle)) return haystack.includes(needle)
  const i = haystack.indexOf(needle)
  if (i === -1) return false
  const before = i === 0 ? '' : haystack[i - 1]
  const after = haystack[i + needle.length] || ''
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)
}

// US at country/state level — the strongest signal, so a genuine dual-location job
// ("San Francisco (USA), Freiburg (Germany)") is still kept.
const US_COUNTRY_STATE = [
  'united states','u.s.a','usa','u.s.','us only','remote - us','remote, us','remote (us',
  'remote us','us remote','anywhere in the us','nationwide','puerto rico','parish',
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware',
  'florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky',
  'louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi',
  'missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico',
  'new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania',
  'rhode island','south carolina','south dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west virginia','wisconsin','wyoming','district of columbia',
]

function hasUSCountryOrState(lower) {
  // US broadcast call signs start with K or W ("KWES-TV Midland-Odessa", "WFMY-TV").
  // That prefix is a US-only convention, so it is a reliable signal for station jobs.
  if (/\b[kw][a-z]{2,3}[-\s]?(tv|am|fm|dt)\b/.test(lower)) return true
  if (US_COUNTRY_STATE.some(m => hasWord(lower, m))) return true
  if (/(^|[^a-z])(u\.?s\.?a?)([^a-z]|$)/i.test(lower)) return true
  return false
}
// A 5-digit postal code only means "US" once an explicit foreign country has been ruled
// out — France, Germany and Spain all use 5-digit codes too.
function hasUSZip(lower) {
  return /(^|[^\d])\d{5}(-\d{4})?([^\d]|$)/.test(lower) && /[a-z]/.test(lower)
}
// City names that exist BOTH abroad and in the US. For these, a US state code wins
// ("Brisbane, CA" is California, "Venice, CA" is Los Angeles). Every other foreign city
// beats a state code, because "Munich, DE" is Germany, not Delaware — some companies
// write every European office that way.
const ALSO_US_CITY_NAMES = new Set([
  'brisbane','venice','cambridge','birmingham','athens','paris','berlin','moscow','dublin',
  'naples','rome','vienna','milan','toledo','manchester','lima','hamburg','odessa','york',
  'glasgow','oxford','windsor','richmond','florence','madrid','lebanon','versailles',
  'st. petersburg','london','bristol','dover','plymouth','belfast','geneva','warsaw',
])
// Returns the matched foreign city name, or null.
function foreignCityMatch(lower) {
  for (const m of FOREIGN_MARKERS) if (hasWord(lower, m)) return m
  return null
}
function hasForeignCountry(lower) {
  return FOREIGN_COUNTRIES.some(m => hasWord(lower, m))
}

function hasStrongUS(lower) {
  if (US_STRONG.some(m => hasWord(lower, m))) return true
  // Bare "US"/"U.S." as a whole word: "Work from Home - US (Central)", "Field - US".
  // Word-boundaried so it can't fire inside words like "Aarhus" or "campus".
  if (/(^|[^a-z])(u\.?s\.?a?)([^a-z]|$)/i.test(lower)) return true
  // US-only timezone shorthand used on remote listings.
  if (/\b(est|edt|cst|cdt|mst|mdt|pst|pdt|eastern|central|mountain|pacific)\s*(time|timezone|tz)?\b/.test(lower)
      && /\b(remote|home|anywhere|wfh)\b/.test(lower)) return true
  return false
}
function hasForeign(lower) {
  // Louisiana is full of "... Parish", which must not read as Paris.
  if (/\bparish\b/.test(lower)) return false
  // "Remote EU" / "UK (Remote)" style, either word order
  if (/\bremote\b[\s\-–—,()\/|]*\b(eu|uk|apac|emea|latam|anz|europe|asia|africa|india|brazil|canada|mexico|ireland|germany|france|spain|italy|poland|ukraine|australia|singapore|japan|china|philippines|latin\s+america|middle\s+east|united\s+kingdom)\b/.test(lower)) return true
  if (/\b(uk|eu|emea|apac|latam|anz|europe|asia|africa|india|brazil|canada|mexico|ireland|germany|france|spain|italy|poland|ukraine|australia|singapore|japan|china|philippines|united\s+kingdom)\b[\s,\/|()-]*remote\b/.test(lower)) return true
  return FOREIGN_MARKERS.some(m => hasWord(lower, m))
}

// Returns 'us' | 'weak-us' | 'foreign' | 'ambiguous' | 'unknown'.
// Exported so filterCheck.mjs can report what the allow-list is actually dropping —
// the whole risk of this approach is silently losing good US jobs, so it must be visible.
function classifyLocation(location = '') {
  if (!location) return 'unknown'
  const lower = deaccent(location.toLowerCase())
  // ── GEORGIA DISAMBIGUATION ─────────────────────────────────────────────────
  // 'Georgia' is both a US state and a country. Because the US-state check runs
  // FIRST (by design, to keep dual-location jobs), the country reading leaked:
  // "Bulgaria, Georgia, Poland, Romania, Uzbekistan" and "Tbilisi, Georgia" both
  // classified as 'us' — 15 Exadel postings on the live board proved it.
  // Resolution: strip the word 'georgia' and let the REST of the string decide.
  //   - any other US signal            → the state  → 'us'
  //   - Tbilisi / 'georgia (country)' / any foreign country in the remainder
  //                                    → the country → 'foreign'
  //   - nothing else recognisable      → the state  → 'us' (matches old behaviour
  //     for bare "Georgia" / "Georgia - Remote"; the checker surfaces these)
  // Accepted residual: "Georgia; United Kingdom" now drops even if Georgia meant
  // the state — fail-safe, and rare.
  if (hasWord(lower, 'georgia')) {
    if (/\bgeorgia\s*\(\s*country\s*\)|\brepublic\s+of\s+georgia\b/.test(lower)) return 'foreign'
    const noGa = lower.replace(/\bgeorgia\b/g, ' ')
    if (hasUSCountryOrState(noGa) || hasStrongUS(noGa)) return 'us'
    if (hasWord(lower, 'tbilisi') || hasForeignCountry(noGa)) return 'foreign'
    return 'us'
  }
  // Precedence: US country/state  >  foreign country  >  US city  >  foreign city.
  // Keeps dual-location US jobs while dropping "Cambridge, UK" and "Birmingham, UK".
  if (hasUSCountryOrState(lower)) return 'us'
  if (hasForeignCountry(lower)) return 'foreign'
  if (hasStrongUS(lower)) return 'us'
  // A US state code outranks a foreign CITY name: "Brisbane, CA" is California, and
  // "Venice, CA" is Los Angeles — both were being dropped as Australia and Italy.
  // Foreign COUNTRIES were already handled above, so "Brisbane, Australia" still drops.
  // Accepted residual: a foreign city with a country code that collides with a state
  // ("Munich, DE") reads as US. Rare in practice; the checker's foreign-slip list shows it.
  // An unambiguous foreign city outranks a bare state code.
  const fc = foreignCityMatch(lower)
  if (fc && !ALSO_US_CITY_NAMES.has(fc)) return 'foreign'
  if (extractState(location)) return 'weak-us'
  // "…, MA 01960" / "Allen, TX; Remote" — a 2-letter state code that extractState's
  // pattern misses because of what follows it.
  // The code must FOLLOW A COMMA ("Reston, VA"). Allowing a bare space matched the
  // English words in "Sydney Or Melbourne" and "Dublin OR London" as Oregon, and
  // "IN - Bengaluru" as Indiana — real foreign jobs kept as US.
  if (/,\s*(a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|t[nx]|ut|v[at]|w[aivy])([\s,;|]|$)/i.test(deaccent(location))) return 'weak-us'
  if (hasForeign(lower)) return 'foreign'
  // ZIP is checked LAST among place signals: France, Germany and Spain also use 5-digit
  // postal codes, so "75009, Paris" must be caught as foreign before the digits count.
  if (hasUSZip(lower)) return 'us'
  const stripped = lower.replace(/\b(remote|hybrid|onsite|on-site)\b/g, ' ').trim()
  if (!stripped || VAGUE_WORDS.test(lower)) return 'ambiguous'
  return 'unknown'
}

function isUSLocation(location = '') {
  const kind = classifyLocation(location)
  return kind === 'us' || kind === 'weak-us' || kind === 'ambiguous'
}

// ── EXPERIENCE LEVEL (from title) ───────────────────────────────────────────
function detectExperienceLevel(title = '') {
  const t = title.toLowerCase()
  if (/\b(director|vp|vice president|head of|principal)\b/.test(t)) return 'Director'
  if (/\bstaff\b/.test(t)) return 'Staff'
  if (/\b(senior|sr|lead)\b/.test(t)) return 'Senior'
  if (/\b(intern|internship|co-?op)\b/.test(t)) return 'Internship'
  if (/\b(entry|junior|jr|new grad|graduate|associate)\b/.test(t)) return 'Entry'
  if (/\b(engineer|analyst|specialist|developer|coordinator|manager)\s+i\b/.test(t)) return 'Entry'
  if (/\b(engineer|analyst|specialist|developer|coordinator|manager)\s+1\b/.test(t)) return 'Entry'
  return 'Mid'
}

// ── WORK TYPE ────────────────────────────────────────────────────────────
function detectWorkType(location = '', description = '') {
  const loc = location.toLowerCase()
  const descHead = description.toLowerCase().slice(0, 600)
  if (/\bhybrid\b/.test(loc) || /\bhybrid\b/.test(descHead)) return 'Hybrid'
  if (loc.includes('remote')) return 'Remote US'
  return 'Onsite'
}

// ── STATE EXTRACTION (all 50 states + DC, full names + abbreviations) ──────
const US_STATES_FULL = {
  'alabama':'Alabama','alaska':'Alaska','arizona':'Arizona','arkansas':'Arkansas','california':'California',
  'colorado':'Colorado','connecticut':'Connecticut','delaware':'Delaware','florida':'Florida','georgia':'Georgia',
  'hawaii':'Hawaii','idaho':'Idaho','illinois':'Illinois','indiana':'Indiana','iowa':'Iowa','kansas':'Kansas',
  'kentucky':'Kentucky','louisiana':'Louisiana','maine':'Maine','maryland':'Maryland','massachusetts':'Massachusetts',
  'michigan':'Michigan','minnesota':'Minnesota','mississippi':'Mississippi','missouri':'Missouri','montana':'Montana',
  'nebraska':'Nebraska','nevada':'Nevada','new hampshire':'New Hampshire','new jersey':'New Jersey','new mexico':'New Mexico',
  'new york':'New York','north carolina':'North Carolina','north dakota':'North Dakota','ohio':'Ohio',
  'oklahoma':'Oklahoma','oregon':'Oregon','pennsylvania':'Pennsylvania','rhode island':'Rhode Island',
  'south carolina':'South Carolina','south dakota':'South Dakota','tennessee':'Tennessee','texas':'Texas',
  'utah':'Utah','vermont':'Vermont','virginia':'Virginia','washington':'Washington','west virginia':'West Virginia',
  'wisconsin':'Wisconsin','wyoming':'Wyoming','district of columbia':'District of Columbia',
}
const STATE_ABBR = {
  'al':'Alabama','ak':'Alaska','az':'Arizona','ar':'Arkansas','ca':'California','co':'Colorado','ct':'Connecticut',
  'de':'Delaware','fl':'Florida','ga':'Georgia','hi':'Hawaii','id':'Idaho','il':'Illinois','in':'Indiana','ia':'Iowa',
  'ks':'Kansas','ky':'Kentucky','la':'Louisiana','me':'Maine','md':'Maryland','ma':'Massachusetts','mi':'Michigan',
  'mn':'Minnesota','ms':'Mississippi','mo':'Missouri','mt':'Montana','ne':'Nebraska','nv':'Nevada','nh':'New Hampshire',
  'nj':'New Jersey','nm':'New Mexico','ny':'New York','nc':'North Carolina','nd':'North Dakota','oh':'Ohio',
  'ok':'Oklahoma','or':'Oregon','pa':'Pennsylvania','ri':'Rhode Island','sc':'South Carolina','sd':'South Dakota',
  'tn':'Tennessee','tx':'Texas','ut':'Utah','vt':'Vermont','va':'Virginia','wa':'Washington','wv':'West Virginia',
  'wi':'Wisconsin','wy':'Wyoming','dc':'District of Columbia',
}
function extractState(location = '') {
  const lower = location.toLowerCase()
  for (const [key, full] of Object.entries(US_STATES_FULL)) {
    if (new RegExp(`\\b${key}\\b`).test(lower)) return full
  }
  for (const [abbr, full] of Object.entries(STATE_ABBR)) {
    if (new RegExp(`(^|,\\s*|\\s)${abbr}(\\s*,|\\s*$)`).test(lower)) return full
  }
  return null
}

// ── SALARY EXTRACTION ────────────────────────────────────────────────────
function extractSalary(text = '') {
  const patterns = [
    /\$\s?(\d{2,3}(?:,\d{3})+)\s?[-–—]\s?\$?\s?(\d{2,3}(?:,\d{3})+)/,
    /(\d{2,3}(?:,\d{3})+)\s?[-–—]\s?(\d{2,3}(?:,\d{3})+)\s?(?:USD|usd)\b/,
    /\$\s?(\d{2,3})[kK]\s?[-–—]\s?\$?\s?(\d{2,3})[kK]\b/,
    /\$\s?(\d{2,3}(?:,\d{3})+)\s+to\s+\$?\s?(\d{2,3}(?:,\d{3})+)/,
  ]
  const salaryContext = /\b(salary|compensation|pay range|base pay|annual salary|base salary|total compensation|salary range|\/\s?year|per year)\b/i
  const notSalaryContext = /\b(raised|funding|valuation|revenue|series [a-e]|investment|market size|arr|assets under management|aum)\b/i

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const idx = match.index
    const window = text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + match[0].length + 80))
    if (notSalaryContext.test(window) && !salaryContext.test(window)) continue

    let low = match[1].replace(/,/g, '')
    let high = match[2].replace(/,/g, '')
    if (/[kK]$/i.test(match[0].trim().split(/[-–—]/)[1] || '') || parseInt(low) < 1000) {
      low = String(parseInt(low) * 1000)
      high = String(parseInt(high) * 1000)
    }
    low = parseInt(low); high = parseInt(high)
    if (low < 20000 || high > 1000000 || low > high) continue
    return { min: low, max: high }
  }
  return null
}

// ── EMPLOYMENT TYPE (display tag) ────────────────────────────────────────
// Only checks for "Full-time" — by the time a job reaches this function, it has
// already passed isContractOrPartTime() above, meaning any genuine contract/temp/
// part-time signal already caused it to be hidden. Previously this duplicated
// that detection with older, unguarded patterns, which could show a wrong
// "Contract" tag on a job the improved hiding logic had already correctly kept.
function detectEmploymentType(text = '') {
  const t = text.toLowerCase()
  if (/\bfull[\s-]?time\b/.test(t)) return 'Full-time'
  return null
}

// ── YEARS OF EXPERIENCE ──────────────────────────────────────────────────
function extractYearsExperience(text = '') {
  const patterns = [
    { re: /(\d{1,2})\s*-\s*(\d{1,2})\s*\+?\s*years?\b/i, type: 'range' },
    { re: /(\d{1,2})\+\s*years?\b/i, type: 'plus' },
    { re: /(?:minimum|at least)\s*(?:of\s*)?(\d{1,2})\s*years?\b/i, type: 'plus' },
  ]
  const expContext = /\b(experience|exp\b|background|similar role|in this field|working in|industry experience|relevant experience)\b/i
  const notExpContext = /\b(founded|established|in business|company history|since \d{4}|anniversary|celebrating|been around|has been|have been|for more than|for over)\b/i

  for (const { re, type } of patterns) {
    const match = text.match(re)
    if (!match) continue
    const idx = match.index
    const window = text.slice(Math.max(0, idx - 60), Math.min(text.length, idx + match[0].length + 60))
    if (notExpContext.test(window) && !expContext.test(window)) continue

    const min = parseInt(match[1])
    const max = type === 'range' ? parseInt(match[2]) : min
    // Sanity ceiling — same pattern as extractSalary's $20k-$1M bound.
    // Blocks demographic ranges ("18-55" age) and any stray >15 that slips
    // past the context guard above. 15+ isn't relevant to F1/OPT students anyway.
    if (min > 15 || max > 15) continue

    return type === 'range' ? { min, max } : { min, max: null }
  }
  return null
}

// ── Fetch from Greenhouse ───────────────────────────────────────────────────
// Returns { ok, jobs }. `ok` means Greenhouse answered authoritatively, so the list
// it returned is the complete truth for this company right now. A timeout, a 5xx, or
// a network blip is NOT authoritative: it returns an empty list that looks identical
// to "this company has no jobs". The stale sweep below deletes anything it didn't see
// this run, so treating an unreachable company as empty would wipe a live board.
async function fetchGreenhouseCompany(slug) {
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return { ok: false, jobs: [], status: res.status }
    const data = await res.json()
    return { ok: true, jobs: data.jobs || [], status: 200 }
  } catch {
    // Timeout or network error. Status 0 means "we never got an answer", which is
    // very different from a 404 and must NOT be treated as proof the board is gone.
    return { ok: false, jobs: [], status: 0 }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function fetchAllJobs() {
  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected to MongoDB')

  const slugsPath = path.join(__dirname, 'greenhouse_companies.json')
  const allSlugs = JSON.parse(fs.readFileSync(slugsPath, 'utf-8'))
  console.log(`📋 Loaded ${allSlugs.length} Greenhouse slugs`)

  let saved = 0, skipped = 0, disqualified = 0, nonUS = 0, contractOrPartTime = 0
  let failedCompanies = 0, removed = 0, tooOld = 0
  const BATCH_SIZE = 10

  // Anything whose fetchedAt is older than this by the end of the run was not seen
  // at the source this time, which means it closed or no longer passes our filters.
  const runStart = new Date()

  // ONE cutoff for the whole run. Computed here, not at purge time, because a run
  // takes 1-2 hours: a cutoff recomputed at the end would be up to two hours later
  // than the one the fetch gate used, so jobs saved as fresh would be deleted as old
  // minutes afterwards. Sharing the value makes that impossible.
  const ageCutoff = new Date(runStart.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
  const okSlugs = []
  const failedSlugs = []

  for (let i = 0; i < allSlugs.length; i += BATCH_SIZE) {
    const batch = allSlugs.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (slug) => ({ slug, ...(await fetchGreenhouseCompany(slug)) }))
    )

    for (const { slug, ok, jobs, status } of results) {
      // Unreachable company: skip it entirely and, critically, do NOT mark it
      // sweepable. Its existing jobs stay untouched until we can confirm them.
      if (!ok) { failedCompanies++; failedSlugs.push({ slug, status }); continue }
      okSlugs.push(slug)

      for (const job of jobs) {
        // ── AGE GATE ───────────────────────────────────────────────────────
        // First check in the loop because it is the cheapest one: a single date
        // compare, before stripHtml and before ~173 regexes run over the full
        // description.
        //
        // Greenhouse returns EVERY open posting regardless of age. Without this
        // gate the run saved ~37,000 rows that the purge below deleted minutes
        // later — the same rows, every run, forever.
        //
        // Unknown age is NOT old. A posting with no updated_at is kept, matching
        // the purge, which leaves a null postedAt alone.
        const posted = postedDate(job)
        if (posted && posted < ageCutoff) { tooOld++; continue }

        const location  = job.location?.name || ''
        const plainText = stripHtml(job.content || '')

        if (location !== '' && !isUSLocation(location)) { nonUS++; continue }

        const fullText = `${job.title || ''} ${plainText}`
        if (isDisqualified(fullText, job.title)) { disqualified++; continue }
        if (isContractOrPartTime(plainText, job.title || '')) { contractOrPartTime++; continue }

        // Greenhouse returns the real display name in company_name — "Movable Ink",
        // "Fischer Homes". This used to capitalise the URL slug instead, which
        // produced Movableink, and for one company that registered a leet-speak slug,
        // F1sch3rh0m3s. The slug stays as the fallback for the rare posting that omits
        // the field.
        const companyName = job.company_name?.trim()
          || slug.charAt(0).toUpperCase() + slug.slice(1)
        const experienceLevel = detectExperienceLevel(job.title || '')
        const workType = detectWorkType(location, plainText)
        const state = extractState(location)
        const salary = extractSalary(plainText)
        const employmentType = detectEmploymentType(plainText)
        const years = extractYearsExperience(plainText)

        try {
          // updateOne, not findOneAndUpdate: we never used the returned document, and
          // its deprecated `new: true` option printed a warning per save, which flooded
          // the CI log with 54k lines and truncated the summary. This also avoids
          // dragging every saved document back over the wire.
          await Job.updateOne(
            { id: String(job.id) },
            {
              id:              String(job.id),
              title:           job.title || '',
              company:         companyName,
              companySlug:     slug,
              location:        location || 'United States',
              isRemote:        location.toLowerCase().includes('remote'),
              description:     plainText.slice(0, 500),
              applyUrl:        job.absolute_url || '',
              postedAt:        posted,
              sponsorBadge:    false,
              field:             categorizeJob(job.title),
              needsLicense:             requiresLicense(job.title),
              ats:             'greenhouse',
              fetchedAt:       new Date(),
              experienceLevel,
              workType,
              state,
              salaryMin:       salary ? salary.min : null,
              salaryMax:       salary ? salary.max : null,
              employmentType,
              yearsMin:        years ? years.min : null,
              yearsMax:        years ? years.max : null,
            },
            { upsert: true }
          )
          saved++
        } catch {
          skipped++
        }
      }
    }

    if ((i + BATCH_SIZE) % 50 === 0) {
      const done = Math.min(i + BATCH_SIZE, allSlugs.length)
      console.log(`⏳ ${done}/${allSlugs.length} companies | 💾 ${saved} saved | ⌛ ${tooOld} too old | 🚫 ${disqualified} disqualified | 📋 ${contractOrPartTime} contract/part-time | 🌍 ${nonUS} non-US`)
    }

    await new Promise(r => setTimeout(r, 200))
  }

  // ── RETRY PASS ──────────────────────────────────────────────────────────────
  // A company can fail for two very different reasons and they need opposite fixes:
  // we got rate-limited (the company is alive, we just hit Greenhouse too hard), or
  // the board is genuinely gone. One retry with a slower pace tells us which.
  // It also recovers real jobs either way, and lets the sweep clean these companies.
  if (failedSlugs.length > 0) {
    console.log(`\n🔁 Retrying ${failedSlugs.length} companies that did not respond...`)
    const toRetry = failedSlugs.map(f => f.slug)
    let recovered = 0
    const confirmedDead = []   // answered with 404 twice: the board is genuinely gone
    const unreachable   = []   // never answered: could be a network problem, keep it

    for (let i = 0; i < toRetry.length; i += 5) {
      const batch = toRetry.slice(i, i + 5)
      const results = await Promise.all(
        batch.map(async (slug) => ({ slug, ...(await fetchGreenhouseCompany(slug)) }))
      )

      for (const { slug, ok, jobs, status } of results) {
        if (!ok) {
          if (status === 404) confirmedDead.push(slug)
          else unreachable.push(slug)
          continue
        }
        recovered++
        failedCompanies--
        okSlugs.push(slug)
        for (const job of jobs) {
          // ── AGE GATE ───────────────────────────────────────────────────────
          // First check in the loop because it is the cheapest one: a single date
          // compare, before stripHtml and before ~173 regexes run over the full
          // description.
          //
          // Greenhouse returns EVERY open posting regardless of age. Without this
          // gate the run saved ~37,000 rows that the purge below deleted minutes
          // later — the same rows, every run, forever.
          //
          // Unknown age is NOT old. A posting with no updated_at is kept, matching
          // the purge, which leaves a null postedAt alone.
          const posted = postedDate(job)
          if (posted && posted < ageCutoff) { tooOld++; continue }

          const plainText = stripHtml(job.content || '')
          const location  = job.location?.name || ''
          if (location !== '' && !isUSLocation(location)) { nonUS++; continue }
          const fullText = `${job.title || ''} ${plainText}`
          if (isDisqualified(fullText, job.title)) { disqualified++; continue }
          if (isContractOrPartTime(plainText, job.title || '')) { contractOrPartTime++; continue }

          // Same as above: real display name from Greenhouse, slug as fallback.
          const companyName = job.company_name?.trim()
            || slug.charAt(0).toUpperCase() + slug.slice(1)
          const salary = extractSalary(plainText)
          const years  = extractYearsExperience(plainText)
          try {
            await Job.updateOne(
              { id: String(job.id) },
              {
                id:              String(job.id),
                title:           job.title || '',
                company:         companyName,
                companySlug:     slug,
                location:        location || 'United States',
                isRemote:        location.toLowerCase().includes('remote'),
                description:     plainText.slice(0, 500),
                applyUrl:        job.absolute_url || '',
                postedAt:        posted,
                sponsorBadge:    false,
                field:             categorizeJob(job.title),
                needsLicense:             requiresLicense(job.title),
                ats:             'greenhouse',
                fetchedAt:       new Date(),
                experienceLevel: detectExperienceLevel(job.title || ''),
                workType:        detectWorkType(location, plainText),
                state:           extractState(location),
                salaryMin:       salary ? salary.min : null,
                salaryMax:       salary ? salary.max : null,
                employmentType:  detectEmploymentType(plainText),
                yearsMin:        years ? years.min : null,
                yearsMax:        years ? years.max : null,
              },
              { upsert: true }
            )
            saved++
          } catch { skipped++ }
        }
      }
      // Deliberately slower than the main loop. If rate limiting caused the failures,
      // this pace is what proves it.
      await new Promise(r => setTimeout(r, 1000))
    }

    const rate = Math.round((recovered / toRetry.length) * 100)
    console.log(`   ✅ Recovered ${recovered} of ${toRetry.length} (${rate}%).`)
    console.log(`   💀 Confirmed gone (404 twice): ${confirmedDead.length}`)
    console.log(`   ❓ Never answered (timeout):    ${unreachable.length}`)

    if (rate >= 30) {
      console.log('   👉 A lot recovered on retry, so RATE LIMITING is the main problem.')
      console.log('      Slow the main loop down before pruning anything.')
    } else if (confirmedDead.length > unreachable.length) {
      console.log('   👉 Mostly DEAD BOARDS. Safe to prune the confirmed list below.')
    } else {
      console.log('   👉 Mostly TIMEOUTS, not confirmed deaths. Do NOT prune these:')
      console.log('      a slow response is not proof a company is gone.')
    }

    // Printed as one line so it can be copied straight out of the log. Only 404s
    // appear here: a timeout never proves a board is gone, so those stay on the list.
    if (confirmedDead.length > 0) {
      console.log('\n📋 CONFIRMED DEAD SLUGS (safe to remove from greenhouse_companies.json):')
      console.log(JSON.stringify(confirmedDead))
    }
  }

  // ── STALE SWEEP ─────────────────────────────────────────────────────────────
  // Greenhouse has no "this job closed" signal. A closed posting simply stops
  // appearing in the company's list. Every job we saved above got a fresh
  // fetchedAt, so anything older than runStart is gone from the source.
  //
  // Deleting is irreversible, so two guards:
  //   1. Only sweep companies that answered successfully this run.
  //   2. Abort entirely if the sweep would remove an implausible share of the DB.
  //      A quarter of all jobs do not close in six hours: that would mean something
  //      broke, and mass-deleting on a bug is far worse than leaving stale rows.
  console.log('\n🧹 Checking for jobs that no longer exist at the source...')

  if (okSlugs.length === 0) {
    console.log('   ⚠️  No company answered successfully. Sweep skipped, nothing deleted.')
  } else {
    const CHUNK = 400
    const chunks = []
    for (let i = 0; i < okSlugs.length; i += CHUNK) chunks.push(okSlugs.slice(i, i + CHUNK))

    const staleFilter = chunk => ({
      ats: 'greenhouse',
      companySlug: { $in: chunk },
      fetchedAt: { $lt: runStart },
    })

    const totalGreenhouse = await Job.countDocuments({ ats: 'greenhouse' })
    let staleTotal = 0
    for (const chunk of chunks) staleTotal += await Job.countDocuments(staleFilter(chunk))

    const share = totalGreenhouse ? staleTotal / totalGreenhouse : 0
    if (share > MAX_SWEEP_SHARE) {
      console.log(`   🛑 ABORTED: sweep would delete ${staleTotal} of ${totalGreenhouse} jobs (${Math.round(share * 100)}%).`)
      console.log('      That is too many to be genuine closures. Nothing was deleted.')
      console.log('      Investigate before the next run.')
    } else if (staleTotal === 0) {
      console.log('   ✅ Nothing stale. Every stored job is still live at the source.')
    } else {
      for (const chunk of chunks) {
        const r = await Job.deleteMany(staleFilter(chunk))
        removed += r.deletedCount || 0
      }
      console.log(`   🗑️  Removed ${removed} closed or no-longer-qualifying jobs.`)
    }
  }

  // ── AGE PURGE ───────────────────────────────────────────────────────────────
  // A posting older than two weeks has usually collected hundreds of applications,
  // and students on an OPT clock are better served by a smaller, fresher board than
  // a large stale one. Accepted cost: a few genuinely-open older roles are lost.
  //
  // Same guard as the sweep: abort if the share is implausible.
  //
  // Was 0.90 while the backlog was being cleared. Now that old postings are skipped at
  // fetch instead of saved-then-deleted, a normal run purges almost nothing — the last
  // run removed 5 of 38,065, then 0 of 44,265. 0.90 is far looser than anything real,
  // so a date bug could empty the board unchallenged. 0.25 is the honest ceiling.
  //
  // MAX_AGE_DAYS now lives at module scope (see top of file) so the fetch gate
  // above and this purge cannot disagree.
  const MAX_PURGE_SHARE = 0.25
  console.log(`\n📅 Removing jobs posted more than ${MAX_AGE_DAYS} days ago...`)

  // Reuses the run-start cutoff the fetch gate used, not a fresh one.
  const cutoff = ageCutoff
  // Jobs with no postedAt are left alone: unknown age is not the same as old.
  const oldFilter = { postedAt: { $ne: null, $lt: cutoff } }
  const totalJobs = await Job.countDocuments({})
  const oldTotal = await Job.countDocuments(oldFilter)
  const oldShare = totalJobs ? oldTotal / totalJobs : 0
  let purged = 0

  console.log(`   Cutoff: ${cutoff.toISOString().slice(0, 10)}  ·  ${oldTotal} of ${totalJobs} jobs are older (${Math.round(oldShare * 100)}%)`)

  if (oldTotal === 0) {
    console.log('   ✅ Nothing older than the cutoff.')
  } else if (oldShare > MAX_PURGE_SHARE) {
    console.log(`   🛑 ABORTED: that is over ${Math.round(MAX_PURGE_SHARE * 100)}% of the board — likely a date bug, not real age.`)
    console.log('      Nothing was deleted. Investigate before the next run.')
  } else {
    const r = await Job.deleteMany(oldFilter)
    purged = r.deletedCount || 0
    console.log(`   🗑️  Removed ${purged} jobs older than ${MAX_AGE_DAYS} days.`)
  }

  console.log(`\n✅ Done!`)
  console.log(`   💾 Saved:              ${saved}`)
  console.log(`   ⌛ Skipped (>${MAX_AGE_DAYS}d old):  ${tooOld}`)
  console.log(`   🚫 Disqualified:       ${disqualified}`)
  console.log(`   📋 Contract/Part-time: ${contractOrPartTime}`)
  console.log(`   🌍 Non-US:             ${nonUS}`)
  console.log(`   ⚠️  DB errors:          ${skipped}`)
  console.log(`   🏢 Companies OK:       ${okSlugs.length}`)
  console.log(`   📡 Companies failed:   ${failedCompanies}  (skipped, not swept)`)
  console.log(`   🗑️  Removed (stale):    ${removed}`)
  console.log(`   📅 Removed (>${MAX_AGE_DAYS}d old):  ${purged}`)

  await mongoose.disconnect()
  console.log('🔌 Disconnected from MongoDB')
}

// ── Exports for reuse ────────────────────────────────────────
// filterCheck.mjs imports these to run the EXACT same filter as production, so
// the audit can never test a different filter than the one that actually ships.
export {
  stripHtml,
  normalize,
  isUSLocation,
  classifyLocation,
  isDisqualified,
  isContractOrPartTime,
  fetchGreenhouseCompany,
  DISQUALIFIER_PATTERNS,
  // Exported for the Ashby fetcher. Deliberately shared rather than copied: a second
  // implementation of "is this senior?" or "which state is this?" would drift, and the
  // board would then judge the same job differently depending on which ATS it came
  // from. One definition, both sources.
  detectExperienceLevel,
  detectWorkType,
  extractState,
  extractSalary,
  detectEmploymentType,
  extractYearsExperience,
}

// Only auto-run the full pipeline when this file is executed directly
// (node FetchJobs.mjs). When another script imports it — e.g. filterCheck.mjs —
// this stays quiet instead of kicking off a 55k-job fetch.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fetchAllJobs().catch(err => {
    console.error('❌ Fatal error:', err)
    process.exit(1)
  })
}


