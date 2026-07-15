function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

async function checkJob(slug, titleMatch, searchWord) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  const data = await res.json()
  const job = data.jobs.find(j => j.title.includes(titleMatch))
  if (!job) { console.log(`Could not find "${titleMatch}" at ${slug}\n`); return }

  const text = stripHtml(job.content || '')
  const idx = text.toLowerCase().search(searchWord)
  console.log(`[${slug}] ${job.title}`)
  if (idx >= 0) {
    console.log(`  Context: ...${text.slice(Math.max(0,idx-90), idx+120)}...\n`)
  } else {
    console.log('  trigger word not found — unexpected\n')
  }
}

console.log('=== 2K CLUSTER — checking 2 different roles ===\n')
await checkJob('2k', 'Multimedia Specialist', /\b(contractor|temporary|fixed[\s-]?term)\b/)
await checkJob('2k', 'Publishing Producer', /\b(contractor|temporary|fixed[\s-]?term)\b/)

console.log('=== [541] Product Owner ===\n')
await checkJob('541', 'Product Owner', /\bpart[\s-]?time\b/)

console.log('=== [10alabs] Protection Scientist Engineer ===\n')
await checkJob('10alabs', 'Protection Scientist Engineer', /\bcontract\b/)

console.log('🔌 Done.')