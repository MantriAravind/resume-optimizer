import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()
await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')

// Pull 10 jobs whose location contains "london" and show the FULL location
const docs = await coll.find({ location: { $regex: 'london', $options: 'i' } }).limit(10).toArray()
console.log('Sample of "london" location jobs:\n')
docs.forEach((j, i) => console.log(`  ${i+1}. "${j.location}"  — ${j.company}`))

// Count how many are New London (US) vs London (foreign-looking)
const newLondon = await coll.countDocuments({ location: { $regex: 'new london', $options: 'i' } })
const withUS = await coll.countDocuments({ location: { $regex: 'london', $options: 'i' }, $or: [
  { location: { $regex: 'united states|, us|remote - us| ny| ca | tx', $options: 'i' } }
]})
console.log(`\n"New London" (US city): ${newLondon}`)
console.log(`"london" + a US signal in same location: ${withUS}`)

await mongoose.disconnect()