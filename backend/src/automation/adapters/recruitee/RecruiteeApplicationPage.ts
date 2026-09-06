import type { Locator, Page } from 'playwright-core'
import { Country } from 'country-state-city'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { recruiteeSelectors } from './selectors.js'

export class RecruiteeApplicationPage {
  constructor(private readonly page: Page) {}
  async waitUntilReady() { await this.page.locator(recruiteeSelectors.form).waitFor({ state: 'visible', timeout: 30_000 }); await this.page.locator('[name="candidate.name"]').waitFor({ state: 'visible', timeout: 30_000 }) }
  async readQuestions(): Promise<AdapterQuestion[]> {
    const questions = await extractQuestionsFromPage(this.page)
    if (await this.page.locator('button[id^="country-select-input-candidate.phone"]').count()) {
      if (!questions.some((question) => /phone country/i.test(question.text))) {
        questions.splice(2, 0, { id: 'phone_country_code', text: 'Phone country code', fieldType: 'select', required: true, locator: { kind: 'field', value: 'label:Phone country code' }, answered: false, inputType: 'country-code' })
      }
    }
    return questions
  }
  async focus(question: AdapterQuestion) { await this.inputFor(question).scrollIntoViewIfNeeded(); await this.pause(350, 650) }
  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const desired = String(answer)
    if (question.locator.value === 'recruitee:phone-country' || /phone country/i.test(question.text)) {
      const country = Country.getCountryByCode(desired.toUpperCase())
      const dialCode = country?.phonecode.replace(/^\+/, '')
      if (!dialCode) throw new Error(`Recruitee could not resolve phone country “${desired}”.`)
      const phone = this.page.locator('[name="candidate.phone"]').first()
      await phone.fill(`+${dialCode}`)
      await this.pause(250, 450)
    } else if (question.inputType === 'radio') {
      const raw = /^(yes|true)$/i.test(desired) ? 'true' : /^(no|false)$/i.test(desired) ? 'false' : desired
      const radio = this.page.locator(`input[type="radio"][name="${this.escapeAttribute(question.locator.value.slice(5))}"][value="${this.escapeAttribute(raw)}"]`).first()
      if (!await radio.count()) throw new Error(`No matching Recruitee choice for “${desired}”.`)
      await radio.click({ force: true })
    } else {
      const input = this.inputFor(question)
      await input.click()
      const isPhone = question.locator.value === 'name:candidate.phone'
      const existing = isPhone ? await input.inputValue() : ''
      if (!isPhone || !/^\+\d+$/.test(existing) || desired.startsWith('+')) await input.fill('')
      await input.pressSequentially(desired, { delay: this.random(45, 85), timeout: 90_000 })
    }
    await this.pause(400, 700)
  }
  async fillEducation(_education: EducationRecord[]) { throw new Error('Recruitee education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(recruiteeSelectors.resume).setInputFiles(resume) }
  async waitForResumeParsing() { const input = this.page.locator(recruiteeSelectors.resume); const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if ((await input.inputValue().catch(() => '')).trim()) return; await this.page.waitForTimeout(300) } throw new Error('Recruitee did not retain the uploaded résumé.') }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.inputFor(question).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> {
    const captcha = this.page.locator(recruiteeSelectors.captchaChallenge).first()
    if (await captcha.isVisible().catch(() => false)) {
      const src = await captcha.getAttribute('src').catch(() => null)
      let challengeType: 'recaptcha' | 'hcaptcha' | 'turnstile' | 'unknown' = 'unknown'
      if (src && src.includes('hcaptcha')) challengeType = 'hcaptcha'
      else if (src && src.includes('recaptcha')) challengeType = 'recaptcha'
      else if (src && (src.includes('turnstile') || src.includes('cloudflare'))) challengeType = 'turnstile'
      return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.', provider: 'recruitee', challengeType }
    }
    return null
  }
  async isReadyForReview() { return this.page.locator(recruiteeSelectors.submit).isVisible().catch(() => false) }
  async submit() { const button = this.page.locator(recruiteeSelectors.submit); if (!await button.isVisible()) throw new Error('The Recruitee Send button is unavailable.'); await button.click() }
  private inputFor(question: AdapterQuestion): Locator { if (question.locator.value === 'recruitee:phone-country' || /phone country/i.test(question.text)) return this.page.locator(recruiteeSelectors.phoneCountry); if (question.locator.value === '_systemfield_resume' || question.inputType === 'file') return this.page.locator(recruiteeSelectors.resume); if (question.locator.value.startsWith('name:')) return this.page.locator(`[name="${this.escapeAttribute(question.locator.value.slice(5))}"]`).first(); throw new Error(`Could not locate Recruitee field “${question.text}”.`) }
  private escapeAttribute(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
