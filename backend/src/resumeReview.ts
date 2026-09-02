import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import * as mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { chromium } from 'playwright-core'
import { canonicalJobUrl, detectAdapter } from './automation/registry.js'

export type ResumeReview = {
  score: number
  summary: string
  strengths: string[]
  tips: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string }>
  matchedKeywords?: string[]
  missingKeywords?: string[]
}

export type ResumeTargetJob = { url: string; board: string; title: string; company: string; location: string; description: string }
export type ResumeOptimization = {
  originalScore: number
  optimizedScore: number
  headline: string
  changes: Array<{ section: string; before: string; after: string; reason: string }>
  tailoredResumeText: string
  safetyNote: string
}

const plainText = (value: string) => value.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim()

export async function extractTargetJob(jobUrl: string): Promise<ResumeTargetJob> {
  const canonicalUrl = canonicalJobUrl(jobUrl)
  const adapter = detectAdapter(canonicalUrl)
  if (!adapter) throw new Error('Use a supported Ashby, Greenhouse, Lever, Workable, Rippling, Breezy, BambooHR, or Recruitee job link.')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(1_000)
    const details = await adapter.extractJob(page, canonicalUrl)
    const visibleText = await page.locator('body').innerText().catch(() => '')
    const description = plainText(details.jobDescription || visibleText).slice(0, 30_000)
    if (!details.jobTitle || description.length < 100) throw new Error('The job requirements could not be read from this link. Try the public job-posting URL instead of an application-step URL.')
    return { url: canonicalUrl, board: adapter.id, title: details.jobTitle, company: details.company || new URL(canonicalUrl).hostname, location: details.location || '', description }
  } finally { await browser.close() }
}

export async function extractResumeText(path: string) {
  const extension = extname(path).toLowerCase()
  const buffer = await readFile(path)
  if (extension === '.pdf') {
    const parser = new PDFParse({ data: buffer })
    try { return (await parser.getText()).text.trim() }
    finally { await parser.destroy() }
  }
  if (extension === '.docx') return (await mammoth.extractRawText({ buffer })).value.trim()
  throw new Error('AI review currently supports PDF and DOCX resumes. Upload either format to continue.')
}

function fallbackReview(text: string): ResumeReview {
  const words = text.split(/\s+/).filter(Boolean).length
  const hasMetrics = /\b\d+(?:\.\d+)?%|\b\d+[kKmMbB]?\+?\b/.test(text)
  const hasSections = ['experience', 'education', 'skills'].filter((section) => new RegExp(`\\b${section}\\b`, 'i').test(text)).length
  const score = Math.max(35, Math.min(82, 45 + hasSections * 8 + (hasMetrics ? 8 : 0) + (words >= 250 && words <= 850 ? 5 : 0)))
  return {
    score,
    summary: 'Your resume has usable foundations. Focus on clearer impact, role-specific keywords, and concise evidence of results.',
    strengths: [hasSections >= 2 ? 'Core resume sections are clearly represented.' : 'The resume provides enough content to build a stronger structure.', hasMetrics ? 'Some achievements already use measurable evidence.' : 'Your experience gives a base for stronger achievement statements.'],
    tips: [
      { priority: 'high', title: 'Turn responsibilities into outcomes', detail: 'Start bullets with strong action verbs and show what changed because of your work. Add truthful numbers wherever available.' },
      { priority: 'high', title: 'Tailor keywords for each role', detail: 'Mirror relevant skills and terminology from the job description naturally in your summary, skills, and experience.' },
      { priority: 'medium', title: 'Keep the strongest information easy to scan', detail: 'Use short bullets, consistent dates, clear section headings, and put the most relevant accomplishments first.' },
    ],
  }
}

export async function reviewResume(text: string, job?: ResumeTargetJob): Promise<ResumeReview> {
  if (text.trim().length < 120) throw new Error('Very little text could be read from this resume. Upload a text-based PDF or DOCX file.')
  const endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
  const model = process.env.OLLAMA_MODEL || 'gemma3:4b'
  const prompt = `You are an expert resume reviewer. ${job ? 'Compare the resume directly with the supplied job requirements.' : 'Review the resume generally.'} Review truthfully and practically. Do not invent candidate facts. Return JSON only with this exact shape:
{"score":78,"summary":"Two concise sentences.","strengths":["Specific strength","Specific strength"],"tips":[{"priority":"high","title":"Short title","detail":"Concrete improvement"}],"matchedKeywords":["keyword"],"missingKeywords":["keyword"]}
Score must be an integer from 0 to 100${job ? ' representing fit for this exact role' : ''}. Provide 2-4 strengths and 4-7 tips. Priority must be high, medium, or low. Focus on clarity, quantified impact, ATS readability, structure, concision, credible achievement language${job ? ', matched requirements, gaps, and relevant keywords. Missing keywords must only include requirements present in the job description and absent from the resume. Never advise claiming experience the candidate does not have' : ''}.

${job ? `TARGET JOB:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\nRequirements and description: ${job.description.slice(0, 20_000)}\n\n` : ''}

RESUME:
${text.slice(0, 24_000)}`
  try {
    const reviewSchema = {
      type: 'object',
      required: ['score', 'summary', 'strengths', 'tips', 'matchedKeywords', 'missingKeywords'],
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        summary: { type: 'string' },
        strengths: { type: 'array', items: { type: 'string' } },
        tips: {
          type: 'array',
          items: {
            type: 'object',
            required: ['priority', 'title', 'detail'],
            properties: {
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              title: { type: 'string' },
              detail: { type: 'string' },
            },
          },
        },
        matchedKeywords: { type: 'array', items: { type: 'string' } },
        missingKeywords: { type: 'array', items: { type: 'string' } },
      },
    }
    const response = await fetch(`${endpoint}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: reviewSchema, messages: [{ role: 'user', content: prompt }], options: { temperature: 0 } }), signal: AbortSignal.timeout(90_000) })
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`)
    const payload = await response.json() as { message?: { content?: string } }
    const parsed = JSON.parse(payload.message?.content || '{}') as Partial<ResumeReview>
    const priorities = new Set(['high', 'medium', 'low'])
    if (!Number.isFinite(parsed.score) || !parsed.summary || !Array.isArray(parsed.strengths) || !Array.isArray(parsed.tips)) throw new Error('Invalid review response')
    const baselineTips = fallbackReview(text).tips
    const modelTips = parsed.tips.slice(0, 8).map((tip) => ({ priority: priorities.has(tip.priority) ? tip.priority : 'medium' as const, title: String(tip.title).slice(0, 150), detail: String(tip.detail).slice(0, 700) }))
    const tips = [...modelTips]
    for (const tip of baselineTips) if (tips.length < 4 && !tips.some((item) => item.title.toLowerCase() === tip.title.toLowerCase())) tips.push(tip)
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score)))),
      summary: String(parsed.summary).slice(0, 1_000),
      strengths: parsed.strengths.slice(0, 6).map((item) => String(item).slice(0, 500)),
      tips,
      matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords.slice(0, 15).map((item) => String(item).slice(0, 100)) : [],
      missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords.slice(0, 15).map((item) => String(item).slice(0, 100)) : [],
    }
  } catch (error) {
    console.warn('Local AI resume review fell back to deterministic analysis:', error instanceof Error ? error.message : error)
    return fallbackReview(text)
  }
}

export async function optimizeResume(text: string, job: ResumeTargetJob, currentScore: number): Promise<ResumeOptimization> {
  if (text.trim().length < 120) throw new Error('Very little text could be read from this resume.')
  const endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
  const model = process.env.OLLAMA_MODEL || 'gemma3:4b'
  const schema = {
    type: 'object', required: ['originalScore', 'optimizedScore', 'headline', 'changes', 'tailoredResumeText', 'safetyNote'],
    properties: {
      originalScore: { type: 'integer', minimum: 0, maximum: 100 }, optimizedScore: { type: 'integer', minimum: 0, maximum: 100 },
      headline: { type: 'string' }, safetyNote: { type: 'string' }, tailoredResumeText: { type: 'string' },
      changes: { type: 'array', items: { type: 'object', required: ['section', 'before', 'after', 'reason'], properties: { section: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, reason: { type: 'string' } } } },
    },
  }
  const prompt = `Tailor this resume for the target job. Return JSON matching the supplied schema. Preserve every factual claim: do not invent employers, dates, degrees, skills, tools, responsibilities, achievements, metrics, certifications, or experience. You may reorder existing material, improve wording, shorten content, and naturally emphasize job keywords only when the resume already supports them. If a job requirement is absent, do not add it. Provide 3-8 meaningful changes and a complete plain-text tailored resume. originalScore must be ${currentScore}; optimizedScore is a conservative projected ATS/readability score.

TARGET JOB\n${job.title} at ${job.company}\n${job.description.slice(0, 20_000)}

ORIGINAL RESUME\n${text.slice(0, 24_000)}`
  const response = await fetch(`${endpoint}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: schema, messages: [{ role: 'user', content: prompt }], options: { temperature: 0 } }), signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Local AI returned ${response.status}`)
  const payload = await response.json() as { message?: { content?: string } }
  const parsed = JSON.parse(payload.message?.content || '{}') as Partial<ResumeOptimization>
  if (!Array.isArray(parsed.changes) || !parsed.tailoredResumeText || !parsed.headline) throw new Error('The local AI did not return a usable tailored resume.')
  const tailoredResumeText = String(parsed.tailoredResumeText).slice(0, 40_000)
  const changes = parsed.changes.slice(0, 10).map((change) => ({ section: String(change.section).slice(0, 100), before: String(change.before).slice(0, 2_000), after: String(change.after).slice(0, 2_000), reason: String(change.reason).slice(0, 700) }))
  if (!changes.length && tailoredResumeText.trim() !== text.trim()) changes.push({ section: 'Full resume structure and emphasis', before: text.slice(0, 2_000), after: tailoredResumeText.slice(0, 2_000), reason: 'The local AI returned a complete tailored draft without itemizing its edits. Review this side-by-side comparison carefully before approval.' })
  return {
    originalScore: Math.max(0, Math.min(100, currentScore)),
    optimizedScore: Math.max(currentScore, Math.min(100, Math.round(Number(parsed.optimizedScore) || currentScore))),
    headline: String(parsed.headline).slice(0, 300),
    changes,
    tailoredResumeText,
    safetyNote: String(parsed.safetyNote || 'Review every proposed change before using this tailored copy.').slice(0, 500),
  }
}
