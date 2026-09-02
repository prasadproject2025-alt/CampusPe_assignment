import { AshbyAdapter } from './adapters/ashby/index.js'
import { BambooHrAdapter } from './adapters/bamboohr/index.js'
import { BreezyAdapter } from './adapters/breezy/index.js'
import { GreenhouseAdapter } from './adapters/greenhouse/index.js'
import { LeverAdapter } from './adapters/lever/index.js'
import { RipplingAdapter } from './adapters/rippling/index.js'
import { RecruiteeAdapter } from './adapters/recruitee/index.js'
import { WorkableAdapter } from './adapters/workable/index.js'
import type { JobBoardAdapter } from './types.js'

const adapters: JobBoardAdapter[] = [new AshbyAdapter(), new GreenhouseAdapter(), new RipplingAdapter(), new BreezyAdapter(), new LeverAdapter(), new WorkableAdapter(), new BambooHrAdapter(), new RecruiteeAdapter()]

export function canonicalJobUrl(value: string) {
  const url = new URL(value)
  const greenhouseJobId = url.hostname.toLowerCase() === 'www.bamboohr.com' && /^\/careers\/application\/?$/i.test(url.pathname)
    ? url.searchParams.get('gh_jid')
    : null
  return greenhouseJobId && /^\d+$/.test(greenhouseJobId)
    ? `https://job-boards.greenhouse.io/bamboohr17/jobs/${greenhouseJobId}`
    : url.toString()
}

export function detectAdapter(value: string) {
  const url = new URL(canonicalJobUrl(value))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS job links are supported.')
  return adapters.find((adapter) => adapter.supports(url)) ?? null
}

export function supportedBoards() { return adapters.map((adapter) => adapter.id) }
