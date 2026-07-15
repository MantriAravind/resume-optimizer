import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')

console.log('Cleaning up unrealistic years-of-experience values (>15 years)...\n')

const result = await coll.updateMany(
  { $or: [{ yearsMin: { $gt: 15 } }, { yearsMax: { $gt: 15 } }] },
  { $set: { yearsMin: null, yearsMax: null } }
)

console.log(`✅ Cleaned ${result.modifiedCount} jobs — their years tag now correctly shows nothing instead of a bogus number.`)

await mongoose.disconnect()
console.log('🔌 Done.')