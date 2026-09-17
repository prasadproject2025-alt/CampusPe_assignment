import test from 'node:test'
import assert from 'node:assert/strict'
import { filterRecommendedJobs, getRecommendedJobs, isIndiaLocation, workableLocation, type RecommendedJob } from './jobs.js'

function job(location: string, source: RecommendedJob['source'] = 'workable'): RecommendedJob {
  return { id: location, source, company: 'Fixture', title: 'Software Engineer', location, countryCode: isIndiaLocation(location) ? 'IN' : null, workplaceType: /remote/i.test(location) ? 'Remote' : 'On site', employmentType: 'Full time', salary: null, department: null, skills: [], publishedAt: null, jobUrl: 'https://example.test/job', applyUrl: 'https://example.test/apply' }
}

test('India filter uses actual job locations and does not infer eligibility from generic remote', () => {
  const jobs = ['Bengaluru', 'Mumbai - India', 'Remote - India', 'Remote', 'Indianapolis, Indiana', 'London'].map(location => job(location))
  const selected = filterRecommendedJobs(jobs, { country: 'india', board: 'all', remote: 'false', q: '' })
  assert.deepEqual(selected.map(j => j.location), ['Bengaluru', 'Mumbai - India', 'Remote - India'])
  assert.equal(filterRecommendedJobs(jobs, { country: 'all', board: 'all', remote: 'false', q: '' }).length, 6)
  assert.deepEqual(filterRecommendedJobs(jobs, { country: 'india', board: 'workable', remote: 'true', q: 'engineer' }).map(j => j.location), ['Remote - India'])
})

test('Workable location is built from widget city and country fields', () => {
  assert.equal(workableLocation({ city: 'Bengaluru', country: 'India' }), 'Bengaluru, India')
  assert.equal(workableLocation({ location: { city: 'Kochi', region: 'Kerala', country: 'India' } }), 'Kochi, Kerala, India')
  assert.equal(workableLocation({ location: 'Pune, India' }), 'Pune, India')
})

test('parallel discovery requests share one refresh and one failed source leaves other jobs available', async () => {
  const previousFetch = globalThis.fetch
  const sources = ['ASHBY', 'GREENHOUSE', 'LEVER', 'WORKABLE']
  const previousEnv = sources.map(source => process.env[`${source}_COMPANY_SLUGS`])
  let calls = 0
  for (const source of sources) process.env[`${source}_COMPANY_SLUGS`] = 'fixture'
  globalThis.fetch = async input => {
    calls++
    const url = String(input)
    if (url.includes('lever.co')) throw new Error('Upstream unavailable')
    if (url.includes('workable.com')) return new Response(JSON.stringify({ jobs: [{ shortcode: 'WORKABLE123', title: 'Developer', city: 'Pune', country: 'India', url: 'https://apply.workable.com/j/WORKABLE123' }] }))
    if (url.includes('ashbyhq.com')) return new Response(JSON.stringify({ jobs: [{ id: 'ashby-1', title: 'Engineer', location: 'Bengaluru', jobUrl: 'https://jobs.ashbyhq.com/fixture/1' }] }))
    return new Response(JSON.stringify({ jobs: [{ id: 1, title: 'Developer', location: { name: 'Hyderabad' }, absolute_url: 'https://careers.example.com/search?gh_jid=1' }] }))
  }
  try {
    const [first, second] = await Promise.all([getRecommendedJobs(), getRecommendedJobs()])
    assert.equal(calls, 4)
    assert.equal(first.jobs, second.jobs)
    assert.equal(first.jobs.length, 3)
    assert.equal(first.sources.find(s => s.source === 'lever')?.failed, 1)
    const greenhouse = first.jobs.find(j => j.source === 'greenhouse')!
    assert.equal(greenhouse.jobUrl, 'https://careers.example.com/search?gh_jid=1')
    assert.equal(greenhouse.applyUrl, 'https://job-boards.greenhouse.io/fixture/jobs/1')
    const workable = first.jobs.find(j => j.source === 'workable')!
    assert.equal(workable.location, 'Pune, India')
    assert.equal(workable.countryCode, 'IN')
    assert.equal(workable.applyUrl, 'https://apply.workable.com/fixture/j/WORKABLE123/apply/')
  } finally {
    globalThis.fetch = previousFetch
    sources.forEach((source, i) => {
      const key = `${source}_COMPANY_SLUGS`
      if (previousEnv[i] === undefined) delete process.env[key]
      else process.env[key] = previousEnv[i]
    })
  }
})
