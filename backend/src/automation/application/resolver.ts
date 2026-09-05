import type { AdapterQuestion, JobDetails } from '../types.js'
import type { ApplicationField, ApplicationSection } from './types.js'

export type ManualRequired = { reason: string; code: 'CAPTCHA' | 'LOGIN' | 'UNSUPPORTED' }

export type ExtractedApplication = {
  board: string
  jobId: string
  embedUrl: string | null
  job: JobDetails
  fields: ApplicationField[]
  sections: ApplicationSection[]
  schemaComplete: boolean
  schemaSource: 'public_api' | 'headless_extract'
  questions: AdapterQuestion[]
  manualRequired?: ManualRequired
}

export function detectApplicationBoard(url: string) {
  return import('../registry.js').then((module) => module.detectAdapter(url))
}
