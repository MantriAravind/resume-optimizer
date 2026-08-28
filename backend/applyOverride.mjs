import 'dotenv/config'
import mongoose from 'mongoose'

// Directly repoint one company's branding at the correct domain — for squatter
// corrections, where the scorer confidently matched the WRONG entity and the
// row is already 'provider' (so --retry won't touch it).
//
//   node applyOverride.mjs <ats> <slug> <domain>
//   e.g. node applyOverride.mjs greenhouse flyzipline flyzipline.com
//
// Also add the same mapping to branding_overrides.json so any future
// re-enrichment keeps the correction.

const [ats, slug, domain] = process.argv.slice(2)
if (!ats || !slug || !domain) {
  console.log('Usage: node applyOverride.mjs <ats> <slug> <domain>')
  process.exit(1)
}
const CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID
if (!CLIENT_ID) { console.error('BRANDFETCH_CLIENT_ID missing from .env'); process.exit(1) }

await mongoose.connect(process.env.MONGODB_URI)
const res = await mongoose.connection.collection('companies').updateOne(
  { ats, slug },
  { $set: {
      officialDomain: domain,
      'branding.logoUrl': `https://cdn.brandfetch.io/${domain}?c=${CLIENT_ID}`,
      'branding.logoSource': 'manual_override',
      logoStatus: 'provider',
      updatedAt: new Date(),
  } }
)
console.log(res.matchedCount
  ? `Updated ${ats}/${slug} -> ${domain}`
  : `NO ROW FOUND for ${ats}/${slug} — check the slug`)
await mongoose.disconnect()
