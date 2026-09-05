import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'
import { detectAdapter } from '../registry.js'
import { dispatchPreviewInput, startRunPreview, stopRunPreview, type PreviewInput } from '../preview.js'
import type { JobBoardAdapter } from '../types.js'
import { atsConfirmationDetected, DEFAULT_CONFIRMATION_TIMEOUT_MS, detectManualBlocker } from './submissionConfirmation.js'
import { fillReviewedApplicationOnPage } from './submission.js'
import type { ApplicationField } from './types.js'

export type AssistedSessionStatus =
  | 'PREPARING'
  | 'FILLING'
  | 'WAITING_FOR_USER'
  | 'USER_REVIEWING'
  | 'SUBMITTING'
  | 'VERIFYING'
  | 'SUBMITTED'
  | 'MANUAL_REQUIRED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED'

export type AssistedSessionSnapshot = {
  id: string
  userId: string
  runId: string
  jobUrl: string
  status: AssistedSessionStatus
  reason: string
  createdAt: string
  lastActivityAt: string
}

type AssistedSession = {
  id: string
  userId: string
  runId: string
  jobUrl: string
  allowedHosts: Set<string>
  browser: Browser
  context: BrowserContext
  page: Page
  adapter: JobBoardAdapter
  status: AssistedSessionStatus
  reason: string
  createdAt: number
  lastActivityAt: number
  confirmationDeadline: number | null
  watchTimer: ReturnType<typeof setInterval> | null
  inactivityMs: number
  confirmationTimeoutMs: number
  onChange?: (snapshot: AssistedSessionSnapshot) => void
}

export const DEFAULT_ASSISTED_INACTIVITY_MS = 10 * 60 * 1000

const CAPTCHA_REASON = 'Complete the CAPTCHA in the assisted browser, then submit the application. JobCopilot will continue monitoring the application.'
const LOGIN_REASON = 'Sign in in the assisted browser, then submit the application. JobCopilot will continue monitoring the application.'
const USER_SUBMIT_REASON = 'Submit the application in the assisted browser when you are ready. JobCopilot will not click Submit for you.'

const EXTRA_HOSTS = [
  'google.com', 'www.google.com', 'www.gstatic.com', 'gstatic.com',
  'recaptcha.net', 'www.recaptcha.net',
  'hcaptcha.com', 'newassets.hcaptcha.com',
  'challenges.cloudflare.com', 'cloudflare.com',
]

const sessions = new Map<string, AssistedSession>()
const sessionByRun = new Map<string, string>()

function snapshot(session: AssistedSession): AssistedSessionSnapshot {
  return {
    id: session.id,
    userId: session.userId,
    runId: session.runId,
    jobUrl: session.jobUrl,
    status: session.status,
    reason: session.reason,
    createdAt: new Date(session.createdAt).toISOString(),
    lastActivityAt: new Date(session.lastActivityAt).toISOString(),
  }
}

function emit(session: AssistedSession) {
  session.onChange?.(snapshot(session))
}

function allowedHostsFor(jobUrl: string) {
  const hosts = new Set(EXTRA_HOSTS)
  try {
    const host = new URL(jobUrl).hostname.toLowerCase()
    hosts.add(host)
    const parts = host.split('.')
    if (parts.length > 2) hosts.add(parts.slice(-2).join('.'))
  } catch { /* ignore */ }
  return hosts
}

function hostAllowed(session: AssistedSession, url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (session.allowedHosts.has(host)) return true
    for (const allowed of session.allowedHosts) {
      if (host === allowed || host.endsWith(`.${allowed}`)) return true
    }
    return false
  } catch {
    return false
  }
}

async function closeBrowser(session: AssistedSession) {
  if (session.watchTimer) {
    clearInterval(session.watchTimer)
    session.watchTimer = null
  }
  await stopRunPreview(session.runId)
  await session.page.close().catch(() => undefined)
  await session.context.close().catch(() => undefined)
  await session.browser.close().catch(() => undefined)
}

export async function closeAssistedSession(sessionId: string, status: AssistedSessionStatus, reason: string) {
  const session = sessions.get(sessionId)
  if (!session) return null
  session.status = status
  session.reason = reason
  const view = snapshot(session)
  sessions.delete(sessionId)
  if (sessionByRun.get(session.runId) === sessionId) sessionByRun.delete(session.runId)
  emit(session)
  await closeBrowser(session)
  return view
}

export function getAssistedSession(userId: string, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session || session.userId !== userId) return null
  return snapshot(session)
}

export function getAssistedSessionForRun(userId: string, runId: string) {
  const sessionId = sessionByRun.get(runId)
  if (!sessionId) return null
  return getAssistedSession(userId, sessionId)
}

export function assistedSessionExists(runId: string) {
  return sessionByRun.has(runId)
}

function requireOwnedSession(userId: string, sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session || session.userId !== userId) throw new Error('Assisted browser session not found.')
  return session
}

export function touchAssistedSession(userId: string, runId: string) {
  const sessionId = sessionByRun.get(runId)
  if (!sessionId) return
  const session = sessions.get(sessionId)
  if (!session || session.userId !== userId) return
  session.lastActivityAt = Date.now()
}

async function installSubmitProbe(page: Page) {
  await page.evaluate(`(() => {
    if (window.__jobcopilotSubmitProbe) return;
    window.__jobcopilotSubmitProbe = true;
    window.__jobcopilotUserSubmit = false;
    document.addEventListener('click', function (event) {
      var node = event.target;
      if (!node || !node.closest) return;
      var control = node.closest('button, input[type="submit"], [role="button"]');
      if (!control) return;
      var text = ((control.innerText || control.value || control.getAttribute('aria-label') || '') + '').toLowerCase();
      if (/submit|apply|send application/.test(text)) window.__jobcopilotUserSubmit = true;
    }, true);
  })()`).catch(() => undefined)
}

async function userClickedSubmit(page: Page) {
  return Boolean(await page.evaluate(`Boolean(window.__jobcopilotUserSubmit)`).catch(() => false))
}

async function watchTick(session: AssistedSession) {
  if (session.page.isClosed() || !session.browser.isConnected()) {
    await closeAssistedSession(session.id, 'FAILED', 'The assisted browser session crashed. Start a new assisted session to continue.')
    return
  }
  if (Date.now() - session.lastActivityAt >= session.inactivityMs) {
    await closeAssistedSession(session.id, 'EXPIRED', 'The assisted browser session expired after inactivity.')
    return
  }
  if (await atsConfirmationDetected(session.page)) {
    await closeAssistedSession(session.id, 'SUBMITTED', 'The job board confirmed the application was submitted.')
    return
  }
  const blocker = await detectManualBlocker(session.page, session.adapter).catch(() => null)
  if (blocker && session.status !== 'MANUAL_REQUIRED' && session.status !== 'VERIFYING' && session.status !== 'SUBMITTED') {
    session.status = 'MANUAL_REQUIRED'
    session.reason = blocker.type === 'CAPTCHA' ? CAPTCHA_REASON : LOGIN_REASON
    emit(session)
  }
  const clicked = await userClickedSubmit(session.page)
  if (clicked && session.status !== 'VERIFYING' && session.status !== 'SUBMITTED') {
    session.status = 'VERIFYING'
    session.reason = 'Verifying submission. JobCopilot needs a real confirmation from the employer site.'
    session.confirmationDeadline = Date.now() + session.confirmationTimeoutMs
    emit(session)
  }
  if (session.confirmationDeadline && Date.now() >= session.confirmationDeadline && !await atsConfirmationDetected(session.page)) {
    session.status = 'MANUAL_REQUIRED'
    session.reason = 'SUBMISSION_TIMEOUT: The employer site did not confirm submission. Clicking Submit is not enough. Complete any remaining steps in the assisted browser.'
    session.confirmationDeadline = null
    emit(session)
  }
}

function startWatch(session: AssistedSession) {
  if (session.watchTimer) clearInterval(session.watchTimer)
  session.watchTimer = setInterval(() => { void watchTick(session).catch(() => undefined) }, 400)
}

export async function dispatchAssistedInput(userId: string, runId: string, input: PreviewInput) {
  const sessionId = sessionByRun.get(runId)
  if (!sessionId) throw new Error('The assisted browser session is no longer active.')
  const session = requireOwnedSession(userId, sessionId)
  if (!['WAITING_FOR_USER', 'USER_REVIEWING', 'MANUAL_REQUIRED', 'SUBMITTING', 'VERIFYING'].includes(session.status)) {
    throw new Error('Wait until the assisted browser is ready before interacting with the live page.')
  }
  session.lastActivityAt = Date.now()
  await dispatchPreviewInput(runId, input)
}

export async function cancelAssistedSession(userId: string, runId: string) {
  const sessionId = sessionByRun.get(runId)
  if (!sessionId) return null
  requireOwnedSession(userId, sessionId)
  return closeAssistedSession(sessionId, 'CANCELLED', 'The assisted browser session was cancelled.')
}

export async function expireInactiveAssistedSessions(now = Date.now()) {
  for (const session of [...sessions.values()]) {
    if (now - session.lastActivityAt < session.inactivityMs) continue
    await closeAssistedSession(session.id, 'EXPIRED', 'The assisted browser session expired after inactivity.')
  }
}

export async function resetAssistedSessionsForTests() {
  for (const session of [...sessions.values()]) {
    await closeAssistedSession(session.id, 'CANCELLED', 'test cleanup')
  }
}

export async function crashAssistedBrowserForTests(runId: string) {
  const sessionId = sessionByRun.get(runId)
  const session = sessionId ? sessions.get(sessionId) : undefined
  if (!session) throw new Error('Assisted browser session not found.')
  await session.browser.close()
}

export async function startAssistedSession(params: {
  userId: string
  runId: string
  jobUrl: string
  fields: ApplicationField[]
  adapter?: JobBoardAdapter
  inactivityMs?: number
  confirmationTimeoutMs?: number
  openPage?: (page: Page) => Promise<void>
  onChange?: (snapshot: AssistedSessionSnapshot) => void
}): Promise<AssistedSessionSnapshot> {
  const existingId = sessionByRun.get(params.runId)
  if (existingId) {
    const existing = sessions.get(existingId)
    if (existing && existing.userId === params.userId) return snapshot(existing)
    if (existing) throw new Error('Assisted browser session not found.')
  }
  const adapter = params.adapter || detectAdapter(params.jobUrl)
  if (!adapter) throw new Error('The job-board adapter is unavailable.')

  return runWithBrowserPermit('submit', async () => {
    const { browser, context } = await launchHeadlessAutomationBrowser()
    const page = await context.newPage()
    const session: AssistedSession = {
      id: randomUUID(),
      userId: params.userId,
      runId: params.runId,
      jobUrl: params.jobUrl,
      allowedHosts: allowedHostsFor(params.jobUrl),
      browser,
      context,
      page,
      adapter,
      status: 'PREPARING',
      reason: 'Preparing the assisted browser session.',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      confirmationDeadline: null,
      watchTimer: null,
      inactivityMs: params.inactivityMs ?? DEFAULT_ASSISTED_INACTIVITY_MS,
      confirmationTimeoutMs: params.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS,
      onChange: params.onChange,
    }
    sessions.set(session.id, session)
    sessionByRun.set(params.runId, session.id)
    browser.on('disconnected', () => {
      if (!sessions.has(session.id)) return
      void closeAssistedSession(session.id, 'FAILED', 'The assisted browser session crashed. Start a new assisted session to continue.')
    })
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      const url = frame.url()
      if (url && url !== 'about:blank' && !hostAllowed(session, url)) {
        session.status = 'MANUAL_REQUIRED'
        session.reason = 'The assisted browser stayed on the employer application flow. Unexpected destinations are not opened as a public browser.'
        emit(session)
      }
    })
    emit(session)
    try {
      await startRunPreview(params.runId, page)
      session.status = 'FILLING'
      session.reason = 'Filling safe answers in the assisted browser.'
      emit(session)
      if (params.openPage) await params.openPage(page)
      else {
        await adapter.openApplication(page, params.jobUrl)
        await adapter.waitForApplication(page)
      }
      const filled = await fillReviewedApplicationOnPage({
        adapter,
        page,
        userId: params.userId,
        jobUrl: params.jobUrl,
        fields: params.fields,
      })
      await installSubmitProbe(page)
      session.lastActivityAt = Date.now()
      if (!filled.ok && filled.code === 'MANUAL_REQUIRED') {
        session.status = 'MANUAL_REQUIRED'
        session.reason = filled.blocker.type === 'CAPTCHA' ? CAPTCHA_REASON : LOGIN_REASON
        emit(session)
        startWatch(session)
        return snapshot(session)
      }
      if (!filled.ok && (filled.code === 'ANSWER_REQUIRES_USER' || filled.code === 'AMBIGUOUS_FIELD' || filled.code === 'FIELD_NOT_FOUND')) {
        session.status = 'WAITING_FOR_USER'
        session.reason = `${filled.error} Complete it in the assisted browser, then submit the application.`
        emit(session)
        startWatch(session)
        return snapshot(session)
      }
      if (!filled.ok) {
        session.status = 'MANUAL_REQUIRED'
        session.reason = filled.error
        emit(session)
        startWatch(session)
        return snapshot(session)
      }
      session.status = 'USER_REVIEWING'
      session.reason = USER_SUBMIT_REASON
      emit(session)
      startWatch(session)
      return snapshot(session)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The assisted browser session failed.'
      await closeAssistedSession(session.id, 'FAILED', message)
      throw error
    }
  })
}
