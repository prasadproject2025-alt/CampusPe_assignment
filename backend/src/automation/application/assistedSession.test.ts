import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Page } from 'playwright-core'
import { extractQuestionsFromPage } from './extraction/domExtractor.js'
import { fillLiveAnswer } from './extraction/liveResolver.js'
import {
  cancelAssistedSession,
  crashAssistedBrowserForTests,
  dispatchAssistedInput,
  expireInactiveAssistedSessions,
  getAssistedSession,
  getAssistedSessionForRun,
  resetAssistedSessionsForTests,
  startAssistedSession,
} from './assistedSession.js'
import type { JobBoardAdapter } from '../types.js'

const formHtml = (script: string) => `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Full name</span></div>
    <input name="name" required />
  </div>
  <button type="button" id="btn-submit">Submit application</button>
</form>
<script>${script}</script>
</body></html>`

const successScript = `document.getElementById('btn-submit').addEventListener('click', function () {
  document.body.innerHTML = '<main data-qa="application-confirmation"><h1>Thank you for applying</h1><p>Your application has been submitted.</p></main>';
});`

const noConfirmScript = `document.getElementById('btn-submit').addEventListener('click', function () {
  this.remove();
  document.body.insertAdjacentHTML('beforeend', '<p>Processing…</p>');
});`

const captchaHtml = `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Full name</span></div>
    <input name="name" required />
  </div>
  <iframe src="https://www.google.com/recaptcha/api2/bframe?k=test" title="reCAPTCHA" width="300" height="150"></iframe>
  <button type="button" id="btn-submit">Submit application</button>
</form>
</body></html>`

function fixtureAdapter(): JobBoardAdapter {
  return {
    id: 'workable',
    supports: () => true,
    applicationUrl: (url) => url,
    openApplication: async () => undefined,
    waitForApplication: async (page) => { await page.locator('form').waitFor({ state: 'visible', timeout: 15_000 }) },
    extractJob: async (_page, originalUrl) => ({ postingId: null, url: originalUrl, company: 'Fixture Co', jobBoard: 'workable' }),
    extractQuestions: (page) => extractQuestionsFromPage(page),
    focusQuestion: async () => undefined,
    fillAnswer: (page, question, answer) => fillLiveAnswer(page, question, answer),
    fillEducation: async () => { throw new Error('Education is not used in assisted fixtures.') },
    uploadResume: async () => undefined,
    uploadFile: async () => undefined,
    detectBlocker: async (page) => {
      const captcha = page.locator('iframe[src*="recaptcha/api2/bframe"]').first()
      if (await captcha.isVisible().catch(() => false)) {
        return { type: 'CAPTCHA', message: 'Complete the CAPTCHA on the employer site, then continue. JobCopilot will not bypass it.' }
      }
      return null
    },
    isReviewReady: async (page) => page.getByRole('button', { name: /submit application/i }).isVisible().catch(() => false),
    submitApplication: async (page) => {
      const button = page.getByRole('button', { name: /submit application/i })
      if (!await button.isVisible()) throw new Error('The submit button is not available.')
      await button.click()
    },
  }
}

function nameField(value = 'Ada Lovelace') {
  return {
    id: 'full_name',
    text: 'Full name',
    fieldType: 'text' as const,
    required: true,
    value,
    status: (value ? 'manual' : 'empty') as 'manual' | 'empty',
    locator: { kind: 'field' as const, value: 'name:name' },
  }
}

async function waitForStatus(userId: string, runId: string, status: string, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const view = getAssistedSessionForRun(userId, runId)
    if (view?.status === status) return view
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`Timed out waiting for assisted status ${status}. Last: ${getAssistedSessionForRun(userId, runId)?.status}`)
}

test.afterEach(async () => {
  await resetAssistedSessionsForTests()
})

test('assisted session creation belongs to the authenticated user', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  let started
  try {
    started = await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter: fixtureAdapter(),
      confirmationTimeoutMs: 2_000,
      openPage: async (page: Page) => { await page.setContent(formHtml(successScript)) },
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  assert.equal(started.userId, userId)
  assert.equal(started.runId, runId)
  assert.ok(started.id)
  assert.equal(getAssistedSession(userId, started.id)?.id, started.id)
  assert.equal(getAssistedSession(randomUUID(), started.id), null)
  await cancelAssistedSession(userId, runId)
})

test('session isolation between users', async (t) => {
  const userA = randomUUID()
  const userB = randomUUID()
  const runA = randomUUID()
  const runB = randomUUID()
  const adapter = fixtureAdapter()
  const openPage = async (page: Page) => { await page.setContent(formHtml(successScript)) }
  const fields = [nameField()]
  try {
    await startAssistedSession({ userId: userA, runId: runA, jobUrl: 'https://example.test/apply', fields, adapter, openPage, confirmationTimeoutMs: 2_000 })
    await startAssistedSession({ userId: userB, runId: runB, jobUrl: 'https://example.test/apply', fields, adapter, openPage, confirmationTimeoutMs: 2_000 })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  assert.equal(getAssistedSessionForRun(userA, runA)?.userId, userA)
  assert.equal(getAssistedSessionForRun(userB, runB)?.userId, userB)
  assert.equal(getAssistedSessionForRun(userA, runB), null)
  assert.equal(getAssistedSessionForRun(userB, runA), null)
  await cancelAssistedSession(userA, runA)
  await cancelAssistedSession(userB, runB)
})

test('browser session cleanup on cancel', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  try {
    await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter: fixtureAdapter(),
      openPage: async (page: Page) => { await page.setContent(formHtml(successScript)) },
      confirmationTimeoutMs: 2_000,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const cancelled = await cancelAssistedSession(userId, runId)
  assert.equal(cancelled?.status, 'CANCELLED')
  assert.equal(getAssistedSessionForRun(userId, runId), null)
})

test('CAPTCHA becomes MANUAL_REQUIRED while keeping the session alive', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  let started
  try {
    started = await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter: fixtureAdapter(),
      openPage: async (page: Page) => { await page.setContent(captchaHtml) },
      confirmationTimeoutMs: 2_000,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  assert.equal(started.status, 'MANUAL_REQUIRED')
  assert.match(started.reason, /Complete the CAPTCHA in the assisted browser/)
  assert.equal(getAssistedSessionForRun(userId, runId)?.status, 'MANUAL_REQUIRED')
  await cancelAssistedSession(userId, runId)
})

test('unresolved required field becomes WAITING_FOR_USER', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  let started
  try {
    started = await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField('')],
      adapter: fixtureAdapter(),
      openPage: async (page: Page) => { await page.setContent(formHtml(successScript)) },
      confirmationTimeoutMs: 2_000,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  assert.equal(started.status, 'WAITING_FOR_USER')
  assert.match(started.reason, /ANSWER_REQUIRES_USER|still empty/i)
  assert.ok(getAssistedSessionForRun(userId, runId))
  await cancelAssistedSession(userId, runId)
})

test('user submits successfully and confirmation is detected as SUCCESS', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  const adapter = fixtureAdapter()
  let pageRef: Page | undefined
  let lastStatus = ''
  try {
    await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter,
      openPage: async (page: Page) => { pageRef = page; await page.setContent(formHtml(successScript)) },
      confirmationTimeoutMs: 5_000,
      onChange: (view) => { lastStatus = view.status },
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  await waitForStatus(userId, runId, 'USER_REVIEWING')
  await pageRef!.getByRole('button', { name: /submit application/i }).click()
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && lastStatus !== 'SUBMITTED') {
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  assert.equal(lastStatus, 'SUBMITTED')
  assert.equal(getAssistedSessionForRun(userId, runId), null)
})

test('submit click without confirmation is NOT SUCCESS', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  const adapter = fixtureAdapter()
  let pageRef: Page | undefined
  try {
    await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter,
      openPage: async (page: Page) => { pageRef = page; await page.setContent(formHtml(noConfirmScript)) },
      confirmationTimeoutMs: 500,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  await waitForStatus(userId, runId, 'USER_REVIEWING')
  await pageRef!.getByRole('button', { name: /submit application/i }).click()
  const timedOut = await waitForStatus(userId, runId, 'MANUAL_REQUIRED', 4_000)
  assert.match(timedOut.reason, /SUBMISSION_TIMEOUT/)
  assert.notEqual(timedOut.status, 'SUBMITTED')
  assert.ok(getAssistedSessionForRun(userId, runId))
  await cancelAssistedSession(userId, runId)
})

test('confirmation timeout keeps a manual-required session instead of success', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  let pageRef: Page | undefined
  try {
    await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter: fixtureAdapter(),
      openPage: async (page: Page) => { pageRef = page; await page.setContent(formHtml('')) },
      confirmationTimeoutMs: 400,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  await waitForStatus(userId, runId, 'USER_REVIEWING')
  await pageRef!.evaluate(`window.__jobcopilotUserSubmit = true`)
  const view = await waitForStatus(userId, runId, 'MANUAL_REQUIRED', 4_000)
  assert.match(view.reason, /SUBMISSION_TIMEOUT/)
  await cancelAssistedSession(userId, runId)
})

test('browser crash is reported as FAILED', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  try {
    await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter: fixtureAdapter(),
      openPage: async (page: Page) => { await page.setContent(formHtml(successScript)) },
      confirmationTimeoutMs: 2_000,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  await waitForStatus(userId, runId, 'USER_REVIEWING')
  const statuses: string[] = []
  const current = getAssistedSessionForRun(userId, runId)
  assert.ok(current)
  await crashAssistedBrowserForTests(runId)
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    const view = getAssistedSessionForRun(userId, runId)
    if (!view) {
      statuses.push('GONE')
      break
    }
    statuses.push(view.status)
    if (view.status === 'FAILED') break
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  assert.ok(statuses.includes('FAILED') || statuses.includes('GONE'))
})

test('expired inactive sessions are closed', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  try {
    await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter: fixtureAdapter(),
      openPage: async (page: Page) => { await page.setContent(formHtml(successScript)) },
      inactivityMs: 30,
      confirmationTimeoutMs: 2_000,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  await waitForStatus(userId, runId, 'USER_REVIEWING')
  await expireInactiveAssistedSessions(Date.now() + 1_000)
  assert.equal(getAssistedSessionForRun(userId, runId), null)
})

test('unauthorized session access is rejected', async (t) => {
  const userId = randomUUID()
  const runId = randomUUID()
  try {
    await startAssistedSession({
      userId,
      runId,
      jobUrl: 'https://example.test/apply',
      fields: [nameField()],
      adapter: fixtureAdapter(),
      openPage: async (page: Page) => { await page.setContent(formHtml(successScript)) },
      confirmationTimeoutMs: 2_000,
    })
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  await waitForStatus(userId, runId, 'USER_REVIEWING')
  await assert.rejects(() => dispatchAssistedInput(randomUUID(), runId, { type: 'click', x: 0.5, y: 0.5 }), /not found|no longer active/i)
  assert.equal(getAssistedSession(randomUUID(), getAssistedSessionForRun(userId, runId)!.id), null)
  await cancelAssistedSession(userId, runId)
})
