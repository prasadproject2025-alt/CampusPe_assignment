import { classifyAnswerMode } from '../automation/answers/answerPolicy.js'
import type { AnswerValue, LlmAnswerProvider } from './types.js'

type OllamaResponse = { message?: { content?: string } }
type Draft = { answer?: AnswerValue; confidence?: number; explanation?: string; needsUserInput?: boolean }

export function matchVisibleOption(answer: AnswerValue, options: string[]) {
  if (!options.length) return answer
  const normalize = (value: AnswerValue) => String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
  const desired = normalize(answer)
  const exact = options.find((option) => normalize(option) === desired)
  if (exact) return exact
  const containsPhrase = (value: string, phrase: string) => value === phrase || value.startsWith(`${phrase} `) || value.endsWith(` ${phrase}`) || value.includes(` ${phrase} `)
  const unambiguous = options.filter((option) => {
    const candidate = normalize(option)
    return containsPhrase(candidate, desired) || containsPhrase(desired, candidate)
  })
  return unambiguous.length === 1 ? unambiguous[0]! : null
}

export async function ollamaStatus() {
  const endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
  const model = process.env.OLLAMA_MODEL || 'gemma3:4b'
  try {
    const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return { ok: false, endpoint, model, message: `Ollama is not responding at ${endpoint}. Start it with: ollama serve` }
    const payload = await response.json() as { models?: Array<{ name?: string }> }
    const names = (payload.models || []).map((item) => String(item.name || ''))
    const hasModel = names.some((name) => {
      const value = name.toLowerCase()
      const want = model.toLowerCase()
      return value === want || value.startsWith(`${want}:`) || value.split(':')[0] === want.split(':')[0]
    })
    return {
      ok: hasModel,
      endpoint,
      model,
      message: hasModel
        ? `Ollama ready (${model}).`
        : `Ollama is running but ${model} is missing. Run: ollama pull ${model}`,
    }
  } catch {
    return { ok: false, endpoint, model, message: `Ollama is not running. Start it with: ollama serve` }
  }
}

export class OllamaAnswerProvider implements LlmAnswerProvider {
  private readonly endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
  private readonly model = process.env.OLLAMA_MODEL || 'gemma3:4b'

  async resolve(input: Parameters<LlmAnswerProvider['resolve']>[0]) {
    if (classifyAnswerMode(input.question.text) !== 'LLM_GENERATED' || input.question.options?.length || ['select', 'boolean', 'number'].includes(input.question.fieldType)) return null
    const candidate = {
      name: input.candidate.name,
      email: input.candidate.email,
      phone: input.candidate.phone,
      location: input.candidate.location,
      currentCity: input.candidate.currentCity,
      currentState: input.candidate.currentState,
      currentCountry: input.candidate.currentCountry,
      linkedinUrl: input.candidate.linkedinUrl,
      githubUrl: input.candidate.githubUrl,
      portfolioUrl: input.candidate.portfolioUrl,
      experienceYears: input.candidate.experienceYears,
      workArrangement: input.candidate.workArrangement,
      careerMotivation: input.candidate.careerMotivation,
      coverLetterIntro: input.candidate.coverLetterIntro,
      additionalInformation: input.candidate.additionalInformation,
      skills: input.candidate.skills || [],
      experiences: input.candidate.experiences,
      education: input.candidate.education,
    }
    const prompt = `You are drafting an answer to a job application form question using the candidate profile and resume.
Never invent facts. Never invent employers. Never invent dates. Never invent skills. Never invent salary. Never invent legal or work authorization status. Never invent personal information. Never claim experience that is not supported by the resume or profile.
Analyze the resume first. Prefer explicit resume evidence, then saved profile values.
If insufficient evidence exists, set needsUserInput to true and confidence to 0. If the question is sensitive, set needsUserInput to true.
First decide whether the supplied resume or profile contains information that is genuinely relevant to this exact question. If it does, use only those relevant details. Never force unrelated education, experience, skills, or links into an answer.
If no relevant resume or profile detail exists and this is an ordinary subjective written question, answer naturally from the job and company context without making new factual claims about the candidate. Do not pause merely because the profile has no matching text.
Produce the strongest truthful answer that improves the candidate's chances by emphasizing genuine alignment with the role.
Do not invent qualifications, dates, employers, achievements, legal status, salary, demographics, disability, veteran status, or immigration facts.
For subjective written questions, be specific, confident, positive, and tailored to the company and role without exaggerating. Use only 1 or 2 short sentences and no more than 35 words unless the form explicitly requires a longer minimum.
Only draft contextual narrative answers. Factual and choice answers must come from saved profile/resume data or the user.
Respect the field type and available options exactly. Keep written answers concise; if the question gives a word limit, obey it.
Return only JSON with keys: answer, confidence (0 to 1), source (profile, resume, derived, or llm), requiresUserReview (boolean), explanation, needsUserInput.

Question: ${input.question.text}
Canonical field: ${input.canonicalField ?? ''}
Field type: ${input.question.fieldType}
Options: ${JSON.stringify(input.question.options ?? [])}
Company: ${input.job.company ?? ''}
Role: ${input.job.jobTitle ?? ''}
Job description: ${this.plainText(input.job.jobDescription ?? '').slice(0, 8_000)}
Candidate context: ${JSON.stringify(candidate).slice(0, 10_000)}
Resume: ${this.plainText(input.candidate.resumeText || '').slice(0, 12_000)}`

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }], options: { temperature: 0.1, num_predict: 320 } }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!response.ok) return null
      const payload = await response.json() as OllamaResponse
      const draft = JSON.parse(payload.message?.content || '{}') as Draft
      if (draft.needsUserInput) return null
      if (!['string', 'number', 'boolean'].includes(typeof draft.answer)) return null
      const confidence = Math.max(0, Math.min(1, Number(draft.confidence) || 0))
      const visibleOption = matchVisibleOption(draft.answer!, input.question.options ?? [])
      if (visibleOption === null) return null
      const answer = input.question.options?.length ? visibleOption! : typeof draft.answer === 'string' ? this.limitWrittenAnswer(draft.answer) : draft.answer!
      return { answer, confidence, explanation: String(draft.explanation || 'Drafted locally with Ollama.') }
    } catch { return null }
  }

  private plainText(value: string) { return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() }
  private limitWrittenAnswer(value: string) {
    const sentences = value.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.slice(0, 2).join(' ').trim() || value.trim()
    const words = sentences.split(/\s+/)
    return words.length <= 35 ? sentences : `${words.slice(0, 35).join(' ').replace(/[,;:]$/, '')}…`
  }
}
