import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isCapSolverConfigured,
  getCapSolverApiKey,
  detectCaptchaOnPage,
  hasValidCaptchaSolution,
  injectCaptchaToken,
  solveCaptchaWithCapSolver,
} from './capsolverService.js'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'

test('isCapSolverConfigured detects presence and absence of API key', () => {
  const origKey = process.env.CAPSOLVER_API_KEY
  try {
    delete process.env.CAPSOLVER_API_KEY
    assert.equal(isCapSolverConfigured(), false)
    assert.equal(getCapSolverApiKey(), '')

    process.env.CAPSOLVER_API_KEY = 'test-capsolver-key-12345'
    assert.equal(isCapSolverConfigured(), true)
    assert.equal(getCapSolverApiKey(), 'test-capsolver-key-12345')
  } finally {
    if (origKey !== undefined) {
      process.env.CAPSOLVER_API_KEY = origKey
    } else {
      delete process.env.CAPSOLVER_API_KEY
    }
  }
})

test('detectCaptchaOnPage recognizes Lever hCaptcha container and sitekey', async () => {
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent(`
      <form id="application-form">
        <input id="hcaptchaResponseInput" type="hidden" name="h-captcha-response" value="">
        <div id="h-captcha" class="h-captcha" data-sitekey="e33f87f8-88ec-4e1a-9a13-df9bbb1d8120"></div>
      </form>
    `)

    const result = await detectCaptchaOnPage(page)
    assert.equal(result.detected, true)
    assert.equal(result.type, 'hcaptcha')
    assert.equal(result.siteKey, 'e33f87f8-88ec-4e1a-9a13-df9bbb1d8120')
  } finally {
    await worker.browser.close()
  }
})

test('detectCaptchaOnPage recognizes reCAPTCHA iframe and Turnstile', async () => {
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent(`
      <div class="cf-turnstile" data-sitekey="0x4AAAAAAABBBBBBBB"></div>
    `)

    const result = await detectCaptchaOnPage(page)
    assert.equal(result.detected, true)
    assert.equal(result.type, 'turnstile')
    assert.equal(result.siteKey, '0x4AAAAAAABBBBBBBB')
  } finally {
    await worker.browser.close()
  }
})

test('hasValidCaptchaSolution returns true when token is present, false when empty', async () => {
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent(`
      <form id="application-form">
        <input id="hcaptchaResponseInput" type="hidden" name="h-captcha-response" value="">
      </form>
    `)

    assert.equal(await hasValidCaptchaSolution(page), false)

    await page.evaluate(() => {
      const input = document.getElementById('hcaptchaResponseInput') as HTMLInputElement
      input.value = 'P1_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.test-solution-token-longer-than-20-chars'
    })

    assert.equal(await hasValidCaptchaSolution(page), true)
  } finally {
    await worker.browser.close()
  }
})

test('injectCaptchaToken populates Lever inputs and triggers onSuccess callback', async () => {
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent(`
      <form id="application-form">
        <input id="hcaptchaResponseInput" type="hidden" name="h-captcha-response" value="">
        <textarea name="h-captcha-response"></textarea>
      </form>
      <script>
        window.callbackFiredWith = null;
        window.onSuccess = function(token) {
          window.callbackFiredWith = token;
        };
      </script>
    `)

    const token = 'sample-solved-token-xyz-1234567890'
    await injectCaptchaToken(page, token, 'hcaptcha')

    const inputVal = await page.locator('#hcaptchaResponseInput').inputValue()
    const textVal = await page.locator('textarea[name="h-captcha-response"]').inputValue()
    const callbackVal = await page.evaluate('window.callbackFiredWith')

    assert.equal(inputVal, token)
    assert.equal(textVal, token)
    assert.equal(callbackVal, token)
    assert.equal(await hasValidCaptchaSolution(page), true)
  } finally {
    await worker.browser.close()
  }
})

test('solveCaptchaWithCapSolver handles createTask and getTaskResult polling', async () => {
  const originalFetch = globalThis.fetch
  try {
    let callCount = 0
    globalThis.fetch = (async (url: string, opts: any) => {
      callCount++
      const body = JSON.parse(opts.body)
      if (String(url).includes('/createTask')) {
        assert.equal(body.clientKey, 'test-key')
        assert.equal(body.task.type, 'HCaptchaTaskProxyless')
        return {
          json: async () => ({
            errorId: 0,
            status: 'processing',
            taskId: 'task-12345',
          }),
        }
      } else if (String(url).includes('/getTaskResult')) {
        assert.equal(body.taskId, 'task-12345')
        return {
          json: async () => ({
            errorId: 0,
            status: 'ready',
            solution: {
              token: 'solved-hcaptcha-token-abc',
            },
          }),
        }
      }
      throw new Error(`Unexpected url: ${url}`)
    }) as any

    const result = await solveCaptchaWithCapSolver(
      'test-key',
      'hcaptcha',
      'https://jobs.lever.co/test/123',
      'e33f87f8-88ec-4e1a-9a13-df9bbb1d8120',
      true,
    )

    assert.equal(result.success, true)
    assert.equal(result.token, 'solved-hcaptcha-token-abc')
    assert.equal(callCount, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
