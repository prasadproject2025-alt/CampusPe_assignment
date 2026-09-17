import type { Page } from 'playwright-core'
import type { Blocker, JobBoardAdapter } from '../types.js'
import { ManualRequiredError, SubmissionTimeoutError, AtsRejectionError, isEmployerSpamRejection, AnswerRequiresUserError } from './fieldResolution.js'

export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 20_000

export const ATS_CONFIRMATION_PATTERN = /thank you for (?:your )?(?:applying|application)|application (?:has been|was|is) (?:successfully )?submitted|we(?:'|’)ve received your application|your application has been (?:submitted|received|sent)|application received|successfully submitted your application/i

export const ATS_REJECTION_PATTERN = /flagged as possible spam|couldn['’]t submit your application|we couldn['’]t submit your application|your application submission was flagged/i

const CHALLENGE_SELECTOR = [
  'iframe[src*="recaptcha/api2/bframe"]',
  'iframe[src*="recaptcha/enterprise/bframe"]',
  'iframe[src*="hcaptcha.com"][src*="frame=challenge"]',
  'iframe[title*="hCaptcha security challenge" i]',
  'iframe[title*="Main content of the hCaptcha challenge" i]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[title*="Cloudflare security challenge"]',
  '.cf-turnstile',
].join(', ')

// Dormant hCaptcha anchor frames are NOT active challenges.
// They are loaded on every page with hCaptcha but only become blocking
// when the user triggers hcaptcha.execute() and a visible challenge modal opens.
export function isPassiveHcaptchaAnchor(src: string | null) {
  if (!src) return false
  try {
    const url = new URL(src)
    if (!/(^|\.)(hcaptcha\.com)$/.test(url.hostname)) return false
    // The challenge frame has frame=challenge in the URL; anchor frames don't
    if (url.searchParams.get('frame') === 'challenge') return false
    return true
  } catch { return false }
}

// The visible logo for invisible reCAPTCHA is not an interactive challenge.
// Leave it intact; the employer still runs reCAPTCHA on submit and may display
// a bframe challenge, which must pause the same session for the user.
export function isPassiveRecaptchaBadge(src: string | null) {
  if (!src) return false
  try {
    const url = new URL(src)
    return /(^|\.)(google\.com|recaptcha\.net)$/.test(url.hostname)
      && /^\/recaptcha\/(api2|enterprise)\/anchor$/.test(url.pathname)
      && url.searchParams.get('size') === 'invisible'
  } catch { return false }
}

export function atsConfirmationLocator(page: Page) {
  return page.getByText(ATS_CONFIRMATION_PATTERN)
}

export async function atsSubmissionRejected(page: Page) {
  return atsRejectionLocator(page).first().isVisible().catch(() => false)
}

export async function atsRejectionMessage(page: Page) {
  const messages = atsRejectionLocator(page)
  const count = await messages.count().catch(() => 0)
  for (let index = 0; index < count; index++) {
    const message = messages.nth(index)
    if (await message.isVisible().catch(() => false)) {
      const text = await message.innerText().catch(() => '')
      if (isEmployerSpamRejection(text)) {
        return 'SUBMISSION_FAILED: The employer rejected this submission as possible spam. No successful application was confirmed. Automatic retries are disabled.'
      }
    }
  }
  return 'SUBMISSION_FAILED: The employer could not accept the application. Review the error shown in its form. No successful submission was confirmed.'
}

export function atsRejectionLocator(page: Page) {
  return page.getByText(ATS_REJECTION_PATTERN)
}

export async function atsConfirmationDetected(page: Page) {
  if (await atsSubmissionRejected(page)) return false
  if (await atsConfirmationLocator(page).first().isVisible().catch(() => false)) return true
  const marked = page.locator('[data-qa="application-confirmation"], .application-confirmation, [data-ui="application-submitted"]')
  if (await marked.first().isVisible().catch(() => false)) return true
  return false
}

import { hasValidCaptchaSolution, isCapSolverConfigured, solveCaptchaOnPage } from './capsolverService.js'

export async function detectManualBlocker(page: Page, adapter: JobBoardAdapter): Promise<Blocker | null> {
  // If page already has a valid injected or solved CAPTCHA token, it is not blocking
  if (await hasValidCaptchaSolution(page)) return null

  const fromAdapter = await adapter.detectBlocker(page)
  if (fromAdapter) {
    if (fromAdapter.type === 'CAPTCHA') {
      if (isCapSolverConfigured()) {
        console.log(`[SubmissionConfirmation] CAPTCHA detected from adapter (${adapter.id}). Attempting CapSolver auto-solve...`)
        const solved = await solveCaptchaOnPage(page).catch(() => ({ success: false }))
        if (solved.success && await hasValidCaptchaSolution(page)) {
          console.log('[SubmissionConfirmation] CapSolver solved CAPTCHA successfully!')
          return null
        }
      }
    }
    // Normalize challenge type if adapter didn't provide it
    if (fromAdapter.type === 'CAPTCHA' && !fromAdapter.challengeType) {
      const challenges = page.locator(CHALLENGE_SELECTOR)
      for (let index = 0; index < await challenges.count().catch(() => 0); index += 1) {
        if (await challenges.nth(index).isVisible().catch(() => false)) {
          const src = await challenges.nth(index).getAttribute('src').catch(() => null)
          if (isPassiveRecaptchaBadge(src)) continue
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
      if (isPassiveRecaptchaBadge(src)) continue
      if (isPassiveHcaptchaAnchor(src)) continue

      if (isCapSolverConfigured()) {
        console.log(`[SubmissionConfirmation] CAPTCHA challenge detected on page. Attempting CapSolver auto-solve...`)
        const solved = await solveCaptchaOnPage(page).catch(() => ({ success: false }))
        if (solved.success && await hasValidCaptchaSolution(page)) {
          console.log('[SubmissionConfirmation] CapSolver solved CAPTCHA successfully!')
          return null
        }
      }

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

export async function visibleSubmissionValidationError(page: Page): Promise<string | null> {
  return page.evaluate(`(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    for (const element of document.querySelectorAll('form input:invalid, form select:invalid, form textarea:invalid, [aria-invalid="true"]')) {
      if (!visible(element)) continue
      const input = element
      const description = (element.getAttribute('aria-describedby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim()
      const label = input.labels?.[0]?.textContent?.trim() || element.getAttribute('aria-label') || input.name || 'Required field'
      return (label + ': ' + (description || input.validationMessage || 'Check this answer in the employer form.')).slice(0, 500)
    }
    for (const element of document.querySelectorAll('[role="alert"], .field-error, .invalid-feedback, [data-testid="error-message"]')) {
      const text = element.textContent?.trim() || ''
      if (visible(element) && /required|invalid|please (?:enter|select|provide)|must (?:be|select|enter)|upload.*(?:failed|error)/i.test(text)) return text.slice(0, 500)
    }
    return null
  })()` )
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
    if (await atsSubmissionRejected(page)) throw new AtsRejectionError(await atsRejectionMessage(page))
    if (await atsConfirmationDetected(page)) return
    const validation = await visibleSubmissionValidationError(page)
    if (validation) throw new AnswerRequiresUserError('Employer validation', `ANSWER_REQUIRES_USER: ${validation}`)
    await page.waitForTimeout(250)
  }
  if (await atsConfirmationDetected(page)) return
  if (await atsSubmissionRejected(page)) throw new AtsRejectionError(await atsRejectionMessage(page))
  throw new SubmissionTimeoutError('No employer confirmation arrived within the verification window. The outcome is unknown; do not submit again while the same session is being checked.')
}
