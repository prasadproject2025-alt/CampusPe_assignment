import { isPassiveRecaptchaBadge } from '../../application/submissionConfirmation.js'
import type { Locator, Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { AnswerRequiresUserError } from '../../application/fieldResolution.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { fillLiveAnswer, resolveLiveControl, locationSearchQueries, locationOptionMatches } from '../../application/extraction/liveResolver.js'
import { hasValidCaptchaSolution, isCapSolverConfigured, solveCaptchaOnPage } from '../../application/capsolverService.js'
import { leverSelectors } from './selectors.js'

export function leverOptionMatches(candidate: string, desired: string) {
  const c = candidate.toLowerCase().trim()
  const d = desired.toLowerCase().trim()
  if (c === d) return true
  const containsPhrase = (value: string, phrase: string) =>
    value === phrase ||
    value.startsWith(`${phrase} `) ||
    value.endsWith(` ${phrase}`) ||
    value.includes(` ${phrase} `) ||
    value.includes(`, ${phrase}`) ||
    value.includes(`${phrase},`)
  return containsPhrase(c, d) || containsPhrase(d, c)
}

export class LeverApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(leverSelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
    await this.page.locator(`${leverSelectors.form} input[name="name"]`).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    const questions = await extractQuestionsFromPage(this.page)
    const storage = this.page.locator(leverSelectors.resumeStorageId)
    const stored = await storage.count() ? (await storage.inputValue()).trim() : ''
    const failed = await this.page.locator(leverSelectors.resumeFailure).isVisible().catch(() => false)
    const parsing = await this.page.locator(leverSelectors.resumeParsing).isVisible().catch(() => false)
    const accepted = !failed && !parsing && (Boolean(stored) || await this.page.locator(leverSelectors.resumeSuccess).isVisible().catch(() => false))
    for (const question of questions) {
      if (question.inputType === 'file' && /^(resume|cv)(\s*[/&]\s*(resume|cv))?$/i.test(question.text.trim())) question.answered = accepted || (!failed && !parsing && question.answered)
    }
    return questions
  }

  async focus(question: AdapterQuestion) {
    const target = question.inputType === 'file' ? this.page.locator(leverSelectors.resumeButton) : await resolveLiveControl(this.page, question)
    await this.scrollNaturally(target)
    await target.hover().catch(() => undefined)
    await this.pause(750, 1_300)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const desired = String(answer)
    if (/^(current\s+)?location$/i.test(question.text.trim()) || /(?:^|:)location$/i.test(question.locator.value)) {
      await this.fillLocationField(question, desired)
      return
    }
    await fillLiveAnswer(this.page, question, answer)
    await this.pause(700, 1_200)
  }

  private async fillLocationField(question: AdapterQuestion, desired: string): Promise<void> {
    const input = this.page.locator(leverSelectors.locationInput).first()
    if (!await input.count()) {
      const fallback = await resolveLiveControl(this.page, question)
      await fillLiveAnswer(this.page, question, desired)
      return
    }

    await this.scrollNaturally(input)
    await input.click({ timeout: 10_000 }).catch(() => undefined)
    await this.pause(200, 400)

    // If CapSolver is enabled and captcha is not yet solved, solve it before searching location
    // because Lever's /searchLocations endpoint validates hcaptchaResponse.
    if (isCapSolverConfigured() && !await hasValidCaptchaSolution(this.page)) {
      console.log('[Lever] Attempting CapSolver auto-solve before location query...')
      await solveCaptchaOnPage(this.page).catch(err => {
        console.warn('[Lever] Pre-location CapSolver attempt failed:', err)
      })
    }

    const queries = locationSearchQueries(desired)
    if (!queries.includes(desired.trim())) queries.unshift(desired.trim())

    const resultsContainer = this.page.locator(leverSelectors.locationResults)
    let selected = false
    let suggestionsEncountered = false

    for (const query of queries) {
      await input.fill('')
      await this.pause(100, 200)
      await input.pressSequentially(query, { delay: 35, timeout: 8_000 })
      await input.dispatchEvent('input').catch(() => undefined)
      await input.dispatchEvent('keydown', { key: 'a' }).catch(() => undefined)

      const deadline = Date.now() + 3_000
      while (Date.now() < deadline) {
        await this.page.waitForTimeout(300)
        const suggestions = resultsContainer.locator('.dropdown-location, [id^="location-"], li, > *')
        const count = await suggestions.count().catch(() => 0)
        if (count > 0) {
          suggestionsEncountered = true
          let bestIndex = -1
          for (let i = 0; i < count; i++) {
            const text = (await suggestions.nth(i).innerText().catch(() => '')).trim()
            if (text && (locationOptionMatches(text, desired) || locationOptionMatches(text, query) || leverOptionMatches(text, desired) || leverOptionMatches(text, query))) {
              bestIndex = i
              break
            }
          }
          if (bestIndex !== -1) {
            const targetOption = suggestions.nth(bestIndex)
            // Lever retrieveLocations.js listens to mousedown on .dropdown-location
            await targetOption.dispatchEvent('mousedown').catch(() => undefined)
            await targetOption.click({ timeout: 5_000 }).catch(() => undefined)
            await this.pause(300, 600)

            const val = await input.inputValue().catch(() => '')
            if (val) {
              selected = true
              break
            }
          }
        }
      }
      if (selected) break
    }

    if (!selected) {
      if (suggestionsEncountered) {
        throw new AnswerRequiresUserError(question.text, `ANSWER_REQUIRES_USER: Lever could not match the saved city to a unique location suggestion.`)
      }
      await input.fill(desired)
      await input.dispatchEvent('change').catch(() => undefined)
    }
  }

  async fillEducation(_education: EducationRecord[]) { throw new Error('Lever education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(leverSelectors.resume).setInputFiles(resume) }
  async waitForResumeParsing() {
    const parsing = this.page.locator(leverSelectors.resumeParsing)
    const success = this.page.locator(leverSelectors.resumeSuccess)
    const failure = this.page.locator(leverSelectors.resumeFailure)
    const filename = this.page.locator(leverSelectors.resumeFilename)
    const storageId = this.page.locator(leverSelectors.resumeStorageId)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      if (await failure.isVisible().catch(() => false)) throw new Error('Lever could not parse the résumé. Check the uploaded file in the live preview.')
      const storedResumeId = (await storageId.inputValue().catch(() => '')).trim()
      if (storedResumeId) return
      const parsingVisible = await parsing.isVisible().catch(() => false)
      const successVisible = await success.isVisible().catch(() => false)
      const filenameVisible = Boolean((await filename.textContent().catch(() => ''))?.trim())
      if (!parsingVisible && (successVisible || filenameVisible)) return
      await this.page.waitForTimeout(350)
    }
    throw new Error('Lever résumé parsing did not finish. Check the uploaded file in the live preview.')
  }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.page.locator(leverSelectors.resume).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> {
    // If captcha is already solved and valid, no blocker
    if (await hasValidCaptchaSolution(this.page)) return null

    const challengeIframes = this.page.locator('iframe[src*="hcaptcha.com"][src*="frame=challenge"], iframe[title*="challenge" i], iframe[title*="hCaptcha security challenge" i], iframe[title*="Main content of the hCaptcha challenge" i], iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]')
    let challengeVisible = false
    let challengeType: 'recaptcha' | 'hcaptcha' | 'unknown' = 'unknown'

    for (let index = 0; index < await challengeIframes.count(); index += 1) {
      if (await challengeIframes.nth(index).isVisible().catch(() => false)) {
        const src = await challengeIframes.nth(index).getAttribute('src').catch(() => null)
        if (isPassiveRecaptchaBadge(src)) continue
        challengeVisible = true
        if (src && src.includes('hcaptcha')) challengeType = 'hcaptcha'
        else if (src && src.includes('recaptcha')) challengeType = 'recaptcha'
        break
      }
    }
    if (!challengeVisible) {
      const challengeText = this.page.getByText(/drag one animal|matching silhouette|verify you are human|complete the challenge/i).first()
      if (await challengeText.isVisible().catch(() => false)) {
        challengeVisible = true
      }
    }

    if (challengeVisible) {
      // If CapSolver is configured, attempt auto-solving
      if (isCapSolverConfigured()) {
        console.log('[Lever] Active CAPTCHA challenge detected. Attempting CapSolver auto-solve...')
        const solved = await solveCaptchaOnPage(this.page).catch(err => ({ success: false, error: String(err) }))
        if (solved.success) {
          console.log('[Lever] CapSolver auto-solved CAPTCHA successfully!')
          return null
        }
      }
      return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.', provider: 'lever', challengeType }
    }
    return null
  }
  async isReadyForReview() {
    const button = await this.submitButton()
    return await button.count() > 0
  }
  async submit() {
    if (isCapSolverConfigured() && !await hasValidCaptchaSolution(this.page)) {
      console.log('[Lever] Ensuring CAPTCHA is solved prior to submit...')
      await solveCaptchaOnPage(this.page).catch(() => undefined)
    }

    const button = await this.submitButton()
    if (!await button.count()) throw new Error('The Lever Submit Application button is not available.')
    await this.scrollNaturally(button)
    await button.hover()
    await this.pause(650, 1_050)
    await button.click({ timeout: 15_000 })
    await this.pause(500, 1_000)

    // If token is present, ensure Lever's hidden submit button is triggered if needed
    if (await hasValidCaptchaSolution(this.page)) {
      await this.page.evaluate(() => {
        const hBtn = document.getElementById('hcaptchaSubmitBtn') as HTMLButtonElement | null
        if (hBtn) hBtn.click()
      }).catch(() => undefined)
    }
  }

  private async submitButton() {
    const exact = this.page.locator('#application-form #btn-submit').first()
    if (await exact.count()) return exact
    const css = this.page.locator(leverSelectors.submit).first()
    if (await css.count()) return css
    return this.page.getByRole('button', { name: /submit application/i }).first()
  }
  private normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
  private async scrollNaturally(target: Locator) {
    for (let step = 0; step < 24; step += 1) {
      const box = await target.boundingBox()
      const viewport = this.page.viewportSize()
      if (!box || !viewport) break
      const delta = box.y + box.height / 2 - viewport.height / 2
      if (Math.abs(delta) < 90) break
      const movement = Math.sign(delta) * Math.min(Math.max(Math.abs(delta) * 0.35, 90), 360)
      await this.page.mouse.wheel(0, movement)
      await this.pause(70, 130)
    }
    await target.scrollIntoViewIfNeeded()
  }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
