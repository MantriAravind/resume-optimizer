import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)

const docs = await mongoose.connection.db
  .collection('jobs')
  .find({})
  .sort({ fetchedAt: -1 })
  .limit(3)
  .toArray()

for (const d of docs) {
  console.log('─────────────────────────────')
  console.log('id:          ', d.id)
  console.log('company:     ', d.company)
  console.log('companySlug: ', d.companySlug)
  console.log('fetchedAt:   ', d.fetchedAt)
  console.log('description: ', JSON.stringify(d.description?.slice(0, 80)))
}

console.log('─────────────────────────────')
console.log('TOTAL DOCS:', await mongoose.connection.db.collection('jobs').countDocuments({}))

await mongoose.disconnect()