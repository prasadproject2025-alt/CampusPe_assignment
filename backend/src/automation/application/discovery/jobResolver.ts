import { detectAdapter } from '../../registry.js'
import { parseAshbyJobUrl } from '../ashbyForm.js'
import { parseGreenhouseJobUrl } from '../greenhouseForm.js'

export type DiscoveredJob = {
  ats: string
  company: string
  jobId: string
  jobTitle: string
  jobUrl: string
  applicationUrl: string
  isApplicationPage: boolean
}

export function detectAts(jobUrl: string) {
  const adapter = detectAdapter(jobUrl)
  if (!adapter) return null
  return { ats: adapter.id, adapter }
}

export function resolveJob(jobUrl: string): DiscoveredJob | null {
  const detected = detectAts(jobUrl)
  if (!detected) return null
  const url = new URL(jobUrl)
  const applicationUrl = detected.adapter.applicationUrl(url).toString()
  if (detected.ats === 'ashby') {
    const parsed = parseAshbyJobUrl(jobUrl)
    return {
      ats: 'ashby',
      company: parsed?.board || '',
      jobId: parsed?.jobId || '',
      jobTitle: '',
      jobUrl,
      applicationUrl,
      isApplicationPage: /\/application\/?$/i.test(url.pathname),
    }
  }
  if (detected.ats === 'greenhouse') {
    const parsed = parseGreenhouseJobUrl(jobUrl)
    return {
      ats: 'greenhouse',
      company: parsed?.board || '',
      jobId: parsed?.jobId || '',
      jobTitle: '',
      jobUrl,
      applicationUrl,
      isApplicationPage: true,
    }
  }
  if (detected.ats === 'workable') {
    const parts = url.pathname.split('/').filter(Boolean)
    return {
      ats: 'workable',
      company: parts[0] || '',
      jobId: parts[2] || '',
      jobTitle: '',
      jobUrl,
      applicationUrl,
      isApplicationPage: /\/apply\/?$/i.test(url.pathname),
    }
  }
  const parts = url.pathname.split('/').filter(Boolean)
  return {
    ats: detected.ats,
    company: parts[0] || detected.ats,
    jobId: parts.find((part) => /[0-9a-f-]{8,}/i.test(part)) || parts.at(-1) || '',
    jobTitle: '',
    jobUrl,
    applicationUrl,
    isApplicationPage: /apply|application/i.test(url.pathname),
  }
}
