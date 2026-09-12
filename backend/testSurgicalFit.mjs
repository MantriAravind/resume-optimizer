// testSurgicalFit.mjs — A7-S4 local verification, run from backend/:
//
//   node testSurgicalFit.mjs your.email@used.for.dev.login
//
// Loads that user's stored resumeFile/resumeCompat/resumeBlocks from Mongo, builds a
// synthetic "optimizer output" from the blocks themselves (every bullet reworded,
// three made deliberately overlong), then runs the exact same core /me/surgical-fit
// runs — including REAL shorten calls to MODEL_REWRITE. Delete or keep; it is a test
// harness, never imported by the server.

import 'dotenv/config'
import mongoose from 'mongoose'
import OpenAI from 'openai'
import { buildFitContext } from './pdfFit.mjs'
import { mapOptimizedToBlocks, fitAndShorten } from './pdfRewrite.mjs'

const email = process.argv[2]
if (!email) { console.error('usage: node testSurgicalFit.mjs <email of dev account>'); process.exit(1) }

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const MODEL_REWRITE = process.env.OPENAI_OPTIMIZATION_MODEL || 'gpt-5.6-luna'

await mongoose.connect(process.env.MONGODB_URI)
// "latest" instead of an email: the newest doc that actually has blocks — the login
// email lives in Clerk, not necessarily in our users collection
if (email === 'diagnose') {
  const col = mongoose.connection.db.collection('users')
  const total = await col.countDocuments({})
  const withBlocks = await col.countDocuments({ 'resumeBlocks.blocks': { $exists: true } })
  const withPending = await col.countDocuments({ 'pendingResumeBlocks.blocks': { $exists: true } })
  const withCompat = await col.countDocuments({ 'resumeCompat.mode': { $exists: true } })
  console.log(`users: ${total} · promoted blocks: ${withBlocks} · pending blocks: ${withPending} · promoted compat: ${withCompat}`)
  const recent = await col.find({}, { projection: { email: 1, 'profile.email': 1, updatedAt: 1, resumeCompat: 1, 'resumeFile.name': 1, 'pendingResumeFile.name': 1, pendingResumeCompat: 1 } }).sort({ updatedAt: -1 }).limit(5).toArray()
  for (const u of recent) console.log('·', u.email || u.profile?.email || u._id, '| file:', u.resumeFile?.name || '-', '| pendingFile:', u.pendingResumeFile?.name || '-', '| compat:', u.resumeCompat?.mode || '-', '| pendingCompat:', u.pendingResumeCompat?.mode || '-')
  await mongoose.disconnect(); process.exit(0)
}
const query = email === 'latest'
  ? { $or: [{ 'resumeBlocks.blocks': { $exists: true } }, { 'pendingResumeBlocks.blocks': { $exists: true } }] }
  : { $or: [{ email }, { 'profile.email': email }] }
const user = await mongoose.connection.db.collection('users').find(
  query, { projection: { resumeFile: 1, resumeCompat: 1, resumeBlocks: 1, pendingResumeFile: 1, pendingResumeCompat: 1, pendingResumeBlocks: 1, email: 1, 'profile.email': 1, updatedAt: 1 } },
).sort({ updatedAt: -1 }).limit(1).next()
// fall back to pending fields when promotion has not run — the fit core is identical
if (user && !user.resumeBlocks?.blocks && user.pendingResumeBlocks?.blocks) {
  console.log('NOTE: using PENDING blocks/compat/file — profile Save has not promoted them')
  user.resumeBlocks = user.pendingResumeBlocks
  user.resumeCompat = user.pendingResumeCompat
  user.resumeFile = user.resumeFile?.data ? user.resumeFile : user.pendingResumeFile
}
if (!user) { console.error('no user with that email'); process.exit(1) }
console.log('user found:', user.email || user.profile?.email || '(no email field)', '· compat:', user.resumeCompat?.mode, '· blocks:', user.resumeBlocks?.blocks?.length)
if (user.resumeCompat?.mode !== 'surgical' || !user.resumeBlocks?.blocks?.length || !user.resumeFile?.data) {
  console.error('not on the surgical path — upload the resume through the local app first'); process.exit(1)
}

const raw = user.resumeFile.data
const pdfBuffer = Buffer.isBuffer(raw) ? raw : raw?.buffer ? Buffer.from(raw.buffer) : Buffer.from(raw)

// synthetic optimizer output, same shape as the /optimize gate guarantees
const lines = []
let overlong = 0
for (const b of user.resumeBlocks.blocks) {
  if (b.type === 'heading') lines.push(b.text.toUpperCase())
  else if (b.type === 'skill') lines.push(b.label.replace(/:?\s*$/, ':') + ' ' + b.text)
  else if (b.type === 'bullet') {
    let t = 'Delivered ' + b.text.charAt(0).toLowerCase() + b.text.slice(1)
    if (b.maxLines <= 2 && overlong < 3) { t += ' while additionally coordinating cross-team alignment sessions and producing extensive supplementary documentation for every stakeholder group involved'; overlong++ }
    lines.push('• ' + t)
  } else lines.push(b.type === 'split' ? `${b.left}    ${b.right}` : b.text)
}
const optimizedResume = lines.join('\n')

const ctx = buildFitContext(pdfBuffer, user.resumeCompat, user.resumeBlocks)
const mapped = mapOptimizedToBlocks(user.resumeBlocks, optimizedResume)
console.log('mapping:', JSON.stringify(mapped.notes))

const shortenFn = async (items, round) => {
  const prompt = `You shorten resume lines so they fit a fixed printed width. For each item, rewrite the text to AT MOST its "budget" characters (shorter is fine).
Rules: keep every factual claim that fits, cut filler first; never add a fact, tool, metric, or claim that is not in the text; keep the original tense and voice; plain hyphens only, no em or en dashes; if "badChars" is present, those characters cannot be printed, reword to avoid them.
Respond with ONLY a JSON object mapping each id to its shortened text, no extra keys, no prose.

${JSON.stringify(items.map(({ id, text, budget, badChars }) => ({ id, text, budget, ...(badChars ? { badChars } : {}) })), null, 1)}`
  const completion = await openai.chat.completions.create({ model: MODEL_REWRITE, max_completion_tokens: 4000, reasoning_effort: 'low', messages: [{ role: 'user', content: prompt }] })
  const reply = completion.choices?.[0]?.message?.content || ''
  console.log(`shorten round ${round}: ${items.length} block(s) sent to ${MODEL_REWRITE}`)
  return JSON.parse(reply.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
}

const result = await fitAndShorten(ctx, user.resumeBlocks, mapped, shortenFn)
const changed = result.blocks.filter(b => b.changed).length
const shortened = result.blocks.filter(b => b.tries > 0 && !b.reverted)
console.log(`result: ${result.blocks.length} blocks · ${changed} changed · shortened ${shortened.length} · reverted: ${result.reverted.length ? result.reverted.join(',') : 'none'}`)
for (const b of shortened) console.log(`  ${b.id} (round ${b.tries}): "${b.text}"`)
await mongoose.disconnect()
console.log(result.blocks.every(b => b.fits) ? 'ALL BLOCKS FIT' : 'FAIL')
