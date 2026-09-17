import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { uploadDir } from '../config.js'
import { db } from '../database.js'
import { extractResumeText } from '../resumeReview.js'
import type { CandidateContext } from './types.js'

export type ResumeFacts = {
  phone: string
  location: string
  currentCity: string
  currentState: string
  currentCountry: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  experienceYears: string
  currentCompany: string
  summary: string
  skills: string[]
  workAuthorized: string
  sponsorship: string
  experiences: Array<Record<string, unknown>>
  education: Array<Record<string, unknown>>
}

type CacheEntry = { text: string; facts: ResumeFacts; expires: number }

const emptyFacts = (): ResumeFacts => ({
  phone: '',
  location: '',
  currentCity: '',
  currentState: '',
  currentCountry: '',
  linkedinUrl: '',
  githubUrl: '',
  portfolioUrl: '',
  experienceYears: '',
  currentCompany: '',
  summary: '',
  skills: [],
  workAuthorized: '',
  sponsorship: '',
  experiences: [],
  education: [],
})

const cache = new Map<string, CacheEntry>()
const CACHE_MS = 10 * 60 * 1000

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
}

function recordsHaveContent(records: Array<Record<string, unknown>>, keys: string[]) {
  return records.some((record) => keys.some((key) => asString(record[key])))
}

export function mergeResumeFacts(candidate: CandidateContext, facts: ResumeFacts, resumeText = ''): CandidateContext {
  const fill = (current: string, incoming: string) => current.trim() ? current : incoming.trim()
  const experiences = recordsHaveContent(candidate.experiences, ['company', 'title', 'school'])
    ? candidate.experiences
    : (facts.experiences.length
      ? facts.experiences
      : (facts.currentCompany ? [{ company: facts.currentCompany, current: true }] : candidate.experiences))
  const education = recordsHaveContent(candidate.education, ['school', 'degree', 'field'])
    ? candidate.education
    : (facts.education.length ? facts.education : candidate.education)
  const location = fill(candidate.location, facts.location || [facts.currentCity, facts.currentState, facts.currentCountry].filter(Boolean).join(', '))
  return {
    ...candidate,
    phone: fill(candidate.phone, facts.phone),
    location,
    currentCity: fill(candidate.currentCity, facts.currentCity),
    currentState: fill(candidate.currentState, facts.currentState),
    currentCountry: fill(candidate.currentCountry, facts.currentCountry),
    linkedinUrl: fill(candidate.linkedinUrl, facts.linkedinUrl),
    githubUrl: fill(candidate.githubUrl, facts.githubUrl),
    portfolioUrl: fill(candidate.portfolioUrl, facts.portfolioUrl),
    experienceYears: fill(candidate.experienceYears, facts.experienceYears),
    workAuthorized: fill(candidate.workAuthorized, facts.workAuthorized),
    sponsorship: fill(candidate.sponsorship, facts.sponsorship),
    careerMotivation: fill(candidate.careerMotivation, facts.summary),
    coverLetterIntro: fill(candidate.coverLetterIntro, facts.summary),
    additionalInformation: fill(candidate.additionalInformation, facts.skills.join(', ')),
    experiences,
    education,
    resumeText,
    skills: facts.skills,
  }
}

export async function loadResumeTextForUser(userId: string) {
  const row = db.prepare('SELECT resume_storage_name FROM profiles WHERE user_id=?').get(userId) as { resume_storage_name: string | null } | undefined
  if (!row?.resume_storage_name) return ''
  const resumePath = resolve(uploadDir, row.resume_storage_name)
  if (!resumePath.startsWith(`${uploadDir}/`) || !existsSync(resumePath)) return ''
  try {
    return (await extractResumeText(resumePath)).trim()
  } catch {
    return ''
  }
}

async function extractFactsWithOllama(resumeText: string): Promise<ResumeFacts> {
  const facts = emptyFacts()
  if (resumeText.length < 80) return facts
  const endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
  const model = process.env.OLLAMA_MODEL || 'gemma3:4b'
  const prompt = `Extract only facts that are explicitly written in this resume. Never invent employers, dates, skills, salary, legal status, or personal data.
If a value is not clearly present, use an empty string or [].
Return JSON only with keys: phone, location, currentCity, currentState, currentCountry, linkedinUrl, githubUrl, portfolioUrl, experienceYears, currentCompany, summary, skills, workAuthorized, sponsorship, experiences, education.
workAuthorized and sponsorship must stay empty unless the resume explicitly states work authorization or visa sponsorship.
experiences is an array of {company, title, startDate, endDate, current, description}.
education is an array of {school, degree, field, startDate, endDate}.
skills is an array of strings. summary is 1-2 sentences copied or closely paraphrased from the resume.

RESUME:
${resumeText.slice(0, 18_000)}`
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0, num_predict: 700 },
      }),
        signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) return facts
    const payload = await response.json() as { message?: { content?: string } }
    const parsed = JSON.parse(payload.message?.content || '{}') as Partial<ResumeFacts>
    return {
      phone: asString(parsed.phone),
      location: asString(parsed.location),
      currentCity: asString(parsed.currentCity),
      currentState: asString(parsed.currentState),
      currentCountry: asString(parsed.currentCountry),
      linkedinUrl: asString(parsed.linkedinUrl),
      githubUrl: asString(parsed.githubUrl),
      portfolioUrl: asString(parsed.portfolioUrl),
      experienceYears: asString(parsed.experienceYears),
      currentCompany: asString(parsed.currentCompany),
      summary: asString(parsed.summary),
      skills: Array.isArray(parsed.skills) ? parsed.skills.map(asString).filter(Boolean).slice(0, 40) : [],
      workAuthorized: asString(parsed.workAuthorized),
      sponsorship: asString(parsed.sponsorship),
      experiences: asList(parsed.experiences).slice(0, 12),
      education: asList(parsed.education).slice(0, 8),
    }
  } catch {
    return facts
  }
}

export async function loadResumeContext(userId: string): Promise<{ text: string; facts: ResumeFacts }> {
  const cached = cache.get(userId)
  if (cached && cached.expires > Date.now()) return { text: cached.text, facts: cached.facts }
  const text = await loadResumeTextForUser(userId)
  const facts = text ? await extractFactsWithOllama(text) : emptyFacts()
  cache.set(userId, { text, facts, expires: Date.now() + CACHE_MS })
  return { text, facts }
}

export function clearResumeFactsCache(userId: string) {
  cache.delete(userId)
}

export async function applyResumeFactsToProfile(userId: string) {
  const row = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(userId) as Record<string, unknown> | undefined
  if (!row) return null
  const { text, facts } = await loadResumeContext(userId)
  if (!text) return null
  const experiences = JSON.parse(String(row.experiences_json || '[]')) as Array<Record<string, unknown>>
  const education = JSON.parse(String(row.education_json || '[]')) as Array<Record<string, unknown>>
  const fill = (current: unknown, incoming: string) => asString(current) ? asString(current) : incoming
  const nextExperiences = recordsHaveContent(experiences, ['company', 'title'])
    ? experiences
    : (facts.experiences.length ? facts.experiences : (facts.currentCompany ? [{ company: facts.currentCompany, current: true }] : experiences))
  const nextEducation = recordsHaveContent(education, ['school', 'degree', 'field']) ? education : (facts.education.length ? facts.education : education)
  const location = fill(row.location, facts.location || [facts.currentCity, facts.currentState, facts.currentCountry].filter(Boolean).join(', '))
  db.prepare(`UPDATE profiles SET phone=?, location=?, current_city=?, current_state=?, current_country=?, linkedin_url=?, github_url=?, portfolio_url=?, experience_years=?, work_authorized=?, sponsorship=?, career_motivation=?, cover_letter_intro=?, additional_information=?, experiences_json=?, education_json=?, updated_at=? WHERE user_id=?`).run(
    fill(row.phone, facts.phone),
    location,
    fill(row.current_city, facts.currentCity),
    fill(row.current_state, facts.currentState),
    fill(row.current_country, facts.currentCountry),
    fill(row.linkedin_url, facts.linkedinUrl),
    fill(row.github_url, facts.githubUrl),
    fill(row.portfolio_url, facts.portfolioUrl),
    fill(row.experience_years, facts.experienceYears),
    fill(row.work_authorized, facts.workAuthorized),
    fill(row.sponsorship, facts.sponsorship),
    fill(row.career_motivation, facts.summary),
    fill(row.cover_letter_intro, facts.summary),
    fill(row.additional_information, facts.skills.join(', ')),
    JSON.stringify(nextExperiences),
    JSON.stringify(nextEducation),
    new Date().toISOString(),
    userId,
  )
  return facts
}
