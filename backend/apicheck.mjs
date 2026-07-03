function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const res = await fetch('https://boards-api.greenhouse.io/v1/boards/mcmastercarr/jobs?content=true')
const data = await res.json()
const job = data.jobs.find(j => String(j.id) === '4109933009')

if (!job) {
  console.log('Job not found in boards list')
} else {
  const full = stripHtml(job.content || '')
  console.log('API content length:', full.length, 'chars')
  console.log()
  console.log('Contains "not eligible for...sponsorship"?', /not eligible for.*sponsorship/i.test(full))
  console.log('Contains "will you now or in the future"?  ', /will you now or in the future/i.test(full))
  console.log('Contains "visa sponsorship"?               ', /visa sponsorship/i.test(full))
  console.log('Contains "work authorization sponsorship"? ', /work authorization sponsorship/i.test(full))
  console.log()
  console.log('FULL API CONTENT (what your filter actually sees):')
  console.log(full)
}