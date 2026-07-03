// verifyAll.mjs — ONE comprehensive read-only check before building the frontend.
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')
const total = await coll.countDocuments({})

const pass = s => `✅ ${s}`
const fail = s => `❌ ${s}`
let problems = 0

console.log('═══════════════════════════════════════════')
console.log(`  RESUMEAI DATA VERIFICATION — ${total} jobs`)
console.log('═══════════════════════════════════════════\n')

console.log('── 1. FILTER CORRECTNESS ──')
const badge = await coll.countDocuments({ sponsorBadge: true })
console.log(badge === 0 ? pass(`sponsorBadge:true = 0`) : fail(`sponsorBadge:true = ${badge}`)); if(badge) problems++

const html = await coll.countDocuments({ description: { $regex: '<[a-z/]', $options: 'i' } })
console.log(html === 0 ? pass(`HTML in descriptions = 0`) : fail(`HTML in descriptions = ${html}`)); if(html) problems++

const disqPhrases = ['must be a us citizen','no visa sponsorship','will not sponsor','does not offer visa sponsorship','not eligible for immigration sponsorship','security clearance required','top secret clearance','green card required','ts/sci','ts sci']
let disqTotal = 0
for (const p of disqPhrases) {
  const n = await coll.countDocuments({ description: { $regex: p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), $options: 'i' } })
  disqTotal += n
}
console.log(disqTotal === 0 ? pass(`disqualifying phrases in kept jobs = 0`) : fail(`disqualifying phrases = ${disqTotal}`)); if(disqTotal) problems++

console.log('\n── 2. FIELD COMPLETENESS ──')
const noTitle = await coll.countDocuments({ $or: [{ title: '' }, { title: null }, { title: { $exists: false } }] })
console.log(noTitle === 0 ? pass(`all jobs have title`) : fail(`missing title = ${noTitle}`)); if(noTitle) problems++

const noCompany = await coll.countDocuments({ $or: [{ company: '' }, { company: null }] })
console.log(noCompany === 0 ? pass(`all jobs have company`) : fail(`missing company = ${noCompany}`)); if(noCompany) problems++

const noId = await coll.countDocuments({ $or: [{ id: '' }, { id: null }] })
console.log(noId === 0 ? pass(`all jobs have id`) : fail(`missing id = ${noId}`)); if(noId) problems++

const noLoc = await coll.countDocuments({ $or: [{ location: '' }, { location: null }] })
console.log(noLoc === 0 ? pass(`all jobs have location`) : fail(`missing location = ${noLoc}`)); if(noLoc) problems++

const emptyDesc = await coll.countDocuments({ $or: [{ description: '' }, { description: null }] })
console.log(emptyDesc === 0 ? pass(`all jobs have description`) : `⚠️  empty descriptions = ${emptyDesc} (minor — cards show blank preview)`)

console.log('\n── 3. APPLY URL VALIDITY ──')
const noUrl = await coll.countDocuments({ $or: [{ applyUrl: '' }, { applyUrl: null }] })
console.log(noUrl === 0 ? pass(`all jobs have applyUrl`) : fail(`missing applyUrl = ${noUrl}`)); if(noUrl) problems++

const badUrl = await coll.countDocuments({ applyUrl: { $not: /^https?:\/\// } })
console.log(badUrl === 0 ? pass(`all applyUrls start with http(s)://`) : fail(`malformed applyUrl = ${badUrl}`)); if(badUrl) problems++

const nonGh = await coll.countDocuments({ applyUrl: { $not: /greenhouse\.io/ } })
console.log(nonGh === 0 ? pass(`all applyUrls point to greenhouse.io (direct ATS)`) : `⚠️  non-greenhouse applyUrls = ${nonGh}`)

console.log('\n── 4. DUPLICATES ──')
const dupAgg = await coll.aggregate([
  { $group: { _id: '$id', count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: 'dupes' }
]).toArray()
const dupes = dupAgg[0]?.dupes || 0
console.log(dupes === 0 ? pass(`no duplicate job IDs`) : fail(`duplicate IDs = ${dupes}`)); if(dupes) problems++

console.log('\n── 5. REMOTE FLAG ──')
const remoteCount = await coll.countDocuments({ isRemote: true })
const onsiteCount = await coll.countDocuments({ isRemote: false })
console.log(`   isRemote:true  = ${remoteCount}`)
console.log(`   isRemote:false = ${onsiteCount}`)
const mismatch = await coll.countDocuments({ location: { $regex: 'remote', $options: 'i' }, isRemote: false })
console.log(mismatch === 0 ? pass(`remote-flag matches location`) : `⚠️  ${mismatch} jobs say "remote" in location but isRemote:false (multi-loc, usually OK)`)

console.log('\n── 6. LOCATION SANITY ──')
const foreignRemote = await coll.countDocuments({ location: { $regex: 'remote - (emea|apac|latam|eu)', $options: 'i' } })
console.log(foreignRemote === 0 ? pass(`no "Remote - EMEA/APAC/LATAM" leaks`) : fail(`foreign-remote leaks = ${foreignRemote}`)); if(foreignRemote) problems++

const intlRemote = await coll.countDocuments({ location: { $regex: 'international remote', $options: 'i' } })
console.log(intlRemote === 0 ? pass(`no "International Remote" leaks`) : fail(`international-remote = ${intlRemote}`)); if(intlRemote) problems++

console.log('\n── 7. COMPANY DIVERSITY ──')
const companies = await coll.aggregate([{ $group: { _id: '$companySlug' } }, { $count: 'n' }]).toArray()
console.log(`   distinct companies with kept jobs: ${companies[0]?.n || 0}`)
const topCompanies = await coll.aggregate([
  { $group: { _id: '$company', count: { $sum: 1 } } },
  { $sort: { count: -1 } }, { $limit: 5 }
]).toArray()
console.log('   top 5 by job count:')
topCompanies.forEach(c => console.log(`     ${c.count.toString().padStart(5)}  ${c._id}`))

console.log('\n═══════════════════════════════════════════')
console.log(problems === 0
  ? `✅✅✅ ALL CRITICAL CHECKS PASS — data is frontend-ready`
  : `❌ ${problems} CRITICAL PROBLEM(S) — review before frontend`)
console.log('═══════════════════════════════════════════')

await mongoose.disconnect()