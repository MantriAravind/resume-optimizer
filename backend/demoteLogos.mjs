// Demote wrongly-resolved company records to needs_review (initials fallback).
//   node demoteLogos.mjs --prod workday/acg workday/the_flex_slug ...
// Prints each record before and after. Refuses if a target does not exist.
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const PROD = process.argv.includes('--prod')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set (.env).'); process.exit(1) }

const targets = process.argv.slice(2).filter(a => a.includes('/'))
if (!targets.length) { console.error('Usage: node demoteLogos.mjs --prod ats/slug [ats/slug ...]'); process.exit(1) }

await mongoose.connect(uri)
console.log('DB   :', mongoose.connection.name)
const Company = mongoose.models.Company || mongoose.model('Company', new mongoose.Schema({}, { strict: false, collection: 'companies' }))

for (const t of targets) {
  const [ats, ...rest] = t.split('/')
  const slug = rest.join('/')
  const before = await Company.findOne({ ats, slug }).lean()
  if (!before) { console.log(`❌ no record for ${t} — nothing changed`); continue }
  console.log(`\n${t}: was [${before.logoStatus}] domain=${before.officialDomain || '(none)'}`)
  await Company.updateOne({ ats, slug }, {
    $set: { logoStatus: 'needs_review', logoNote: 'demoted: wrong domain caught in eyeball pass', updatedAt: new Date() },
    $unset: { officialDomain: '', branding: '' },
  })
  console.log(`   now [needs_review] — board shows initials until an override lands`)
}
await mongoose.disconnect()
