import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { detectAdapter } from '../registry.js'
import type { JobBoardAdapter } from '../types.js'
import { captchaConfig } from '../../config.js'
import { detectManualBlocker, atsConfirmationDetected } from './submissionConfirmation.js'
import type { ApplicationField } from './types.js'

export type CaptchaSessionStage = 'FILLING' | 'PRE_SUBMIT' | 'POST_SUBMIT'

export type CaptchaSession = {
  id: string
  userId: string
  runId: string
  jobUrl: string
  adapter: JobBoardAdapter
  browser: Browser
  context: BrowserContext
  page: Page
  fields: ApplicationField[]
  stage: CaptchaSessionStage
  submitAttempted: boolean
  submitAttemptCount: number
  createdAt: number
  expiresAt: number
  currentUrl: string
}

const activeCaptchaSessions = new Map<string, CaptchaSession>()
const sessionByRun = new Map<string, string>()
const captchaMonitoringIntervals = new Map<string, NodeJS.Timeout>()

export function getCaptchaSessionTimeout(): number {
  return captchaConfig.sessionTimeoutMs
}

export function getCaptchaMonitorInterval(): number {
  return captchaConfig.monitorIntervalMs
}

export function createCaptchaSession(params: {
  userId: string
  runId: string
  jobUrl: string
  adapter: JobBoardAdapter
  browser: Browser
  context: BrowserContext
  page: Page
  fields: ApplicationField[]
  stage: CaptchaSessionStage
  submitAttempted?: boolean
  submitAttemptCount?: number
}): CaptchaSession {
  const id = randomUUID()
  const now = Date.now()
  const session: CaptchaSession = {
    id,
    userId: params.userId,
    runId: params.runId,
    jobUrl: params.jobUrl,
    adapter: params.adapter,
    browser: params.browser,
    context: params.context,
    page: params.page,
    fields: params.fields,
    stage: params.stage,
    submitAttempted: params.submitAttempted || false,
    submitAttemptCount: params.submitAttemptCount || 0,
    createdAt: now,
    expiresAt: now + getCaptchaSessionTimeout(),
    currentUrl: params.page.url(),
  }
  activeCaptchaSessions.set(id, session)
  sessionByRun.set(params.runId, id)
  return session
}

export function getCaptchaSession(runId: string): CaptchaSession | null {
  const sessionId = sessionByRun.get(runId)
  return sessionId ? activeCaptchaSessions.get(sessionId) || null : null
}

export function getCaptchaSessionById(id: string): CaptchaSession | null {
  return activeCaptchaSessions.get(id) || null
}

export function hasActiveCaptchaSession(runId: string): boolean {
  return sessionByRun.has(runId)
}

export async function closeCaptchaSession(runId: string): Promise<void> {
  const sessionId = sessionByRun.get(runId)
  if (!sessionId) return
  
  const session = activeCaptchaSessions.get(sessionId)
  if (!session) {
    sessionByRun.delete(runId)
    return
  }
  
  // Stop monitoring for this session
  stopCaptchaMonitoring(runId)
  
  activeCaptchaSessions.delete(sessionId)
  sessionByRun.delete(runId)
  
  // Note: We do NOT close the browser here - it's preserved for the user
  // The browser will be closed when the session expires or explicitly cleaned up
}

export async function checkCaptchaCleared(runId: string): Promise<boolean> {
  const session = getCaptchaSession(runId)
  if (!session) return false
  
  if (Date.now() > session.expiresAt) {
    await closeCaptchaSession(runId)
    return false
  }
  
  if (session.page.isClosed() || !session.browser.isConnected()) {
    await closeCaptchaSession(runId)
    return false
  }
  
  const blocker = await detectManualBlocker(session.page, session.adapter)
  if (blocker && blocker.type === 'CAPTCHA') {
    return false // CAPTCHA still present
  }
  
  // CAPTCHA cleared
  return true
}

export async function waitForAtsConfirmationBrief(page: Page, timeoutMs: number = 5000): Promise<boolean> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    if (await atsConfirmationDetected(page)) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return false
}

export async function resumeAfterCaptcha(runId: string): Promise<{ success: boolean; reason?: string; nextStage?: CaptchaSessionStage }> {
  const session = getCaptchaSession(runId)
  if (!session) {
    return { success: false, reason: 'No active CAPTCHA session found' }
  }
  
  if (Date.now() > session.expiresAt) {
    await closeCaptchaSession(runId)
    return { success: false, reason: 'CAPTCHA session expired' }
  }
  
  if (session.page.isClosed() || !session.browser.isConnected()) {
    await closeCaptchaSession(runId)
    return { success: false, reason: 'Browser session closed' }
  }
  
  // Check if confirmation already appeared (post-submit CAPTCHA case)
  if (await atsConfirmationDetected(session.page)) {
    await closeCaptchaSession(runId)
    // Clean up browser
    await session.page.close().catch(() => undefined)
    await session.context.close().catch(() => undefined)
    await session.browser.close().catch(() => undefined)
    return { success: true, reason: 'ATS confirmation detected', nextStage: undefined }
  }
  
  // Stage-aware resume logic
  switch (session.stage) {
    case 'POST_SUBMIT':
      // POST_SUBMIT: CAPTCHA cleared but no confirmation yet
      // CRITICAL: Do NOT re-submit automatically. First check if original submission completed.
      const confirmationAlreadyReceived = await waitForAtsConfirmationBrief(session.page, 5000)
      if (confirmationAlreadyReceived) {
        await closeCaptchaSession(runId)
        await session.page.close().catch(() => undefined)
        await session.context.close().catch(() => undefined)
        await session.browser.close().catch(() => undefined)
        return { success: true, reason: 'ATS confirmation received after CAPTCHA clear', nextStage: undefined }
      }
      
      // No confirmation yet - check if form is still pending submit
      const submitButton = await session.adapter.isReviewReady(session.page)
      if (submitButton) {
        // Form still pending, but we already clicked submit once
        // Don't automatically retry - let user decide to avoid duplicate submission
        await closeCaptchaSession(runId)
        return { success: true, reason: 'CAPTCHA cleared, form still pending submit (manual decision required to avoid duplicate)', nextStage: 'POST_SUBMIT' }
      } else {
        // Form no longer pending - likely already submitted, waiting for confirmation
        await closeCaptchaSession(runId)
        return { success: true, reason: 'CAPTCHA cleared, form state changed (submission likely completed, waiting for confirmation)', nextStage: 'POST_SUBMIT' }
      }
    
    case 'PRE_SUBMIT':
      // PRE_SUBMIT: Re-run validation before submit
      try {
        const isReady = await session.adapter.isReviewReady(session.page)
        if (!isReady) {
          await closeCaptchaSession(runId)
          return { success: false, reason: 'Form not ready for submit after CAPTCHA clear (validation failed)' }
        }
        // Ready to continue to submit
        await closeCaptchaSession(runId)
        return { success: true, reason: 'CAPTCHA cleared, validation passed, ready for submit', nextStage: 'PRE_SUBMIT' }
      } catch (error) {
        await closeCaptchaSession(runId)
        return { success: false, reason: `Validation error after CAPTCHA clear: ${error instanceof Error ? error.message : String(error)}` }
      }
    
    case 'FILLING':
      // FILLING: Reconcile live form and continue
      // For now, preserve the session - actual field reconciliation would require
      // re-extracting form state and comparing with saved fields
      // This is handled by the manager's resume logic which will re-run the fill process
      await closeCaptchaSession(runId)
      return { success: true, reason: 'CAPTCHA cleared, ready to continue filling fields', nextStage: 'FILLING' }
    
    default:
      await closeCaptchaSession(runId)
      return { success: false, reason: `Unknown CAPTCHA session stage: ${session.stage}` }
  }
}

export async function startCaptchaMonitoring(runId: string, onCleared: () => void): Promise<void> {
  const session = getCaptchaSession(runId)
  if (!session) return
  
  // Clear any existing monitoring for this run
  stopCaptchaMonitoring(runId)
  
  const interval = setInterval(async () => {
    try {
      const cleared = await checkCaptchaCleared(runId)
      if (cleared) {
        stopCaptchaMonitoring(runId)
        onCleared()
      }
    } catch (error) {
      console.error(`CAPTCHA monitoring error for run ${runId}:`, error)
      stopCaptchaMonitoring(runId)
    }
  }, getCaptchaMonitorInterval())
  
  captchaMonitoringIntervals.set(runId, interval)
}

export function stopCaptchaMonitoring(runId: string): void {
  const interval = captchaMonitoringIntervals.get(runId)
  if (interval) {
    clearInterval(interval)
    captchaMonitoringIntervals.delete(runId)
  }
}

export async function cleanupExpiredCaptchaSessions(): Promise<void> {
  const now = Date.now()
  for (const [id, session] of activeCaptchaSessions.entries()) {
    if (now > session.expiresAt) {
      stopCaptchaMonitoring(session.runId)
      await session.page.close().catch(() => undefined)
      await session.context.close().catch(() => undefined)
      await session.browser.close().catch(() => undefined)
      activeCaptchaSessions.delete(id)
      sessionByRun.delete(session.runId)
    }
  }
}

export function getCaptchaSessionInfo(runId: string): {
  id: string
  userId: string
  runId: string
  jobUrl: string
  stage: CaptchaSessionStage
  submitAttempted: boolean
  submitAttemptCount: number
  expiresAt: number
  currentUrl: string
  provider: string
} | null {
  const session = getCaptchaSession(runId)
  if (!session) return null
  
  return {
    id: session.id,
    userId: session.userId,
    runId: session.runId,
    jobUrl: session.jobUrl,
    stage: session.stage,
    submitAttempted: session.submitAttempted,
    submitAttemptCount: session.submitAttemptCount,
    expiresAt: session.expiresAt,
    currentUrl: session.currentUrl,
    provider: session.adapter.id,
  }
}
