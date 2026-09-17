import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'
import { extractQuestionsFromPage } from './extraction/domExtractor.js'
import { fillLiveAnswer } from './extraction/liveResolver.js'
import { questionsToFields } from './formModel.js'
import { applyStoredAnswers } from './applyAnswers.js'
import { atsConfirmationDetected, waitForAtsConfirmation } from './submissionConfirmation.js'
import { startAssistedSession, cancelAssistedSession, getAssistedSessionForRun } from './assistedSession.js'
import type { JobBoardAdapter } from '../types.js'

const adapter: JobBoardAdapter = {
  id: 'greenhouse', supports: () => true, applicationUrl: url => url,
  openApplication: async () => { throw new Error('A retained page must never be reopened') },
  waitForApplication: async () => undefined,
  extractJob: async () => ({ url: 'https://job-boards.greenhouse.io/example/jobs/1', jobBoard: 'greenhouse', postingId: null }),
  extractQuestions: extractQuestionsFromPage,
  focusQuestion: async () => undefined,
  fillAnswer: fillLiveAnswer,
  fillEducation: async () => undefined, uploadResume: async () => undefined, uploadFile: async () => undefined,
  detectBlocker: async () => null, isReviewReady: async () => true,
  submitApplication: async () => { throw new Error('Assisted mode never submits automatically') },
}

// This suite deliberately does not skip when browser launch fails.
test('headless Chrome retains isolated concurrent pages through assisted handoff', async () => {
  const workers = await Promise.all([0, 1].map(() => runWithBrowserPermit('test', launchHeadlessAutomationBrowser)))
  const runs = workers.map(() => ({ userId: randomUUID(), runId: randomUUID() }))
  try {
    const pages = await Promise.all(workers.map(w => w.context.newPage()))
    await Promise.all(pages.map((page, i) => page.setContent(`<form><label>Location<input name="location" value="City ${i}"></label><button type="button">Submit</button></form>`)))
    await Promise.all(pages.map((page, i) => startAssistedSession({ ...runs[i]!, jobUrl: 'https://job-boards.greenhouse.io/example/jobs/1', adapter, fields: [], existingBrowser: { ...workers[i]!, page } })))
    assert.notEqual(workers[0]!.browser, workers[1]!.browser)
    await workers[0]!.context.addCookies([{ name: 'isolation', value: 'first-user', url: 'https://example.test' }])
    assert.equal((await workers[1]!.context.cookies('https://example.test')).length, 0)
    assert.equal(await pages[0]!.locator('input').inputValue(), 'City 0')
    assert.equal(await pages[1]!.locator('input').inputValue(), 'City 1')
    assert.equal(getAssistedSessionForRun(runs[0]!.userId, runs[1]!.runId), null)
    await cancelAssistedSession(runs[0]!.userId, runs[0]!.runId)
    assert.equal(pages[0]!.isClosed(), true)
    assert.equal(pages[1]!.isClosed(), false)
  } finally {
    await Promise.all(runs.map(run => cancelAssistedSession(run.userId, run.runId)))
    await Promise.all(workers.map(w => w.browser.close()))
  }
})

test('Greenhouse live Location locator replaces stale reviewed identity; Ashby hidden fields disappear', async () => {
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent('<form><label for="old">Location</label><select id="old" name="old_location"><option></option><option>Pune</option></select></form>')
    const fields = questionsToFields(await adapter.extractQuestions(page))
    fields[0]!.value = 'Pune'
    await page.setContent('<form><label for="live">Location</label><select id="live" name="location" required><option></option><option>Pune</option></select><label hidden>Conditional detail<input required></label></form>')
    await applyStoredAnswers(adapter, page, fields, randomUUID(), 'https://example.test/job')
    assert.equal(await page.locator('[name="location"]').inputValue(), 'Pune')
    assert.equal(fields.length, 1)
    assert.equal(fields[0]!.locator?.value, 'name:location')
    await page.route('https://example.test/thank-you', route => route.fulfill({ body: '<p>Processing</p>', contentType: 'text/html' }))
    await page.goto('https://example.test/thank-you')
    assert.equal(await atsConfirmationDetected(page), false)
  } finally { await worker.browser.close() }
})

test('assisted user Submit validates missing live answers before employer handler runs', async () => {
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  const run = { userId: randomUUID(), runId: randomUUID() }
  try {
    const page = await worker.context.newPage()
    await page.setContent('<form><label>Full name<input name="name" required></label><button type="button" onclick="window.submits = (window.submits || 0) + 1">Submit</button></form>')
    const params = { ...run, jobUrl: 'https://job-boards.greenhouse.io/example/jobs/1', adapter, fields: [], existingBrowser: { ...worker, page } }
    const [first, second] = await Promise.all([startAssistedSession(params), startAssistedSession(params)])
    assert.equal(first.id, second.id)
    await page.getByRole('button', { name: 'Submit' }).click()
    await page.waitForFunction('document.querySelector("input").value === ""')
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate('window.submits || 0'), 0)
    await page.locator('input').fill('Ada Lovelace')
    await page.getByRole('button', { name: 'Submit' }).click()
    await page.waitForFunction('window.submits === 1')
    assert.equal(await page.evaluate('window.submits'), 1)
    assert.notEqual(getAssistedSessionForRun(run.userId, run.runId)?.status, 'SUBMITTED')
  } finally {
    await cancelAssistedSession(run.userId, run.runId)
    await worker.browser.close()
  }
})

test('delayed location suggestions stay scoped to the active field', async () => {
  const { fillLiveAnswer } = await import('./extraction/liveResolver.js')
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent(`<form><label for="city">Location</label><input id="city" role="combobox" aria-controls="cities" />
      <ul id="cities" role="listbox"></ul><ul role="listbox"><li role="option">Pune, Maharashtra, India</li></ul></form>
      <script>let timer; document.querySelector('input').oninput = function () {
        clearTimeout(timer); timer = setTimeout(() => {
          document.getElementById('cities').innerHTML = '<li role="option">Pune, Maharashtra, India</li>';
          document.querySelector('#cities li').onclick = function () { document.querySelector('input').value = this.textContent; window.citySelected = true; };
        }, 1100);
      };</script>`)
    await fillLiveAnswer(page, { id: 'location', text: 'Location', fieldType: 'select', inputType: 'select', required: true, answered: false, locator: { kind: 'field', value: 'id:city' } }, 'Pune, Maharashtra, India')
    assert.equal(await page.evaluate('window.citySelected'), true)
  } finally { await worker.browser.close() }
})

test('Lever uses the same location matcher and rejects an unrelated sole suggestion', async () => {
  const { LeverApplicationPage } = await import('../adapters/lever/LeverApplicationPage.js')
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent('<form><label>Current location<input name="location"></label><ul class="dropdown-results"><li>London, United Kingdom</li></ul></form>')
    await assert.rejects(() => new LeverApplicationPage(page).fill({ id: 'location', text: 'Current location', fieldType: 'text', required: true, answered: false, inputType: 'text', locator: { kind: 'field', value: 'name:location' } }, 'Pune'), /ANSWER_REQUIRES_USER/)
  } finally { await worker.browser.close() }
})

test('new live narrative fields use Ollama and identity fields use the saved profile', async () => {
  const { db } = await import('../../database.js')
  const userId = randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)').run(userId, `${userId}@fixture.test`, 'Fixture Candidate', 'unused', 'unused', now)
  db.prepare('INSERT INTO profiles (user_id,updated_at) VALUES (?,?)').run(userId, now)
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  const previousFetch = globalThis.fetch
  let modelCalls = 0
  globalThis.fetch = async input => {
    assert.match(String(input), /\/api\/chat$/)
    modelCalls++
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ answer: 'I am interested in building useful software with your team.', confidence: .95, needsUserInput: false }) } }))
  }
  try {
    const page = await worker.context.newPage()
    await page.setContent('<form><label for="name">Full name</label><input id="name" name="name" required><label for="why">Why do you want to work here?</label><textarea id="why" name="why" required></textarea></form>')
    const fields: import('./types.js').ApplicationField[] = []
    await applyStoredAnswers(adapter, page, fields, userId, 'https://example.test/job')
    assert.equal(await page.locator('#name').inputValue(), 'Fixture Candidate')
    assert.match(await page.locator('#why').inputValue(), /building useful software/)
    assert.equal(modelCalls, 1)
    assert.equal(fields.find(f => f.text === 'Full name')?.source, 'L1_PROFILE')
    assert.equal(fields.find(f => f.text.startsWith('Why'))?.source, 'L3_LLM')
  } finally {
    globalThis.fetch = previousFetch
    await worker.browser.close()
    db.prepare('DELETE FROM users WHERE id=?').run(userId)
  }
})


test('post-submit validation reports the field error instead of a confirmation timeout', async () => {
  await runWithBrowserPermit('test', async () => {
    const worker = await launchHeadlessAutomationBrowser()
    try {
      const page = await worker.context.newPage()
      await page.setContent('<form><label>Email<input name="email" value="candidate@example.test" aria-invalid="true" aria-describedby="email-error"></label><p id="email-error" role="alert">Please enter a valid email.</p></form>')
      await assert.rejects(waitForAtsConfirmation(page, { timeoutMs: 500 }), /ANSWER_REQUIRES_USER:.*valid email/)
    } finally { await worker.browser.close() }
  })
})

test('timeout retains the submitted page and detects late confirmation without refilling or resubmitting', async () => {
  await runWithBrowserPermit('test', async () => {
    const worker = await launchHeadlessAutomationBrowser()
    const page = await worker.context.newPage()
    const runId = randomUUID(), userId = randomUUID()
    try {
      await worker.context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      await page.setContent(`<form><label>Name<input name="name" value="Original answer"></label><button type="button" onclick="window.submitCount=(window.submitCount||0)+1;document.getElementById('state').textContent='Processing…'">Submit application</button></form><p id="state">Ready</p>`)
      await page.getByRole('button', { name: 'Submit application' }).click()
      await assert.rejects(waitForAtsConfirmation(page, { timeoutMs: 100 }), /outcome is unknown/)
      let submitted = false
      await startAssistedSession({ userId, runId, jobUrl: 'https://job-boards.greenhouse.io/example/jobs/1', fields: [], adapter: { ...adapter, fillAnswer: async () => { throw new Error('Must not refill after timeout') } }, existingBrowser: { ...worker, page }, observeOnly: true, onChange: view => { if (view.status === 'SUBMITTED') submitted = true } })
      assert.equal(await page.locator('input').inputValue(), 'Original answer')
      assert.equal(worker.context.pages().length, 1)
      assert.equal(await page.evaluate('window.submitCount'), 1)
      assert.match(getAssistedSessionForRun(userId, runId)!.reason, /original page/)
      await worker.context.tracing.stop({ path: '/tmp/jobcopilot-submission-timeout.zip' })
      await page.setContent('<main><h1>Thank you for applying</h1><p>Your application has been submitted.</p></main>')
      for (let i = 0; i < 20 && !submitted; i++) await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal(submitted, true)
    } finally { await cancelAssistedSession(userId, runId); await worker.browser.close().catch(() => undefined) }
  })
})

test('Workable validates the selected phone dial code instead of a permanently empty synthetic field', async () => {
  const { WorkableApplicationPage } = await import('../adapters/workable/WorkableApplicationPage.js')
  const { assertLiveFormReadyToSubmit } = await import('./submission.js')
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent(`<form><label>Phone<input name="phone" type="tel" value="9876543210" required></label><div class="iti__selected-flag" role="combobox" style="width:100px;height:30px" title="Select country" onclick="document.querySelector('.iti__country-list').hidden=false"></div><ul class="iti__country-list" hidden><li data-country-code="in" data-dial-code="91" onclick="document.querySelector('.iti__selected-flag').title='India: +91';this.parentNode.hidden=true">India +91</li></ul></form>`)
    const form = new WorkableApplicationPage(page)
    const questions = await form.readQuestions()
    const country = questions.find(q => q.inputType === 'country-code')!
    assert.equal(country.answered, false)
    await form.fill(country, 'IN')
    const latest = await form.readQuestions()
    assert.equal(latest.find(q => q.inputType === 'country-code')?.answered, true)
    await assertLiveFormReadyToSubmit({...adapter,extractQuestions: () => form.readQuestions()},page,questionsToFields(latest))
  } finally { await worker.browser.close() }
})

test('Lever uploaded résumé remains answered after its file input is reset', async () => {
  const { LeverApplicationPage } = await import('../adapters/lever/LeverApplicationPage.js')
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  try {
    const page = await worker.context.newPage()
    await page.setContent('<form><label>Resume/CV<input name="resume" id="resume-upload-input" type="file"></label><input type="hidden" name="resumeStorageId" value="stored-document"><div class="resume-upload-success">Uploaded</div></form>')
    const form = new LeverApplicationPage(page)
    assert.equal((await form.readQuestions()).find(q => q.inputType === 'file')?.answered, true)
    await page.locator('[name="resumeStorageId"]').evaluate(el => (el as HTMLInputElement).value = '')
    await page.locator('.resume-upload-success').evaluate(el => el.remove())
    assert.equal((await form.readQuestions()).find(q => q.inputType === 'file')?.answered, false)
  } finally { await worker.browser.close() }
})

test('side Submit preserves live edits, sends once, and requires ATS confirmation on the retained page', async () => {
  const { submitAssistedApplication } = await import('./assistedSession.js')
  const worker = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  const run = {userId: randomUUID(), runId: randomUUID()}
  try {
    const page = await worker.context.newPage()
    await page.setContent('<form><label>Name<input name="name" value="Live edited name" required></label><button type="button" onclick="window.sent=(window.sent||0)+1">Submit application</button></form>')
    const fields = questionsToFields(await adapter.extractQuestions(page));fields[0]!.value='Old saved name'
    const clickAdapter = {...adapter, submitApplication: async () => { await page.getByRole('button', {name:'Submit application'}).click() }}
    await startAssistedSession({...run,jobUrl:'https://job-boards.greenhouse.io/example/jobs/1',adapter:clickAdapter,fields,existingBrowser:{...worker,page},confirmationTimeoutMs:100})
    await assert.rejects(submitAssistedApplication(randomUUID(),run.runId), /not found/)
    await Promise.all([submitAssistedApplication(run.userId,run.runId),submitAssistedApplication(run.userId,run.runId)])
    await page.waitForTimeout(700)
    assert.equal(await page.locator('input').inputValue(), 'Live edited name')
    assert.equal(await page.evaluate('window.sent'),1)
    assert.notEqual(getAssistedSessionForRun(run.userId,run.runId)?.status, 'SUBMITTED')
    await submitAssistedApplication(run.userId,run.runId)
    assert.equal(await page.evaluate('window.sent'),1)
    const closed = page.waitForEvent('close', {timeout: 5000})
    await page.setContent('<h1>Thank you for applying!</h1><p>Your application has been submitted.</p>')
    await closed
    // The watcher closes the same session only after actual confirmation.
    assert.equal(page.isClosed(),true)
  } finally { await cancelAssistedSession(run.userId,run.runId);await worker.browser.close() }
})
