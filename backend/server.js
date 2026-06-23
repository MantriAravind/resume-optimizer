import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, BorderStyle } from 'docx'

dotenv.config()

const app = express()
const PORT = 3001

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/', (req, res) => {
  res.json({ message: 'Resume Optimizer backend is running.' })
})

// ── OPTIMIZE
app.post('/optimize', async (req, res) => {
  const { resumeText, jobText } = req.body
  if (!resumeText || !jobText) {
    return res.status(400).json({ error: 'Please provide both resume text and job description.' })
  }
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are an expert resume optimizer and ATS specialist.

I will provide you with a resume and a job description. Your job is to:
1. Analyze how well the resume matches the job description
2. Give an ATS score out of 100 based on keyword match, relevance, and formatting
3. Rewrite the resume to better match the job description while keeping it honest and professional

Resume:
${resumeText}

Job Description:
${jobText}

Respond in this exact JSON format with no extra text:
{
  "score": <number between 0-100>,
  "feedback": "<2-3 sentences explaining the score>",
  "optimizedResume": "<the full rewritten resume>"
}`
      }]
    })
    const responseText = message.content[0].text
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    res.json(parsed)
  } catch (error) {
    console.error('AI API error:', error)
    if (error.status === 401) return res.status(401).json({ error: 'Invalid API key.' })
    if (error.status === 402) return res.status(402).json({ error: 'No API credits remaining.' })
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ── PARSE resume text
function parseResume(text) {
  const lines = text.split('\n').map(l => l.trim())
  const SECTIONS = [
    'SUMMARY', 'SKILLS', 'EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'EDUCATION',
    'CERTIFICATIONS', 'PROJECTS', 'KEY PROJECTS', 'ACHIEVEMENTS', 'AWARDS',
    'LANGUAGES', 'INTERESTS', 'OBJECTIVE', 'WORK EXPERIENCE', 'TECHNICAL SKILLS',
    'TECHNICAL PROFICIENCY', 'NOTABLE PROJECTS', 'STRATEGIC PROJECTS'
  ]
  const isSection  = l => SECTIONS.includes(l.toUpperCase())
  const isBullet   = l => l.startsWith('•') || l.startsWith('-')
  const isRoleLine = l => l.includes(' | ') && (l.includes('Present') || /\| (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(l))

  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    if (isSection(lines[i])) { bodyStart = i; break }
  }
  const header = []
  for (let i = 0; i < bodyStart; i++) {
    if (lines[i]) header.push(lines[i])
  }
  return { header, bodyLines: lines.slice(bodyStart), isSection, isBullet, isRoleLine }
}

// ── Template configs
const TEMPLATE_CONFIGS = {
  google:   { hex: '4285F4', center: false },
  amazon:   { hex: 'E07B00', center: false },
  apple:    { hex: '1d1d1f', center: false },
  mckinsey: { hex: '003A70', center: true  },
  netflix:  { hex: 'E50914', center: false },
}

// ── DOWNLOAD WORD
app.post('/download-word', async (req, res) => {
  const { resumeText, template, length } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })

  try {
    const { header, bodyLines, isSection, isBullet, isRoleLine } = parseResume(resumeText)
    const cfg       = TEMPLATE_CONFIGS[template] || TEMPLATE_CONFIGS.google
    const isCompact = length === 'concise'
    const children  = []

    const sp        = isCompact ? { before: 40, after: 30 } : { before: 60, after: 50 }
    const nameSize  = isCompact ? 44 : 52
    const titleSize = isCompact ? 22 : 26
    const bodySize  = isCompact ? 17 : 19
    const align     = cfg.center ? AlignmentType.CENTER : AlignmentType.LEFT

    if (header[0]) {
      children.push(new Paragraph({
        alignment: align, spacing: { after: 40 },
        children: [new TextRun({ text: header[0], bold: true, size: nameSize, color: '111827', font: 'Calibri' })]
      }))
    }

    let contactStart = 1
    if (header[1] && !header[1].includes('|') && !header[1].includes('@')) {
      children.push(new Paragraph({
        alignment: align, spacing: { after: 30 },
        children: [new TextRun({ text: header[1], size: titleSize, color: cfg.hex, font: 'Calibri' })]
      }))
      contactStart = 2
    }

    for (let i = contactStart; i < header.length; i++) {
      children.push(new Paragraph({
        alignment: align, spacing: { after: 20 },
        children: [new TextRun({ text: header[i], size: 18, color: '6B7280', font: 'Calibri' })]
      }))
    }

    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: cfg.hex } },
      spacing: { before: 60, after: 120 }
    }))

    for (const line of bodyLines) {
      if (!line) { children.push(new Paragraph({ spacing: { after: 20 } })); continue }
      if (isSection(line)) {
        children.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: cfg.hex } },
          spacing: { before: sp.before + 60, after: 80 },
          children: [new TextRun({ text: line.toUpperCase(), bold: true, size: 22, color: cfg.hex, font: 'Calibri' })]
        }))
        continue
      }
      if (isBullet(line)) {
        const clean = line.replace(/^[•\-]\s*/, '').trim()
        children.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          spacing: { after: sp.after - 20 },
          children: [new TextRun({ text: clean, size: bodySize, font: 'Calibri', color: '1F2937' })]
        }))
        continue
      }
      if (isRoleLine(line)) {
        children.push(new Paragraph({
          spacing: { before: sp.before, after: 40 },
          children: [new TextRun({ text: line, bold: true, size: bodySize, color: cfg.hex, font: 'Calibri' })]
        }))
        continue
      }
      children.push(new Paragraph({
        spacing: { after: sp.after },
        children: [new TextRun({ text: line, size: bodySize, font: 'Calibri', color: '1F2937' })]
      }))
    }

    const doc = new Document({
      numbering: {
        config: [{
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 180 } } } }]
        }]
      },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        children
      }]
    })

    const buffer = await Packer.toBuffer(doc)
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': 'attachment; filename="optimized-resume.docx"',
      'Content-Length': buffer.length
    })
    res.send(buffer)

  } catch (error) {
    console.error('Word error:', error)
    res.status(500).json({ error: 'Failed to generate Word document. Please try again.' })
  }
})

// ── BUILD HTML for PDF
function buildResumeHTML(resumeText, template, length) {
  const CONFIGS = {
    google:   { accent: '#4285F4', font: 'Arial, sans-serif',           nameSize: '26px', center: false },
    amazon:   { accent: '#E07B00', font: 'Arial, sans-serif',           nameSize: '24px', center: false },
    apple:    { accent: '#1d1d1f', font: 'Helvetica Neue, sans-serif',  nameSize: '24px', center: false },
    mckinsey: { accent: '#003A70', font: 'Georgia, Times New Roman, serif', nameSize: '22px', center: true },
    netflix:  { accent: '#E50914', font: 'Arial, sans-serif',           nameSize: '26px', center: false },
  }
  const cfg       = CONFIGS[template] || CONFIGS.google
  const isCompact = length === 'concise'
  const fs        = isCompact ? '8.5pt' : '9.5pt'
  const lh        = isCompact ? '1.35'  : '1.5'
  const gap       = isCompact ? '5pt'   : '9pt'
  const sgap      = isCompact ? '7pt'   : '12pt'
  const pad       = isCompact ? '0.45in' : '0.55in'
  const align     = cfg.center ? 'center' : 'left'

  const { header, bodyLines, isSection, isBullet, isRoleLine } = parseResume(resumeText)

  let body = ''
  const name = header[0] || ''
  let titleLine = '', contactStart = 1
  if (header[1] && !header[1].includes('|') && !header[1].includes('@')) {
    titleLine = header[1]; contactStart = 2
  }

  // Header block
  body += `<div style="text-align:${align};padding-bottom:10pt;margin-bottom:14pt;border-bottom:2pt solid ${cfg.accent}">`
  body += `<div style="font-size:${isCompact ? '20pt' : '24pt'};font-weight:900;color:#111;letter-spacing:0.02em;text-transform:uppercase">${esc(name)}</div>`
  if (titleLine) body += `<div style="font-size:${isCompact ? '10pt' : '12pt'};font-weight:600;color:${cfg.accent};margin-top:4pt;letter-spacing:0.01em">${esc(titleLine)}</div>`
  for (let i = contactStart; i < header.length; i++) {
    body += `<div style="font-size:8pt;color:#555;margin-top:5pt">${esc(header[i])}</div>`
  }
  body += `</div>`

  // Body
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i]
    if (!line) { body += `<div style="height:${isCompact ? '3pt' : '5pt'}"></div>`; continue }

    if (isSection(line)) {
      body += `
        <div style="margin-top:${sgap};margin-bottom:5pt">
          <div style="font-size:9.5pt;font-weight:800;color:${cfg.accent};letter-spacing:0.08em;text-transform:uppercase;display:flex;align-items:center;gap:8pt">
            <span style="width:3pt;height:14pt;background:${cfg.accent};display:inline-block;border-radius:1pt;flex-shrink:0"></span>
            ${esc(line)}
          </div>
          <div style="height:1pt;background:${cfg.accent};opacity:0.25;margin-top:3pt"></div>
        </div>`
      continue
    }

    if (isBullet(line)) {
      const clean = line.replace(/^[•\-]\s*/, '')
      body += `<div style="display:flex;gap:6pt;font-size:${fs};line-height:${lh};margin-bottom:${isCompact ? '2pt' : '3.5pt'};color:#222"><span style="flex-shrink:0;margin-top:1pt;color:${cfg.accent};font-weight:700">•</span><span>${esc(clean)}</span></div>`
      continue
    }

    if (isRoleLine(line)) {
      // Split role line into title and company|date
      const parts = line.split(' | ')
      if (parts.length >= 2) {
        const role = parts[0]
        const rest = parts.slice(1).join(' | ')
        // Check if next line is also a role detail or if it's all in one line
        body += `
          <div style="margin-top:${gap};margin-bottom:2pt">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:${isCompact ? '9pt' : '10pt'};font-weight:700;color:#111">${esc(role)}</span>
            </div>
            <div style="font-size:${isCompact ? '8pt' : '8.5pt'};color:${cfg.accent};font-style:italic;margin-top:1pt">${esc(rest)}</div>
          </div>`
      } else {
        body += `<div style="font-size:${fs};font-weight:700;color:${cfg.accent};margin-top:${gap};margin-bottom:2pt">${esc(line)}</div>`
      }
      continue
    }

    body += `<div style="font-size:${fs};line-height:${lh};color:#222;margin-bottom:2pt">${esc(line)}</div>`
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter; margin: ${pad}; }
  body { font-family: ${cfg.font}; color: #222; background: #fff; font-size: ${fs}; line-height: ${lh}; }
</style>
</head>
<body>${body}</body>
</html>`
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── DOWNLOAD PDF via PDFShift
app.post('/download-pdf', async (req, res) => {
  const { resumeText, template, length } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })

  try {
    const html = buildResumeHTML(resumeText, template || 'google', length || 'standard')

    const response = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`api:${process.env.PDFSHIFT_API_KEY}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: html,
        format: 'Letter',
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      })
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('PDFShift error:', err)
      return res.status(500).json({ error: 'Failed to generate PDF. Please try again.' })
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer())
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="optimized-resume.pdf"',
      'Content-Length': pdfBuffer.length
    })
    res.send(pdfBuffer)

  } catch (error) {
    console.error('PDF error:', error)
    res.status(500).json({ error: 'Failed to generate PDF. Please try again.' })
  }
})

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})