import type { FieldType } from '../../resolver/types.js'
import type { AdapterQuestion } from '../types.js'

export type ApplicationStrategy = 'EMBED' | 'CUSTOM_FORM' | 'BROWSER_AUTOMATION' | 'NATIVE_FORM' | 'OFFICIAL_API' | 'SERVER_BROWSER_AUTOMATION' | 'MANUAL_REQUIRED'

export type ApplicationFieldStatus = 'empty' | 'suggested' | 'accepted' | 'manual' | 'unresolved' | 'skipped'

export type ApplicationField = {
  id: string
  path?: string
  text: string
  description?: string
  fieldType: FieldType
  inputType?: string
  required: boolean
  options?: string[]
  section?: string
  isHidden?: boolean
  isMany?: boolean
  dependsOn?: { fieldId: string; values: string[] }
  placeholder?: string
  locator?: AdapterQuestion['locator']
  value: string
  suggestion?: string
  source?: string
  confidence?: number
  status: ApplicationFieldStatus
  reason?: string
  raw?: Record<string, unknown>
}

export type ApplicationSection = {
  id: string
  title: string
  description?: string
}

export type ApplicationModel = {
  provider: string
  strategy: ApplicationStrategy
  jobId: string | null
  title: string
  company: string
  embedUrl: string | null
  fields: ApplicationField[]
  sections?: ApplicationSection[]
  schemaSource?: 'public_api' | 'headless_extract' | 'none'
  schemaStage?: 'API_DISCOVERED' | 'LIVE_DISCOVERED' | 'LIVE_VALIDATED'
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

export function emptyApplication(provider: string, strategy: ApplicationStrategy, reason: string, extras: Partial<ApplicationModel> = {}): ApplicationModel {
  return {
    provider,
    strategy,
    jobId: extras.jobId ?? null,
    title: extras.title || '',
    company: extras.company || '',
    embedUrl: extras.embedUrl ?? null,
    fields: extras.fields || [],
    sections: extras.sections || [],
    schemaSource: extras.schemaSource,
    schemaStage: extras.schemaStage,
    schemaComplete: extras.schemaComplete,
    schemaFieldCount: extras.schemaFieldCount ?? extras.fields?.length,
    reason,
    displayMode: extras.displayMode || (strategy === 'EMBED' ? 'official_embed' : strategy === 'BROWSER_AUTOMATION' ? 'browser_assisted' : 'native_form'),
  }
}
