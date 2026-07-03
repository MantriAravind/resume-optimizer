import mongoose from 'mongoose'
import dotenv from 'dotenv'
dotenv.config()

function stripHtml(html = '') {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// Fetch ONE company
const res = await fetch('https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true')
const data = await res.json()
const job = data.jobs[0]

console.log('STEP 1 — raw job.content (first 150 chars):')
console.log(JSON.stringify(job.content?.slice(0, 150)))
console.log()

const plainText = stripHtml(job.content || '')

console.log('STEP 2 — after stripHtml (first 150 chars):')
console.log(JSON.stringify(plainText.slice(0, 150)))
console.log()

console.log('STEP 3 — does it still contain "<div"?', plainText.includes('<div'))

await mongoose.disconnect().catch(() => {})