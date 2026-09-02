import { randomUUID } from 'node:crypto'
import { db } from '../database.js'
import { decryptJson, encryptJson } from '../security.js'
import { classifyQuestion, normalizeQuestion, questionSimilarity } from './normalizer.js'
import { approvedDeclarationAnswer, manualPolicyReason, nonDisclosureOption, nonInferableFields, sensitiveFields } from './policy.js'
import { OllamaAnswerProvider } from './ollama.js'
import { matchNoticePeriodOption } from './optionMatcher.js'
import type { AnswerValue, CandidateContext, FormQuestion, JobContext, LlmAnswerProvider, Resolution } from './types.js'

type ProfileRow = Record<string, unknown>
type MemoryRow = { id: string; question_text: string; normalized_question: string; canonical_field: string | null; field_type: string; answer_encrypted: string; scope: 'global' | 'company'; company: string | null }

const emptyDemographics = { gender: 'prefer', orientation: 'prefer', ethnicity: 'prefer', disability: 'prefer', veteran: 'prefer' }

function loadCandidate(userId: string): CandidateContext {
  const row = db.prepare('SELECT users.name, users.email, profiles.* FROM profiles JOIN users ON users.id=profiles.user_id WHERE profiles.user_id=?').get(userId) as ProfileRow | undefined
  if (!row) throw new Error('Candidate profile not found.')
  return { name: String(row.name), email: String(row.email), phone: String(row.phone), phoneCountryCode: String(row.phone_country_code), location: String(row.location), currentCity: String(row.current_city), currentState: String(row.current_state), currentCountry: String(row.current_country), linkedinUrl: String(row.linkedin_url), githubUrl: String(row.github_url), portfolioUrl: String(row.portfolio_url), experienceYears: String(row.experience_years), noticePeriod: String(row.notice_period), workAuthorized: String(row.work_authorized), sponsorship: String(row.sponsorship), currentSalary: String(row.current_salary), expectedSalary: String(row.expected_salary), workArrangement: String(row.work_arrangement), willingInOffice: String(row.willing_in_office), willingRelocate: String(row.willing_relocate), usWorkAuthorized: String(row.us_work_authorized), usSponsorship: String(row.us_sponsorship), usVisaType: String(row.us_visa_type), activeImmigrationCase: String(row.active_immigration_case), referralSource: String(row.referral_source), careerMotivation: String(row.career_motivation), coverLetterIntro: String(row.cover_letter_intro), additionalInformation: String(row.additional_information), experiences: JSON.parse(String(row.experiences_json || '[]')), education: JSON.parse(String(row.education_json || '[]')), demographics: decryptJson(String(row.demographics_encrypted || ''), emptyDemographics), allowDemographicSuggestions: Boolean(row.allow_demographic_suggestions) }
}

function l1Lookup(field: string | null, candidate: CandidateContext): { answer: AnswerValue; confidence: number; review: boolean; explanation: string } | null {
  const nameParts = candidate.name.trim().split(/\s+/)
  const direct: Record<string, AnswerValue> = { first_name: nameParts[0] || candidate.name, last_name: nameParts.slice(1).join(' ') || nameParts[0] || candidate.name, full_name: candidate.name, email: candidate.email, phone: candidate.phone, phone_country_code: candidate.phoneCountryCode, location: candidate.location, current_city: candidate.currentCity, current_state: candidate.currentState, current_country: candidate.currentCountry, linkedin_url: candidate.linkedinUrl, github_url: candidate.githubUrl, portfolio_url: candidate.portfolioUrl, total_experience_years: candidate.experienceYears, notice_period: candidate.noticePeriod, work_authorized: candidate.workAuthorized, sponsorship: candidate.sponsorship, current_salary: candidate.currentSalary, expected_salary: candidate.expectedSalary, work_arrangement: candidate.workArrangement, willing_in_office: candidate.willingInOffice, willing_relocate: candidate.willingRelocate, us_work_authorized: candidate.usWorkAuthorized, us_sponsorship: candidate.usSponsorship, us_visa_type: candidate.usVisaType, active_immigration_case: candidate.activeImmigrationCase, referral_source: candidate.referralSource, career_motivation: candidate.careerMotivation, cover_letter_intro: candidate.coverLetterIntro, additional_information: candidate.additionalInformation }
  if (field && field in direct && direct[field] !== '') return { answer: direct[field]!, confidence: .99, review: ['work_authorized', 'sponsorship', 'us_work_authorized', 'us_sponsorship', 'us_visa_type', 'active_immigration_case', 'current_salary', 'expected_salary', 'notice_period'].includes(field), explanation: `Matched the explicit ${field.replaceAll('_', ' ')} value in the candidate profile.` }
  if (field === 'current_company') {
    const current = candidate.experiences.find((experience) => experience.current === true) ?? candidate.experiences[0]
    if (current?.company) return { answer: String(current.company), confidence: .96, review: false, explanation: 'Matched the current or most recent company in work experience.' }
  }
  if (field === 'degree_type') {
    const education = candidate.education.find((record) => typeof record.degree === 'string' && record.degree.trim())
    if (education?.degree) return { answer: String(education.degree), confidence: .96, review: false, explanation: 'Matched the degree saved in education history.' }
  }
  if (field === 'education_discipline') {
    const education = candidate.education.find((record) => typeof record.field === 'string' && record.field.trim())
    if (education?.field) return { answer: String(education.field), confidence: .96, review: false, explanation: 'Matched the field of study saved in education history.' }
  }
  if (field === 'education_school') {
    const education = candidate.education.find((record) => typeof record.school === 'string' && record.school.trim())
    if (education?.school) return { answer: String(education.school), confidence: .99, review: false, explanation: 'Matched the school saved in education history.' }
  }
  if (field === 'education_start_year') {
    const education = candidate.education.find((record) => typeof record.startDate === 'string' && /^\d{4}/.test(record.startDate))
    if (education?.startDate) return { answer: String(education.startDate).slice(0, 4), confidence: .99, review: false, explanation: 'Matched the education start year saved in the profile.' }
  }
  if (field === 'education_end_year') {
    const education = candidate.education.find((record) => typeof record.endDate === 'string' && /^\d{4}/.test(record.endDate))
    if (education?.endDate) return { answer: String(education.endDate).slice(0, 4), confidence: .99, review: false, explanation: 'Matched the education end year saved in the profile.' }
  }
  if (field === 'pronouns' && candidate.allowDemographicSuggestions) {
    const pronounsByGender: Record<string, string> = {
      male: 'He/him/his',
      female: 'She/her/hers',
      'non-binary': 'They/them/theirs',
      'decline to self-identify': 'Just use my name',
    }
    const answer = pronounsByGender[String(candidate.demographics.gender || '').toLowerCase()]
    if (answer) return { answer, confidence: 1, review: true, explanation: 'Mapped the explicit gender identity saved in the profile to the corresponding pronoun option.' }
  }
  const demographicMap: Record<string, string> = { gender: 'gender', sexual_orientation: 'orientation', ethnicity: 'ethnicity', disability: 'disability', veteran: 'veteran' }
  if (field && sensitiveFields.has(field) && candidate.allowDemographicSuggestions) {
    const value = candidate.demographics[demographicMap[field]!]
    if (value && value !== 'prefer') return { answer: value, confidence: 1, review: true, explanation: 'Matched an explicit voluntary profile answer; review is always required.' }
  }
  return null
}

function loadMemory(userId: string, normalized: string, canonical: string | null, job: JobContext) {
  const rows = db.prepare('SELECT * FROM answer_memory WHERE user_id=? ORDER BY last_used_at DESC, approved_at DESC LIMIT 200').all(userId) as unknown as MemoryRow[]
  let best: { row: MemoryRow; score: number } | null = null
  for (const row of rows) {
    if (row.scope === 'company' && (!job.company || row.company?.toLowerCase() !== job.company.toLowerCase())) continue
    let score = questionSimilarity(normalized, row.normalized_question)
    if (canonical && row.canonical_field === canonical) score = Math.max(score, .94)
    if (!best || score > best.score) best = { row, score }
  }
  return best && best.score >= .82 ? best : null
}

export class AnswerResolver {
  constructor(private readonly llm?: LlmAnswerProvider) {}

  async resolve(userId: string, question: FormQuestion, job: JobContext = {}, options: { testMode?: boolean } = {}): Promise<Resolution> {
    const normalized = normalizeQuestion(question.text)
    const canonical = classifyQuestion(normalized)
    const approvedDeclaration = approvedDeclarationAnswer(normalized, question.options)
    if (approvedDeclaration) return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: approvedDeclaration, source: 'L1_PROFILE', confidence: 1, requiresReview: true, canonicalField: canonical, explanation: 'Used your explicit approval for the no-recording and no-transcribing acknowledgement.' })
    const manualReason = manualPolicyReason(normalized)
    if (manualReason && options.testMode && question.options?.length) {
      const testAnswer = question.options.find((option) => /^(?:yes|i agree|i acknowledge|agree)$/i.test(option.trim())) ?? question.options[0]
      if (testAnswer) return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: testAnswer, source: 'L3_LLM', confidence: 1, requiresReview: true, canonicalField: canonical, explanation: 'Testing mode selected a visible option. This run cannot be submitted.' })
    }
    if (manualReason) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: manualReason, canonicalField: canonical, pauseCode: 'RESTRICTED_QUESTION' })
    const candidate = loadCandidate(userId)
    let l1 = l1Lookup(canonical, candidate)
    if (canonical === 'declaration_date') {
      const today = new Date()
      l1 = { answer: `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`, confidence: 1, review: true, explanation: 'Used today’s date for the visible declaration date field.' }
    }
    if (canonical === 'location_confirmation' && candidate.currentCountry) {
      const target = normalized.match(/\blocated in ([a-z .-]+?)(?:\?|$)/)?.[1]?.trim()
      if (target) l1 = { answer: candidate.currentCountry.toLowerCase().includes(target) ? 'Yes' : 'No', confidence: .99, review: true, explanation: 'Compared the requested country with the current country saved in the profile.' }
    }
    if (l1 && canonical === 'notice_period' && question.options?.length) {
      const matchedOption = matchNoticePeriodOption(l1.answer, question.options)
      if (matchedOption) l1 = { ...l1, answer: matchedOption, explanation: `${l1.explanation} Matched it to the employer's notice-period wording.` }
    }
    if (l1 && question.options?.length) {
      const matchedOption = this.visibleOption(l1.answer, question.options)
      if (!matchedOption) {
        if (canonical && (sensitiveFields.has(canonical) || nonInferableFields.has(canonical))) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'Your saved profile answer does not match any option shown by this employer.', canonicalField: canonical, pauseCode: 'MISSING_PROFILE_VALUE' })
        l1 = null
      } else l1 = { ...l1, answer: matchedOption }
    }
    if (l1) return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: l1.answer, source: 'L1_PROFILE', confidence: l1.confidence, requiresReview: l1.review, canonicalField: canonical, explanation: l1.explanation })
    if (canonical && sensitiveFields.has(canonical) && options.testMode) {
      const privateOption = nonDisclosureOption(question.options)
      if (privateOption) return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: privateOption, source: 'L3_LLM', confidence: 1, requiresReview: true, canonicalField: canonical, explanation: 'Testing mode used the employer’s non-disclosure option because no explicit demographic answer was saved.' })
    }
    if (canonical && sensitiveFields.has(canonical) && !options.testMode) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'This voluntary answer was not explicitly enabled and saved in the profile.', canonicalField: canonical, pauseCode: 'RESTRICTED_QUESTION' })
    const memory = loadMemory(userId, normalized, canonical, job)
    if (memory) {
      const rememberedAnswer = decryptJson<AnswerValue>(memory.row.answer_encrypted, '')
      const matchedMemoryOption = question.options?.length ? this.visibleOption(rememberedAnswer, question.options) : rememberedAnswer
      if (matchedMemoryOption === null) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'Your previously approved answer does not match any option shown by this employer.', canonicalField: canonical, pauseCode: 'MISSING_PROFILE_VALUE' })
      db.prepare('UPDATE answer_memory SET usage_count=usage_count+1, last_used_at=? WHERE id=?').run(new Date().toISOString(), memory.row.id)
      return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: matchedMemoryOption, source: 'L2_MEMORY', confidence: Number(memory.score.toFixed(2)), requiresReview: sensitiveFields.has(canonical ?? ''), canonicalField: canonical, explanation: 'Reused a previously approved answer to a semantically similar question.', memoryId: memory.row.id })
    }
    if (canonical && nonInferableFields.has(canonical) && !options.testMode) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'This factual or preference answer must come from your profile or a previously approved answer.', canonicalField: canonical, pauseCode: 'RESTRICTED_QUESTION' })
    if ((question.fieldType === 'select' || question.fieldType === 'boolean') && !question.options?.length) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'This is a choice control, but its visible options could not be read reliably. JobCopilot will not type a generated sentence into it.', canonicalField: canonical, pauseCode: 'MISSING_PROFILE_VALUE' })
    if (!this.llm && options.testMode) return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: this.testAnswer(question), source: 'L3_LLM', confidence: 1, requiresReview: true, canonicalField: canonical, explanation: 'Used a testing-only fallback because no model is configured. This run cannot be submitted.' })
    if (!this.llm) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'No reliable profile or approved-memory answer was found, and no LLM provider is configured.', canonicalField: canonical, pauseCode: 'LLM_NOT_CONFIGURED' })
    const draft = await this.llm.resolve({ question, normalizedQuestion: normalized, canonicalField: canonical, candidate, job })
    if (!draft && options.testMode) return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: this.testAnswer(question), source: 'L3_LLM', confidence: 1, requiresReview: true, canonicalField: canonical, explanation: 'Used a testing-only fallback because the model declined. This run cannot be submitted.' })
    if (!draft) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'The LLM declined to generate a reliable answer.', canonicalField: canonical, pauseCode: 'LLM_DECLINED' })
    if (draft.confidence < .75 && !options.testMode) return this.finish(userId, question, job, normalized, canonical, { status: 'NEEDS_USER_INPUT', reason: 'The generated draft did not meet the confidence threshold.', canonicalField: canonical, pauseCode: 'LOW_CONFIDENCE' })
    return this.finish(userId, question, job, normalized, canonical, { status: 'RESOLVED', answer: draft.answer, source: 'L3_LLM', confidence: draft.confidence, requiresReview: true, canonicalField: canonical, explanation: draft.explanation })
  }

  remember(userId: string, input: { question: FormQuestion; answer: AnswerValue; scope: 'global' | 'company'; company?: string }) {
    const normalized = normalizeQuestion(input.question.text); const canonical = classifyQuestion(normalized); const now = new Date().toISOString(); const id = randomUUID()
    db.prepare('INSERT INTO answer_memory (id,user_id,question_text,normalized_question,canonical_field,field_type,answer_encrypted,scope,company,approved_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id, userId, input.question.text, normalized, canonical, input.question.fieldType, encryptJson(input.answer), input.scope, input.scope === 'company' ? input.company || null : null, now, now)
    return { id, normalizedQuestion: normalized, canonicalField: canonical }
  }

  listMemory(userId: string) {
    const rows = db.prepare('SELECT id,question_text,normalized_question,canonical_field,field_type,answer_encrypted,scope,company,approved_at,last_used_at,usage_count FROM answer_memory WHERE user_id=? ORDER BY approved_at DESC').all(userId) as unknown as MemoryRow[]
    return rows.map((row) => ({ id: row.id, question: row.question_text, normalizedQuestion: row.normalized_question, canonicalField: row.canonical_field, fieldType: row.field_type, answer: decryptJson<AnswerValue>(row.answer_encrypted, ''), scope: row.scope, company: row.company, approvedAt: (row as unknown as Record<string, unknown>).approved_at, lastUsedAt: (row as unknown as Record<string, unknown>).last_used_at, usageCount: (row as unknown as Record<string, unknown>).usage_count }))
  }

  private finish(userId: string, question: FormQuestion, job: JobContext, normalized: string, canonical: string | null, result: Resolution) {
    db.prepare('INSERT INTO resolution_log (id,user_id,question_text,normalized_question,canonical_field,status,source,confidence,reason,company,job_title,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), userId, question.text, normalized, canonical, result.status, result.status === 'RESOLVED' ? result.source : null, result.status === 'RESOLVED' ? result.confidence : null, result.status === 'NEEDS_USER_INPUT' ? result.reason : null, job.company || null, job.jobTitle || null, new Date().toISOString())
    return result
  }

  private visibleOption(answer: AnswerValue, options: string[]) {
    const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/\bundergraduate\b|\bbachelors?(?: degree)?\b/g, 'bachelor').replace(/\bmasters?(?: degree)?\b/g, 'master').replace(/[^a-z0-9]+/g, ' ').trim()
    const desired = normalize(String(answer))
    const exact = options.find((option) => normalize(option) === desired)
    if (exact) return exact
    const containsPhrase = (value: string, phrase: string) => value === phrase || value.startsWith(`${phrase} `) || value.endsWith(` ${phrase}`) || value.includes(` ${phrase} `)
    const matches = options.filter((option) => { const candidate = normalize(option); return containsPhrase(candidate, desired) || containsPhrase(desired, candidate) })
    return matches.length === 1 ? matches[0]! : null
  }

  private testAnswer(question: FormQuestion): AnswerValue {
    const options = question.options ?? []
    const preferred = options.find((option) => /^(?:5|yes|i agree|i acknowledge|agree)$/i.test(option.trim()))
      ?? options.find((option) => /\b(?:yes|agree|acknowledge)\b/i.test(option))
      ?? options[0]
    if (preferred) return preferred
    if (question.fieldType === 'number' || /\bscale of 1\s*-\s*5\b/i.test(question.text)) return 5
    if (question.fieldType === 'boolean') return true
    return 'Testing mode answer — review only.'
  }
}

export const answerResolver = new AnswerResolver(new OllamaAnswerProvider())
