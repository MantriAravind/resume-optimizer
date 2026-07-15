import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')

console.log('═══════════════════════════════════════════')
console.log('  YEARS-OF-EXPERIENCE OUTLIER INVESTIGATION')
console.log('═══════════════════════════════════════════\n')

const outliers = await coll.find({ $or: [{ yearsMin: { $gt: 30 } }, { yearsMax: { $gt: 30 } }] }).limit(10).toArray()

console.log(`Found ${outliers.length} sample outliers (showing up to 10):\n`)
outliers.forEach((j, i) => {
  console.log(`${i+1}. [${j.company}] ${j.title}`)
  console.log(`   yearsMin: ${j.yearsMin}, yearsMax: ${j.yearsMax}`)
  console.log(`   description snippet: "${(j.description || '').slice(0, 250)}"`)
  console.log('')
})

await mongoose.disconnect()
console.log('🔌 Done.')