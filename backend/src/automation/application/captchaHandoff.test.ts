import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCaptchaSession,
  getCaptchaSession,
  hasActiveCaptchaSession,
  closeCaptchaSession,
  checkCaptchaCleared,
  resumeAfterCaptcha,
  startCaptchaMonitoring,
  stopCaptchaMonitoring,
  cleanupExpiredCaptchaSessions,
  getCaptchaSessionInfo,
  type CaptchaSessionStage,
} from './captchaHandoff.js'
import { randomUUID } from 'node:crypto'
import type { Page, Browser, BrowserContext } from 'playwright-core'
import type { ApplicationField, ApplicationFieldStatus } from './types.js'
import type { FieldType } from '../../resolver/types.js'
import * as submissionConfirmation from './submissionConfirmation.js'

// Mock Playwright objects
const mockPage = {
  isClosed: () => false,
  url: () => 'https://example.com/apply',
  close: async () => {},
  getByText: () => ({
    first: () => ({
      isVisible: () => Promise.resolve(false),
    }),
  }),
  locator: () => ({
    first: () => ({
      isVisible: () => Promise.resolve(false),
    }),
  }),
} as unknown as Page

const mockContext = {
  close: async () => {},
} as unknown as BrowserContext

const mockBrowser = {
  isConnected: () => true,
  close: async () => {},
} as unknown as Browser

const mockAdapter = {
  id: 'test',
  supports: () => true,
  applicationUrl: () => new URL('https://example.com/apply'),
  openApplication: async () => {},
  waitForApplication: async () => {},
  extractJob: async () => ({ postingId: '123', url: 'https://example.com/apply' }),
  extractQuestions: async () => [],
  focusQuestion: async () => {},
  fillAnswer: async () => {},
  fillEducation: async () => {},
  uploadResume: async () => {},
  uploadFile: async () => {},
  detectBlocker: async () => null,
  isReviewReady: async () => true,
  submitApplication: async () => {},
} as any

test('createCaptchaSession creates and stores session', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })
  
  assert.ok(session.id)
  assert.equal(session.userId, userId)
  assert.equal(session.runId, runId)
  assert.equal(session.stage, 'PRE_SUBMIT')
  assert.equal(session.submitAttempted, false)
  assert.equal(session.submitAttemptCount, 0)
  assert.ok(hasActiveCaptchaSession(runId))
  
  const retrieved = getCaptchaSession(runId)
  assert.ok(retrieved)
  assert.equal(retrieved?.id, session.id)
  
  await closeCaptchaSession(runId)
  assert.ok(!hasActiveCaptchaSession(runId))
})

test('CAPTCHA session expiration handling', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  // Create session - it will use the default timeout from config
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })
  
  // Session should be active
  assert.ok(hasActiveCaptchaSession(runId))
  
  // Manually expire the session by setting expiresAt to past
  ;(session as any).expiresAt = Date.now() - 1000
  
  // checkCaptchaCleared should close expired session
  const cleared = await checkCaptchaCleared(runId)
  assert.equal(cleared, false)
  assert.ok(!hasActiveCaptchaSession(runId))
})

test('resumeAfterCaptcha FILLING stage', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'FILLING',
  })
  
  const result = await resumeAfterCaptcha(runId)
  
  assert.ok(result.success)
  assert.equal(result.nextStage, 'FILLING')
  assert.ok(result.reason?.includes('ready to continue filling'))
  
  await closeCaptchaSession(runId)
})

test('resumeAfterCaptcha with expired session', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })
  
  // Manually expire the session
  ;(session as any).expiresAt = Date.now() - 1000
  
  const result = await resumeAfterCaptcha(runId)
  
  assert.equal(result.success, false)
  assert.equal(result.reason, 'CAPTCHA session expired')
  
  // Session should be closed
  assert.ok(!hasActiveCaptchaSession(runId))
})

test('resumeAfterCaptcha with closed browser', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const closedPage = { ...mockPage, isClosed: () => true } as Page
  const closedBrowser = { ...mockBrowser, isConnected: () => false } as Browser
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: closedBrowser,
    context: mockContext,
    page: closedPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })
  
  const result = await resumeAfterCaptcha(runId)
  
  assert.equal(result.success, false)
  assert.equal(result.reason, 'Browser session closed')
  
  // Session should be closed
  assert.ok(!hasActiveCaptchaSession(runId))
})

test('startCaptchaMonitoring and stopCaptchaMonitoring', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })
  
  let callbackCount = 0
  const mockCallback = () => { callbackCount++ }
  
  // Start monitoring
  startCaptchaMonitoring(runId, mockCallback)
  
  // Wait a bit to ensure interval is running
  await new Promise(resolve => setTimeout(resolve, 100))
  
  // Stop monitoring
  stopCaptchaMonitoring(runId)
  
  // Wait to ensure interval is stopped
  await new Promise(resolve => setTimeout(resolve, 100))
  
  // Callback should not have been called (CAPTCHA not cleared in this test)
  assert.equal(callbackCount, 0)
  
  await closeCaptchaSession(runId)
})

test('CAPTCHA session stores browser/context/page for resume', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })
  
  assert.strictEqual(session.browser, mockBrowser)
  assert.strictEqual(session.context, mockContext)
  assert.strictEqual(session.page, mockPage)
  
  const retrieved = getCaptchaSession(runId)
  assert.strictEqual(retrieved?.browser, mockBrowser)
  assert.strictEqual(retrieved?.context, mockContext)
  assert.strictEqual(retrieved?.page, mockPage)
  
  await closeCaptchaSession(runId)
})

test('CAPTCHA session preserves submitAttemptCount', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'POST_SUBMIT',
    submitAttempted: true,
    submitAttemptCount: 2,
  })
  
  assert.equal(session.submitAttempted, true)
  assert.equal(session.submitAttemptCount, 2)
  
  const retrieved = getCaptchaSession(runId)
  assert.equal(retrieved?.submitAttempted, true)
  assert.equal(retrieved?.submitAttemptCount, 2)
  
  await closeCaptchaSession(runId)
})

test('CAPTCHA session preserves stage information', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const stages: CaptchaSessionStage[] = ['FILLING', 'PRE_SUBMIT', 'POST_SUBMIT']
  
  for (const stage of stages) {
    const session = createCaptchaSession({
      userId,
      runId,
      jobUrl: 'https://example.com/apply',
      adapter: mockAdapter,
      browser: mockBrowser,
      context: mockContext,
      page: mockPage,
      fields: [],
      stage,
    })
    
    assert.equal(session.stage, stage)
    
    const retrieved = getCaptchaSession(runId)
    assert.equal(retrieved?.stage, stage)
    
    await closeCaptchaSession(runId)
  }
})

test('getCaptchaSessionInfo returns session details', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
    submitAttempted: false,
    submitAttemptCount: 0,
  })
  
  // Get session info directly from the shared function
  const info = getCaptchaSessionInfo(runId)
  
  assert.ok(info)
  assert.equal(info?.userId, userId)
  assert.equal(info?.runId, runId)
  assert.equal(info?.stage, 'PRE_SUBMIT')
  assert.equal(info?.submitAttempted, false)
  assert.equal(info?.submitAttemptCount, 0)
  assert.equal(info?.provider, 'test')
  
  await closeCaptchaSession(runId)
})

test('CAPTCHA session with no active session returns null', async (t) => {
  const runId = randomUUID()
  
  const session = getCaptchaSession(runId)
  assert.equal(session, null)
  
  const info = getCaptchaSessionInfo(runId)
  assert.equal(info, null)
})

test('CAPTCHA session stores current URL', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  const session = createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })
  
  assert.equal(session.currentUrl, 'https://example.com/apply')
  
  const retrieved = getCaptchaSession(runId)
  assert.equal(retrieved?.currentUrl, 'https://example.com/apply')
  
  await closeCaptchaSession(runId)
})

test('multiple resume calls handle gracefully', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  
  createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: [],
    stage: 'PRE_SUBMIT',
  })

  // First resume
  const result1 = await resumeAfterCaptcha(runId)
  assert.ok(result1.success)

  // Second resume should handle gracefully (session already closed)
  const result2 = await resumeAfterCaptcha(runId)
  assert.ok(!result2.success)
  assert.equal(result2.reason, 'No active CAPTCHA session found')
})

test('FILLING stage CAPTCHA resume preserves fields', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()

  const testFields: ApplicationField[] = [
    { id: 'field1', path: 'name', text: 'Full Name', value: 'Test User', required: true, inputType: 'text', fieldType: 'text', status: 'suggested' },
    { id: 'field2', path: 'email', text: 'Email', value: 'test@example.com', required: true, inputType: 'email', fieldType: 'text', status: 'suggested' },
  ]

  createCaptchaSession({
    userId,
    runId,
    jobUrl: 'https://example.com/apply',
    adapter: mockAdapter,
    browser: mockBrowser,
    context: mockContext,
    page: mockPage,
    fields: testFields,
    stage: 'FILLING',
  })

  const session = getCaptchaSession(runId)
  assert.ok(session)
  assert.equal(session.fields.length, 2)
  assert.equal(session.fields[0]?.value, 'Test User')

  const result = await resumeAfterCaptcha(runId)
  assert.ok(result.success)
  assert.equal(result.nextStage, 'FILLING')
  
  await closeCaptchaSession(runId)
})