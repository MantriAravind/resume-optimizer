// backend/test/make-testlab.mjs
// Generates the regression test build from the CANONICAL ../server.js.
// The generated file (server_testlab.generated.js) is gitignored — this
// generator and harness.snippet.js are the version-controlled, reproducible
// artifacts. Every patch below must match server.js exactly once; if the
// production file drifts, generation FAILS LOUDLY instead of silently
// producing a stale test build.
//
// Run:      node test/make-testlab.mjs            (from backend/)
// Suite:    $env:REGRESSION_SUITE="1"; node test/server_testlab.generated.js
// Exit:     0 = all green, 1 = failures (machine-readable)
// Database: whatever MONGODB_URI in backend/.env points at — must be the
//           isolated dev database, never production. Sentinels self-clean.
// Contains: no résumé content, no personal data, no secrets (the auth-bypass
//           secret is generated fresh inside the process per run, never logged).

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
let src = readFileSync(join(here, '..', 'server.js'), 'utf8')
const harness = readFileSync(join(here, 'harness.snippet.js'), 'utf8')

let applied = 0
function patch(name, oldStr, newStr) {
  const n = src.split(oldStr).length - 1
  if (n !== 1) {
    console.error(`GENERATION FAILED at patch "${name}": expected exactly 1 match in server.js, found ${n}.`)
    console.error('The production file has drifted — update this generator before trusting the suite.')
    process.exit(2)
  }
  src = src.replace(oldStr, newStr)
  applied++
}

// 1. Banner: unmistakable test build
patch('banner', 'Backend server running on',
  '\u26a0 TESTLAB BUILD (generated \u2014 do not push, do not deploy) \u00b7 Backend server running on')

// 2. Neutralize the production fail-closed guard (this IS the test entry point)
patch('fail-closed guard', "].filter(k => process.env[k] !== undefined)\nif (TEST_ONLY_ENV.length) {",
  "].filter(k => process.env[k] !== undefined)\nif (false) { // TESTLAB: production fail-closed guard disabled in the generated test entry point")

// 3. createHash for hash-only evidence
patch('crypto import', "import { randomUUID } from 'crypto'",
  "import { randomUUID, createHash } from 'crypto'")

// 4. Auth bypass — exists ONLY in this generated file, secret self-generated per run
patch('auth bypass', `function requireUser(req, res, next) {
  const { userId } = getAuth(req)`,
  `function requireUser(req, res, next) {
  // TESTLAB ONLY: harness bypass; the secret is minted inside runRegressionSuite
  // each run and never logged. Absent the env var this block is inert.
  const bypass = process.env.TEST_AUTH_BYPASS_SECRET
  if (bypass) {
    const h = String(req.headers['x-test-auth'] || '')
    if (h.startsWith(bypass + ':')) { req.userId = h.slice(bypass.length + 1); return next() }
  }
  const { userId } = getAuth(req)`)

// 5. Deterministic parse stubs (machinery under test, not the model)
patch('structured stub', 'async function parseResumeStructured(resumeText) {',
  `async function parseResumeStructured(resumeText) {
  if (process.env.TEST_STUB_PARSE === '1') return stubStructuredFromText(resumeText)`)
{
  const marker = 'async function readProfileFromResume('
  const i = src.indexOf(marker)
  if (i === -1 || src.indexOf(marker, i + 1) !== -1) { console.error('GENERATION FAILED: readProfileFromResume anchor'); process.exit(2) }
  const j = src.indexOf('{', i)
  src = src.slice(0, j + 1) + "\n  if (process.env.TEST_STUB_PARSE === '1') return stubProfileFromText(arguments[0])" + src.slice(j + 1)
  applied++
}

// 6. Adjustable BSON ceiling for boundary tests
patch('ceiling env', '      const ceilingBytes = 13.5 * 1024 * 1024',
  `      // TESTLAB: ceiling adjustable via env for boundary tests (production hardcodes 13.5)
      const ceilingBytes = (Number(process.env.SIZE_CEILING_TEST_MIB) || 13.5) * 1024 * 1024`)

// 7. Harness + self-tests, spliced before a stable production anchor
patch('harness splice', '// Entry-level deletions (2026-09-23, recruiter rule):',
  harness + '\n\n// Entry-level deletions (2026-09-23, recruiter rule):')

// 8. Boot hooks
patch('boot hooks', `  .then(() => ResumeDraft.syncIndexes())
  .then(() => console.log('draft TTL index synced to schema'))`,
  `  .then(() => ResumeDraft.syncIndexes())
  .then(() => console.log('draft TTL index synced to schema'))
  .then(() => { if (process.env.SWEEP_CONCURRENCY_TEST === '1') return runConcurrencySelfTest() })
  .then(() => { if (process.env.DRAFT_IMMUTABILITY_TEST === '1') return runImmutabilitySelfTest() })
  .then(() => { if (process.env.REGRESSION_SUITE === '1') return runRegressionSuite() })`)

// 9b. The generated file lives in test/, one level below server.js — rewrite
// every relative import so sibling modules still resolve.
{
  const before = (src.match(/ from '\.\//g) || []).length
  src = src.split(" from './").join(" from '../")
  console.log(`relative imports rewritten for test/ placement: ${before}`)
}

const out = join(here, 'server_testlab.generated.js')
writeFileSync(out, src)
console.log(`testlab generated: ${applied} patches applied \u2192 ${out}`)
