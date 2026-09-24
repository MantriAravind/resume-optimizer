// TEST BUILD ONLY — concurrent-worker safety self-test.
async function runConcurrencySelfTest() {
  const uid = 'concurrency-selftest-sentinel'
  const oldTs = new Date(Date.now() - 60 * 60 * 1000)
  try {
    await User.deleteOne({ clerkUserId: uid })
    await User.create({ clerkUserId: uid, resumeText: 'active-stays',
      pendingResumeFile: { data: Buffer.from('x'), name: 't.pdf', mime: 'application/pdf', size: 1, uploadedAt: oldTs, draftId: 'stale-A' } })
    const filter = { clerkUserId: uid, 'pendingResumeFile.draftId': 'stale-A' }
    const unset = { $unset: { pendingResumeFile: 1, pendingResumeLayout: 1, pendingResumeCompat: 1, pendingResumeBlocks: 1 } }
    const [r1, r2] = await Promise.all([User.updateOne(filter, unset), User.updateOne(filter, unset)])
    console.log(`[${(r1.modifiedCount + r2.modifiedCount === 1) ? 'PASS' : 'FAIL'}] R10 parallel guarded deletes on one orphan: modified=[${r1.modifiedCount},${r2.modifiedCount}]`)
    await User.updateOne({ clerkUserId: uid }, { $set: { pendingResumeFile: { data: Buffer.from('y'), name: 'n.pdf', mime: 'application/pdf', size: 1, uploadedAt: oldTs, draftId: 'newer-B' } } })
    const r3 = await User.updateOne(filter, unset)
    const doc = await User.findOne({ clerkUserId: uid }).select('resumeText pendingResumeFile.draftId').lean()
    console.log(`[${(r3.matchedCount === 0 && doc?.pendingResumeFile?.draftId === 'newer-B' && doc?.resumeText === 'active-stays') ? 'PASS' : 'FAIL'}] R10 stale-filter delete vs newer draftId: matched=${r3.matchedCount}, newer intact, active unchanged`)
    await User.deleteOne({ clerkUserId: uid })
  } catch (e) { console.error('concurrency self-test failed to run:', e.message) }
}

// TEST BUILD ONLY — rawText immutability self-test (chunk 1 item 1).
async function runImmutabilitySelfTest() {
  const uid = 'immutability-selftest-sentinel'
  const Hh = s => createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12)
  try {
    await ResumeDraft.deleteOne({ clerkUserId: uid })
    const raw = 'SENTINEL NAME\nEXPERIENCE\n\u2022 line one Jos\u00e9 \ud83d\udc68\u200d\ud83d\udcbb\n\u2022 line two'
    const lm = buildLineMap(raw)
    await ResumeDraft.create({ clerkUserId: uid, fileName: 's.pdf', text: raw, rawText: raw, lineMap: lm,
      resumeData: { summary: 'sentinel' }, draftId: 'sent-1', baseVersion: 0, createdAt: new Date() })
    const h0 = Hh(raw)
    console.log(`immutability: h0=${h0} (created; lineMap ${lm.units} v${lm.v}, lines=${lm.lines.length})`)
    const r1 = await ResumeDraft.findOne({ clerkUserId: uid }).lean()
    const set = buildDraftSyncSet({ resumeData: { summary: 'edited by user' }, rawText: 'OVERRIDE', text: 'OVERRIDE', lineMap: { v: 9 }, draftId: 'evil', baseVersion: 99 })
    await ResumeDraft.updateOne({ clerkUserId: uid }, { $set: set })
    const r2 = await ResumeDraft.findOne({ clerkUserId: uid }).lean()
    const g = await ResumeDraft.updateOne({ clerkUserId: uid, draftId: 'WRONG' }, { $set: { rawText: 'X' } })
    const r3 = await ResumeDraft.findOne({ clerkUserId: uid }).lean()
    const pass = [r1, r2, r3].every(r => Hh(r.rawText) === h0) && !('rawText' in set) && r2.resumeData?.summary === 'edited by user' && g.matchedCount === 0
    console.log(`immutability self-test: ${pass ? 'PASS' : 'FAIL'} — hash constant across create/reload/edit/guarded-miss; whitelist kept keys=[${Object.keys(set).join(',')}]`)
    await ResumeDraft.deleteOne({ clerkUserId: uid })
  } catch (e) { console.error('immutability self-test failed to run:', e.message) }
}

// ── TEST BUILD ONLY: PHASE 1 REGRESSION HARNESS ─────────────────────────────
// Runs with REGRESSION_SUITE=1 against the isolated dev database, driving real
// HTTP through the production routes as generated sentinel users. Deterministic
// parse stub (TEST_STUB_PARSE) replaces the two model calls with verbatim
// slices of the fixture text — the machinery under test is drafts, guards,
// gates, limits and ownership, not model quality; one real-parse pass lives in
// the manual UI checklist. Output is PASS/FAIL lines with counts and hashes
// only. Sentinels are removed at the end.

function fixtureLines() {
  return [
    'SENTINEL ALPHA',
    'Albany, NY | (518) 555-0100 | sentinel.alpha@example.com',
    'SUMMARY',
    '- Fixture summary bullet for harness runs.',
    'EXPERIENCE',
    'Harness Engineer | Fixture Labs | Jan 2024 - Present',
    '- Built regression fixtures end to end.',
    '- Validated confirmation atomicity paths.',
    'EDUCATION',
    'BS Testing, Fixture University',
  ]
}

function makeFixturePdf(padBytes = 0) {
  const lines = fixtureLines()
  const content = ['BT /F1 11 Tf 40 750 Td 14 TL']
  for (const ln of lines) {
    const safe = ln.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    content.push('(' + safe + ') Tj T*')
  }
  content.push('ET')
  const stream = Buffer.from(content.join('\n'))
  const pad = padBytes > 0 ? Buffer.alloc(padBytes, 0x41) : null
  const objs = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from('<< /Length ' + stream.length + ' >>\nstream\n'), stream, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    ...(pad ? [Buffer.concat([Buffer.from('<< /Length ' + pad.length + ' >>\nstream\n'), pad, Buffer.from('\nendstream')])] : []),
  ]
  let out = Buffer.from('%PDF-1.4\n')
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out = Buffer.concat([out, Buffer.from((i + 1) + ' 0 obj\n'), o, Buffer.from('\nendobj\n')])
  })
  const xrefAt = out.length
  let xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
  for (const off of offsets) xref += String(off).padStart(10, '0') + ' 00000 n \n'
  out = Buffer.concat([out, Buffer.from(xref), Buffer.from('trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF')])
  return out
}

function harnessPick(text) { return String(text || '').split('\n').map(s => s.trim()).filter(Boolean) }

function stubStructuredFromText(text) {
  const L = harnessPick(text)
  const bullets = L.filter(s => s.startsWith('- ')).map(s => s.slice(2).trim())
  const expLine = L.find(s => s.includes('Fixture Labs')) || ''
  const parts = expLine.split('|').map(s => s.trim())
  const eduLine = L.find(s => s.includes('Fixture University')) || ''
  const edu = eduLine.split(',').map(s => s.trim())
  return {
    name: L[0] || '', contact: (L[1] || '').split('|').map(s => s.trim()).filter(Boolean),
    summary: null, summaryBullets: bullets.slice(0, 1), skills: [],
    experience: expLine ? [{ title: parts[0] || '', company: parts[1] || '', location: '', dates: parts[2] || '', bullets: bullets.slice(1, 3) }] : [],
    projects: [], education: eduLine ? [{ degree: edu[0] || '', school: edu[1] || '', dates: '' }] : [], certifications: [],
  }
}

function stubProfileFromText(text) {
  const L = harnessPick(text)
  const c = (L[1] || '').split('|').map(s => s.trim())
  return { isResume: true, firstName: 'Sentinel', lastName: 'Alpha', email: c[2] || '', phone: c[1] || '', location: c[0] || '', linkedin: '', github: '', portfolio: '', targetRole: '' }
}

async function runRegressionSuite() {
  const PORT2 = process.env.PORT || 3001
  const BASE = 'http://127.0.0.1:' + PORT2
  const SECRET = randomUUID()
  process.env.TEST_AUTH_BYPASS_SECRET = SECRET
  process.env.TEST_STUB_PARSE = '1'
  const uidA = 'regr-sentinel-A', uidB = 'regr-sentinel-B', uidS = 'regr-sentinel-sweep'
  const H = b => createHash('sha256').update(b).digest('hex').slice(0, 12)
  const results = []
  const FIXTURE_SHA = createHash('sha256').update(fixtureLines().join('\n'), 'utf8').digest('hex').slice(0, 12)
  const ok = (name, cond, detail = '') => { console.log('[' + (cond ? 'PASS' : 'FAIL') + '] ' + name + (detail ? ' \u2014 ' + detail : '')); results.push(!!cond) }
  const as = uid => ({ 'x-test-auth': SECRET + ':' + uid })
  const jpost = (path, uid, body, extra = {}) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(uid ? as(uid) : {}), ...extra }, body: JSON.stringify(body) })
  const uploadAs = async (uid, buf, name = 'sentinel.pdf') => {
    const fd = new FormData()
    fd.append('resume', new Blob([buf], { type: 'application/pdf' }), name)
    const r = await fetch(BASE + '/me/resume/upload', { method: 'POST', headers: as(uid), body: fd })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }
  const confirmBody = (text, data, draftId, extra = {}) => ({
    resumeText: text, resumeFileName: 'sentinel.pdf',
    profile: { firstName: 'Sentinel', lastName: 'Alpha', email: 'sentinel.alpha@example.com', phone: '(518) 555-0100', location: 'Albany, NY', linkedin: '', github: '', portfolio: '' },
    resumeData: data, draftId, ...extra,
  })

  try {
    await new Promise(r => setTimeout(r, 600))
    for (const uid of [uidA, uidB, uidS]) { await User.deleteOne({ clerkUserId: uid }); await ResumeDraft.deleteOne({ clerkUserId: uid }) }
    console.log('\u2500\u2500 regression suite start (sentinels reset) \u00b7 fixture sha256=' + FIXTURE_SHA + ' \u2500\u2500')

    // R1 — authentication on every protected endpoint
    const protectedEps = [
      ['GET', '/me/resume'], ['POST', '/me/resume'], ['POST', '/me/resume/upload'],
      ['GET', '/me/resume-file'], ['POST', '/me/resume/analyze'], ['POST', '/me/resume/draft'],
      ['POST', '/me/resume/cancel'], ['POST', '/me/profile'], ['POST', '/download-word'], ['POST', '/download-pdf'],
    ]
    let authPass = 0
    for (const [m, p] of protectedEps) {
      const r1 = await fetch(BASE + p, { method: m })
      const r2 = await fetch(BASE + p, { method: m, headers: { Authorization: 'Bearer invalid-token-000' } })
      if (r1.status === 401 && r2.status === 401) authPass++
      else console.log('  auth leak at ' + m + ' ' + p + ': ' + r1.status + '/' + r2.status)
    }
    ok('R1 auth: no-token and invalid-token \u2192 401 on all protected endpoints', authPass === protectedEps.length, authPass + '/' + protectedEps.length)

    // R2 — upload + draft creation (as A) with a non-resume marker jobMark for preservation checks
    await User.create({ clerkUserId: uidA, resumeText: '', jobMarks: undefined })
    const fixture = makeFixturePdf()
    const up1 = await uploadAs(uidA, fixture)
    const text1 = up1.body?.text || ''
    const d1 = up1.body?.draftId || ''
    ok('R2 upload accepted, draft + parked file created', up1.status === 200 && !!d1 && text1.includes('SENTINEL ALPHA'), 'status=' + up1.status)
    const draft1 = await ResumeDraft.findOne({ clerkUserId: uidA }).lean()
    ok('R2 draft carries rawText/lineMap (chunk 1 fields)', !!draft1 && H(draft1.rawText || '') === H(text1) && draft1?.lineMap?.units === 'utf16-code-units')

    // R3 — completeness gate: under-captured submit 422, ack path 200 + recorded
    const stub1 = stubStructuredFromText(text1)
    const gap = { ...stub1, summaryBullets: [] }
    const g1 = await jpost('/me/profile', uidA, confirmBody(text1, gap, d1))
    ok('R3 gate: under-captured submit \u2192 422 needsAck', g1.status === 422 && (await g1.json()).needsAck === true)
    const up1b = await uploadAs(uidA, fixture)   // fresh draft (the 422 left it, but re-park for clean id)
    const d1b = up1b.body?.draftId
    const g2 = await jpost('/me/profile', uidA, confirmBody(up1b.body.text, { ...stubStructuredFromText(up1b.body.text), summaryBullets: [] }, d1b, { completenessAck: true }))
    ok('R3 gate: explicit acknowledgment \u2192 200', g2.status === 200)
    const uAck = await User.findOne({ clerkUserId: uidA }).select('completenessAck resumeVersion resumeFileName resumeText').lean()
    ok('R3 ack recorded with sections', Array.isArray(uAck?.completenessAck?.sections) && uAck.completenessAck.sections.includes('summary'))
    ok('R2/R3 replacement semantics: text + file name active after confirm', uAck?.resumeText === up1b.body.text && uAck?.resumeFileName === 'sentinel.pdf')

    // R4 — original-file preservation, byte-exact
    const rf = await fetch(BASE + '/me/resume-file', { headers: as(uidA) })
    const rfBuf = Buffer.from(await rf.arrayBuffer())
    ok('R4 original file retrievable and byte-identical', rf.status === 200 && H(rfBuf) === H(fixture), 'sha=' + H(rfBuf))

    // R5 — clean confirm, consumed-draft replay, stale-tab 409
    const up2 = await uploadAs(uidA, fixture)
    const d2 = up2.body?.draftId
    const c2 = await jpost('/me/profile', uidA, confirmBody(up2.body.text, stubStructuredFromText(up2.body.text), d2))
    ok('R5 clean confirmation \u2192 200 (no gate on complete data)', c2.status === 200)
    const replay = await jpost('/me/profile', uidA, confirmBody(up2.body.text, stubStructuredFromText(up2.body.text), d2))
    ok('R5 consumed-draft replay \u2192 409, nothing written', replay.status === 409)
    const up3 = await uploadAs(uidA, fixture); const d3 = up3.body?.draftId
    const up4 = await uploadAs(uidA, fixture); const d4 = up4.body?.draftId
    const stale = await jpost('/me/profile', uidA, confirmBody(up3.body.text, stubStructuredFromText(up3.body.text), d3))
    ok('R5 stale tab (older draftId after newer upload) \u2192 409', stale.status === 409 && d3 !== d4)
    const cur = await jpost('/me/profile', uidA, confirmBody(up4.body.text, stubStructuredFromText(up4.body.text), d4))
    ok('R5 current draft confirms after stale rejection', cur.status === 200)

    // R6a — stale-version CONCURRENCY (recruiter reclassification): out-of-band
    // version bump, stale confirm rejected, state unchanged, safe retry
    const up5 = await uploadAs(uidA, fixture); const d5 = up5.body?.draftId
    const snap = await User.findOne({ clerkUserId: uidA }).select('resumeText resumeFileName resumeVersion').lean()
    await User.updateOne({ clerkUserId: uidA }, { $inc: { resumeVersion: 1 } })
    const fail = await jpost('/me/profile', uidA, confirmBody(up5.body.text, stubStructuredFromText(up5.body.text), d5))
    const after = await User.findOne({ clerkUserId: uidA }).select('resumeText resumeFileName resumeVersion').lean()
    ok('R6a stale-version concurrency \u2192 409; active resume, file name unchanged', fail.status === 409 && after.resumeText === snap.resumeText && after.resumeFileName === snap.resumeFileName && after.resumeVersion === snap.resumeVersion + 1)
    const up6 = await uploadAs(uidA, fixture); const d6 = up6.body?.draftId
    const retry = await jpost('/me/profile', uidA, confirmBody(up6.body.text, stubStructuredFromText(up6.body.text), d6))
    ok('R6a retry after stale rejection succeeds', retry.status === 200)

    // R6b — PRE-COMMIT write failure: fault injection on the REAL persistence
    // call (User.findOneAndUpdate’s own query exec is made to reject before the
    // write runs). Nothing may change; retry must succeed.
    const armFault = mode => {
      const orig = User.findOneAndUpdate.bind(User)
      User.findOneAndUpdate = function (filter, ...rest) {
        const q = orig(filter, ...rest)
        if (filter && filter.clerkUserId === uidA) {
          const oe = q.exec.bind(q)
          if (mode === 'pre') q.exec = () => Promise.reject(new Error('injected: pre-commit write failure'))
          if (mode === 'post') q.exec = async (...a) => { const r = await oe(...a); throw new Error('injected: response lost after commit'); return r }
        }
        User.findOneAndUpdate = orig
        return q
      }
    }
    const up8 = await uploadAs(uidA, fixture); const d8 = up8.body?.draftId
    const snapB = await User.findOne({ clerkUserId: uidA }).select('resumeText resumeFileName resumeVersion').lean()
    armFault('pre')
    const preFail = await jpost('/me/profile', uidA, confirmBody(up8.body.text, stubStructuredFromText(up8.body.text), d8))
    const afterB = await User.findOne({ clerkUserId: uidA }).select('resumeText resumeFileName resumeVersion').lean()
    const draft8Still = await ResumeDraft.findOne({ clerkUserId: uidA, draftId: d8 }).lean()
    ok('R6b pre-commit write failure → 5xx; resume, file, version, draft ALL unchanged', preFail.status >= 500 && afterB.resumeText === snapB.resumeText && afterB.resumeFileName === snapB.resumeFileName && afterB.resumeVersion === snapB.resumeVersion && !!draft8Still, 'status=' + preFail.status)
    const preRetry = await jpost('/me/profile', uidA, confirmBody(up8.body.text, stubStructuredFromText(up8.body.text), d8))
    ok('R6b retry after injected failure succeeds', preRetry.status === 200)

    // R6c — COMMITTED write, LOST response: the atomic update commits, the
    // response is dropped before the client sees success. Retry must not
    // duplicate, double-increment the version, or replay the consumed draft.
    const up9 = await uploadAs(uidA, fixture); const d9 = up9.body?.draftId
    const snapC = await User.findOne({ clerkUserId: uidA }).select('resumeVersion').lean()
    armFault('post')
    const lost = await jpost('/me/profile', uidA, confirmBody(up9.body.text, stubStructuredFromText(up9.body.text), d9))
    const afterC1 = await User.findOne({ clerkUserId: uidA }).select('resumeText resumeVersion').lean()
    const draft9Still = await ResumeDraft.findOne({ clerkUserId: uidA, draftId: d9 }).lean()
    ok('R6c lost response: client saw 5xx but the write COMMITTED once (version +1, data active, draft not yet consumed)', lost.status >= 500 && afterC1.resumeVersion === snapC.resumeVersion + 1 && afterC1.resumeText === up9.body.text && !!draft9Still, 'status=' + lost.status)
    const replayC = await jpost('/me/profile', uidA, confirmBody(up9.body.text, stubStructuredFromText(up9.body.text), d9))
    const afterC2 = await User.findOne({ clerkUserId: uidA }).select('resumeVersion').lean()
    const draft9Gone = await ResumeDraft.findOne({ clerkUserId: uidA, draftId: d9 }).lean()
    ok('R6c retry → 409 (base version stale), NO double increment, consumed draft unreplayable', replayC.status === 409 && afterC2.resumeVersion === snapC.resumeVersion + 1 && !draft9Gone)

    // R7 — per-user ownership isolation
    const up7 = await uploadAs(uidA, fixture); const d7 = up7.body?.draftId
    const bFile = await fetch(BASE + '/me/resume-file', { headers: as(uidB) })
    ok('R7 user B cannot retrieve user A\u2019s original file (keyed by identity)', bFile.status === 404)
    const bSteal = await jpost('/me/profile', uidB, confirmBody(up7.body.text, stubStructuredFromText(up7.body.text), d7))
    const aDraftStill = await ResumeDraft.findOne({ clerkUserId: uidA, draftId: d7 }).lean()
    ok('R7 user B confirming with A\u2019s draftId \u2192 409, A\u2019s draft untouched', bSteal.status === 409 && !!aDraftStill)
    const bPersist = await ResumeDraft.updateOne({ clerkUserId: uidB, draftId: d7 }, { $set: { fileName: 'x' } })
    ok('R7 identity-scoped persistence: B-filtered write on A\u2019s draft matches nothing', bPersist.matchedCount === 0)
    const bCancel = await jpost('/me/resume/cancel', uidB, {})
    const aDraftStill2 = await ResumeDraft.findOne({ clerkUserId: uidA, draftId: d7 }).lean()
    ok('R7 user B\u2019s cancel cannot discard A\u2019s draft', bCancel.status === 200 && !!aDraftStill2)
    await jpost('/me/resume/cancel', uidA, {})

    // R8 — payload limits
    const big = await uploadAs(uidA, makeFixturePdf(6 * 1024 * 1024))
    ok('R8 >5MB upload rejected before parsing/parking', (big.status === 400 || big.status === 413) && /5MB/.test(big.body?.error || ''), 'status=' + big.status)
    process.env.SIZE_CEILING_TEST_MIB = '0.3'
    const bson = await uploadAs(uidA, fixture)
    delete process.env.SIZE_CEILING_TEST_MIB
    ok('R8 projected BSON guard rejects pre-write (compressed ceiling)', bson.status === 413 && /storage limit/.test(bson.body?.error || ''))
    const capW = await jpost('/download-word', uidA, { resumeText: 'a'.repeat(200001) })
    ok('R8 document-generation text cap \u2192 413, no partial file', capW.status === 413)

    // R9 — combined document-generation rate limit (40/hr shared)
    docGenLog.set(uidA, Array.from({ length: 39 }, () => Date.now()))
    const gen40 = await jpost('/download-word', uidA, { resumeText: 'Sentinel doc text', kind: 'resume' })
    const gen41 = await jpost('/download-pdf', uidA, { resumeText: 'Sentinel doc text', kind: 'resume' })
    ok('R9 40th combined generation allowed, 41st \u2192 429 across the OTHER endpoint', gen40.status !== 429 && gen41.status === 429, '40th=' + gen40.status + ' 41st=' + gen41.status)
    docGenLog.delete(uidA)

    // R10 — sweep conditions on the real function + live TTL index check
    const oldTs = new Date(Date.now() - 60 * 60 * 1000)
    await User.create({ clerkUserId: uidS, resumeText: 'active-stays', pendingResumeFile: { data: Buffer.from('x'), name: 't.pdf', mime: 'application/pdf', size: 1, uploadedAt: oldTs, draftId: 'orph-1' } })
    const s1 = await sweepOrphanParkedFile(uidS, (await User.findOne({ clerkUserId: uidS }).select('pendingResumeFile').lean()).pendingResumeFile, null)
    const sDoc = await User.findOne({ clerkUserId: uidS }).select('pendingResumeFile resumeText').lean()
    ok('R10 aged orphan (no draft) removed by real sweep; active untouched', s1 === 'removed' && !sDoc?.pendingResumeFile?.name && sDoc.resumeText === 'active-stays')
    await User.updateOne({ clerkUserId: uidS }, { $set: { pendingResumeFile: { data: Buffer.from('y'), name: 'f.pdf', mime: 'application/pdf', size: 1, uploadedAt: new Date(), draftId: 'fresh-1' } } })
    const s2 = await sweepOrphanParkedFile(uidS, (await User.findOne({ clerkUserId: uidS }).select('pendingResumeFile').lean()).pendingResumeFile, null)
    ok('R10 fresh parked file inside grace kept', s2 === 'kept')
    const idx = (await ResumeDraft.collection.indexes()).find(i => i.key && i.key.createdAt)
    ok('R10 live TTL index matches schema (24h)', idx?.expireAfterSeconds === 86400, 'expireAfterSeconds=' + idx?.expireAfterSeconds)
    await runConcurrencySelfTest()

    // R11 — log sanitization mapping (field paths only)
    const v = verifyResumeData({ name: 'ZZZ-INVENTED-NAME', contact: [], experience: [], projects: [], education: [] }, 'completely different source text')
    const mapped = v.violations.map(x => String(x).split(':')[0].trim()).join(', ')
    ok('R11 violation log mapping emits field paths only', !v.ok && mapped === 'name' && !/ZZZ-INVENTED/.test(mapped))

    // R12 — draft schema-version compatibility (chunk 2 step 1)
    // (a) a legacy draft with NO version field (inserted raw, bypassing schema
    // defaults — also no rawText/lineMap, i.e. a genuine pre-chunk-1 draft)
    // remains fully reviewable and confirmable through the current path.
    await ResumeDraft.deleteOne({ clerkUserId: uidA })
    const ftext = fixtureLines().join('\n')
    const uvNow = (await User.findOne({ clerkUserId: uidA }).select('resumeVersion').lean())?.resumeVersion || 0
    const legacyId = 'legacy-' + randomUUID().slice(0, 8)
    await ResumeDraft.collection.insertOne({ clerkUserId: uidA, fileName: 'sentinel.pdf', text: ftext, resumeData: stubStructuredFromText(ftext), draftId: legacyId, baseVersion: uvNow, createdAt: new Date() })
    const legacyConfirm = await jpost('/me/profile', uidA, confirmBody(ftext, stubStructuredFromText(ftext), legacyId))
    ok('R12 legacy pre-versioning draft (no version field, no chunk-1 fields) confirms normally', legacyConfirm.status === 200)
    // (b) a FUTURE-version draft: confirmation and edit-sync both 409, draft
    // left intact for the newer path, active resume and version untouched.
    const uvSnap = await User.findOne({ clerkUserId: uidA }).select('resumeVersion resumeText').lean()
    const futId = 'future-' + randomUUID().slice(0, 8)
    await ResumeDraft.collection.insertOne({ clerkUserId: uidA, fileName: 'sentinel.pdf', text: ftext, resumeData: stubStructuredFromText(ftext), draftId: futId, baseVersion: uvSnap?.resumeVersion || 0, draftSchemaVersion: 99, createdAt: new Date() })
    const futConfirm = await jpost('/me/profile', uidA, confirmBody(ftext, stubStructuredFromText(ftext), futId))
    const futDraftStill = await ResumeDraft.findOne({ clerkUserId: uidA, draftId: futId }).lean()
    const uvAfter = await User.findOne({ clerkUserId: uidA }).select('resumeVersion resumeText').lean()
    ok('R12 future-version draft: confirmation 409, draft intact, active resume + version untouched', futConfirm.status === 409 && !!futDraftStill && uvAfter.resumeVersion === uvSnap.resumeVersion && uvAfter.resumeText === uvSnap.resumeText)
    const futSync = await jpost('/me/resume/draft', uidA, { resumeData: { summary: 'sync should not land' } })
    const futUntouched = await ResumeDraft.findOne({ clerkUserId: uidA, draftId: futId }).lean()
    ok('R12 future-version draft: edit-sync 409, draft unmodified', futSync.status === 409 && futUntouched?.resumeData?.summary !== 'sync should not land')
    await ResumeDraft.deleteOne({ clerkUserId: uidA })

    const pass = results.filter(Boolean).length
    console.log('\u2500\u2500 regression suite: ' + pass + '/' + results.length + ' PASS ' + (pass === results.length ? '\u2014 ALL GREEN' : '\u2014 FAILURES ABOVE') + ' \u2500\u2500')
    process.exitCode = pass === results.length ? 0 : 1
  } catch (e) {
    console.error('regression suite crashed:', e.message)
    process.exitCode = 1
  } finally {
    for (const uid of [uidA, uidB, uidS]) { await User.deleteOne({ clerkUserId: uid }).catch(() => {}); await ResumeDraft.deleteOne({ clerkUserId: uid }).catch(() => {}) }
    delete process.env.TEST_AUTH_BYPASS_SECRET
    delete process.env.TEST_STUB_PARSE
    console.log('regression suite: sentinels cleaned up, bypass + stub disabled')
    console.log('exit code: ' + (process.exitCode ?? 0))
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
}
