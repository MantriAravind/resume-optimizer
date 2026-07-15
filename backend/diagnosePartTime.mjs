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
  const idx = text.toLowerCase().search(/\bpart[\s-]?time\b/)
  console.log(`\n[${slug}] ${job.title}`)
  if (idx >= 0) {
    console.log(`  Context: ...${text.slice(Math.max(0,idx-80), idx+100)}...`)
  } else {
    console.log('  "part-time" not found — unexpected')
  }
}

await checkJob('550', 'General Manager')
await checkJob('540', 'Software Engineer (Contract)')

console.log('\n🔌 Done.')