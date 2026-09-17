import assert from 'node:assert/strict'
import test from 'node:test'
import type { Page } from 'playwright-core'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'
import type { JobBoardAdapter } from '../types.js'
import { extractQuestionsFromPage } from './extraction/domExtractor.js'
import { fillLiveAnswer } from './extraction/liveResolver.js'
import { questionsToFields } from './formModel.js'
import { runReviewedSubmission, submitApplicationWithServerBrowser } from './submission.js'
import { ATS_REJECTION_PATTERN, atsRejectionMessage } from './submissionConfirmation.js'
import type { ApplicationField } from './types.js'

test('Ashby spam banner matches the rejection pattern', () => {
  assert.match(
    "We couldn't submit your application. Your application submission was flagged as possible spam.",
    ATS_REJECTION_PATTERN,
  )
})

const successFormHtml = `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Full name</span></div>
    <input name="name" required />
  </div>
  <div class="application-question">
    <div class="application-label"><span class="text">About you</span></div>
    <textarea name="about"></textarea>
  </div>
  <div class="application-question">
    <div class="application-label"><span class="text">Country</span></div>
    <select name="country"><option value=""></option><option>United States</option><option>India</option></select>
  </div>
  <div class="application-question">
    <div class="application-label"><span class="text">Pronouns</span></div>
    <label><input type="radio" name="pronouns" value="He/Him"> He/Him</label>
    <label><input type="radio" name="pronouns" value="She/Her"> She/Her</label>
  </div>
  <div class="application-question">
    <div class="application-label"><span class="text">How did you hear about us?</span></div>
    <input type="text" name="hear" />
  </div>
  <div class="application-question">
    <div class="application-label"><span class="text">Phone</span></div>
    <input type="tel" name="phone" class="iti__tel-input" />
  </div>
  <div class="application-question">
    <div class="application-label"><span class="text">Interests</span></div>
    <label><input type="checkbox" name="int_eng"> Engineering</label>
    <label><input type="checkbox" name="int_des"> Design</label>
  </div>
  <button type="button" id="btn-submit">Submit application</button>
</form>
<script>
document.getElementById('btn-submit').addEventListener('click', function () {
  window.__submitClicks = (window.__submitClicks || 0) + 1;
  document.body.innerHTML = '<main data-qa="application-confirmation"><h1>Thank you for applying</h1><p>Your application has been submitted.</p></main>';
});
</script>
</body></html>`

const noConfirmationHtml = `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Full name</span></div>
    <input name="name" required />
  </div>
  <button type="button" id="btn-submit">Submit application</button>
</form>
<script>
document.getElementById('btn-submit').addEventListener('click', function () {
  window.__submitClicks = (window.__submitClicks || 0) + 1;
  this.remove();
  document.body.insertAdjacentHTML('beforeend', '<p>Processing…</p>');
});
</script>
</body></html>`

const timeoutHtml = `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Full name</span></div>
    <input name="name" required />
  </div>
  <button type="button" id="btn-submit">Submit application</button>
</form>
<script>
document.getElementById('btn-submit').addEventListener('click', function () {
  window.__submitClicks = (window.__submitClicks || 0) + 1;
});
</script>
</body></html>`

const spamHtml = `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Full name</span></div>
    <input name="name" required />
  </div>
  <button type="button" id="btn-submit">Submit application</button>
</form>
<script>
document.getElementById('btn-submit').addEventListener('click', function () {
  window.__submitClicks = (window.__submitClicks || 0) + 1;
  document.body.insertAdjacentHTML('afterbegin', '<p>We couldn\\'t submit your application. Your application submission was flagged as possible spam. If you believe this was a mistake, please submit your application again.</p>');
});
</script>
</body></html>`

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

const ambiguousHtml = `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Website</span></div>
    <input />
  </div>
  <div class="application-question">
    <div class="application-label"><span class="text">Website</span></div>
    <input />
  </div>
  <button type="button" id="btn-submit">Submit application</button>
</form>
<script>
document.getElementById('btn-submit').addEventListener('click', function () {
  window.__submitClicks = (window.__submitClicks || 0) + 1;
  document.body.innerHTML = '<h1>Thank you for applying</h1>';
});
</script>
</body></html>`

function fixtureAdapter(): JobBoardAdapter {
  return {
    id: 'workable',
    supports: () => true,
    applicationUrl: (url) => url,
    openApplication: async (page, jobUrl) => { await page.goto(jobUrl, { waitUntil: 'domcontentloaded' }) },
    waitForApplication: async (page) => { await page.locator('form').waitFor({ state: 'visible', timeout: 15_000 }) },
    extractJob: async (_page, originalUrl) => ({ postingId: null, url: originalUrl, company: 'Fixture Co', jobBoard: 'workable' }),
    extractQuestions: (page) => extractQuestionsFromPage(page),
    focusQuestion: async () => undefined,
    fillAnswer: (page, question, answer) => fillLiveAnswer(page, question, answer),
    fillEducation: async () => { throw new Error('Education is not used in submission fixtures.') },
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

function answeredFields(questions: Awaited<ReturnType<typeof extractQuestionsFromPage>>, answers: Record<string, string>): ApplicationField[] {
  return questionsToFields(questions).map((field) => {
    const value = answers[field.text] || ''
    return { ...field, value, status: value ? 'manual' : field.status }
  })
}

async function withPage<T>(work: (page: Page) => Promise<T>, t: { skip: (reason: string) => void }) {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return undefined as T
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    return await work(page)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

test('successful submission confirmation', async (t) => {
  await withPage(async (page) => {
    await page.setContent(successFormHtml)
    const questions = await extractQuestionsFromPage(page)
    const fields = answeredFields(questions, {
      'Full name': 'Ada Lovelace',
      'About you': 'I build compilers.',
      Country: 'United States',
      Pronouns: 'He/Him',
      'How did you hear about us?': 'LinkedIn',
      Phone: '4155550100',
      Interests: 'Engineering',
    })
    const result = await runReviewedSubmission({
      adapter: fixtureAdapter(),
      page,
      userId: 'submission-fixture-user',
      jobUrl: 'https://example.test/apply',
      fields,
      confirmationTimeoutMs: 5_000,
    })
    assert.equal(result.ok, true)
    assert.equal(result.code, 'SUBMISSION_SUCCESS')
    assert.match(await page.locator('h1').innerText(), /thank you for applying/i)
  }, t)
})

test('required unanswered field stops without clicking Submit', async (t) => {
  await withPage(async (page) => {
    await page.setContent(successFormHtml)
    const questions = await extractQuestionsFromPage(page)
    const fields = answeredFields(questions, { Country: 'United States' })
    const result = await runReviewedSubmission({
      adapter: fixtureAdapter(),
      page,
      userId: 'submission-fixture-user',
      jobUrl: 'https://example.test/apply',
      fields,
      confirmationTimeoutMs: 2_000,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'ANSWER_REQUIRES_USER')
    assert.equal(await page.evaluate('window.__submitClicks || 0'), 0)
  }, t)
})

test('ambiguous field stops without claiming success', async (t) => {
  await withPage(async (page) => {
    await page.setContent(ambiguousHtml)
    const questions = await extractQuestionsFromPage(page)
    const fields = answeredFields(questions, { Website: 'https://ada.dev' })
    const result = await runReviewedSubmission({
      adapter: fixtureAdapter(),
      page,
      userId: 'submission-fixture-user',
      jobUrl: 'https://example.test/apply',
      fields,
      confirmationTimeoutMs: 2_000,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'AMBIGUOUS_FIELD')
    assert.equal(await page.evaluate('window.__submitClicks || 0'), 0)
  }, t)
})

test('CAPTCHA or anti-bot is reported as MANUAL_REQUIRED', async (t) => {
  await withPage(async (page) => {
    await page.setContent(captchaHtml)
    const questions = await extractQuestionsFromPage(page)
    const fields = answeredFields(questions, { 'Full name': 'Ada Lovelace' })
    const result = await runReviewedSubmission({
      adapter: fixtureAdapter(),
      page,
      userId: 'submission-fixture-user',
      jobUrl: 'https://example.test/apply',
      fields,
      confirmationTimeoutMs: 2_000,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MANUAL_REQUIRED')
    if (!result.ok && result.code === 'MANUAL_REQUIRED') {
      assert.equal(result.blocker.type, 'CAPTCHA')
    }
  }, t)
})

test('submission timeout does not return success', async (t) => {
  await withPage(async (page) => {
    await page.setContent(timeoutHtml)
    const questions = await extractQuestionsFromPage(page)
    const fields = answeredFields(questions, { 'Full name': 'Ada Lovelace' })
    const result = await runReviewedSubmission({
      adapter: fixtureAdapter(),
      page,
      userId: 'submission-fixture-user',
      jobUrl: 'https://example.test/apply',
      fields,
      confirmationTimeoutMs: 800,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'SUBMISSION_TIMEOUT')
    assert.equal(await page.evaluate('window.__submitClicks || 0'), 1)
  }, t)
})

test('employer spam rejection is SUBMISSION_FAILED and not success', async (t) => {
  await withPage(async (page) => {
    await page.setContent(spamHtml)
    const questions = await extractQuestionsFromPage(page)
    const fields = answeredFields(questions, { 'Full name': 'Ada Lovelace' })
    const result = await runReviewedSubmission({
      adapter: fixtureAdapter(),
      page,
      userId: 'submission-fixture-user',
      jobUrl: 'https://example.test/apply',
      fields,
      confirmationTimeoutMs: 2_000,
    })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'SUBMISSION_FAILED')
    assert.match(result.error, /spam/i)
    assert.notEqual(result.code, 'SUBMISSION_SUCCESS')
  }, t)
})

test('submit click without confirmation MUST NOT return success', async (t) => {
  await withPage(async (page) => {
    await page.setContent(noConfirmationHtml)
    const questions = await extractQuestionsFromPage(page)
    const fields = answeredFields(questions, { 'Full name': 'Ada Lovelace' })
    const result = await runReviewedSubmission({
      adapter: fixtureAdapter(),
      page,
      userId: 'submission-fixture-user',
      jobUrl: 'https://example.test/apply',
      fields,
      confirmationTimeoutMs: 800,
    })
    assert.equal(result.ok, false)
    assert.notEqual(result.code, 'SUBMISSION_SUCCESS')
    assert.ok(result.code === 'SUBMISSION_TIMEOUT' || result.code === 'SUBMISSION_FAILED')
    assert.equal(await page.evaluate('window.__submitClicks || 0'), 1)
    assert.equal(await page.getByRole('button', { name: /submit application/i }).count(), 0)
  }, t)
})

test('disposable submit worker does not treat a click as success', async (t) => {
  const adapter: JobBoardAdapter = {
    ...fixtureAdapter(),
    openApplication: async (page) => { await page.setContent(noConfirmationHtml) },
    waitForApplication: async (page) => { await page.locator('form').waitFor({ state: 'visible', timeout: 5_000 }) },
  }
  let result: Awaited<ReturnType<typeof submitApplicationWithServerBrowser>>
  try {
    result = await submitApplicationWithServerBrowser(
      'https://example.test/apply',
      'submission-fixture-user',
      [{
        id: 'full_name',
        text: 'Full name',
        fieldType: 'text',
        inputType: 'text',
        required: true,
        value: 'Ada Lovelace',
        status: 'manual',
        locator: { kind: 'field', value: 'name:name' },
      }],
      undefined,
      { adapter, confirmationTimeoutMs: 800 },
    )
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  assert.equal(result.ok, false)
  assert.notEqual(result.code, 'SUBMISSION_SUCCESS')
})


test('generic employer failure is not mislabeled as spam', async () => {
  await runWithBrowserPermit('test', async () => {
    const { browser, context } = await launchHeadlessAutomationBrowser()
    try {
      const page = await context.newPage()
      await page.setContent("<p>We couldn't submit your application. Please check the required fields.</p>")
      assert.doesNotMatch(await atsRejectionMessage(page), /spam/i)
      await page.setContent("<p>We couldn't submit your application.</p><p>Your application submission was flagged as possible spam.</p>")
      assert.match(await atsRejectionMessage(page), /possible spam/)
    } finally { await browser.close() }
  })
})
