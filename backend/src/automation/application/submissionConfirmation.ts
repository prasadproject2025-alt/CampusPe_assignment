import type { Page } from 'playwright-core'
import type { Blocker, JobBoardAdapter } from '../types.js'
import { ManualRequiredError, SubmissionTimeoutError } from './fieldResolution.js'

export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 20_000

export const ATS_CONFIRMATION_PATTERN = /thank you for (?:your )?(?:applying|application)|application (?:has been|was|is) (?:successfully )?submitted|we(?:'|’)ve received your application|your application has been (?:submitted|received|sent)|application received|successfully submitted your application/i

const CHALLENGE_SELECTOR = [
  'iframe[src*="recaptcha/api2/bframe"]',
  'iframe[src*="recaptcha/enterprise/bframe"]',
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[title*="captcha" i]',
  'iframe[title*="Cloudflare security challenge"]',
  '.cf-turnstile',
  '[data-hcaptcha-widget-id]',
].join(', ')

export function atsConfirmationLocator(page: Page) {
  return page.getByText(ATS_CONFIRMATION_PATTERN)
}

export async function atsConfirmationDetected(page: Page) {
  if (await atsConfirmationLocator(page).first().isVisible().catch(() => false)) return true
  const marked = page.locator('[data-qa="application-confirmation"], .application-confirmation, [data-ui="application-submitted"]')
  if (await marked.first().isVisible().catch(() => false)) return true
  try {
    const path = new URL(page.url()).pathname
    if (/\/(thank-?you|thanks|application-submitted)(\/|$)/i.test(path) && !/\/apply\b/i.test(path)) return true
  } catch {
    return false
  }
  return false
}

export async function detectManualBlocker(page: Page, adapter: JobBoardAdapter): Promise<Blocker | null> {
  const fromAdapter = await adapter.detectBlocker(page)
  if (fromAdapter) {
    // Normalize challenge type if adapter didn't provide it
    if (fromAdapter.type === 'CAPTCHA' && !fromAdapter.challengeType) {
      const challenges = page.locator(CHALLENGE_SELECTOR)
      for (let index = 0; index < await challenges.count().catch(() => 0); index += 1) {
        if (await challenges.nth(index).isVisible().catch(() => false)) {
          const src = await challenges.nth(index).getAttribute('src').catch(() => null)
          if (src && src.includes('hcaptcha')) {
            return { ...fromAdapter, challengeType: 'hcaptcha' }
          } else if (src && src.includes('recaptcha')) {
            return { ...fromAdapter, challengeType: 'recaptcha' }
          } else if (src && (src.includes('turnstile') || src.includes('cloudflare'))) {
            return { ...fromAdapter, challengeType: 'turnstile' }
          }
          return { ...fromAdapter, challengeType: 'unknown' }
        }
      }
    }
    return fromAdapter
  }
  const challenges = page.locator(CHALLENGE_SELECTOR)
  for (let index = 0; index < await challenges.count().catch(() => 0); index += 1) {
    if (await challenges.nth(index).isVisible().catch(() => false)) {
      const src = await challenges.nth(index).getAttribute('src').catch(() => null)
      let challengeType: 'recaptcha' | 'hcaptcha' | 'turnstile' | 'unknown' = 'unknown'
      if (src && src.includes('hcaptcha')) challengeType = 'hcaptcha'
      else if (src && src.includes('recaptcha')) challengeType = 'recaptcha'
      else if (src && (src.includes('turnstile') || src.includes('cloudflare'))) challengeType = 'turnstile'
      return { type: 'CAPTCHA', message: 'CAPTCHA or anti-bot challenge is blocking submission. JobCopilot will not bypass it.', challengeType, provider: adapter.id }
    }
  }
  const heading = page.getByRole('heading', { name: /^(sign in|log in|log into|create an account)$/i }).first()
  const applicationControl = page.locator('form input:not([type="hidden"]):not([type="submit"]), form textarea, form select').first()
  if (await heading.isVisible().catch(() => false) && !await applicationControl.isVisible().catch(() => false)) {
    return { type: 'LOGIN', message: 'Sign in on the employer site is required. JobCopilot will not continue past a login wall.', provider: adapter.id }
  }
  return null
}

export async function waitForAtsConfirmation(page: Page, options: {
  timeoutMs?: number
  detectBlocker?: () => Promise<Blocker | null>
} = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const blocker = options.detectBlocker ? await options.detectBlocker() : null
    if (blocker) throw new ManualRequiredError(blocker)
    if (await atsConfirmationDetected(page)) return
    await page.waitForTimeout(250)
  }
  if (await atsConfirmationDetected(page)) return
  throw new SubmissionTimeoutError()
}
