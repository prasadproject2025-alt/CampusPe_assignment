import type { Page } from 'playwright-core'
import { Country } from 'country-state-city'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { fillLiveAnswer, resolveLiveControl } from '../../application/extraction/liveResolver.js'
import { workableSelectors } from './selectors.js'

export class WorkableApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(workableSelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
    await this.page.locator('[data-ui="firstname"], input[name="firstname"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    const questions = await extractQuestionsFromPage(this.page)
    const countryButton = this.page.locator(workableSelectors.phoneCountryButton)
    if (await countryButton.count() && !questions.some((question) => /phone country/i.test(question.text))) {
      const phoneIndex = Math.max(0, questions.findIndex((question) => /phone/i.test(question.text)))
      questions.splice(phoneIndex, 0, {
        id: 'phone_country_code',
        text: 'Phone country code',
        fieldType: 'select',
        required: true,
        locator: { kind: 'field', value: 'label:Phone country code' },
        answered: false,
        inputType: 'country-code',
      })
    }
    return questions
  }

  async focus(question: AdapterQuestion) {
    const input = await resolveLiveControl(this.page, question)
    await input.scrollIntoViewIfNeeded()
    await this.pause(350, 650)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const desired = String(answer)
    if (question.inputType === 'country-code' || /phone country/i.test(question.text)) {
      const country = Country.getCountryByCode(desired.toUpperCase())
      const digits = (country?.phonecode || desired).replace(/\D/g, '')
      const isoCode = country?.isoCode.toLowerCase()
      if (!digits) throw new Error(`The saved phone country “${desired}” has no dial code.`)
      const button = this.page.locator(workableSelectors.phoneCountryButton)
      const current = `${await button.getAttribute('title').catch(() => '') || ''} ${await button.locator('.iti__selected-dial-code').textContent().catch(() => '') || ''}`
      if (!new RegExp(`\\+${digits}(?:\\D|$)`).test(current)) {
        await button.click()
        const option = this.page.locator(isoCode
          ? `${workableSelectors.phoneCountryOptions}[data-country-code="${isoCode}"]`
          : `${workableSelectors.phoneCountryOptions}[data-dial-code="${digits}"]`).first()
        if (!await option.isVisible({ timeout: 2_500 }).catch(() => false)) throw new Error(`Workable does not list phone country code +${digits}.`)
        await option.click()
      }
      return
    }
    await fillLiveAnswer(this.page, question, answer)
    if (/address/i.test(question.text)) {
      await this.pause(650, 950)
      const suggestion = this.page.locator(workableSelectors.addressOptions).first()
      if (await suggestion.isVisible().catch(() => false)) await suggestion.click()
    }
    await this.pause(400, 700)
  }

  async fillEducation(_education: EducationRecord[]) { throw new Error('Workable education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(workableSelectors.resume).setInputFiles(resume) }
  async waitForResumeParsing() {
    const input = this.page.locator(workableSelectors.resume)
    const busy = this.page.locator(`${workableSelectors.resumeDropzone} [role="progressbar"], ${workableSelectors.resumeDropzone} [aria-busy="true"]`)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const retainedFile = Boolean((await input.inputValue().catch(() => '')).trim())
      let processing = false
      for (let index = 0; index < await busy.count(); index += 1) {
        if (await busy.nth(index).isVisible().catch(() => false)) { processing = true; break }
      }
      if (retainedFile && !processing) return
      await this.page.waitForTimeout(300)
    }
    throw new Error('Workable résumé processing did not finish.')
  }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await (await resolveLiveControl(this.page, question)).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> {
    const captcha = this.page.locator(workableSelectors.captchaChallenge).first()
    if (await captcha.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA on the employer site, then continue. JobCopilot will not bypass it.' }
    return null
  }
  async isReadyForReview() { return this.page.locator(workableSelectors.submit).isVisible().catch(() => false) }
  async submit() {
    const button = this.page.locator(workableSelectors.submit)
    if (!await button.isVisible()) throw new Error('The Workable Submit application button is not available.')
    await button.scrollIntoViewIfNeeded(); await this.pause(500, 850); await button.click()
  }

  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
