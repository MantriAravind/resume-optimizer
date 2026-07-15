import fs from 'fs'

function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function checkJob(slug, titleMatch) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const data = await res.json()
  const job = data.jobs.find(j => j.title.includes(titleMatch))
  if (!job) { console.log(`Could not find "${titleMatch}" at ${slug}`); return }

  const text = stripHtml(job.content || '')
  const idx = text.toLowerCase().search(/\bcontractor\b/)
  console.log(`\n[${slug}] ${job.title}`)
  if (idx === -1) {
    console.log('  "contractor" not found as standalone word (check "temp"/"temporary"/"fixed-term" instead)')
    const idx2 = text.toLowerCase().search(/\b(temporary|temp position|fixed[\s-]?term)\b/)
    if (idx2 >= 0) console.log(`  Found other trigger: ...${text.slice(Math.max(0,idx2-60), idx2+80)}...`)
  } else {
    console.log(`  Context: ...${text.slice(Math.max(0,idx-70), idx+90)}...`)
  }
}

await checkJob('2k', 'Lead Lighting Artist')
await checkJob('3mgroofing', 'Junior Roofing Sales Consultant')
await checkJob('4dmoleculartherapeutics', 'Administrative Assistant')

console.log('\n🔌 Done.')