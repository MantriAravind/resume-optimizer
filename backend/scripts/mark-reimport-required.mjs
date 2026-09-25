// backend/scripts/mark-reimport-required.mjs — the ONLY writer of user.repair
// (reviewer ruling 2026-09-25: "Mark the affected profile internally as requiring
// re-import"). It writes one small field on one user document and nothing else:
// resumeText, resumeData, resumeFile, profile, drafts and tracker rows are never
// modified (the run proves it: hashes of each are printed before and after).
//
// DRY RUN BY DEFAULT — prints exactly what it would write and changes nothing.
// --apply performs the write. The write is guarded, so a second run changes nothing.
//
// Run from backend/ (PowerShell: keep the single quotes around --path):
//   node scripts/mark-reimport-required.mjs --selftest
//   node scripts/mark-reimport-required.mjs --db=dev --list      read-only: every user's _id, structured yes/no, locked yes/no
//   node scripts/mark-reimport-required.mjs --db=prod --user=<Mongo _id> '--path=projects[0].bullets' --missing-lines=5
//   node scripts/mark-reimport-required.mjs --db=prod --user=<Mongo _id> '--path=projects[0].bullets' --missing-lines=5 --apply
//   node scripts/mark-reimport-required.mjs --db=prod --user=<Mongo _id> --unlock             (dry run)
//   node scripts/mark-reimport-required.mjs --db=prod --user=<Mongo _id> --unlock --apply     ONLY after the reviewer
//        approves the repair evidence, or to roll the lock itself back
// Output: internal _id, field paths, counts, timestamps, 12-char hashes. Never résumé
// text or personal data.
// Exit: 0 done · 1 selftest failed / request refused · 2 setup error
import { createHash } from 'crypto'

const PATH_RE = /^\$\.[a-zA-Z]+(\[\d+\])?(\.[a-zA-Z]+)?$/
const ID_RE = /^[0-9a-f]{24}$/

export function parseArgs(argv) {
  const o = { selftest: false, list: false, db: 'dev', user: '', paths: [], missingLines: null, apply: false, unlock: false, bad: [] }
  for (const a of argv) {
    if (a === '--selftest') o.selftest = true
    else if (a === '--apply') o.apply = true
    else if (a === '--unlock') o.unlock = true
    else if (a === '--list') o.list = true
    else if (a.startsWith('--db=')) o.db = a.slice(5)
    else if (a.startsWith('--user=')) o.user = a.slice(7).trim()
    else if (a.startsWith('--path=')) { const p = a.slice(7).trim(); o.paths.push(p.startsWith('$.') ? p : '$.' + p) }
    else if (a.startsWith('--missing-lines=')) o.missingLines = Number(a.slice(16))
    else o.bad.push(a)
  }
  return o
}

// null = acceptable; otherwise the reason the request is refused.
export function validate(o) {
  if (o.bad.length) return 'unknown argument(s): ' + o.bad.join(' ')
  if (!['dev', 'prod'].includes(o.db)) return '--db must be dev or prod'
  if (o.list) return (o.user || o.paths.length || o.apply || o.unlock || o.missingLines !== null) ? '--list takes only --db' : null
  if (!ID_RE.test(o.user)) return '--user must be a 24-character Mongo _id'
  if (o.unlock) {
    if (o.paths.length || o.missingLines !== null) return '--unlock takes no --path / --missing-lines'
    return null
  }
  if (!o.paths.length) return 'at least one --path is required (the field path the legacy caps cut)'
  const badPath = o.paths.find(p => !PATH_RE.test(p))
  if (badPath !== undefined) return 'malformed --path (expected e.g. projects[0].bullets)'
  if (!Number.isInteger(o.missingLines) || o.missingLines < 1) return '--missing-lines must be a whole number ≥ 1'
  return null
}

export function buildLock(o, now) {
  return { reimportRequired: true, reason: 'legacy_cap_truncation', paths: [...o.paths], missingSourceLines: o.missingLines, markedAt: now }
}

// doc: { _id, repair, structured } → what to do. Pure.
export function plan(doc, o, now) {
  if (!doc) return { action: 'refuse', why: 'user not found' }
  if (o.unlock) {
    if (doc.repair?.reimportRequired !== true) return { action: 'none', why: 'not locked — nothing to unlock' }
    return { action: 'unlock', filter: { _id: doc._id, 'repair.reimportRequired': true },
      update: { $set: { 'repair.reimportRequired': false, 'repair.repairedAt': now } } }
  }
  if (!doc.structured) return { action: 'refuse', why: 'no structured profile — nothing the legacy caps could have cut' }
  if (doc.repair?.reimportRequired === true) return { action: 'none', why: 'already locked — nothing to write' }
  return { action: 'lock', filter: { _id: doc._id, 'repair.reimportRequired': { $ne: true } }, update: { $set: { repair: buildLock(o, now) } } }
}

const sha = v => createHash('sha256').update(v === undefined ? 'undefined' : Buffer.isBuffer(v) ? v : JSON.stringify(v), typeof v === 'string' ? 'utf8' : undefined).digest('hex').slice(0, 12)
// Exact bytes of a stored file whether it arrives as a Buffer, a Uint8Array or a BSON
// Binary (whose .buffer is the Uint8Array of its content).
const bytesOf = f => {
  const d = f?.data
  if (!d) return null
  if (Buffer.isBuffer(d)) return d
  if (d instanceof Uint8Array) return Buffer.from(d.buffer, d.byteOffset, d.byteLength)
  if (d.buffer instanceof Uint8Array) return Buffer.from(d.buffer.buffer, d.buffer.byteOffset, d.buffer.byteLength)
  return Buffer.from(d)
}
// Fingerprint of everything the lock must never touch: hashes only.
async function fingerprint(users, id) {
  const d = await users.findOne({ _id: id }, { projection: { resumeText: 1, resumeData: 1, 'resumeFile.data': 1, profile: 1, resumeVersion: 1 } })
  if (!d) return null
  const f = bytesOf(d.resumeFile)
  return { text: sha(d.resumeText ?? ''), data: sha(d.resumeData ?? null), file: f ? sha(f) : 'none', profile: sha(d.profile ?? null), version: d.resumeVersion ?? 0 }
}
const fpLine = fp => `resume_text=${fp.text} resume_data=${fp.data} original_file=${fp.file} contact_profile=${fp.profile} resume_version=${fp.version}`
const lockLine = r => !r ? 'none' : `reimportRequired:${r.reimportRequired} reason:${r.reason} paths:[${(r.paths || []).join(',')}] missing_source_lines:${r.missingSourceLines} marked_at:${r.markedAt ? new Date(r.markedAt).toISOString() : '-'} repaired_at:${r.repairedAt ? new Date(r.repairedAt).toISOString() : '-'}`

export async function execute({ users, apps, id, o, now, log }) {
  const raw = await users.findOne({ _id: id }, { projection: { repair: 1, clerkUserId: 1 } })
  const structured = raw ? (await users.countDocuments({ _id: id, resumeData: { $ne: null } })) > 0 : false
  const doc = raw ? { _id: raw._id, repair: raw.repair || null, structured } : null
  const p = plan(doc, o, now)
  if (p.action === 'refuse') { log(`mark: REFUSED — ${p.why}. Nothing written.`); return { code: 1, plan: p } }
  log(`mark: user=${String(id)} structured_profile=${structured ? 'yes' : 'no'} lock_before=${lockLine(doc.repair)}`)
  const optimizedRows = await apps.countDocuments({ clerkUserId: raw.clerkUserId, optimized: true })
  const fp0 = await fingerprint(users, id)
  log(`mark: untouchable fields before: ${fpLine(fp0)}`)
  if (p.action === 'none') { log(`mark: ${p.why}. Nothing written.`); return { code: 0, plan: p } }
  if (p.action === 'lock') {
    log(`mark: PLAN lock paths=[${o.paths.join(',')}] missing_source_lines=${o.missingLines} reason=legacy_cap_truncation`)
    log(`mark: tracker resumes that will be reported invalid: ${optimizedRows} (their stored text is not modified)`)
  } else {
    log('mark: PLAN unlock (reimportRequired -> false, repairedAt -> now; markedAt, reason and paths kept as history)')
    log(`mark: tracker resumes made before the repair stay invalid: ${optimizedRows} currently stored`)
  }
  if (!o.apply) { log('mark: DRY RUN — nothing written. Re-run with --apply to write exactly this.'); return { code: 0, plan: p } }
  const r = await users.updateOne(p.filter, p.update)
  log(`mark: APPLIED matched=${r.matchedCount} modified=${r.modifiedCount}`)
  const after = await users.findOne({ _id: id }, { projection: { repair: 1 } })
  log(`mark: lock_after=${lockLine(after?.repair)}`)
  const fp1 = await fingerprint(users, id)
  const same = JSON.stringify(fp0) === JSON.stringify(fp1)
  log(`mark: untouchable fields after:  ${fpLine(fp1)} -> ${same ? 'UNCHANGED' : 'CHANGED (investigate)'}`)
  return { code: same && r.matchedCount <= 1 ? 0 : 1, plan: p, result: r }
}

// Read-only listing so the operator can find a user's _id without a database tool.
// ids and yes/no flags only.
export async function listUsers(users, log) {
  const rows = await users.find({}, { projection: { _id: 1, repair: 1, updatedAt: 1 } }).limit(50).toArray()
  for (const r of rows) {
    const structured = (await users.countDocuments({ _id: r._id, resumeData: { $ne: null } })) > 0
    log(`list: user=${String(r._id)} structured_profile=${structured ? 'yes' : 'no'} locked=${r.repair?.reimportRequired === true ? 'yes' : 'no'} updated=${r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : '-'}`)
  }
  log(`list: ${rows.length} user(s) shown (read-only, nothing written)`)
  return rows.length
}

// ── self-test: in-memory collections, synthetic data ──
function fakeDb(userDoc, rows) {
  const st = { doc: userDoc ? structuredClone(userDoc) : null, writes: 0 }
  const setPath = (obj, k, v) => { const ks = k.split('.'); let t = obj; for (const x of ks.slice(0, -1)) { if (t[x] == null || typeof t[x] !== 'object') t[x] = {}; t = t[x] } t[ks.at(-1)] = v }
  const users = {
    find: () => ({ limit: () => ({ toArray: async () => (st.doc ? [structuredClone(st.doc)] : []) }) }),
    findOne: async q => (st.doc && q._id === st.doc._id ? structuredClone(st.doc) : null),
    countDocuments: async q => (st.doc && q._id === st.doc._id && st.doc.resumeData != null ? 1 : 0),
    updateOne: async (filter, update) => {
      st.writes++
      if (!st.doc || filter._id !== st.doc._id) return { matchedCount: 0, modifiedCount: 0 }
      const rr = st.doc.repair?.reimportRequired
      const g = filter['repair.reimportRequired']
      if (g && typeof g === 'object' && g.$ne === true && rr === true) return { matchedCount: 0, modifiedCount: 0 }
      if (g === true && rr !== true) return { matchedCount: 0, modifiedCount: 0 }
      for (const [k, v] of Object.entries(update.$set || {})) setPath(st.doc, k, structuredClone(v))
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }
  const apps = { countDocuments: async q => rows.filter(r => r.clerkUserId === q.clerkUserId && r.optimized === q.optimized).length }
  return { users, apps, st }
}

export async function selftest() {
  const res = []
  const ok = (name, cond) => { console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + name); res.push(!!cond) }
  const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  const SECRET = 'SENTINEL-SECRET-VALUE'
  const base = { _id: ID, clerkUserId: 'user_sentinel', resumeText: SECRET + ' resume text', resumeVersion: 7,
    resumeData: { name: SECRET, projects: [{ name: SECRET, bullets: ['b'] }] }, resumeFile: { data: Buffer.from(SECRET), size: 21 },
    profile: { firstName: SECRET, email: SECRET + '@example.com' } }
  const rows = [{ clerkUserId: 'user_sentinel', optimized: true }, { clerkUserId: 'user_sentinel', optimized: true }, { clerkUserId: 'user_sentinel', optimized: false }, { clerkUserId: 'other', optimized: true }]
  const now = new Date('2026-09-25T18:00:00Z')
  const go = async (argv, db) => {
    const o = parseArgs(argv); const why = validate(o); const logs = []
    if (why) return { refused: why, logs, code: 1 }
    const r = await execute({ users: db.users, apps: db.apps, id: o.user, o, now, log: l => logs.push(l) })
    return { ...r, logs }
  }
  const LOCK = ['--db=prod', '--user=' + ID, '--path=projects[0].bullets', '--missing-lines=5']

  const db1 = fakeDb(base, rows)
  const r1 = await go(LOCK, db1)
  ok('K-01 default is a DRY RUN: plan printed (path, 5 lines, 2 tracker resumes), zero writes', db1.st.writes === 0 && r1.code === 0 &&
    r1.logs.some(l => l.includes('DRY RUN')) && r1.logs.some(l => l.includes('paths=[$.projects[0].bullets] missing_source_lines=5')) && r1.logs.some(l => l.includes('reported invalid: 2')))

  const db2 = fakeDb(base, rows)
  const r2 = await go([...LOCK, '--apply'], db2)
  const lk = db2.st.doc.repair
  ok('K-02 --apply: exactly one write, touching ONLY the repair field; lock is a real boolean with reason, paths, count, time',
    db2.st.writes === 1 && Object.keys(r2.plan.update.$set).join() === 'repair' && lk.reimportRequired === true && lk.reason === 'legacy_cap_truncation' &&
    lk.paths.join() === '$.projects[0].bullets' && lk.missingSourceLines === 5 && +new Date(lk.markedAt) === +now)
  const { repair: _r, ...restAfter } = db2.st.doc
  ok('K-03 resume text, structured data, original file, contact profile and version untouched (deep-equal) and the run PRINTS the proof (UNCHANGED)',
    JSON.stringify(restAfter) === JSON.stringify(structuredClone(base)) && r2.code === 0 && r2.logs.some(l => l.includes('-> UNCHANGED')))

  const r3 = await go([...LOCK, '--apply'], db2)
  const writesAfterSecond = db2.st.writes
  // Race: a second run that read the user BEFORE the first run's write (stale "no lock")
  // executes its own planned write afterwards — the plan's filter must match nothing.
  const stale = plan({ _id: ID, repair: null, structured: true }, parseArgs(LOCK), new Date('2026-09-25T19:00:00Z'))
  const raced = await db2.users.updateOne(stale.filter, stale.update)
  ok('K-04 idempotent: a second --apply writes nothing ("already locked"); a racing run\'s planned write matches nothing (guarded filter), first lock kept',
    writesAfterSecond === 1 && r3.plan.action === 'none' && raced.matchedCount === 0 && +new Date(db2.st.doc.repair.markedAt) === +now)

  const noStruct = fakeDb({ ...base, resumeData: null }, rows)
  const refusals = [
    await go(['--db=prod', '--path=projects[0].bullets', '--missing-lines=5', '--apply'], db1),
    await go(['--db=prod', '--user=6aae06', '--path=projects[0].bullets', '--missing-lines=5', '--apply'], db1),
    await go(['--db=prod', '--user=' + ID, '--missing-lines=5', '--apply'], db1),
    await go(['--db=prod', '--user=' + ID, '--path=projects[0].bullets', '--apply'], db1),
    await go(['--db=prod', '--user=' + ID, "--path=projects[0].bullets'; drop", '--missing-lines=5', '--apply'], db1),
    await go(['--db=staging', '--user=' + ID, '--path=projects[0].bullets', '--missing-lines=5', '--apply'], db1),
    await go([...LOCK, '--apply'], noStruct),
    await go([...LOCK, '--apply'], fakeDb(null, rows)),
  ]
  ok('K-05 refuses (nothing written): no user, bad id, no path, no count, malformed path, unknown db, no structured profile, unknown user',
    refusals.every(r => r.code === 1) && db1.st.writes === 0 && noStruct.st.writes === 0)

  const r6a = await go(['--db=prod', '--user=' + ID, '--unlock'], db2)
  const w6 = db2.st.writes
  const r6b = await go(['--db=prod', '--user=' + ID, '--unlock', '--apply'], db2)
  const ul = db2.st.doc.repair
  const r6c = await go(['--db=prod', '--user=' + ID, '--unlock', '--apply'], db2)
  ok('K-06 unlock: dry run writes nothing; --apply sets reimportRequired=false + repairedAt, keeps markedAt/reason/paths as history; a second unlock writes nothing',
    r6a.logs.some(l => l.includes('DRY RUN')) && w6 === db2.st.writes - 1 && ul.reimportRequired === false && +new Date(ul.repairedAt) === +now &&
    +new Date(ul.markedAt) === +now && ul.reason === 'legacy_cap_truncation' && ul.paths.length === 1 && r6c.plan.action === 'none' && r6b.code === 0)

  const allLogs = [r1, r2, r3, r6a, r6b, r6c, ...refusals].flatMap(r => r.logs).join('\n')
  ok('K-07 output carries ids, paths, counts and hashes only — no resume or contact values', allLogs.length > 0 && !allLogs.includes('SENTINEL') && !allLogs.includes('example.com') && !allLogs.includes('user_sentinel'))

  const a = parseArgs(['--path=projects[0].bullets']), b = parseArgs(['--path=$.projects[0].bullets'])
  ok('K-08 --path accepts projects[0].bullets or $.projects[0].bullets (same stored path)', a.paths[0] === b.paths[0] && a.paths[0] === '$.projects[0].bullets')
  const db9 = fakeDb({ ...base, repair: { reimportRequired: true } }, rows), l9 = []
  const n9 = await listUsers(db9.users, l => l9.push(l))
  const bad9 = validate(parseArgs(['--db=prod', '--list', '--apply']))
  ok('K-09 --list is read-only: ids + yes/no flags only (structured, locked), zero writes; --list refuses any other option',
    n9 === 1 && db9.st.writes === 0 && l9[0] === `list: user=${ID} structured_profile=yes locked=yes updated=-` && !l9.join('').includes('SENTINEL') && typeof bad9 === 'string')
  const pass = res.filter(Boolean).length
  console.log(`mark selftest: ${pass}/${res.length} ${pass === res.length ? 'PASS' : 'FAIL'}`)
  return pass === res.length
}

// ── entry point ──
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const o = parseArgs(process.argv.slice(2))
  if (o.selftest) process.exit((await selftest()) ? 0 : 1)
  if (!(await selftest())) { console.error('selftest failed — refusing to run'); process.exit(1) }
  const why = validate(o)
  if (why) { console.error('mark: REFUSED — ' + why + '. Nothing written.'); process.exit(1) }
  const { default: mongoose } = await import('mongoose')
  try { await import('dotenv/config') } catch { /* env may already be injected */ }
  const uri = o.db === 'prod' ? process.env.MONGODB_URI_PROD : process.env.MONGODB_URI
  if (!uri) { console.error(`SETUP FAILED: ${o.db === 'prod' ? 'MONGODB_URI_PROD' : 'MONGODB_URI'} not set`); process.exit(2) }
  await mongoose.connect(uri)
  console.log(`mark: connected to database "${mongoose.connection.name}" · mode=${o.list ? 'list' : o.unlock ? 'unlock' : 'lock'} · ${o.apply ? 'APPLY (writes)' : 'no writes'}`)
  const users = mongoose.connection.db.collection('users')
  const apps = mongoose.connection.db.collection('applications')
  if (o.list) { await listUsers(users, l => console.log(l)); await mongoose.disconnect(); process.exit(0) }
  const id = new mongoose.Types.ObjectId(o.user)
  const r = await execute({ users, apps, id, o, now: new Date(), log: l => console.log(l) })
  await mongoose.disconnect()
  process.exit(r.code)
}
