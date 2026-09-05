import type { ApplicationCapabilities, ApplicationStrategy } from './types.js'

export type ExtractMode = 'http' | 'server_browser' | 'none'
export type SubmitMode = 'official_api' | 'server_browser' | 'manual'

export type PipelineCapability = {
  EXTRACT_SUPPORTED: boolean
  FILL_SUPPORTED: boolean
  VALIDATION_SUPPORTED: boolean
  SUBMIT_SUPPORTED: boolean
  SUBMISSION_VERIFIED: boolean
}

const unprovenSubmit: PipelineCapability = {
  EXTRACT_SUPPORTED: true,
  FILL_SUPPORTED: true,
  VALIDATION_SUPPORTED: true,
  SUBMIT_SUPPORTED: false,
  SUBMISSION_VERIFIED: false,
}

export type BoardCapability = ApplicationCapabilities & {
  extractMode: ExtractMode
  submitMode: SubmitMode
  displayStrategy: ApplicationStrategy
}

const nativeHttp = (board: string, extra: Partial<BoardCapability>): BoardCapability => ({
  supportsEmbed: false,
  supportsCustomForm: true,
  supportsBrowserAutomation: true,
  preferredStrategy: 'CUSTOM_FORM',
  displayStrategy: 'CUSTOM_FORM',
  schemaSource: 'public_api',
  extractMode: 'http',
  submitMode: 'server_browser',
  embedReason: `${board} hosted apply pages are not iframed by JobCopilot.`,
  customFormReason: `${board} application questions are loaded into a native React form. Playwright is not used until submit.`,
  browserReason: 'Server-side chrome-headless-shell is used only to submit reviewed answers. No Chrome window is shown.',
  ...extra,
})

const nativeHeadlessExtract = (board: string, extra: Partial<BoardCapability> = {}): BoardCapability => ({
  supportsEmbed: false,
  supportsCustomForm: true,
  supportsBrowserAutomation: true,
  preferredStrategy: 'CUSTOM_FORM',
  displayStrategy: 'CUSTOM_FORM',
  schemaSource: 'headless_extract',
  extractMode: 'server_browser',
  submitMode: 'server_browser',
  embedReason: `${board} does not publish an official in-page application embed that JobCopilot can legally iframe.`,
  customFormReason: `${board} does not expose a candidate-facing application-form API. Schema is extracted with a disposable backend browser, then closed. The UI is a React form, not a browser preview.`,
  browserReason: 'A disposable chrome-headless-shell worker extracts fields and later submits. Google Chrome is never launched.',
  ...extra,
})

const capabilitiesByBoard: Record<string, BoardCapability> = {
  greenhouse: nativeHttp('Greenhouse', {
    supportsEmbed: true,
    embedReason: 'Greenhouse publishes an official Embedded Job Application. It is cross-origin, so JobCopilot only uses it if the public questions API is unavailable.',
    customFormReason: 'The public Job Board API returns application questions without an API key. Candidate POST requires an employer key, so submit uses headless Playwright.',
  }),
  ashby: nativeHttp('Ashby', {
    embedReason: 'Ashby hosted apply pages send X-Frame-Options: DENY. JobCopilot does not iframe jobs.ashbyhq.com.',
    customFormReason: 'Ashby hosted GraphQL returns applicationForm.sections and surveyForms. Playwright is used only if the user submits.',
  }),
  lever: nativeHeadlessExtract('Lever'),
  breezy: nativeHeadlessExtract('Breezy'),
  bamboohr: nativeHeadlessExtract('BambooHR'),
  rippling: nativeHeadlessExtract('Rippling'),
  workable: nativeHeadlessExtract('Workable'),
  recruitee: nativeHeadlessExtract('Recruitee'),
}

export function boardCapabilities(board: string): BoardCapability {
  return capabilitiesByBoard[board] || nativeHeadlessExtract(board || 'This board')
}

export function capabilitiesForBoard(board: string): ApplicationCapabilities {
  return boardCapabilities(board)
}

export function resolveApplicationStrategy(board: string, _jobUrl?: string): {
  strategy: ApplicationStrategy
  capabilities: ApplicationCapabilities
} {
  const capabilities = boardCapabilities(board)
  return { strategy: capabilities.displayStrategy, capabilities }
}

export function canProgrammaticallySubmit(strategy: ApplicationStrategy) {
  return strategy !== 'EMBED' && strategy !== 'MANUAL_REQUIRED'
}

export function shouldLaunchBrowserForStrategy(_strategy: ApplicationStrategy) {
  return false
}

export function extractRequiresBrowser(board: string) {
  return boardCapabilities(board).extractMode === 'server_browser'
}

export function submitRequiresBrowser(board: string) {
  return boardCapabilities(board).submitMode === 'server_browser'
}

export function supportedStrategyBoards() {
  return Object.keys(capabilitiesByBoard)
}

export function pipelineCapabilityForBoard(_board: string): PipelineCapability {
  return unprovenSubmit
}
