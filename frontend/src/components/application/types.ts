export type ApplicationStrategy = 'EMBED' | 'CUSTOM_FORM' | 'BROWSER_AUTOMATION' | 'NATIVE_FORM' | 'OFFICIAL_API' | 'SERVER_BROWSER_AUTOMATION' | 'MANUAL_REQUIRED'

export type ApplicationField = {
  id: string
  path?: string
  text: string
  description?: string
  fieldType: 'text' | 'textarea' | 'number' | 'boolean' | 'select'
  inputType?: string
  required: boolean
  options?: string[]
  section?: string
  isHidden?: boolean
  isMany?: boolean
  dependsOn?: { fieldId: string; values: string[] }
  placeholder?: string
  value: string
  suggestion?: string
  source?: string
  confidence?: number
  status: 'empty' | 'suggested' | 'accepted' | 'manual' | 'unresolved' | 'skipped'
  reason?: string
}

export type ApplicationModel = {
  provider: string
  strategy: ApplicationStrategy
  jobId: string | null
  title: string
  company: string
  embedUrl: string | null
  fields: ApplicationField[]
  sections?: Array<{ id: string; title: string }>
  schemaSource?: 'public_api' | 'headless_extract' | 'none'
  schemaComplete?: boolean
  schemaFieldCount?: number
  reason: string
  displayMode: 'native_form' | 'official_embed' | 'browser_assisted'
}

export type ApplicationCapabilities = {
  supportsEmbed: boolean
  supportsCustomForm: boolean
  supportsBrowserAutomation: boolean
  preferredStrategy: ApplicationStrategy
  schemaSource: 'public_api' | 'headless_extract' | 'none'
  embedReason: string
  customFormReason: string
  browserReason: string
}

export type AutomationStatus =
  | 'QUEUED' | 'OPENING_JOB' | 'EXTRACTING_JOB' | 'FILLING_APPLICATION'
  | 'PAUSED_BY_USER' | 'PAUSED_NEEDS_INPUT' | 'PAUSED_LOGIN' | 'PAUSED_CAPTCHA'
  | 'READY_FOR_REVIEW' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED'

export type AutomationRun = {
  id: string
  jobUrl: string
  jobBoard: string
  status: AutomationStatus
  currentStep: string
  autoSubmit?: boolean
  testMode?: boolean
  browserActive?: boolean
  strategy?: ApplicationStrategy
  capabilities?: ApplicationCapabilities
  application?: ApplicationModel | null
  job?: { company?: string; jobTitle?: string; location?: string } | null
  pause?: { reason?: string; instruction?: string; question?: { id?: string; text?: string } } | null
  error?: string | null
  errorCode?: 'ANSWER_REQUIRES_USER' | 'AMBIGUOUS_FIELD' | 'FIELD_NOT_FOUND' | 'MANUAL_REQUIRED' | 'SUBMISSION_TIMEOUT' | 'SUBMISSION_FAILED' | null
  events?: Array<{ message: string; createdAt: string }>
  createdAt: string
  updatedAt: string
  assistedSession?: {
    id: string
    status: 'PREPARING' | 'FILLING' | 'WAITING_FOR_USER' | 'USER_REVIEWING' | 'SUBMITTING' | 'VERIFYING' | 'SUBMITTED' | 'MANUAL_REQUIRED' | 'FAILED' | 'EXPIRED' | 'CANCELLED'
    reason: string
    createdAt: string
    lastActivityAt: string
  } | null
}

export function runStrategy(run: AutomationRun | null): ApplicationStrategy | null {
  if (!run) return null
  return run.application?.strategy || run.strategy || null
}
