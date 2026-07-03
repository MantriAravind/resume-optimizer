import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()
await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')

// 1. The 6 disqualifying-phrase jobs
console.log('═══ DISQUALIFYING PHRASES (ts/sci, ts sci) ═══')
for (const p of ['ts/sci','ts sci','security clearance required','green card required']) {
  const docs = await coll.find({ description: { $regex: p, $options: 'i' } }).limit(5).toArray()
  if (docs.length) {
    console.log(`\n"${p}" found in ${docs.length}+ jobs:`)
    docs.forEach(j => {
      const idx = j.description.toLowerCase().indexOf(p.toLowerCase())
      console.log(`  [${j.company}] ${j.title}`)
      console.log(`     ...${j.description.slice(Math.max(0,idx-40), idx+40)}...`)
    })
  }
}

// 2. The 9 foreign-remote jobs
console.log('\n\n═══ FOREIGN-REMOTE LEAKS ═══')
const fr = await coll.find({ location: { $regex: 'remote - (emea|apac|latam|eu)', $options: 'i' } }).limit(10).toArray()
fr.forEach(j => console.log(`  "${j.location}"  — ${j.company} — ${j.title}`))

// 3. Sample of non-greenhouse applyUrls
console.log('\n\n═══ NON-GREENHOUSE APPLY URLS (sample) ═══')
const ng = await coll.find({ applyUrl: { $not: /greenhouse\.io/ } }).limit(10).toArray()
ng.forEach(j => console.log(`  ${j.applyUrl}`))

await mongoose.disconnect()