// ── RESUME TEXT EXTRACTION AND SANITY CHECKS ────────────────────────────────
//
// Separate from server.js so it can be run against real files without booting the
// API or touching the database.
//
// NOTE ON pdf-parse v2: the API is nothing like v1. Every tutorial online shows
//   const pdf = require('pdf-parse'); pdf(buffer).then(d => d.text)
// which throws on v2 — there is no default export. v2 is a class:
//   new PDFParse({ data: buffer }).getText() -> { pages, text, total }
// Verified against a real generated PDF before this was written.

import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

// pdf-parse v2 appends a "-- 1 of 3 --" marker after every page. Left in, these end
// up in the resume text, get sent to the AI, and can be pulled into a rewrite.
const PAGE_MARKER = /^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm

function tidy(raw) {
  return String(raw || '')
    .replace(PAGE_MARKER, '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')       // non-breaking spaces read as normal ones
    .replace(/[ \t]+\n/g, '\n')    // trailing whitespace on lines
    .replace(/\n{3,}/g, '\n\n')    // runs of blank lines
    .trim()
}

/**
 * Pull text out of a PDF or Word buffer.
 * Returns { text, pages, method }. Throws only on a genuinely unreadable file —
 * an empty result is NOT an error, it is the scanned-PDF case the caller must handle.
 */
export async function extractText(buffer, filename = '') {
  const name = filename.toLowerCase()

  if (name.endsWith('.docx') || name.endsWith('.doc')) {
    const { value } = await mammoth.extractRawText({ buffer })
    return { text: tidy(value), pages: null, method: 'word' }
  }

  // Default to PDF. The browser check already restricted the type, so anything else
  // reaching here is worth attempting rather than rejecting on the extension alone.
  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return { text: tidy(result.text), pages: result.total ?? null, method: 'pdf' }
  } finally {
    // Frees the worker. Skipping this leaks memory across uploads on a long-running
    // server, which on Render's free tier means a restart.
    await parser.destroy().catch(() => {})
  }
}

// ── DOES THIS LOOK LIKE A RESUME? ───────────────────────────────────────────
//
// Four cheap signals, no AI. A bank statement, a transcript or an essay fails most
// of them; a resume passes most.
//
// THESE WARN, THEY DO NOT BLOCK. If the checks are wrong even 2% of the time,
// blocking locks a real student out of the product permanently with no way to argue.
// Letting a wrong file through costs ten seconds — they see the wrong jobs and know
// immediately. Wrong block loses a user; wrong pass annoys one.

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

// Deliberately loose: international students have numbers in many formats, and a
// missed phone number is a warning, not a rejection.
const PHONE = /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/

const SECTIONS = /\b(experience|employment|work history|education|skills|projects|certifications|qualifications|professional summary|objective)\b/i

// "2022 - Present", "Jan 2022 – Dec 2023", "2019-2023"
const DATE_RANGE = /\b(19|20)\d{2}\s*[-–—to]+\s*((19|20)\d{2}|present|current)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}\b/i

export function looksLikeResume(text) {
  const t = String(text || '')
  const checks = {
    email:    EMAIL.test(t),
    phone:    PHONE.test(t),
    sections: SECTIONS.test(t),
    dates:    DATE_RANGE.test(t),
  }
  const passed = Object.values(checks).filter(Boolean).length

  // Two of four is the line. A resume missing a phone number and using unusual
  // section headings still passes on email + dates; a bank statement has dates and
  // little else and fails at one.
  return { isResume: passed >= 2, passed, checks }
}

// Shorter than this and it is a fragment, not a resume — a half-finished copy or a
// mostly-empty file. Low on purpose: the job is catching accidents, not judging
// whether someone's resume is substantial enough.
export const MIN_RESUME_CHARS = 200

/**
 * Single verdict for the upload endpoint.
 * status is one of: ok · empty · short · not_resume
 */
export function assessExtraction(text) {
  const clean = String(text || '').trim()

  if (clean.length === 0) {
    return {
      status: 'empty',
      message: "We couldn't read any text. This looks like a scan or a photo, so there are no words inside the file to pull out.",
    }
  }
  if (clean.length < MIN_RESUME_CHARS) {
    return {
      status: 'short',
      message: `We only read ${clean.length} characters. That is too little for a resume — the file may be mostly images.`,
    }
  }

  const check = looksLikeResume(clean)
  if (!check.isResume) {
    return {
      status: 'not_resume',
      message: "This doesn't look like a resume. We read the text but couldn't find the things a resume normally has.",
      checks: check.checks,
    }
  }

  return { status: 'ok', checks: check.checks }
}
