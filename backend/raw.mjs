import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)

const doc = await mongoose.connection.db
  .collection('jobs')
  .findOne({ companySlug: 'zyngacareers' })

console.log('RAW DESCRIPTION (first 300 chars):')
console.log(doc.description.slice(0, 300))
console.log()
console.log('FIRST CHARACTER CODE:', doc.description.charCodeAt(0))
console.log('STARTS WITH <?:', doc.description.startsWith('<'))

await mongoose.disconnect()