import { classifyJob, buildReport } from './filterCheck.mjs'

// Synthetic Greenhouse-shaped jobs — proves the logic with NO network call.
const jobs = [
  { // 1. clean job → should PASS, no flags
    id: 1, title: 'Frontend Engineer',
    location: { name: 'Austin, TX' },
    absolute_url: 'https://example.com/1',
    content: '<p>Build React apps with a great team. Full-time role with benefits. Ship features to users.</p>',
  },
  { // 2. real requirement "must be a U.S. citizen" → should be DISQUALIFIED + show pattern
    id: 2, title: 'Backend Engineer',
    location: { name: 'Remote, US' },
    absolute_url: 'https://example.com/2',
    content: '<p>Great role. Applicants must be a U.S. citizen or lawful permanent resident to be considered.</p>',
  },
  { // 3. THE LEAK the current filter MISSES: "Public Trust position" + "polygraph" have
    //    no disqualifier pattern. Should PASS the filter but get FLAGGED as suspicious.
    id: 3, title: 'Systems Analyst',
    location: { name: 'McLean, Virginia' },
    absolute_url: 'https://example.com/3',
    content: '<p>Support mission systems. The selected candidate must be eligible to hold a Public Trust position and will be required to pass a polygraph before starting.</p>',
  },
  { // 4. likely FALSE POSITIVE: "without sponsorship from major brands" is about brand
    //    deals, but the filter blocks it. Should be DISQUALIFIED — tool shows the fired
    //    pattern so you can spot the over-block.
    id: 4, title: 'Marketing Manager',
    location: { name: 'New York, NY' },
    absolute_url: 'https://example.com/4',
    content: '<p>Run creative campaigns and grow the brand without sponsorship from major brands or agencies.</p>',
  },
  { // 5. clean US job in "City, VA" form → isUSLocation MISSES it → dropped as non-US,
    //    but should show up in the "looks US / wrongly dropped" section.
    id: 5, title: 'Data Engineer',
    location: { name: 'Reston, VA' },
    absolute_url: 'https://example.com/5',
    content: '<p>Build data pipelines. Full-time role with a strong team and good benefits.</p>',
  },
  { // 6. genuinely foreign → dropped as non-US AND does not look US → goes to the
    //    "other non-US" sanity sample.
    id: 6, title: 'Platform Engineer',
    location: { name: 'London, United Kingdom' },
    absolute_url: 'https://example.com/6',
    content: '<p>Build platform tooling for our EMEA team.</p>',
  },
]

const classified = jobs.map(j => ({ ...classifyJob(j), slug: 'democo' }))

console.log('=== VERDICTS ===')
for (const j of classified) {
  const extra = j.flags?.length ? '   flags: ' + j.flags.map(f => f.label).join(', ')
              : j.hit ? '   fired: ' + j.hit.source : ''
  console.log(j.title.padEnd(20) + ' -> ' + j.verdict + extra)
}

console.log('\n=== GENERATED REPORT ===\n')
console.log(buildReport(classified, { companies: 1 }))
