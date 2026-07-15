import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected.\n')

  const total = await Job.countDocuments()
  console.log('Total jobs now:', total.toLocaleString())

  const anduril = await Job.find({ company: /anduril/i }).lean()
  console.log('\nAnduril jobs remaining:', anduril.length)
  if (anduril.length > 0) {
    console.log('⚠️ STILL PRESENT — these should have been filtered:')
    anduril.forEach(j => console.log('  -', j.title))
  } else {
    console.log('✅ Zero Anduril jobs — the clearance filter worked.')
  }

  await mongoose.disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })