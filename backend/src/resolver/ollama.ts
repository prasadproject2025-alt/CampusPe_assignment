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

export class OllamaAnswerProvider implements LlmAnswerProvider {
  private readonly endpoint = process.env.OLLAMA_URL || 'http://127.0.0.1:11434'
  private readonly model = process.env.OLLAMA_MODEL || 'gemma3:4b'

  async resolve(input: Parameters<LlmAnswerProvider['resolve']>[0]) {
    const candidate = {
      name: input.candidate.name,
      location: input.candidate.location,
      linkedinUrl: input.candidate.linkedinUrl,
      githubUrl: input.candidate.githubUrl,
      portfolioUrl: input.candidate.portfolioUrl,
      experienceYears: input.candidate.experienceYears,
      workArrangement: input.candidate.workArrangement,
      careerMotivation: input.candidate.careerMotivation,
      coverLetterIntro: input.candidate.coverLetterIntro,
      additionalInformation: input.candidate.additionalInformation,
      experiences: input.candidate.experiences,
      education: input.candidate.education,
    }
    const prompt = `You are drafting an answer to a job application form question.
First decide whether the supplied candidate profile contains information that is genuinely relevant to this exact question. If it does, use only those relevant details. Never force unrelated education, experience, skills, or links into an answer.
If no relevant profile detail exists and this is an ordinary subjective written question, answer naturally from the job and company context without making new factual claims about the candidate. Do not pause merely because the profile has no matching text.
Produce the strongest truthful answer that improves the candidate's chances by emphasizing genuine alignment with the role.
Do not invent qualifications, dates, employers, achievements, legal status, salary, demographics, disability, veteran status, or immigration facts.
For subjective written questions, be specific, confident, positive, and tailored to the company and role without exaggerating. Use only 1 or 2 short sentences and no more than 35 words unless the form explicitly requires a longer minimum.
For ordinary yes/no, dropdown, checkbox, or multiple-choice questions, understand the question and choose the single most obvious, contextually appropriate option from the supplied options. Return the option text exactly as provided.
For optional recruitment-status communication questions (for example receiving application updates by SMS or email), prefer the opt-in/Yes option because the user's stated preference is to keep the application process moving and receive employer updates. This preference applies only to recruitment updates and does not authorize unrelated marketing.
Other than the recruitment-status communication preference above, if an option would assert a candidate-specific fact—such as eligibility, authorization, sponsorship, immigration, salary, availability, location commitment, consent, demographics, disability, veteran status, qualifications, or years of experience—choose it only when the candidate context explicitly supports it. Otherwise set needsUserInput to true and confidence to 0. Never select a favorable option by inventing a fact.
When the canonical field is skill_experience_years, estimate a numeric number of years only from dated candidate work-history entries whose descriptions explicitly mention the skill, system, or domain in the question. Return only a number such as 3 or 4.5 as the answer. Do not use total career duration unless the relevant skill is supported throughout those dated roles. If the evidence cannot support a defensible estimate, set needsUserInput to true.
Respect the field type and available options exactly. Keep written answers concise; if the question gives a word limit, obey it.
Return only JSON with keys: answer, confidence (0 to 1), explanation, needsUserInput.

Question: ${input.question.text}
Canonical field: ${input.canonicalField ?? ''}
Field type: ${input.question.fieldType}
Options: ${JSON.stringify(input.question.options ?? [])}
Company: ${input.job.company ?? ''}
Role: ${input.job.jobTitle ?? ''}
Job description: ${this.plainText(input.job.jobDescription ?? '').slice(0, 12_000)}
Candidate context: ${JSON.stringify(candidate).slice(0, 12_000)}`

    try {
      const response = await fetch(`${this.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }], options: { temperature: 0.25, num_predict: 180 } }),
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
