// Prune zero-yield companies from sr_companies.txt so the 6-hourly SR cron
// stops spending ~2h40m knocking on doors that never produce a job.
//
// KEEP RULE: a company stays if it has >=1 job on the board right now.
// Everything it lists either failed the filters or aged out — measured twice
// (before and after the Domino's purge), stable at ~87% zero-yield.
//
// WHY THIS IS THE LEAST-REVERSIBLE OPERATION IN THE SYSTEM, AND THE GUARDS:
// a wrongly removed company is silently never fetched again — no error, no
// report, just absence. So:
//   • Preview by default; --apply to write.
//   • The removed list is SAVED to sr_pruned_companies.txt, committed next to
//     the live list. Restoring any company is pasting its line back. A future
//     re-probe can re-audition the whole pruned list cheaply.
//   • The live list is backed up to sr_companies.backup.txt before writing.
//
// Run from backend:   node pruneSRCompanies.mjs           (preview)
//                     node pruneSRCompanies.mjs --apply   (write)

import mongoose from 'mongoose'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config()

const APPLY = process.argv.includes('--apply')
const J = mongoose.model('Job', new mongoose.Schema({}, { strict: false, collection: 'jobs' }))

await mongoose.connect(process.env.MONGODB_URI)

const listed = fs.readFileSync('sr_companies.txt', 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean)
const counts = await J.aggregate([
  { $match: { ats: 'smartrecruiters' } },
  { $group: { _id: '$companySlug', n: { $sum: 1 } } },
])
await mongoose.disconnect()

const byCompany = new Map(counts.map(c => [String(c._id).toLowerCase(), c.n]))
const keep = [], drop = []
for (const c of listed) (byCompany.get(c.toLowerCase()) > 0 ? keep : drop).push(c)

console.log(`SR companies: ${listed.length} → keep ${keep.length}, drop ${drop.length} (${(drop.length / listed.length * 100).toFixed(0)}%)`)
console.log('\nSample of what would be DROPPED (30 random):')
const shuffled = [...drop].sort(() => Math.random() - 0.5)
for (const c of shuffled.slice(0, 30)) console.log('  -', c)
console.log('\nSample of what stays (10):')
for (const c of keep.slice(0, 10)) console.log('  +', c)

if (!APPLY) {
  console.log('\n👀 PREVIEW ONLY — nothing written.')
  console.log('   Eyeball the drop sample: LLC/logistics/franchise names expected.')
  console.log('   If a company you recognize as a real tech/professional employer')
  console.log('   appears there, STOP — its jobs may have merely aged out.')
  console.log('   Apply with:  node pruneSRCompanies.mjs --apply')
  process.exit(0)
}

fs.writeFileSync('sr_companies.backup.txt', listed.join('\n') + '\n')
fs.writeFileSync('sr_pruned_companies.txt', drop.join('\n') + '\n')
fs.writeFileSync('sr_companies.txt', keep.join('\n') + '\n')
console.log('\n✅ Written:')
console.log('   sr_companies.txt          →', keep.length, 'companies (the live list)')
console.log('   sr_pruned_companies.txt   →', drop.length, 'removed, kept for re-audition')
console.log('   sr_companies.backup.txt   → full pre-prune list')
console.log('\nNext: commit all three, then watch the next scheduled SR cron duration.')
