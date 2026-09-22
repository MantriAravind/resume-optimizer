// renderTemplate.mjs v2 — authoritative spec: Fixed_Industry_Standard_ATS_Resume_Template.docx
// + recruiter implementation email (2026-09-18).
// Structured resume details in → template docx out; PDF generated FROM the docx.
// No branding on output. Never invents content — renders exactly what it's given.
//
// Spec: Letter portrait, margins T/B 0.6" (864) L/R 0.7" (1008), Arial only.
// Name 18pt bold centered · headings 12pt bold + navy rule (17365D) · body 10.5pt ·
// secondary 10pt italic for entry details · round bullets, hanging indent · no tables/
// images/headers. Dynamic length: natural page breaks, headings keep with content,
// no font shrinking. Conditional sections; adaptive order (education first for students).

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
} from 'docx'

const FONT = 'Arial'
const SZ = { name: 36, heading: 24, body: 21, detail: 20 } // half-points: 18/12/10.5/10pt
const RULE = '17365D'

const styles = {
  default: { document: { run: { font: FONT, size: SZ.body } } },
  paragraphStyles: [
    { id: 'CandidateName', name: 'Candidate Name', basedOn: 'Normal',
      run: { font: FONT, size: SZ.name, bold: true },
      paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 20 } } },
    { id: 'ContactInfo', name: 'Contact Information', basedOn: 'Normal',
      run: { font: FONT, size: SZ.detail },
      paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 100 } } },
    { id: 'SectionHeading', name: 'Section Heading', basedOn: 'Normal',
      run: { font: FONT, size: SZ.heading, bold: true },
      paragraph: {
        spacing: { before: 140, after: 60 },
        keepNext: true, // never orphan a heading at a page bottom
        border: { bottom: { style: BorderStyle.SINGLE, size: 8, space: 2, color: RULE } },
      } },
    { id: 'EntryHeading', name: 'Entry Heading', basedOn: 'Normal',
      run: { font: FONT, size: SZ.body, bold: true },
      paragraph: { spacing: { before: 40, after: 0 }, keepNext: true } },
    { id: 'EntryDetails', name: 'Entry Details', basedOn: 'Normal',
      run: { font: FONT, size: SZ.detail, italics: true },
      paragraph: { spacing: { after: 20 }, keepNext: true } }, // keep with first bullet
    { id: 'BodyText', name: 'Body Text 1', basedOn: 'Normal',
      run: { font: FONT, size: SZ.body },
      paragraph: { spacing: { after: 20 } } },
    { id: 'ResumeBullet', name: 'Resume Bullet', basedOn: 'Normal',
      run: { font: FONT, size: SZ.body },
      paragraph: { spacing: { after: 30 }, indent: { left: 288, hanging: 216 }, keepLines: true } },
  ],
}

const bar = (parts) => parts.filter(Boolean).join(' | ')
const P = (style, children) => new Paragraph({ style, children })
const T = (text, opts = {}) => new TextRun({ text, ...opts })
const bullet = (text) => P('ResumeBullet', [T('• '), T(text)])

const sectionHeading = (text) => P('SectionHeading', [T(text)])

function experienceSection (jobs, out) {
  out.push(sectionHeading('PROFESSIONAL EXPERIENCE'))
  for (const j of jobs) {
    out.push(P('EntryHeading', [T(bar([j.title, j.company]))]))
    out.push(P('EntryDetails', [T(bar([j.city, j.dates]))]))
    for (const b of j.bullets || []) out.push(bullet(b))
  }
}

function educationSection (edu, out) {
  out.push(sectionHeading('EDUCATION'))
  for (const e of edu) {
    out.push(P('EntryHeading', [T(bar([e.degree, e.school]))]))
    const detailParts = [e.city, e.dates]
    if (e.gpa && e.showGpa) detailParts.push(`GPA: ${e.gpa}`)
    out.push(P('EntryDetails', [T(bar(detailParts))]))
    for (const b of e.bullets || []) out.push(bullet(b))
  }
}

// resume schema (v2):
// { name, contact:[..], summary, summaryBullets:[..], skills:[{label, items:[..]}], skillsHeading?,
//   experience:[{title, company, city, dates, bullets:[..]}],
//   projects:[{name, tech:[..], dates, github?, bullets:[..]}],
//   education:[{degree, school, city, dates, gpa?, showGpa?, bullets?}],
//   certifications:[{name, org, date}],
//   extraSections:[{heading, entries:[{title, details, bullets:[..]}] }],
//   educationFirst?: bool  // students/fresh grads: Education above Experience }
export function buildResumeDoc (r) {
  const out = []

  out.push(P('CandidateName', [T(r.name || '')]))
  if (r.contact?.length) out.push(P('ContactInfo', [T(bar(r.contact))]))

  if (r.summary || r.summaryBullets?.length) {
    out.push(sectionHeading('PROFESSIONAL SUMMARY'))
    if (r.summary) out.push(P('BodyText', [T(r.summary)]))
    for (const b of r.summaryBullets || []) out.push(bullet(b))
  }

  if (r.skills?.length) {
    out.push(sectionHeading(r.skillsHeading || 'TECHNICAL SKILLS'))
    for (const s of r.skills) {
      out.push(P('BodyText', [T(`${s.label}: `, { bold: true }), T((s.items || []).join(', '))]))
    }
  }

  // Template order: Experience -> Projects -> Education (Projects stays glued
  // behind Experience in both orders; students only lift Education to the top).
  const hasExp = r.experience?.length
  const hasEdu = r.education?.length
  if (r.educationFirst && hasEdu) educationSection(r.education, out)
  if (hasExp) experienceSection(r.experience, out)

  if (r.projects?.length) {
    out.push(sectionHeading('PROJECTS'))
    for (const p of r.projects) {
      out.push(P('EntryHeading', [T(bar([p.name, (p.tech || []).join(', ')]))]))
      if (p.dates) out.push(P('EntryDetails', [T(p.dates)]))
      for (const b of p.bullets || []) out.push(bullet(b))
      if (p.github) out.push(bullet(`GitHub: ${p.github}`))
    }
  }

  if (!r.educationFirst && hasEdu) educationSection(r.education, out)

  if (r.certifications?.length) {
    out.push(sectionHeading('CERTIFICATIONS'))
    for (const c of r.certifications) out.push(P('BodyText', [T(bar([c.name, c.org, c.date]))]))
  }

  for (const x of r.extraSections || []) {
    if (!x.entries?.length) continue
    out.push(sectionHeading(x.heading.toUpperCase()))
    for (const e of x.entries) {
      if (e.title) out.push(P('EntryHeading', [T(e.title)]))
      if (e.details) out.push(P('EntryDetails', [T(e.details)]))
      for (const b of e.bullets || []) out.push(bullet(b))
    }
  }

  return new Document({
    styles,
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 864, bottom: 864, left: 1008, right: 1008 },
        },
      },
      children: out,
    }],
  })
}

export async function renderResumeDocx (resume) {
  return Packer.toBuffer(buildResumeDoc(resume))
}
