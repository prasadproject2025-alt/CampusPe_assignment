import { classifyQuestion, normalizeQuestion } from '../../resolver/normalizer.js'
import { nonInferableFields, safePreferenceFields, sensitiveFields } from '../../resolver/policy.js'

export type AnswerClass = 'PROFILE_FACT' | 'RESUME_FACT' | 'DERIVED_FACT' | 'LLM_GENERATED' | 'USER_REQUIRED' | 'UNSUPPORTED'

const userRequiredPatterns = [
  /\bportfolio password\b/,
  /\bpassword\b/,
  /\bdate of birth\b|\bdob\b|\bbirthdate\b/,
  /\bsocial security\b|\bssn\b|\baadhaar\b|\bpassport\b|\bnational id\b/,
  /\bbank\b|\brouting number\b|\biban\b/,
  /\bemergency contact\b/,
  /\bhome address\b|\bstreet address\b/,
  /\bgovernment ident/,
  /\bsecurity (?:question|answer)\b/,
]

export function classifyAnswerMode(label: string): AnswerClass {
  const normalized = normalizeQuestion(label)
  if (userRequiredPatterns.some((pattern) => pattern.test(normalized))) return 'USER_REQUIRED'
  const canonical = classifyQuestion(normalized)
  if (canonical && (sensitiveFields.has(canonical) || nonInferableFields.has(canonical))) return 'USER_REQUIRED'
  if (canonical && safePreferenceFields.has(canonical)) return 'LLM_GENERATED'
  if (canonical && ['first_name', 'last_name', 'full_name', 'email', 'phone', 'linkedin_url', 'github_url', 'portfolio_url'].includes(canonical)) return 'PROFILE_FACT'
  if (canonical && ['total_experience_years', 'degree_type', 'education_school', 'current_company'].includes(canonical)) return 'DERIVED_FACT'
  if (canonical && ['motivation', 'career_motivation', 'cover_letter_intro', 'additional_information'].includes(canonical)) return 'LLM_GENERATED'
  if (/\bwhy (?:do you want|are you interested)\b|\btell us about\b|\bbiggest achievement\b|\bgood fit\b/.test(normalized)) return 'LLM_GENERATED'
  if (canonical) return 'RESUME_FACT'
  return 'UNSUPPORTED'
}

export function sensitiveUserMessage(label: string) {
  return classifyAnswerMode(label) === 'USER_REQUIRED'
    ? 'Please provide this information. JobCopilot will not guess or generate it.'
    : ''
}
