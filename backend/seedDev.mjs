// seedDev.mjs — copy a sample of REAL jobs from production into the dev database.
//
// Why: the dev database drifted to 1,192 truncated Lever stubs, so every local test
// of the optimizer either used a stub (and produced garbage) or needed the production
// address pasted into a shell. This makes local testing local again.
//
// Reads two addresses from backend/.env (gitignored, local machine only):
//   MONGODB_URI       = the dev database (what server.js uses locally)
//   MONGODB_URI_PROD  = production, read-only here; this script never writes to it
//
// Usage (from backend/):   node seedDev.mjs           copies 300 jobs (100 per ATS)
//                          node seedDev.mjs --n 500
// Run once now, then whenever local tests need fresh postings. Safe to re-run: upserts by id.

import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
dotenv.config()

const args = process.argv.slice(2)
const nArg = args.indexOf('--n')
const PER_ATS = Math.max(20, Math.round((nArg === -1 ? 300 : Number(args[nArg + 1])) / 3))

const devUri  = process.env.MONGODB_URI
// MONGODB_URI_PROD is the name deepClean.mjs already used; accepted first.
const prodUri = process.env.MONGODB_URI_PROD || process.env.PROD_MONGODB_URI
if (!devUri || !prodUri) { console.error('need MONGODB_URI and MONGODB_URI_PROD in backend/.env'); process.exit(1) }
if (devUri === prodUri) { console.error('refusing: MONGODB_URI and PROD_MONGODB_URI are the same database'); process.exit(1) }

const prod = new MongoClient(prodUri)
const dev  = new MongoClient(devUri)
await prod.connect(); await dev.connect()
const prodDb = prod.db(), devDb = dev.db()
console.log('from', prodDb.databaseName, '-> to', devDb.databaseName)
if (devDb.databaseName === prodDb.databaseName) { console.error('refusing: same database name on both sides'); process.exit(1) }

const src = prodDb.collection('jobs')
const dst = devDb.collection('jobs')
let total = 0
for (const ats of ['greenhouse', 'smartrecruiters', 'ashby']) {
  const docs = await src.find(
    { ats, closed: { $ne: true }, company: { $not: /sandbox|test|demo/i } },
    { sort: { postedAt: -1 }, limit: PER_ATS },
  ).toArray()
  if (!docs.length) { console.log(ats.padEnd(16), 'no jobs found'); continue }
  const ops = docs.map(d => { const { _id, ...rest } = d; return { updateOne: { filter: { id: d.id }, update: { $set: rest }, upsert: true } } })
  const r = await dst.bulkWrite(ops, { ordered: false })
  console.log(ats.padEnd(16), docs.length, 'copied ·', r.upsertedCount, 'new ·', r.modifiedCount, 'updated')
  total += docs.length
}
console.log('\ndev jobs now:', await dst.countDocuments(), '· seeded', total)
await prod.close(); await dev.close()
