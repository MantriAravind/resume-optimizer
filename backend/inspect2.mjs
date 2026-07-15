import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const jobSchema = new mongoose.Schema({}, { strict: false })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected.\n')

  const samples = await Job.find({}).limit(3).lean()
  for (const j of samples) {
    console.log('='.repeat(60))
    console.log('Title:      ', j.title)
    console.log('Company:    ', j.company)
    console.log('All fields: ', Object.keys(j).join(', '))
    console.log('description length:', (j.description || '').length, 'chars')
    console.log('description preview:', JSON.stringify((j.description || '').slice(0, 200)))
    console.log('')
  }

  const anduril = await Job.findOne({ company: /anduril/i }).lean()
  if (anduril) {
    console.log('='.repeat(60))
    console.log('FOUND ANDURIL JOB:')
    console.log('Title:', anduril.title)
    console.log('description length:', (anduril.description || '').length, 'chars')
    console.log('Does stored description contain "clearance"?',
      /clearance/i.test(anduril.description || '') ? 'YES' : 'NO')
    console.log('description preview:', JSON.stringify((anduril.description || '').slice(0, 300)))
  } else {
    console.log('No Anduril job found by company name.')
  }

  await mongoose.disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })