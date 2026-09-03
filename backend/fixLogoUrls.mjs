// One-off: rewrite stored Brandfetch logo URLs to the /fallback/404 form so
// unknown domains 404 (initials fallback) instead of serving Brandfetch's own
// logo as a placeholder.
//   node fixLogoUrls.mjs --prod --dry     count + 3 examples, writes nothing
//   node fixLogoUrls.mjs --prod           rewrite for real
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const PROD = process.argv.includes('--prod')
const DRY = process.argv.includes('--dry')
const uri = PROD ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
if (!uri) { console.error('❌ URI not set (.env).'); process.exit(1) }

await mongoose.connect(uri)
console.log('DB   :', mongoose.connection.name, DRY ? '· DRY RUN' : '')
const Company = mongoose.models.Company || mongoose.model('Company', new mongoose.Schema({}, { strict: false, collection: 'companies' }))

// Old form: https://cdn.brandfetch.io/<domain>?c=...   (no /fallback/ segment)
const targets = await Company.find({
  'branding.logoUrl': { $regex: /^https:\/\/cdn\.brandfetch\.io\/[^/?]+\?c=/ },
}, { ats: 1, slug: 1, 'branding.logoUrl': 1 }).lean()
console.log(`Old-form logo URLs: ${targets.length}`)
for (const t of targets.slice(0, 3)) console.log(`   e.g. ${t.ats}/${t.slug}: ${t.branding.logoUrl}`)

if (DRY) { console.log('\nDry run — nothing written. Rerun without --dry to rewrite.'); await mongoose.disconnect(); process.exit(0) }

let changed = 0
for (const t of targets) {
  const newUrl = t.branding.logoUrl.replace(/^(https:\/\/cdn\.brandfetch\.io\/[^/?]+)(\?c=)/, '$1/fallback/404$2')
  if (newUrl === t.branding.logoUrl) continue
  await Company.updateOne({ _id: t._id }, { $set: { 'branding.logoUrl': newUrl, updatedAt: new Date() } })
  changed++
  if (changed % 500 === 0) console.log(`   ${changed}/${targets.length}`)
}
console.log(`\nRewrote ${changed} logo URLs to /fallback/404 form.`)
await mongoose.disconnect()
