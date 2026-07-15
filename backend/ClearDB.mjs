import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  const before = await Job.countDocuments()
  console.log('Jobs before: ' + before.toLocaleString())

  const result = await Job.deleteMany({})
  console.log('Deleted: ' + result.deletedCount.toLocaleString())

  const after = await Job.countDocuments()
  console.log('Jobs remaining: ' + after.toLocaleString())

  await mongoose.disconnect()
  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })