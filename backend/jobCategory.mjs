// ── JOB FIELD CATEGORISER ───────────────────────────────────────────────────
//
// ONE module, imported by the pipeline, the backfill and the preview, so the label
// written to the database can never drift from the label the preview showed. Same
// reason postedDate() is a single shared function.
//
// Sorted by TITLE only. Descriptions are full of boilerplate that produces false
// matches — "our engineering team" appears in nursing posts. The title is also what
// the student reads on the card.
//
// ORDER MATTERS. The first category to match wins, so the narrow and licensed
// professions are checked before the broad ones. "Clinical Data Engineer" should be
// tech, but "Nurse Manager" must not be caught by the manager rules further down.
//
// WHY LICENSED PROFESSIONS ARE SPLIT OUT
// The disqualifier filter catches jobs that SAY "US citizens only". It cannot catch
// a Registered Nurse posting, which never mentions citizenship because it does not
// need to — the barrier is a state licence, not a sentence in the description.
// Those are silent disqualifiers, and they are ~30% of the board.

// Rules are [regex, category]. Word boundaries throughout so "ml" does not match
// "html" and "rn" does not match "learn".
const RULES = [
  // ── PASS 0: unambiguous roles, checked before everything else ────────────
  // Two problems this fixes, both seen in the real board:
  //
  //   "Legal Systems Engineer" was filed under Legal, because Legal is checked
  //   before Tech. It is a tech job at a legal company.
  //
  //   "SNF Clinical Sales Director" and "Clinical Research Finance Specialist"
  //   were filed under Healthcare. They are a sales job and a finance job — no
  //   licence needed, and exactly the kind of role a student CAN take. Filing
  //   them as Healthcare hid them.
  //
  // The rule: when a title names an unmistakable role, that role wins over the
  // industry word sitting next to it.
  [/\b(software|data|devops|security|cloud|platform|systems|network|backend|frontend|full ?stack|machine learning|ml|ai|qa|test|automation|release|build|integration|identity|infrastructure|reliability|solutions|support|application)\s+(engineer|developer|architect)\b/, 'Tech'],
  [/\b(engineer|developer|architect)\s+(software|data|devops|security|cloud|platform|systems|network|backend|frontend)\b/, 'Tech'],
  [/\b(software engineer|data scientist|data engineer|web developer|mobile developer|site reliability)\b/, 'Tech'],

  [/\b(sales (director|manager|representative|lead|specialist)|account executive|business development (manager|representative))\b/, 'Sales & Marketing'],
  [/\b(financial analyst|finance (specialist|manager|director|analyst)|staff accountant|senior accountant|accounts (payable|receivable))\b/, 'Finance & Accounting'],
  [/\b(technical recruiter|recruiting (manager|coordinator)|talent acquisition)\b/, 'HR & Operations'],

  // ── Healthcare and clinical. Nearly all need a US licence. ────────────────
  [/\b(nurse|nursing|rn|lpn|lvn|cna|bsn|np|crna)\b/, 'Healthcare'],
  [/\b(physician|surgeon|surgical|doctor|md|dds|dmd|dentist|endodontist|orthodontist|periodontist|hygienist)\b/, 'Healthcare'],
  [/\b(pharmacist|pharmacy|pharmac)\w*/, 'Healthcare'],
  [/\b(veterinar\w*|vet tech|kennel)\b/, 'Healthcare'],
  [/\b(therapist|therapy|physical therap|occupational therap|speech language|pathologist|cota|pta)\b/, 'Healthcare'],
  [/\b(bcba|behavior analyst|behavioral health|autism|aba)\b/, 'Healthcare'],
  [/\b(clinical|clinician|patient|hospice|caregiver|care giver|direct support professional|direct care|home health|health aide|phlebotom\w*|radiolog\w*|sonograph\w*|medical assistant|medical receptionist|medical director|medical science|dietitian|nutritionist|paramedic|emt)\b/, 'Healthcare'],
  [/\b(counselor|social worker|case manager|case management|health coach|health navigator|community liaison|intervention specialist|personal care)\b/, 'Healthcare'],

  // ── Legal. Bar admission required. ────────────────────────────────────────
  [/\b(attorney|counsel|litigation|paralegal|solicitor|barrister|legal|law clerk|presuit|court)\b/, 'Legal'],

  // ── Education. Teaching licence required in most states. ──────────────────
  [/\b(teacher|teaching|instructor|professor|tutor|faculty|principal of|educator|instructional aide|admissions representative|substitute)\b/, 'Education'],

  // ── Skilled trades and manual. Often licensed, rarely sponsored. ──────────
  [/\b(electrician|plumber|hvac|welder|machinist|carpenter|mason|roofer|painter|installer|foreman|superintendent|groundskeeper|landscap\w*|janitor|custodian|housekeep\w*|driver|cdl|dispatcher|warehouse|material handler|forklift|assembler|line cook|chef|server|bartender|barista|cashier|stylist|tailor|barber|personal trainer|security officer|guard)\b/, 'Skilled trades'],

  // ── Engineering and science that is NOT software. Checked BEFORE tech so a
  //    Civil Engineer is not swept up by the bare word "engineer". ───────────
  [/\b(civil|mechanical|electrical|structural|chemical|aerospace|aeronautic\w*|manufacturing|industrial|process|environmental|geotechnical|petroleum|mining|nuclear|biomedical|materials|optical|acoustic|marine)\s+engineer/, 'Engineering & Science'],
  [/\b(engineer\w*)\s+(civil|mechanical|electrical|structural|chemical|aerospace|manufacturing|industrial)\b/, 'Engineering & Science'],
  [/\b(biologist|chemist|physicist|geologist|microbiolog\w*|laborator\w*|lab technician|research associate|clinical research|r&d|formulation|metallurg\w*|surveyor|drafter|cad)\b/, 'Engineering & Science'],

  // ── Tech. Software, data, IT, product, technical design. ──────────────────
  [/\b(software|developer|programmer|coder|swe|sde)\b/, 'Tech'],
  [/\b(back ?end|front ?end|full ?stack|web dev|mobile dev|ios|android|embedded|firmware)\b/, 'Tech'],
  [/\b(devops|sre|site reliability|platform engineer|infrastructure|systems engineer|network engineer|cloud|kubernetes|reliability engineer)\b/, 'Tech'],
  [/\b(data engineer|data scientist|data analyst|data architect|analytics engineer|machine learning|deep learning|ml|ai|artificial intelligence|nlp|computer vision|applied scientist|research engineer|mlops)\b/, 'Tech'],
  [/\b(business intelligence|bi (developer|analyst|manager|engineer)|etl|data warehouse|database|dba|sql)\b/, 'Tech'],
  [/\b(cyber|information security|infosec|security (engineer|analyst|architect|operations)|penetration test|appsec)\b/, 'Tech'],
  [/\b(qa engineer|quality engineer|test engineer|sdet|automation engineer|controls engineer|robotics)\b/, 'Tech'],
  [/\b(solutions? (engineer|architect|consultant)|forward deployed|sales engineer|support engineer|technical (support|consultant|account|program|project|delivery|writer)|implementation (engineer|consultant)|gtm engineer|partner engineer|field engineer|integration engineer)\b/, 'Tech'],
  [/\b(identity management|iam|ict engineer|middleware|api |sdk|release engineer|build engineer|data governance|data platform|observability|technical lead|tech lead|systems? admin\w*|sysadmin|it (support|engineer|analyst|manager|specialist|technician|administrator)|help ?desk|desktop support|technical operations)\b/, 'Tech'],
  [/\b(product manager|product owner|product management|technical product|product engineer|product design\w*|ux|ui|user experience|user research|interaction design)\b/, 'Tech'],
  [/\b(engineering (manager|director|lead)|head of engineering|vp of engineering|cto|chief technology)\b/, 'Tech'],
  [/\b(business systems analyst|systems analyst|solutions analyst|enterprise applications|salesforce|workday|sap|erp)\b/, 'Tech'],

  // ── Finance, accounting, insurance. ───────────────────────────────────────
  [/\b(accountant|accounting|bookkeep\w*|controller|auditor|audit|tax|treasury|payroll|accounts payable|accounts receivable|fp a|financial|finance|actuar\w*|underwrit\w*|claims|insurance|investment|portfolio|equity|credit|billing|collections|revenue analyst)\b/, 'Finance & Accounting'],

  // ── Sales, marketing, customer facing. ────────────────────────────────────
  [/\b(sales|seller|account (executive|manager|director)|business development|territory|revenue|quota|inside sales|sdr|bdr)\b/, 'Sales & Marketing'],
  [/\b(marketing|brand|growth|seo|sem|content|copywriter|social media|communications|public relations|media relations|creative director|art director|demand gen\w*|campaign|producer)\b/, 'Sales & Marketing'],
  [/\b(customer (success|support|service|experience)|client (success|services|onboarding|retention)|account coordinator|relationship manager|community manager|customer service representative)\b/, 'Sales & Marketing'],

  // ── HR, admin, operations, supply chain. ──────────────────────────────────
  [/\b(human resources|hr|hrbp|labor relations|employee relations|recruit\w*|talent|people (operations|business partner)|compensation|benefits|hris|onboarding specialist|training)\b/, 'HR & Operations'],
  [/\b(administrative|office manager|executive assistant|receptionist|secretary|clerk|coordinator|scheduler)\b/, 'HR & Operations'],
  [/\b(operations|logistics|supply chain|supply|procurement|sourcing|inventory|fulfilment|fulfillment|facilities|shipping|planner|buyer|vendor)\b/, 'HR & Operations'],
  [/\b(leasing|property manager|real estate|facilities manager|store manager|branch manager|general manager|restaurant|retail|merchandis\w*)\b/, 'HR & Operations'],
]

/**
 * Returns one of: Tech, Engineering & Science, Healthcare, Legal, Education,
 * Skilled trades, Finance & Accounting, Sales & Marketing, HR & Operations, Other.
 *
 * "Other" is honest, not a dumping ground: it means the title gave no clear signal.
 * Those jobs stay on the board and stay visible; they are simply not claimed by any
 * field filter.
 */
export function categorizeJob(title) {
  if (!title) return 'Other'

  // Normalise so punctuation cannot hide a word from \b: "Engineer, Backend" and
  // "Engineer - Backend" must read the same as "Engineer Backend".
  const t = ' ' + String(title)
    .toLowerCase()
    .replace(/[/(),.\-–—|:;&+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + ' '

  for (const [re, category] of RULES) {
    if (re.test(t)) return category
  }
  return 'Other'
}

// Every category the UI needs to offer. Exported so the dropdown and the server
// validation read from the same place instead of hardcoding their own copies.
export const CATEGORIES = [
  'Tech',
  'Engineering & Science',
  'Healthcare',
  'Legal',
  'Education',
  'Skilled trades',
  'Finance & Accounting',
  'Sales & Marketing',
  'HR & Operations',
  'Other',
]

// ── DOES THIS ROLE NEED A US LICENCE? ───────────────────────────────────────
//
// SEPARATE FROM THE FIELD, ON PURPOSE.
//
// The disqualifier filter catches postings that SAY "US citizens only". It cannot
// catch a Registered Nurse posting, because that posting never mentions citizenship
// — it does not need to. The barrier is a state licence that takes years of US
// schooling, not a sentence in the description. Silent disqualifiers.
//
// WHY NOT JUST HIDE THE HEALTHCARE CATEGORY
// Because most of it is not licensed work. Clinical Research Associate, Medical
// Science Liaison, Health Economics Analyst, medical device sales — pharma and
// biotech roles, no licence required, and pharma is one of the largest employers of
// OPT students there is. Hiding the category to remove the nurses would throw those
// away too. So this matches the ROLE in the title, not the industry around it.
//
// DELIBERATELY NARROW. Only titles where the licence is genuinely unavoidable. When
// unsure, the job stays visible: wrongly hiding a real opportunity is worse than
// showing one extra job a student can skip in a second.
const LICENSED = [
  // Nursing and direct clinical care. Bare "nurse" is here on purpose: "Nurse",
  // "High Acuity Nurse" and "1:1 Private Duty Nurse" are all real titles on the board,
  // and a list of compounds alone let every one of them through.
  // No trailing boundary after "nurse" here, on purpose: a real posting reads
  // "Registered NurseSenior Living Visits" — a missing space in the employer's title —
  // and \bnurse\b cannot match it. Requiring a qualifier in front keeps "Nursery
  // Technician" safe, since nursery is never preceded by one of these words.
  /\b(registered|licensed|practical|vocational|travel|staff|charge|school|duty|acuity|private duty)\s*nurse/,
  /\b(nurses?|registered nurses?|nurse practitioners?|licensed practical nurses?|licensed vocational nurses?|nurse anesthetists?|nurse midwi(fe|ves)|rn|lpn|lvn|cna|crna|np|bsn)\b/,
  // Physicians, dentistry, and surgical
  /\b(physicians?|surgeons?|dentists?|endodontists?|orthodontists?|periodontists?|prosthodontists?|dental hygienists?|anesthesiologists?|radiologists?|psychiatrists?|optometrists?|podiatrists?|chiropractors?)\b/,
  // Pharmacy
  /\b(pharmacists?|pharmacy technicians?)\b/,
  // Veterinary
  /\b(veterinarians?|licensed veterinary technicians?|lvt|veterinary technicians?)\b/,
  // Therapy and allied health
  /\b(physical therapists?|occupational therapists?|respiratory therapists?|speech language pathologists?|speech therapists?|radiation therapists?|cota|pta|athletic trainers?|dietitians?|audiologists?)\b/,
  // Behaviour analysis — BCBA is a national certification plus state licensure
  /\b(bcba|bcaba|board certified behavior analysts?|behavior analysts?)\b/,
  // Emergency and imaging
  /\b(paramedics?|emt|emergency medical technicians?|sonographers?|ultrasound technologists?|radiologic technologists?|surgical technologists?)\b/,
  // Counselling and social work where licensure is standard
  /\b(licensed clinical social workers?|lcsw|licensed professional counselors?|lpc|lmft|licensed therapists?|mental health counselors?)\b/,
  // Law — bar admission
  /\b(attorneys?|lawyers?|counsel|litigation associates?|solicitors?|barristers?)\b/,
  // Teaching — state licence. Plurals matter: "Child Care and Preschool Teachers" is a
  // real posting, and \bteacher\b does not match "teachers" because the boundary falls
  // between the r and the s.
  /\b(teachers?|substitute teachers?|special education teachers?|classroom teachers?|educators?)\b/,
  // Trades and driving where a state licence or CDL applies
  /\b(electricians?|journeymen|journeyman|master plumbers?|plumbers?|cdl|commercial drivers?|air traffic controllers?)\b/,
  /\bhvac\b.*\b(technicians?|installers?|mechanics?|repair|service tech)\b|\b(technicians?|installers?|mechanics?)\b.*\bhvac\b/,
  // Regulated financial and property roles requiring a state licence
  /\b(insurance producers?|insurance agents?|real estate agents?|realtors?|mortgage loan officers?|licensed appraisers?)\b/,
]

// Checked BEFORE the licence rules, to stop a commercial job being hidden because of
// WHO IT SELLS TO: "Territory Sales Representative - Cardiology Physician Partnership"
// is a sales job, and a student can take it.
//
// The rule is about WHERE the licensed word sits, not whether a commercial word exists
// anywhere. An earlier version just asked "is a commercial word present?", which let
// "Marketing Attorney" through — attorney is the job there; marketing only describes it.
//
// A title splits into a HEAD (before the first dash, comma or bracket) and CONTEXT:
//     "Territory Sales Representative" | "Cardiology Physician Partnership"
//     "Marketing Attorney"             | —
// The head names the job. So:
//   1. A head ending in a pure commercial noun is commercial, full stop. A Nurse
//      Recruiter recruits nurses; they do not need a nursing licence.
//   2. Otherwise, if the licensed word appears ONLY in the context and the head is
//      commercial, the licence belongs to the customer, not the job.
const COMMERCIAL_NOUN = /\b(representative|rep|executive|recruiter|salesperson|seller)\s*$/
const COMMERCIAL_HEAD = /\b(sales|account manager|account director|business development|territory|marketing|partnerships?|customer success)\b/

// Splits the RAW title, before normalisation. Normalising first would replace every
// dash, comma and bracket with a space, leaving nothing to split on — which is exactly
// the bug this comment exists to prevent from coming back.
function splitTitle(raw) {
  const i = String(raw).search(/[-–—(,|:/]/)
  const norm = x => ' ' + String(x).toLowerCase()
    .replace(/[/(),.\-–—|:;&+]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  return i === -1
    ? [norm(raw), '']
    : [norm(String(raw).slice(0, i)), norm(String(raw).slice(i + 1))]
}

/**
 * True when the TITLE names a role that effectively requires a US state licence,
 * certification, or bar admission — qualifications an international student on F1
 * will not hold. These jobs never say "citizens only", so nothing else catches them.
 *
 * Errs toward false. A missed one shows on the board; a wrong true hides a real job.
 */
export function requiresLicense(title) {
  if (!title) return false
  const t = ' ' + String(title)
    .toLowerCase()
    .replace(/[/(),.\-–—|:;&+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() + ' '
  const [head, context] = splitTitle(title)

  // 1. The job itself is commercial. A Nurse Recruiter recruits nurses.
  if (COMMERCIAL_NOUN.test(head.trim())) return false

  // 2. The licensed word sits only in the context, describing the customer.
  if (context.trim() && COMMERCIAL_HEAD.test(head) && !LICENSED.some(re => re.test(head))) {
    return false
  }

  return LICENSED.some(re => re.test(t))
}
