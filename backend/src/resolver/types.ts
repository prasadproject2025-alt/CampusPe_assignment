export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select'
export type AnswerValue = string | number | boolean
export type ResolutionSource = 'L1_PROFILE' | 'L2_MEMORY' | 'L3_LLM'

export type FormQuestion = {
  id: string
  text: string
  fieldType: FieldType
  options?: string[]
  required: boolean
}

export type JobContext = {
  company?: string
  jobTitle?: string
  jobDescription?: string
  jobBoard?: string
}

export type CandidateContext = {
  name: string
  email: string
  phone: string
  phoneCountryCode: string
  location: string
  currentCity: string
  currentState: string
  currentCountry: string
  linkedinUrl: string
  githubUrl: string
  portfolioUrl: string
  experienceYears: string
  noticePeriod: string
  workAuthorized: string
  sponsorship: string
  currentSalary: string
  expectedSalary: string
  workArrangement: string
  willingInOffice: string
  willingRelocate: string
  usWorkAuthorized: string
  usSponsorship: string
  usVisaType: string
  activeImmigrationCase: string
  referralSource: string
  careerMotivation: string
  coverLetterIntro: string
  additionalInformation: string
  experiences: Array<Record<string, unknown>>
  education: Array<Record<string, unknown>>
  demographics: Record<string, string>
  allowDemographicSuggestions: boolean
}

export type ResolvedAnswer = {
  status: 'RESOLVED'
  answer: AnswerValue
  source: ResolutionSource
  confidence: number
  requiresReview: boolean
  canonicalField: string | null
  explanation: string
  memoryId?: string
}

export type NeedsUserInput = {
  status: 'NEEDS_USER_INPUT'
  reason: string
  canonicalField: string | null
  pauseCode: 'MISSING_PROFILE_VALUE' | 'RESTRICTED_QUESTION' | 'LOW_CONFIDENCE' | 'LLM_NOT_CONFIGURED' | 'LLM_DECLINED'
}

export type Resolution = ResolvedAnswer | NeedsUserInput

export interface LlmAnswerProvider {
  resolve(input: { question: FormQuestion; normalizedQuestion: string; canonicalField: string | null; candidate: CandidateContext; job: JobContext }): Promise<{ answer: AnswerValue; confidence: number; explanation: string } | null>
}
