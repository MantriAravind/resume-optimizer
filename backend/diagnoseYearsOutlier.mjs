import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

await mongoose.connect(process.env.MONGODB_URI)
const coll = mongoose.connection.db.collection('jobs')

function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function extractYearsDebug(text) {
  const patterns = [
    { re: /(\d{1,2})\s*-\s*(\d{1,2})\s*\+?\s*years?\b/i, type: 'range' },
    { re: /(\d{1,2})\+\s*years?\b/i, type: 'plus' },
    { re: /(?:minimum|at least)\s*(?:of\s*)?(\d{1,2})\s*years?\b/i, type: 'plus' },
  ]
  for (const { re, type } of patterns) {
    const match = text.match(re)
    if (match) {
      const idx = match.index
      const context = text.slice(Math.max(0, idx-60), idx+match[0].length+60)
      return { match: match[0], context }
    }
  }
  return null
}

const job = await coll.findOne({ company: 'Crestwoodcareers' })
console.log(`[${job.company}] ${job.title} (slug: ${job.companySlug}, id: ${job.id})\n`)

const url = `https://boards-api.greenhouse.io/v1/boards/${job.companySlug}/jobs/${job.id}?questions=false`
const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
if (res.ok) {
  const data = await res.json()
  const fullText = stripHtml(data.content || '')
  const result = extractYearsDebug(fullText)
  if (result) {
    console.log(`Matched text: "${result.match}"`)
    console.log(`Context: ...${result.context}...`)
  }
  console.log(`\nFull description length: ${fullText.length} chars`)
} else {
  console.log('Could not fetch from Greenhouse')
}

await mongoose.disconnect()
console.log('\n🔌 Done.')