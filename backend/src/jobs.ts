const CACHE_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000
type Ats = 'ashby' | 'greenhouse' | 'lever' | 'workable'
type JsonRecord = Record<string, unknown>
const DEFAULT_COMPANIES: Record<Ats, string[]> = {
  ashby: ['ema', 'ramp', 'linear', 'notion', 'render', 'revenuecat', 'posthog', 'supabase'],
  greenhouse: ['stripe', 'airtable', 'asana', 'brex', 'chime', 'cockroachlabs', 'contentful', 'databricks', 'duolingo'],
  lever: ['galepartners', 'dnb', 'spotify'], workable: ['exponent-energy', 'dodge-construction-network', 'minderacraft', 'huggingface'],
}
export type RecommendedJob = {
  id: string; source: Ats; company: string; title: string; location: string; workplaceType: string; employmentType: string
  countryCode: 'IN' | null; salary: string | null; department: string | null; skills: string[]; publishedAt: string | null; jobUrl: string; applyUrl: string
}
export type JobSourceStatus = { source: Ats; companies: number; jobs: number; failed: number }
let cache: { expiresAt: number; jobs: RecommendedJob[]; sources: JobSourceStatus[] } | null = null

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const asString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
const asBoolean = (value: unknown) => typeof value === 'boolean' ? value : null
const asArray = (value: unknown) => Array.isArray(value) ? value : []
const companyLabel = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const enumLabel = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ')
const skillMatchers: Array<[string, RegExp]> = [
  ['React', /\breact(?:\.js)?\b/i], ['TypeScript', /\btypescript\b/i], ['JavaScript', /\bjavascript\b/i],
  ['Node.js', /\bnode(?:\.js)?\b/i], ['Python', /\bpython\b/i], ['Java', /\bjava\b/i], ['Go', /\bgolang\b|\bgo\b/i],
  ['SQL', /\bsql\b|\bpostgres(?:ql)?\b/i], ['GraphQL', /\bgraphql\b/i], ['AWS', /\baws\b|amazon web services/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i], ['Product', /\bproduct\b/i],
]

function configuredCompanies(source: Ats) {
  const configured = process.env[`${source.toUpperCase()}_COMPANY_SLUGS`]?.split(',').map((slug) => slug.trim()).filter(Boolean)
  return (configured?.length ? configured : DEFAULT_COMPANIES[source]).filter((slug) => /^[A-Za-z0-9_-]{1,100}$/.test(slug)).slice(0, 30)
}
async function getJson(url: string) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'JobCopilot/0.1' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`Job board returned HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}
function isoDate(value: unknown): string | null {
  const date = typeof value === 'number' ? new Date(value) : new Date(asString(value) || '')
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
function inferWorkplace(location: string | null, remote: boolean | null, explicit: unknown) {
  if (typeof explicit === 'boolean') return explicit ? 'Remote' : 'On site'
  const value = asString(explicit)
  if (value && /^(remote|hybrid|onsite)$/i.test(value)) return enumLabel(value)
  if (remote || /\bremote\b/i.test(location || '')) return 'Remote'
  return value ? enumLabel(value) : 'On site'
}
function normalize(input: { source: Ats; company: string; id: unknown; title: unknown; location: unknown; department: unknown; remote: unknown; workplaceType: unknown; employmentType: unknown; publishedAt: unknown; jobUrl: unknown; applyUrl: unknown; salary?: unknown; description?: unknown }): RecommendedJob | null {
  const title = asString(input.title), jobUrl = asString(input.jobUrl), applyUrl = asString(input.applyUrl) || jobUrl
  if (!title || !jobUrl || !applyUrl) return null
  const location = asString(input.location), department = asString(input.department)
  const description = [title, department, asString(input.description)].filter(Boolean).join(' ')
  const skills = skillMatchers.filter(([, pattern]) => pattern.test(description)).slice(0, 3).map(([skill]) => skill)
  if (!skills.length && department) skills.push(department)
  return { id: asString(input.id) || `${input.source}:${jobUrl}`, source: input.source, company: companyLabel(input.company), title,
    location: location || (asBoolean(input.remote) ? 'Remote' : 'Location not specified'), workplaceType: inferWorkplace(location, asBoolean(input.remote), input.workplaceType),
    countryCode: isIndiaLocation(location || '') ? 'IN' : null, employmentType: enumLabel(asString(input.employmentType) || 'FullTime'), salary: asString(input.salary), department, skills,
    publishedAt: isoDate(input.publishedAt), jobUrl, applyUrl }
}

async function fetchAshby(company: string) {
  const payload = asRecord(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}?includeCompensation=true`))
  return asArray(payload.jobs).map(asRecord).filter((job) => job.isListed !== false).map((job) => {
    const compensation = asRecord(job.compensation)
    return normalize({ source: 'ashby', company, id: job.id, title: job.title, location: job.location, department: job.department || job.team, remote: job.isRemote, workplaceType: job.workplaceType, employmentType: job.employmentType, publishedAt: job.publishedAt, jobUrl: job.jobUrl, applyUrl: job.applyUrl, salary: compensation.scrapeableCompensationSalarySummary || compensation.compensationTierSummary, description: job.descriptionPlain })
  }).filter((job): job is RecommendedJob => Boolean(job))
}
async function fetchGreenhouse(company: string) {
  const payload = asRecord(await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company)}/jobs`))
  return asArray(payload.jobs).map(asRecord).map((job) => normalize({ source: 'greenhouse', company, id: job.id, title: job.title, location: asRecord(job.location).name, department: asArray(job.departments).map(asRecord)[0]?.name, remote: null, workplaceType: null, employmentType: null, publishedAt: job.updated_at, jobUrl: job.absolute_url, applyUrl: `https://job-boards.greenhouse.io/${encodeURIComponent(company)}/jobs/${encodeURIComponent(String(job.id))}` })).filter((job): job is RecommendedJob => Boolean(job))
}
async function fetchLever(company: string) {
  const payload = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`)
  return asArray(payload).map(asRecord).map((job) => { const categories = asRecord(job.categories); return normalize({ source: 'lever', company, id: job.id, title: job.text, location: categories.location, department: categories.team, remote: null, workplaceType: categories.workplaceType, employmentType: categories.commitment, publishedAt: job.createdAt, jobUrl: job.hostedUrl, applyUrl: job.applyUrl, description: `${asString(job.descriptionPlain) || ''} ${asString(job.additionalPlain) || ''}` }) }).filter((job): job is RecommendedJob => Boolean(job))
}
export function workableLocation(job: JsonRecord) {
  if (asString(job.location)) return asString(job.location)!
  const location = asRecord(job.location)
  return [location.city || job.city, location.region || job.state, location.country || job.country]
    .map(asString).filter(Boolean).join(', ')
}

export function isIndiaLocation(location: string) {
  // Use the posting's location, never company headquarters or description keywords.
  return /\b(?:india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|gurugram|gurgaon|noida|new delhi|delhi|kolkata|kochi|cochin|ahmedabad|jaipur|indore|chandigarh|thiruvananthapuram|trivandrum|coimbatore|navi mumbai|nagpur|vadodara)\b/i.test(location)
    && !/\bindiana(?:polis)?\b/i.test(location)
}

export function filterRecommendedJobs(jobs: RecommendedJob[], query: { country: 'india' | 'all'; board: string; remote: string; q: string }) {
  const search = query.q.toLowerCase()
  return jobs.filter(job => {
    if (query.country === 'india' && !isIndiaLocation(job.location)) return false
    if (query.board !== 'all' && job.source !== query.board) return false
    if (query.remote === 'true' && job.workplaceType.toLowerCase() !== 'remote') return false
    return !search || [job.title, job.company, job.location, job.department, job.source, job.workplaceType, job.employmentType, ...job.skills].filter(Boolean).join(' ').toLowerCase().includes(search)
  })
}

async function fetchWorkable(company: string) {
  const payload = asRecord(await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(company)}`))
  return asArray(payload.jobs).map(asRecord).map((job) => normalize({ source: 'workable', company, id: job.shortcode || job.id, title: job.title, location: workableLocation(job), department: job.department, remote: job.telecommuting, workplaceType: job.telecommuting, employmentType: job.employment_type, publishedAt: job.published_on, jobUrl: job.shortcode ? `https://apply.workable.com/${encodeURIComponent(company)}/j/${encodeURIComponent(String(job.shortcode))}/` : job.url, applyUrl: job.shortcode ? `https://apply.workable.com/${encodeURIComponent(company)}/j/${encodeURIComponent(String(job.shortcode))}/apply/` : job.url })).filter((job): job is RecommendedJob => Boolean(job))
}
const fetchers: Record<Ats, (company: string) => Promise<RecommendedJob[]>> = { ashby: fetchAshby, greenhouse: fetchGreenhouse, lever: fetchLever, workable: fetchWorkable }

async function refreshRecommendedJobs() {
  if (cache && cache.expiresAt > Date.now()) return { jobs: cache.jobs, sources: cache.sources }
  const entries = Object.entries(fetchers) as Array<[Ats, (company: string) => Promise<RecommendedJob[]>]>
  const grouped = await Promise.all(entries.map(async ([source, fetcher]) => {
    const companies = configuredCompanies(source), results = await Promise.allSettled(companies.map(fetcher))
    const jobs = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    return { jobs, status: { source, companies: companies.length, jobs: jobs.length, failed: results.filter((result) => result.status === 'rejected').length } }
  }))
  const unique = new Map<string, RecommendedJob>()
  grouped.flatMap((group) => group.jobs)
    .forEach((job) => unique.set(`${job.company.toLowerCase()}:${job.title.toLowerCase()}:${job.location.toLowerCase()}`, job))
  const jobs = [...unique.values()].sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0))
  const sources = grouped.map((group) => group.status)
  if (!jobs.length) throw new Error('No configured public job board could be reached.')
  cache = { jobs, sources, expiresAt: Date.now() + CACHE_TTL_MS }
  return { jobs, sources }
}

let pendingRefresh: ReturnType<typeof refreshRecommendedJobs> | null = null

export async function getRecommendedJobs() {
  if (cache && cache.expiresAt > Date.now()) return { jobs: cache.jobs, sources: cache.sources }
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = refreshRecommendedJobs()
  try { return await pendingRefresh } finally { pendingRefresh = null }
}
