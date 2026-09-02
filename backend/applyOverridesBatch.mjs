// applyOverridesBatch.mjs — apply EVERY mapping in branding_overrides.json.
//
// applyOverride.mjs corrects one company per command; this reads the whole file
// and applies each entry, skipping rows already pointed at the right domain, so
// it is idempotent — rerunning after adding a line only touches the new line.
// Same write as applyOverride.mjs, deliberately: manual_override + provider.
//
//   node applyOverridesBatch.mjs          apply all
//   node applyOverridesBatch.mjs --dry    show what would change

import 'dotenv/config'
import fs from 'fs'
import mongoose from 'mongoose'

const DRY = process.argv.includes('--dry')
const CLIENT_ID = process.env.BRANDFETCH_CLIENT_ID
if (!CLIENT_ID) { console.error('BRANDFETCH_CLIENT_ID missing from .env'); process.exit(1) }

const OVERRIDES = JSON.parse(fs.readFileSync('branding_overrides.json', 'utf8'))
await mongoose.connect(process.env.MONGODB_URI)
const db = mongoose.connection.db.databaseName
console.log(`Database: ${db} · ${Object.keys(OVERRIDES).length} overrides in file${DRY ? ' · DRY RUN' : ''}\n`)

const col = mongoose.connection.collection('companies')
let applied = 0, current = 0, missing = 0
for (const [key, domain] of Object.entries(OVERRIDES)) {
  const [ats, ...rest] = key.split('/')
  const slug = rest.join('/')           // ashby slugs can contain dots, never slashes — but be safe
  const row = await col.findOne({ ats, slug }, { projection: { officialDomain: 1, logoStatus: 1 } })
  if (!row) { missing++; console.log(`   MISSING ROW  ${key}  (no company record — has it ever had jobs?)`); continue }
  if (row.officialDomain === domain && row.logoStatus === 'provider') { current++; continue }
  if (!DRY) {
    await col.updateOne({ ats, slug }, { $set: {
      officialDomain: domain,
      'branding.logoUrl': `https://cdn.brandfetch.io/${domain}?c=${CLIENT_ID}`,
      'branding.logoSource': 'manual_override',
      logoStatus: 'provider',
      updatedAt: new Date(),
    } })
  }
  applied++
  console.log(`   ${DRY ? 'would apply' : 'applied'}  ${key} -> ${domain}`)
}
console.log(`\n${applied} ${DRY ? 'would change' : 'changed'} · ${current} already correct · ${missing} missing rows`)
await mongoose.disconnect()
