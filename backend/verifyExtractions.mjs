import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')
const total = await coll.countDocuments({})

console.log('═══════════════════════════════════════════')
console.log(`  EXTRACTION VERIFICATION — ${total} jobs`)
console.log('═══════════════════════════════════════════\n')

console.log('── 1. NO REGRESSION (original filters still clean) ──')
const badge = await coll.countDocuments({ sponsorBadge: true })
console.log(`   sponsorBadge:true = ${badge} ${badge===0?'✅':'❌'}`)
const disqPhrases = ['must be a us citizen','no visa sponsorship','security clearance required','top secret clearance','green card required']
let disqTotal = 0
for (const p of disqPhrases) {
  disqTotal += await coll.countDocuments({ description: { $regex: p, $options:'i' } })
}
console.log(`   disqualifying phrases in kept jobs = ${disqTotal} ${disqTotal===0?'✅':'❌'}`)

console.log('\n── 2. INDUSTRY ──')
const industryCount = await coll.countDocuments({ industry: { $ne: null } })
console.log(`   Has industry tag: ${industryCount}/${total} (${(industryCount/total*100).toFixed(1)}%)`)
const industryBreakdown = await coll.aggregate([
  { $match: { industry: { $ne: null } } },
  { $group: { _id: '$industry', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray()
industryBreakdown.forEach(i => console.log(`     ${i.count.toString().padStart(6)}  ${i._id}`))

console.log('\n── 3. STATE EXTRACTION ──')
const stateCount = await coll.countDocuments({ state: { $ne: null } })
console.log(`   Has state: ${stateCount}/${total} (${(stateCount/total*100).toFixed(1)}%)`)

console.log('\n── 4. SALARY ──')
const salaryCount = await coll.countDocuments({ salaryMin: { $ne: null } })
console.log(`   Has salary: ${salaryCount}/${total} (${(salaryCount/total*100).toFixed(1)}%)`)
const salaryOutliers = await coll.countDocuments({ $or: [
  { salaryMin: { $lt: 20000 } }, { salaryMax: { $gt: 1000000 } },
  { $expr: { $gt: ['$salaryMin', '$salaryMax'] } }
]})
console.log(`   Outlier/nonsense values (should be 0): ${salaryOutliers} ${salaryOutliers===0?'✅':'❌ REVIEW'}`)

console.log('\n── 5. YEARS OF EXPERIENCE ──')
const yearsCount = await coll.countDocuments({ yearsMin: { $ne: null } })
console.log(`   Has years: ${yearsCount}/${total} (${(yearsCount/total*100).toFixed(1)}%)`)
const yearsOutliers = await coll.countDocuments({ $or: [
  { yearsMin: { $gt: 30 } }, { yearsMax: { $gt: 30 } }
]})
console.log(`   Outlier values >30 years (should be near 0): ${yearsOutliers} ${yearsOutliers===0?'✅':'⚠️  review'}`)

console.log('\n── 6. EMPLOYMENT TYPE TAG ──')
const empBreakdown = await coll.aggregate([
  { $match: { employmentType: { $ne: null } } },
  { $group: { _id: '$employmentType', count: { $sum: 1 } } }
]).toArray()
console.log('   Breakdown:', empBreakdown.map(e => `${e._id}: ${e.count}`).join(', ') || 'none tagged')
const partTimeLeak = await coll.countDocuments({ employmentType: 'Part-time' })
console.log(`   ⚠️  "Part-time" TAGGED jobs still present: ${partTimeLeak} — should be 0 (Part-time should be HIDDEN, not tagged, so this catches a logic mismatch)`)

console.log('\n── 7. WORK TYPE ──')
const wtBreakdown = await coll.aggregate([
  { $group: { _id: '$workType', count: { $sum: 1 } } }, { $sort: { count: -1 } }
]).toArray()
wtBreakdown.forEach(w => console.log(`     ${w.count.toString().padStart(6)}  ${w._id}`))

console.log('\n── 8. EXPERIENCE LEVEL ──')
const expBreakdown = await coll.aggregate([
  { $group: { _id: '$experienceLevel', count: { $sum: 1 } } }, { $sort: { count: -1 } }
]).toArray()
expBreakdown.forEach(e => console.log(`     ${e.count.toString().padStart(6)}  ${e._id}`))

console.log('\n── 9. RANDOM SAMPLE (eyeball for sanity) ──')
const sample = await coll.aggregate([{ $sample: { size: 6 } }]).toArray()
sample.forEach((j, i) => {
  console.log(`\n  ${i+1}. [${j.company}] ${j.title}`)
  console.log(`     state:${j.state} | workType:${j.workType} | exp:${j.experienceLevel} | industry:${j.industry}`)
  console.log(`     salary:${j.salaryMin?`$${j.salaryMin}-$${j.salaryMax}`:'none'} | years:${j.yearsMin?`${j.yearsMin}+`:'none'} | empType:${j.employmentType||'none'}`)
})

await mongoose.disconnect()
console.log('\n🔌 Done.')