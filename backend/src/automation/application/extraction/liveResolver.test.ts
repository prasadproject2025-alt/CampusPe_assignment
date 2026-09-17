import assert from 'node:assert/strict'
import test from 'node:test'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../../browserLauncher.js'
import { extractQuestionsFromPage } from './domExtractor.js'
import { fillLiveAnswer, locationSearchQueries, resolveLiveField } from './liveResolver.js'

test('location search queries prefer the full value then the city', () => {
  assert.deepEqual(locationSearchQueries('Mumbai, Maharashtra, India'), [
    'Mumbai, Maharashtra, India',
    'Mumbai',
    'Mumbai, India',
  ])
})

const leverPronounsHtml = `<!doctype html><html><body>
<form id="application-form">
  <ul>
    <li class="application-question">
      <div class="application-label"><span class="text">Full name</span></div>
      <input name="name" />
    </li>
    <li class="application-question">
      <div class="application-label"><span class="text">Pronouns</span></div>
      <label><input type="radio" name="pronouns" value="He/Him"> He/Him</label>
      <label><input type="radio" name="pronouns" value="She/Her"> She/Her</label>
      <label><input type="radio" name="pronouns" value="They/Them"> They/Them</label>
    </li>
  </ul>
</form>
</body></html>`

test('Lever Pronouns extracts as one radio group and fills He/Him without FIELD_NOT_FOUND', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(leverPronounsHtml)
    const questions = await extractQuestionsFromPage(page)
    const pronouns = questions.find((question) => question.text === 'Pronouns')
    assert.ok(pronouns, 'Pronouns question must exist')
    assert.equal(questions.some((question) => question.text === 'He/Him'), false)
    assert.deepEqual(pronouns?.options, ['He/Him', 'She/Her', 'They/Them'])
    const group = await resolveLiveField(page, pronouns!)
    assert.ok(await group.count())
    await fillLiveAnswer(page, pronouns!, 'He/Him')
    const checked = page.locator('input[name="pronouns"][value="He/Him"]')
    assert.equal(await checked.isChecked(), true)
    const nameField = questions.find((question) => question.text === 'Full name')
    assert.ok(nameField)
    await fillLiveAnswer(page, nameField!, 'Ada Lovelace')
    assert.equal(await page.locator('input[name="name"]').inputValue(), 'Ada Lovelace')
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const ashbyGroupHtml = `<!doctype html><html><body>
<form class="ashby-application-form">
  <div class="ashby-application-form-field-entry">
    <label class="ashby-application-form-question-title">Full Name</label>
    <div aria-label="Full Name"><input name="_systemfield_name" aria-label="Full Name" /></div>
  </div>
  <div class="ashby-application-form-field-entry">
    <label class="ashby-application-form-question-title">How did you hear about this job?</label>
    <label><input type="checkbox" name="src_li"> LinkedIn</label>
    <label><input type="checkbox" name="src_gd"> Glassdoor</label>
    <label><input type="checkbox" name="src_ot"> Other</label>
  </div>
  <div class="ashby-application-form-field-entry">
    <label class="ashby-application-form-question-title">Pronouns</label>
    <label><input type="radio" name="pronouns" value="He/Him"> He/Him</label>
    <label><input type="radio" name="pronouns" value="She/Her"> She/Her</label>
  </div>
</form>
</body></html>`

test('Ashby checkboxes with unique names stay one field and Full Name is not ambiguous', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(ashbyGroupHtml)
    const questions = await extractQuestionsFromPage(page)
    const referral = questions.find((question) => /how did you hear/i.test(question.text))
    assert.ok(referral)
    assert.equal(questions.filter((question) => /how did you hear|linkedin|glassdoor/i.test(question.text)).length, 1)
    assert.deepEqual(referral?.options, ['LinkedIn', 'Glassdoor', 'Other'])
    const fullName = questions.find((question) => question.text === 'Full Name')
    assert.ok(fullName)
    await fillLiveAnswer(page, fullName!, 'Ada Lovelace')
    assert.equal(await page.locator('input[name="_systemfield_name"]').inputValue(), 'Ada Lovelace')
    const pronouns = questions.find((question) => question.text === 'Pronouns')
    await fillLiveAnswer(page, pronouns!, 'He/Him')
    assert.equal(await page.locator('input[name="pronouns"][value="He/Him"]').isChecked(), true)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const workableYesNoHtml = `<!doctype html><html><body>
<form>
  <span id="elig_label">Are you eligible to work in the country you are applying?</span>
  <fieldset role="radiogroup" data-ui="CA_10628" aria-labelledby="elig_label">
    <div data-ui="option" role="radio" aria-labelledby="elig_label yes_label">
      <label id="yes_label"><input type="radio" name="input_CA_10628_input" value="YES"> YES</label>
    </div>
    <div data-ui="option" role="radio" aria-labelledby="elig_label no_label">
      <label id="no_label"><input type="radio" name="input_CA_10629_input" value="NO"> NO</label>
    </div>
  </fieldset>
</form>
</body></html>`

test('Workable YES/NO radios stay one question and do not become questions', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(workableYesNoHtml)
    const questions = await extractQuestionsFromPage(page)
    assert.equal(questions.filter((question) => /eligible to work/i.test(question.text)).length, 1)
    assert.equal(questions.some((question) => question.text === 'YES' || question.text === 'NO'), false)
    const eligibility = questions.find((question) => /eligible to work/i.test(question.text))
    assert.deepEqual(eligibility?.options, ['YES', 'NO'])
    await fillLiveAnswer(page, eligibility!, 'YES')
    assert.equal(await page.locator('input[value="YES"]').isChecked(), true)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const greenhousePhoneHtml = `<!doctype html><html><body>
<form id="application-form">
  <label>First Name <input name="first_name" /></label>
  <label>Phone country code <select name="country"><option>United States</option></select></label>
  <input class="iti__search-input" type="text" />
  <label>Phone <input id="phone" name="phone" type="tel" class="input iti__tel-input" /></label>
</form>
</body></html>`

test('Greenhouse phone keeps tel and country code, not the intl-tel search box', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(greenhousePhoneHtml)
    const questions = await extractQuestionsFromPage(page)
    const phoneFields = questions.filter((question) => /^phone$/i.test(question.text))
    assert.equal(phoneFields.length, 1)
    assert.equal(phoneFields[0]?.inputType, 'tel')
    assert.equal(questions.some((question) => /country/i.test(question.text)), true)
    await fillLiveAnswer(page, phoneFields[0]!, '4155552671')
    assert.equal(await page.locator('input[type="tel"]').inputValue(), '4155552671')
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const ashbyMissingHtml = `<!doctype html><html><body>
<div class="ashby-application-form-container">
  <div class="ashby-application-form-field-entry" data-field-path="portfolio">
    <label class="ashby-application-form-question-title" for="portfolio">Portfolio Link</label>
    <input id="portfolio" name="portfolio" type="url" />
  </div>
  <div class="ashby-application-form-field-entry" data-field-path="aa227727-b67d-4ec0-8ed2-b4f6a6e6e945">
    <label class="ashby-application-form-question-title" for="aa227727-b67d-4ec0-8ed2-b4f6a6e6e945">Portfolio Password</label>
    <input id="aa227727-b67d-4ec0-8ed2-b4f6a6e6e945" name="aa227727-b67d-4ec0-8ed2-b4f6a6e6e945" type="text" placeholder="Type here..." />
  </div>
  <div class="ashby-application-form-field-entry" data-field-path="e01a85db-feaa-42b3-a9ad-69b1dcbbab3f">
    <label class="ashby-application-form-question-title">Are you able to commit to working from one of our offices on Anchor Days each week?</label>
    <div class="ashby-application-form-input-yesno">
      <button type="submit" class="ashby-application-form-input-yesno-option" data-option="yes">Yes</button>
      <button type="submit" class="ashby-application-form-input-yesno-option" data-option="no">No</button>
      <input type="checkbox" class="_input_1svni_78" name="e01a85db-feaa-42b3-a9ad-69b1dcbbab3f" style="display:none" />
    </div>
  </div>
  <div class="ashby-application-form-field-entry" data-field-path="790b5934-74f5-46f5-897a-675b7f37f2f3">
    <label class="ashby-application-form-question-title">Will you now or in the future require Notion to sponsor an immigration case in order to employ you?</label>
    <div class="ashby-application-form-input-yesno">
      <button type="submit" class="ashby-application-form-input-yesno-option" data-option="yes">Yes</button>
      <button type="submit" class="ashby-application-form-input-yesno-option" data-option="no">No</button>
      <input type="checkbox" class="_input_1svni_78" name="790b5934-74f5-46f5-897a-675b7f37f2f3" style="display:none" />
    </div>
  </div>
</div>
</body></html>`

test('Ashby live extract keeps Portfolio Password and yes/no widgets', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(ashbyMissingHtml)
    const questions = await extractQuestionsFromPage(page)
    assert.equal(questions.some((question) => question.text === 'Portfolio Link'), true)
    assert.equal(questions.some((question) => question.text === 'Portfolio Password'), true)
    const anchor = questions.find((question) => /anchor days/i.test(question.text))
    const sponsor = questions.find((question) => /sponsor an immigration/i.test(question.text))
    assert.ok(anchor)
    assert.ok(sponsor)
    assert.deepEqual(anchor?.options, ['Yes', 'No'])
    assert.deepEqual(sponsor?.options, ['Yes', 'No'])
    assert.equal(questions.filter((question) => question.text === 'Yes' || question.text === 'No').length, 0)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const workableHearHtml = `<!doctype html><html><body>
<form>
  <span id="elig_label">Are you eligible to work in the country you are applying?</span>
  <fieldset role="radiogroup" aria-labelledby="elig_label">
    <label><input type="radio" name="input_CA_10628_input" value="YES"> YES</label>
    <label><input type="radio" name="input_CA_10629_input" value="NO"> NO</label>
  </fieldset>
  <label>
    <span id="CA_10630_label"><strong>How did you hear about us?</strong></span>
    <input id="CA_10630" name="CA_10630" data-ui="CA_10630" aria-labelledby="CA_10630_label" type="text" />
  </label>
</form>
</body></html>`

test('Workable how did you hear stays a text control, not a choice group', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(workableHearHtml)
    const questions = await extractQuestionsFromPage(page)
    const hear = questions.find((question) => /how did you hear about us/i.test(question.text))
    assert.ok(hear)
    assert.equal(hear?.inputType, 'text')
    assert.equal(!hear?.options?.length, true)
    assert.equal(questions.filter((question) => /how did you hear/i.test(question.text)).length, 1)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const greenhouseLiveHtml = `<!doctype html><html><body>
<form id="application-form">
  <label for="first_name">First Name</label>
  <input id="first_name" name="first_name" />
  <label for="location">Location (City)</label>
  <select id="location" name="location"><option>San Francisco</option></select>
  <label for="gender">Gender</label>
  <select id="gender" name="gender"><option>Male</option><option>Female</option></select>
  <label for="hispanic_ethnicity">Are you Hispanic/Latino?</label>
  <select id="hispanic_ethnicity" name="hispanic_ethnicity"><option>Yes</option><option>No</option></select>
  <label for="veteran_status">Veteran Status</label>
  <select id="veteran_status" name="veteran_status"><option>I am a veteran</option></select>
  <label for="disability_status">Disability Status</label>
  <select id="disability_status" name="disability_status"><option>Yes</option><option>No</option></select>
  <input type="hidden" name="longitude" />
  <input type="hidden" name="latitude" />
</form>
</body></html>`

test('Greenhouse live extract keeps Location (City) and EEOC fields, not hidden coordinates', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(greenhouseLiveHtml)
    const questions = await extractQuestionsFromPage(page)
    assert.equal(questions.some((question) => question.text === 'Location (City)'), true)
    assert.equal(questions.some((question) => question.text === 'Gender'), true)
    assert.equal(questions.some((question) => question.text === 'Are you Hispanic/Latino?'), true)
    assert.equal(questions.some((question) => question.text === 'Veteran Status'), true)
    assert.equal(questions.some((question) => question.text === 'Disability Status'), true)
    assert.equal(questions.some((question) => /longitude|latitude/i.test(question.text)), false)
    const location = questions.find((question) => /location/i.test(question.text))
    assert.ok(location)
    await fillLiveAnswer(page, { ...location!, text: 'Location', locator: { kind: 'field', value: 'label:Location' } }, 'San Francisco')
    assert.equal(await page.locator('select#location').inputValue(), 'San Francisco')
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const workablePhoneDumpHtml = `<!doctype html><html><body>
<form>
  <label>
    Phone
    <div class="iti">
      <div class="iti__flag-container">
        <div class="iti__selected-flag" role="combobox" aria-haspopup="listbox">+1</div>
      </div>
      <input id="phone" name="phone" type="tel" class="iti__tel-input" />
      <ul class="iti__country-list" role="listbox">
        <li class="iti__country" data-dial-code="1">United States</li>
        <li class="iti__country" data-dial-code="44">United Kingdom</li>
        <li class="iti__country" data-dial-code="93">Afghanistan</li>
        <li class="iti__country" data-dial-code="355">Albania</li>
        <li class="iti__country" data-dial-code="213">Algeria</li>
        <li class="iti__country" data-dial-code="376">Andorra</li>
        <li class="iti__country" data-dial-code="244">Angola</li>
      </ul>
    </div>
  </label>
</form>
</body></html>`

test('Workable intl-tel Phone stays one tel field without a country-list question', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(workablePhoneDumpHtml)
    const questions = await extractQuestionsFromPage(page)
    const phoneFields = questions.filter((question) => /phone/i.test(question.text))
    assert.equal(phoneFields.length, 1)
    assert.equal(phoneFields[0]?.text, 'Phone')
    assert.equal(phoneFields[0]?.inputType, 'tel')
    assert.equal((phoneFields[0]?.options || []).length, 0)
    assert.equal(questions.some((question) => /united states|afghanistan/i.test(question.text)), false)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const ashbyConditionalHtml = `<!doctype html><html><body>
<form class="ashby-application-form">
  <div class="ashby-application-form-field-entry">
    <label class="ashby-application-form-question-title">Will you need sponsorship?</label>
    <div class="ashby-application-form-input-yesno">
      <button type="button" data-option="yes">Yes</button>
      <button type="button" data-option="no">No</button>
    </div>
  </div>
  <div class="ashby-application-form-field-entry" style="display:none">
    <label class="ashby-application-form-question-title">Visa type</label>
    <input name="visa_type" />
  </div>
  <div class="ashby-application-form-field-entry">
    <label class="ashby-application-form-question-title">Full Name</label>
    <input name="_systemfield_name" />
  </div>
</form>
</body></html>`

test('Ashby hidden conditional fields are omitted until visible', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(ashbyConditionalHtml)
    const hidden = await extractQuestionsFromPage(page)
    assert.equal(hidden.some((question) => /visa type/i.test(question.text)), false)
    assert.equal(hidden.some((question) => /sponsorship/i.test(question.text)), true)
    await page.evaluate(`document.querySelector('input[name="visa_type"]').closest('.ashby-application-form-field-entry').style.display = 'block'`)
    const shown = await extractQuestionsFromPage(page)
    assert.equal(shown.some((question) => /visa type/i.test(question.text)), true)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const leverLocationHtml = `<!doctype html><html><body>
<form id="application-form">
  <div class="application-question">
    <div class="application-label"><span class="text">Current location</span></div>
    <input name="location" id="location" />
    <div class="dropdown-results"></div>
  </div>
</form>
</body></html>`

test('Lever location without a unique suggestion is ANSWER_REQUIRES_USER', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(leverLocationHtml)
    const questions = await extractQuestionsFromPage(page)
    const location = questions.find((question) => /location/i.test(question.text))
    assert.ok(location)
    const { LeverApplicationPage } = await import('../../adapters/lever/LeverApplicationPage.js')
    const { AnswerRequiresUserError } = await import('../fieldResolution.js')
    await assert.rejects(
      () => new LeverApplicationPage(page).fill(location!, 'Atlantis'),
      (error: unknown) => error instanceof AnswerRequiresUserError,
    )
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})

const ashbyLocationComboHtml = `<!doctype html><html><body>
<form>
  <label for="location">Location</label>
  <input id="location" name="location" role="combobox" />
  <ul id="location-options" role="listbox" hidden>
    <li role="option">Mumbai, Maharashtra, India</li>
    <li role="option">Mumbai, Florida, United States</li>
  </ul>
</form>
<script>
const input = document.getElementById('location');
const list = document.getElementById('location-options');
input.addEventListener('input', function () {
  const query = input.value.trim().toLowerCase();
  list.hidden = !query;
  for (const option of list.querySelectorAll('[role="option"]')) {
    option.hidden = !option.textContent.toLowerCase().includes(query);
  }
});
for (const option of list.querySelectorAll('[role="option"]')) {
  option.addEventListener('click', function () {
    input.value = option.textContent.trim();
    list.hidden = true;
  });
}
</script>
</body></html>`

test('Ashby-style location combobox picks a unique typed suggestion', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent(ashbyLocationComboHtml)
    const questions = await extractQuestionsFromPage(page)
    const location = questions.find((question) => /location/i.test(question.text))
    assert.ok(location)
    await fillLiveAnswer(page, { ...location!, text: 'Location', locator: { kind: 'field', value: 'label:Location' }, inputType: 'select' }, 'Mumbai, Maharashtra, India')
    assert.match(await page.locator('#location').inputValue(), /Mumbai, Maharashtra, India/i)
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})


test('location matching accepts Indian city aliases but rejects conflicting regions', async () => {
  const { locationOptionMatches } = await import('./liveResolver.js')
  assert.equal(locationOptionMatches('Bengaluru, Karnataka, India', 'Bangalore, Karnataka, India'), true)
  assert.equal(locationOptionMatches('Mumbai, Maharashtra, India', 'Mumbai, India'), true)
  assert.equal(locationOptionMatches('Pune, United States', 'Pune, India'), false)
  assert.equal(locationOptionMatches('Navi Mumbai, Maharashtra, India', 'Mumbai, India'), false)
})
