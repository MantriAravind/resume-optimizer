// Does the database hold the original resume file? READ-ONLY.
// Run from backend: node checkResumeFile.mjs
//
// Prints name, size and type for every user with a stored file, plus anyone with a
// file still parked in the pending slot (uploaded, never approved).
import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

const U = mongoose.model('User', new mongoose.Schema({}, { strict: false, collection: 'users' }))
await mongoose.connect(process.env.MONGODB_URI)

const users = await U.find({}, {
  clerkUserId: 1, resumeFileName: 1,
  'resumeFile.name': 1, 'resumeFile.size': 1, 'resumeFile.mime': 1, 'resumeFile.uploadedAt': 1,
  'pendingResumeFile.name': 1, 'pendingResumeFile.size': 1,
}).lean()

console.log(`${users.length} user(s)\n`)
for (const u of users) {
  const f = u.resumeFile
  const p = u.pendingResumeFile
  console.log(u.clerkUserId)
  console.log('  resumeText from:', u.resumeFileName || '(pasted / none)')
  console.log('  stored file:    ', f?.size ? `${f.name}  ${f.size} bytes  ${f.mime}  ${f.uploadedAt?.toISOString?.() || ''}` : 'none')
  if (p?.size) console.log('  pending:        ', `${p.name}  ${p.size} bytes  (uploaded, not approved)`)
  console.log()
}

await mongoose.disconnect()
