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

// ── OPTIMIZE (unchanged)
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

// ── PARSE resume text into header + body lines
function parseResume(text) {
  const lines = text.split('\n').map(l => l.trim())
  const SECTIONS = [
    'SUMMARY', 'SKILLS', 'EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'EDUCATION',
    'CERTIFICATIONS', 'PROJECTS', 'KEY PROJECTS', 'ACHIEVEMENTS', 'AWARDS',
    'LANGUAGES', 'INTERESTS', 'OBJECTIVE', 'WORK EXPERIENCE', 'TECHNICAL SKILLS'
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

// ── Template accent colours
const TEMPLATE_ACCENTS = {
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
    const cfg       = TEMPLATE_ACCENTS[template] || TEMPLATE_ACCENTS.google
    const isCompact = length === 'concise'
    const children  = []

    const sp = isCompact
      ? { before: 40,  after: 30,  line: 240 }
      : { before: 60,  after: 50,  line: 276 }

    const nameSize    = isCompact ? 44 : 52
    const titleSize   = isCompact ? 22 : 26
    const contactSize = isCompact ? 16 : 18
    const bodySize    = isCompact ? 17 : 19
    const align       = cfg.center ? AlignmentType.CENTER : AlignmentType.LEFT

    // Name
    if (header[0]) {
      children.push(new Paragraph({
        alignment: align,
        spacing: { after: 40 },
        children: [new TextRun({ text: header[0], bold: true, size: nameSize, color: '111827', font: 'Calibri' })]
      }))
    }

    // Title
    let contactStart = 1
    if (header[1] && !header[1].includes('|') && !header[1].includes('@')) {
      children.push(new Paragraph({
        alignment: align,
        spacing: { after: 30 },
        children: [new TextRun({ text: header[1], size: titleSize, color: cfg.hex, font: 'Calibri' })]
      }))
      contactStart = 2
    }

    // Contact lines
    for (let i = contactStart; i < header.length; i++) {
      children.push(new Paragraph({
        alignment: align,
        spacing: { after: 20 },
        children: [new TextRun({ text: header[i], size: contactSize, color: '6B7280', font: 'Calibri' })]
      }))
    }

    // Divider after header
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: cfg.hex } },
      spacing: { before: 60, after: 120 }
    }))

    // Body
    for (const line of bodyLines) {
      if (!line) {
        children.push(new Paragraph({ spacing: { after: 20 } }))
        continue
      }
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
          levels: [{
            level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 180 } } }
          }]
        }]
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
          }
        },
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
    google:   { accent: '#4285F4', font: 'Arial, sans-serif',          nameSize: '26px', center: false },
    amazon:   { accent: '#E07B00', font: 'Arial, sans-serif',          nameSize: '24px', center: false },
    apple:    { accent: '#1d1d1f', font: 'Helvetica Neue, sans-serif', nameSize: '24px', center: false },
    mckinsey: { accent: '#003A70', font: 'Georgia, serif',             nameSize: '22px', center: true  },
    netflix:  { accent: '#E50914', font: 'Arial, sans-serif',          nameSize: '26px', center: false },
  }
  const cfg       = CONFIGS[template] || CONFIGS.google
  const isCompact = length === 'concise'
  const fs        = isCompact ? '8.5pt' : '9.5pt'
  const lh        = isCompact ? '1.35'  : '1.5'
  const gap       = isCompact ? '6pt'   : '10pt'
  const sgap      = isCompact ? '8pt'   : '14pt'
  const pad       = isCompact ? '0.5in' : '0.6in'
  const nameFs    = isCompact ? '20pt'  : cfg.nameSize
  const align     = cfg.center ? 'center' : 'left'

  const { header, bodyLines, isSection, isBullet, isRoleLine } = parseResume(resumeText)

  let body = ''

  // Header
  const name = header[0] || ''
  let titleLine = '', contactStart = 1
  if (header[1] && !header[1].includes('|') && !header[1].includes('@')) {
    titleLine = header[1]; contactStart = 2
  }

  body += `<div style="text-align:${align};margin-bottom:12pt;padding-bottom:10pt;border-bottom:1.5pt solid ${cfg.accent}">`
  body += `<div style="font-size:${nameFs};font-weight:800;color:#111;letter-spacing:-0.01em">${esc(name)}</div>`
  if (titleLine) body += `<div style="font-size:${isCompact ? '10pt' : '11pt'};font-weight:600;color:${cfg.accent};margin-top:3pt">${esc(titleLine)}</div>`
  for (let i = contactStart; i < header.length; i++) {
    body += `<div style="font-size:${isCompact ? '7.5pt' : '8.5pt'};color:#666;margin-top:4pt">${esc(header[i])}</div>`
  }
  body += `</div>`

  // Body
  for (const line of bodyLines) {
    if (!line) { body += `<div style="height:${isCompact ? '3pt' : '5pt'}"></div>`; continue }
    if (isSection(line)) {
      body += `<div style="font-size:${isCompact ? '9pt' : '10pt'};font-weight:800;color:${cfg.accent};letter-spacing:0.06em;text-transform:uppercase;margin-top:${sgap};margin-bottom:5pt;padding-bottom:2pt;border-bottom:1.5pt solid ${cfg.accent}">${esc(line)}</div>`
      continue
    }
    if (isBullet(line)) {
      const clean = line.replace(/^[•\-]\s*/, '')
      body += `<div style="display:flex;gap:5pt;font-size:${fs};line-height:${lh};margin-bottom:${isCompact ? '2pt' : '3pt'};color:#1F2937"><span style="flex-shrink:0;color:${cfg.accent}">•</span><span>${esc(clean)}</span></div>`
      continue
    }
    if (isRoleLine(line)) {
      body += `<div style="font-size:${fs};font-weight:700;color:${cfg.accent};margin-top:${gap};margin-bottom:3pt">${esc(line)}</div>`
      continue
    }
    body += `<div style="font-size:${fs};line-height:${lh};color:#1F2937;margin-bottom:2pt">${esc(line)}</div>`
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: letter; margin: ${pad}; }
  body { font-family: ${cfg.font}; color: #1F2937; background: #fff; font-size: ${fs}; line-height: ${lh}; }
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

// ── DOWNLOAD PDF
app.post('/download-pdf', async (req, res) => {
  const { resumeText, template, length } = req.body
  if (!resumeText) return res.status(400).json({ error: 'No resume text provided.' })

  try {
    const puppeteer = await import('puppeteer')
    const browser   = await puppeteer.default.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: 'new'
    })
    const page = await browser.newPage()
    const html = buildResumeHTML(resumeText, template || 'google', length || 'standard')
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({ format: 'Letter', printBackground: true })
    await browser.close()

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="optimized-resume.pdf"',
      'Content-Length': pdf.length
    })
    res.send(pdf)
  } catch (error) {
    console.error('PDF error:', error)
    res.status(500).json({ error: 'Failed to generate PDF. Please try again.' })
  }
})

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})