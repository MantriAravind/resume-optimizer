import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const DELETE_MODE = process.argv.includes('--delete')

function normalize(text = '') {
  return text.toLowerCase()
    .replace(/u\.s\.a\./g, 'us').replace(/u\.s\./g, 'us').replace(/u\.s\b/g, 'us')
    .replace(/\s+/g, ' ')
}

const DISQUALIFIER_PATTERNS = [
  /\b(us|u s)?\s*citizenship\s*:?\s*(is\s+)?(required|requirement)\b/,
  /\bcitizenship\s*:\s*this\s+position\s+requires\b/,
  /\brequires?\s+(us\s+|u s\s+)?citizenship\b/,
  /\bwill\s+require\s+(us\s+|u s\s+)?citizenship\b/,
  /\bmust\s+be\s+a?\s*(us|u s)?\s*citizen\b/,
  /\b(us|u s)\s+citizens?\s+only\b/,
  /\bonly\s+(us|u s)\s+citizens?\b/,
  /\bcitizens?\s+(are\s+)?required\b/,
  /\bsecurity\s+clearance\s+(is\s+)?(required|requirement)\b/,
  /\b(require|requires|will require|must have|must possess|must hold|must obtain)\s+(an?\s+)?(active\s+|current\s+)?(security\s+)?clearance\b/,
  /\bactive\s+(security\s+)?clearance\b/,
  /\bclearance\s+required\s*:?\s*(active|public|secret|top)\b/,
  /\bclearance\s*:\s*(active\s+|current\s+|ability to obtain\s+|able to obtain\s+)?(a\s+)?(top[\s-]?secret|secret|public\s+trust|ts\/sci|ts-sci|ts\s+sci)\b/,
  /\bclearance\s+required\b/,
  /\bpublic\s+trust\s+(clearance|required)\b/,
  /\b(ability to obtain|must be able to obtain|eligible to obtain|able to obtain)\s+(a\s+)?(public\s+trust|security|secret|ts\/sci)?\s*clearance\b/,
  /\bactive\s+(top[\s-]?secret|public\s+trust|ts\/sci)\b/,
  /\b(requires?|must have|must hold|must possess)\s+(a\s+|an\s+)?(active\s+|current\s+)?(public\s+trust|top[\s-]?secret|ts\/sci)\b/,
  /\btop\s+secret\b/, /\bts\/sci\b/, /\bts\s+sci\b/, /\bts-sci\b/, /\bsecret\s+clearance\b/, /\bdod\s+clearance\b/,
  /\bsecurity\s+clearance\b/,
  /\b(obtain|maintain|hold|possess|acquire|eligible|able|ability|require|requires|required)\b[^.]{0,40}\bsecurity\s+clearance\b/,
  /\b(obtain|maintain)\b[^.]{0,30}\bclearance\b/,
  /\bsecurity\s+clearance\b[^.]{0,40}\b(required|is required|must|eligib)/,
  /\b\(clearance\s+required\)/,
  /\bclearance\b.{0,20}\bus\s+citizen\b/,
  /\bus\s+citizen\b.{0,20}\bclearance\b/,
  /\bno\s+(visa\s+)?sponsorship\b/,
  /\b(will\s+not|cannot|can not|unable to|not able to|does not|do not|won't|are not able to|is not able to)\s+(offer|provide|sponsor)\b/,
  /\b(unable|not able)\s+to\s+(offer|provide)\s+(work\s+)?(visa\s+)?sponsorship\b/,
  /\b(does|do)\s+not\s+(offer|provide)\s+(work\s+)?(visa\s+)?sponsorship\b/,
  /\b(is\s+)?not\s+open\s+to\s+(visa\s+)?sponsorship\b/,
  /\bsponsorship\s*:?\s*(is\s+)?not\s+(available|offered|provided)\b/,
  /\bsponsorship\s+not\s+available\b/,
  /\b(visa\s+)?sponsorship\s+(is\s+)?(not\s+available|unavailable)\b/,
  /\bwithout\s+(employer\s+)?sponsorship\b/,
  /\bmust\s+be\s+authorized\s+to\s+work\s+(in\s+the\s+us\s+)?without\b/,
  /\bnot\s+eligible\s+for\s+(\w+\s+){0,3}sponsorship\b/,
  /\bineligible\s+for\s+(\w+\s+){0,3}sponsorship\b/,
  /\bno\s+h-?1b\s+or\s+opt\s+(visa\s+)?sponsorship\b/,
  /\bregret\s+that\s+we\s+are\s+unable\s+to\s+(offer|provide)/,
  /\bgreen\s+card\s+(is\s+)?required\b/,
  /\bgc\s+required\b/,
  /\bpermanent\s+resident\s+(is\s+)?required\b/,
]

function isDisqualified(plainText = '') {
  const norm = normalize(plainText)
  return DISQUALIFIER_PATTERNS.some(re => re.test(norm))
}

const jobSchema = new mongoose.Schema({
  id: String, title: String, company: String, description: String,
}, { strict: false })
const Job = mongoose.models.Job || mongoose.model('Job', jobSchema)

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not found. Run this from the backend folder where your .env lives.')
    process.exit(1)
  }

  console.log('\n' + '='.repeat(64))
  console.log(DELETE_MODE
    ? 'DELETE MODE — disqualified jobs WILL be permanently removed.'
    : 'DRY RUN — nothing will be deleted. Add --delete to actually remove.')
  console.log('='.repeat(64) + '\n')

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB\n')

  const total = await Job.countDocuments()
  console.log('Scanning ' + total.toLocaleString() + ' jobs...\n')

  const flagged = []
  let scanned = 0

  const cursor = Job.find({}, { id: 1, title: 1, company: 1, description: 1 }).lean().cursor()

  for (let job = await cursor.next(); job != null; job = await cursor.next()) {
    scanned++
    const text = (job.title || '') + ' ' + (job.description || '')
    if (isDisqualified(text)) {
      flagged.push(job)
    }
    if (scanned % 10000 === 0) console.log('  ...scanned ' + scanned.toLocaleString())
  }

  console.log('\n' + '-'.repeat(64))
  console.log('Scanned:      ' + scanned.toLocaleString())
  console.log('Disqualified: ' + flagged.length.toLocaleString() + '  (' + ((flagged.length / total) * 100).toFixed(1) + '% of database)')
  console.log('-'.repeat(64) + '\n')

  console.log('Examples of jobs that would be removed:\n')
  for (const j of flagged.slice(0, 15)) {
    console.log('  - ' + (j.title || '(no title)') + '  -  ' + (j.company || '(no company)'))
  }
  if (flagged.length > 15) console.log('  ...and ' + (flagged.length - 15).toLocaleString() + ' more\n')
  else console.log('')

  if (!DELETE_MODE) {
    console.log('DRY RUN complete. No changes made.')
    console.log('If these look right, run again with:  node cleanupJobs.mjs --delete\n')
    await mongoose.disconnect()
    return
  }

  const ids = flagged.map(j => j.id).filter(Boolean)
  console.log('Deleting ' + ids.length.toLocaleString() + ' disqualified jobs...')
  const result = await Job.deleteMany({ id: { $in: ids } })
  console.log('Removed ' + result.deletedCount.toLocaleString() + ' jobs.\n')

  const remaining = await Job.countDocuments()
  console.log('Database now holds ' + remaining.toLocaleString() + ' jobs.\n')

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})