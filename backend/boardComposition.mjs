// ── WHAT IS ACTUALLY ON THE BOARD? ──────────────────────────────────────────
//
// The board holds ~26,000 jobs and nobody knows what fields they are in. Before
// deciding whether to filter, hide, or re-focus anything, count them.
//
// Sorting is by job TITLE only. Titles are short and consistent; job descriptions
// are full of boilerplate that would produce false matches ("our engineering team"
// inside a nursing post). A title is what the student reads on the card anyway.
//
// READ-ONLY. Counts and prints. Writes nothing, deletes nothing.
//
// RUN:  node boardComposition.mjs

import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false, collection: 'jobs' })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

// Order matters: the first category to match wins. Narrower groups sit above
// broader ones so "Data Engineer" lands in software rather than generic engineering.
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

function categorize(title) {
  const t = ` ${(title || '').toLowerCase()} `
  for (const [name, words] of CATEGORIES) {
    if (words.some(w => t.includes(w))) return name
  }
  return 'Uncategorised'
}

async function main() {
  console.log('🔗 Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✅ Connected\n')

  const total = await Job.countDocuments()
  console.log(`📊 Board holds ${total.toLocaleString()} jobs\n`)

  const counts = {}
  const samples = {}
  let seen = 0

  // Streamed, so this never pulls 26,000 documents into memory at once.
  const cursor = Job.find({}, { title: 1 }).lean().cursor()
  for await (const job of cursor) {
    const cat = categorize(job.title)
    counts[cat] = (counts[cat] || 0) + 1
    if (!samples[cat]) samples[cat] = []
    if (samples[cat].length < 4) samples[cat].push(job.title)
    seen++
    if (seen % 5000 === 0) console.log(`   ...${seen.toLocaleString()}`)
  }

  console.log('\n' + '═'.repeat(64))
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  for (const [cat, n] of rows) {
    const pct = ((n / total) * 100).toFixed(1)
    const bar = '█'.repeat(Math.round(pct / 2))
    console.log(`\n${cat.padEnd(30)} ${String(n).padStart(6)}  ${pct.padStart(5)}%  ${bar}`)
    console.log(`   e.g. ${samples[cat].join(' · ')}`)
  }
  console.log('\n' + '═'.repeat(64))

  const tech = counts['Software / Data / IT'] || 0
  const eng  = counts['Other engineering / science'] || 0
  const stemish = tech + eng
  console.log(`\nSoftware/Data/IT:              ${((tech / total) * 100).toFixed(1)}%`)
  console.log(`Plus other engineering/science: ${((stemish / total) * 100).toFixed(1)}%`)
  console.log(`Everything else:               ${(((total - stemish) / total) * 100).toFixed(1)}%`)
  console.log('\nNote: "Uncategorised" is not junk — it is titles the word lists')
  console.log('did not recognise. Read its samples before drawing conclusions.')

  await mongoose.disconnect()
  console.log('\n🔌 Disconnected')
}

main().catch(async e => {
  console.error('❌ Failed:', e.message)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
