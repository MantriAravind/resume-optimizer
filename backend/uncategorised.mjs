// ── WHAT IS IN THE UNCATEGORISED PILE? ──────────────────────────────────────
//
// boardComposition.mjs put 9,033 of 26,133 jobs (34.6%) into "Uncategorised" —
// titles its word lists did not recognise. That is too big to guess at. If a third
// of it is tech, a tech allow-list needs very different words than if it is all
// directors and coordinators.
//
// This prints the most common uncategorised titles so the allow-list gets built
// against real titles instead of assumptions. Same lesson as the location filter:
// the blocklist leaked for five rounds because it was written from guesses.
//
// READ-ONLY. Prints only.
//
// RUN:  node uncategorised.mjs        (top 150 titles)
//       node uncategorised.mjs 300    (top 300)

import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false, collection: 'jobs' })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

// Identical to boardComposition.mjs. Kept in step by hand — if one changes, change
// both, or the two scripts will disagree about what "uncategorised" even means.
const CATEGORIES = [
  ['Software / Data / IT', [
    'software', 'developer', 'engineer, back', 'backend', 'back-end', 'frontend', 'front-end',
    'full stack', 'fullstack', 'data engineer', 'data scientist', 'data analyst', 'machine learning',
    ' ml ', 'ai engineer', 'devops', 'sre', 'site reliability', 'cloud', 'security engineer',
    'qa engineer', 'test engineer', 'mobile engineer', 'ios engineer', 'android engineer',
    'platform engineer', 'infrastructure engineer', 'systems engineer', 'network engineer',
    'database', 'analytics engineer', 'business intelligence', 'programmer', 'architect',
    'technical program', 'product manager', 'ux ', 'ui ', 'designer', 'computer',
  ]],
  ['Other engineering / science', [
    'mechanical', 'electrical', 'civil', 'chemical engineer', 'aerospace', 'manufacturing engineer',
    'process engineer', 'quality engineer', 'industrial engineer', 'hardware', 'firmware',
    'research scientist', 'biologist', 'chemist', 'physicist', 'laboratory', 'r&d',
    'structural', 'materials', 'optical', 'rf engineer', 'validation engineer',
  ]],
  ['Healthcare / clinical', [
    'nurse', ' rn ', 'rn -', 'rn,', 'lpn', 'physician', 'medical assistant', 'clinical',
    'therapist', 'hospice', 'patient', 'caregiver', 'veterinar', 'dental', 'pharmac',
    'radiolog', 'surgical tech', 'phlebotom', 'behavioral health', 'social worker',
    'home health', 'nursing', 'health aide', 'counselor',
  ]],
  ['Sales / marketing / CS', [
    'sales', 'account executive', 'account manager', 'business development', 'marketing',
    'customer success', 'customer support', 'brand', 'growth', 'partnerships', 'seo',
    'content', 'social media', 'communications', 'public relations', 'demand generation',
  ]],
  ['Finance / accounting / legal', [
    'accountant', 'accounting', 'finance', 'financial', 'controller', 'auditor', 'audit',
    'tax ', 'treasury', 'payroll', 'underwrit', 'actuar', 'legal', 'attorney', 'paralegal',
    'compliance', 'investment', 'portfolio',
  ]],
  ['HR / admin / operations', [
    'human resources', ' hr ', 'recruit', 'talent', 'people operations', 'administrative',
    'office manager', 'executive assistant', 'coordinator', 'operations', 'warehouse',
    'logistics', 'supply chain', 'facilities', 'driver', 'technician', 'maintenance',
    'production', 'assembler', 'shift', 'store manager', 'retail', 'cashier', 'server',
    'cook', 'janitor', 'custodian', 'security officer', 'teacher', 'instructor',
  ]],
]

function isUncategorised(title) {
  const t = ` ${(title || '').toLowerCase()} `
  return !CATEGORIES.some(([, words]) => words.some(w => t.includes(w)))
}

// Strips the noise that makes identical roles look like different titles: req IDs,
// seniority prefixes, trailing location and department parentheticals.
function normalise(title) {
  return (title || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[#-]\s*\d+.*$/, ' ')
    .replace(/\b(senior|sr\.?|junior|jr\.?|staff|lead|principal|associate|assistant|head of|director of|vp|vice president|manager of|i{1,3}|iv|[0-9]+)\b/g, ' ')
    .replace(/[^a-z& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  const topN = parseInt(process.argv[2] || '150', 10)

  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected\n')

  const exact = new Map()   // normalised title -> count
  const words = new Map()   // single word -> count
  let total = 0, uncat = 0

  const cursor = Job.find({}, { title: 1 }).lean().cursor()
  for await (const job of cursor) {
    total++
    if (!isUncategorised(job.title)) continue
    uncat++

    const norm = normalise(job.title)
    if (norm) exact.set(norm, (exact.get(norm) || 0) + 1)

    for (const w of new Set(norm.split(' '))) {
      if (w.length < 3) continue
      words.set(w, (words.get(w) || 0) + 1)
    }
  }

  console.log(`📊 ${uncat.toLocaleString()} uncategorised of ${total.toLocaleString()} (${((uncat / total) * 100).toFixed(1)}%)\n`)

  console.log('═'.repeat(64))
  console.log(`TOP ${topN} UNCATEGORISED TITLES`)
  console.log('═'.repeat(64))
  const topTitles = [...exact.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
  for (const [t, n] of topTitles) {
    console.log(`${String(n).padStart(5)}  ${t}`)
  }

  console.log('\n' + '═'.repeat(64))
  console.log('MOST COMMON WORDS (what the allow-list should be built from)')
  console.log('═'.repeat(64))
  const topWords = [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)
  for (let i = 0; i < topWords.length; i += 4) {
    console.log(topWords.slice(i, i + 4)
      .map(([w, n]) => `${w} (${n})`.padEnd(26)).join(''))
  }

  await mongoose.disconnect()
  console.log('\n🔌 Disconnected')
}

main().catch(async e => {
  console.error('❌ Failed:', e.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
