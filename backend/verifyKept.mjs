// verifyKept.mjs — Verifies the jobs we KEPT are actually clean. Read-only.
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')

const total = await coll.countDocuments({})
console.log(`✅ Total saved jobs: ${total}\n`)

const badgeTrue = await coll.countDocuments({ sponsorBadge: true })
console.log(`TEST 1 — sponsorBadge:true count (must be 0): ${badgeTrue} ${badgeTrue === 0 ? '✅' : '❌'}`)

const htmlDesc = await coll.countDocuments({ description: { $regex: '<[a-z]', $options: 'i' } })
console.log(`TEST 2 — descriptions containing HTML tags (must be 0): ${htmlDesc} ${htmlDesc === 0 ? '✅' : '❌'}`)

const emptyDesc = await coll.countDocuments({ $or: [{ description: '' }, { description: null }] })
console.log(`TEST 3 — empty descriptions: ${emptyDesc}`)

console.log(`\nTEST 4 — Disqualifying phrases that must NOT appear in saved jobs:`)
const badPhrases = [
  'must be a us citizen',
  'must be a u.s. citizen',
  'u.s. citizenship is required',
  'us citizenship is required',
  'will require u.s. citizenship',
  'no visa sponsorship',
  'will not sponsor',
  'unable to sponsor',
  'does not offer visa sponsorship',
  'not eligible for immigration sponsorship',
  'not eligible for work authorization sponsorship',
  'not open to visa sponsorship',
  'security clearance required',
  'top secret clearance',
  'active security clearance',
  'green card required',
]
let anyFound = 0
for (const phrase of badPhrases) {
  const n = await coll.countDocuments({ description: { $regex: phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } })
  if (n > 0) { anyFound += n; console.log(`   ❌ "${phrase}": ${n} found`) }
  else console.log(`   ✅ "${phrase}": 0`)
}
console.log(`\n   Total disqualifying matches in kept jobs: ${anyFound} ${anyFound === 0 ? '✅ CLEAN' : '❌ REVIEW NEEDED'}`)

console.log(`\nTEST 5 — Random sample of kept jobs (eyeball these for sanity):`)
const sample = await coll.aggregate([{ $sample: { size: 8 } }]).toArray()
sample.forEach((j, i) => {
  console.log(`\n  ${i + 1}. [${j.company}] ${j.title}`)
  console.log(`     loc: ${j.location} | remote: ${j.isRemote} | badge: ${j.sponsorBadge}`)
  console.log(`     desc: ${(j.description || '').slice(0, 120)}...`)
})

console.log(`\n\nTEST 6 — Location spot check (non-US that may have slipped):`)
const foreignHints = ['london','toronto','bangalore','singapore','dublin','berlin','sydney','remote - emea','remote - apac']
for (const loc of foreignHints) {
  const n = await coll.countDocuments({ location: { $regex: loc, $options: 'i' } })
  if (n > 0) console.log(`   ⚠️  "${loc}": ${n}`)
}
console.log('   (some may be legit US offices or US-remote; just a sanity scan)')

await mongoose.disconnect()
console.log('\n🔌 Done.')