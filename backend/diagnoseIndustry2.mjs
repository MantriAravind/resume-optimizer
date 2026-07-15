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

function detectIndustryDebug(text = '') {
  const t = text.toLowerCase()
  const rules = [
    ['Financial Services', /\b(bank|banking|lending|loans|treasury|liquidity|payments|fintech|financial services|fund administrator|asset management|investment|capital markets)\b/],
    ['Healthcare', /\b(patient|clinical|healthcare|hospital|medical|therapy|pharma|pharmaceutical)\b/],
    ['Consulting', /\b(consulting|consultancy|advisory services|client engagements)\b/],
    ['Defense & Government', /\b(defense|military|national security|department of defense|government contract)\b/],
    ['Education', /\b(education|university|academy|students|curriculum|learning platform)\b/],
    ['Energy & Manufacturing', /\b(battery|energy storage|manufacturing|supply chain|recycling|clean energy)\b/],
    ['Insurance', /\b(insurance|underwriting|claims|policyholder)\b/],
    ['Retail & E-commerce', /\b(retail|e-commerce|ecommerce|marketplace|shopping|merchandise)\b/],
    ['Technology / SaaS', /\b(software|saas|cloud platform|data engineering|artificial intelligence|machine learning|mobile app|text-to-speech)\b/],
  ]
  for (const [label, re] of rules) {
    const match = t.match(re)
    if (match) {
      const idx = match.index
      const context = text.slice(Math.max(0, idx-40), idx+40)
      return { label, keyword: match[0], context }
    }
  }
  return null
}

const companies = ['Britive', 'Pearceservices', 'Coreweave']
for (const co of companies) {
  const job = await coll.findOne({ company: co })
  if (!job) { console.log(`\n[${co}] — no job found`); continue }

  console.log(`\n${'='.repeat(70)}`)
  console.log(`[${job.company}] ${job.title}  (id: ${job.id}, slug: ${job.companySlug})`)
  console.log(`Stored industry: ${job.industry}`)

  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${job.companySlug}/jobs/${job.id}?questions=false`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const data = await res.json()
      const fullText = stripHtml(data.content || '')
      const result = detectIndustryDebug(fullText)
      if (result) {
        console.log(`Actual trigger: "${result.keyword}" → classified as ${result.label}`)
        console.log(`Context: ...${result.context}...`)
      } else {
        console.log('No keyword match found in full text (unexpected)')
      }
      console.log(`Full description length: ${fullText.length} chars`)
    } else {
      console.log('Could not fetch full description from Greenhouse')
    }
  } catch (e) {
    console.log('Fetch error:', e.message)
  }
}

await mongoose.disconnect()
console.log('\n🔌 Done.')