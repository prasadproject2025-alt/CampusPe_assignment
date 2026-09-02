import type { Locator, Page } from 'playwright-core'
import { Country } from 'country-state-city'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { recruiteeSelectors } from './selectors.js'

export class RecruiteeApplicationPage {
  constructor(private readonly page: Page) {}
  async waitUntilReady() { await this.page.locator(recruiteeSelectors.form).waitFor({ state: 'visible', timeout: 30_000 }); await this.page.locator('[name="candidate.name"]').waitFor({ state: 'visible', timeout: 30_000 }) }
  async readQuestions(): Promise<AdapterQuestion[]> {
    return this.page.locator(recruiteeSelectors.form).evaluate((form) => {
      type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      const questions: AdapterQuestion[] = []; const seen = new Set<string>()
      for (const control of [...form.querySelectorAll('input:not([type="hidden"]), textarea, select')] as Control[]) {
        const isResume = control.type === 'file' && control.name === 'candidate.cv'; const key = isResume ? '_systemfield_resume' : control.name || control.id
        if (!key || seen.has(key)) continue
        seen.add(key)
        const radios = control.type === 'radio' && control.name ? [...form.querySelectorAll(`input[type="radio"][name="${CSS.escape(control.name)}"]`)] as HTMLInputElement[] : []
        const fieldset = control.closest('fieldset')
        let text = (radios.length ? fieldset?.querySelector('legend')?.textContent : '') || (control.id ? form.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent : '') || control.getAttribute('placeholder') || key
        text = text.replace(/\s+/g, ' ').replace(/[ *]+$/, '').trim()
        if (isResume) text = 'Resume/CV'
        if (control.name === 'candidate.coverLetterFile') text = 'Cover Letter'
        if (control.name === 'candidate.name') text = 'Full name'
        if (control.name === 'candidate.email') text = 'Email address'
        if (control.name === 'candidate.phone') text = 'Phone number'
        const inputType = isResume || control.type === 'file' ? 'file' : radios.length ? 'radio' : control.tagName === 'SELECT' ? 'select' : control.tagName === 'TEXTAREA' ? 'textarea' : control.type || 'text'
        const fieldType: FieldType = inputType === 'textarea' ? 'textarea' : inputType === 'radio' || inputType === 'select' ? 'select' : 'text'
        const options = radios.length ? radios.map((radio) => radio.value === 'true' ? 'Yes' : radio.value === 'false' ? 'No' : radio.value) : undefined
        const answered = radios.length ? radios.some((radio) => radio.checked) : control.type === 'file' ? Boolean((control as HTMLInputElement).files?.length) : Boolean(control.value.trim())
        questions.push({ id: key, text, fieldType, options, required: control.required, locator: { kind: 'field', value: isResume ? '_systemfield_resume' : `name:${key}` }, answered, inputType })
      }
      if (form.querySelector('button[id^="country-select-input-candidate.phone"]')) questions.splice(2, 0, { id: '_recruitee_phone_country', text: 'Phone country code', fieldType: 'select', required: true, locator: { kind: 'field', value: 'recruitee:phone-country' }, answered: false, inputType: 'country-code' })
      return questions
    })
  }
  async focus(question: AdapterQuestion) { await this.inputFor(question).scrollIntoViewIfNeeded(); await this.pause(350, 650) }
  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const desired = String(answer)
    if (question.locator.value === 'recruitee:phone-country') {
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
  async detectBlocker(): Promise<Blocker | null> { const captcha = this.page.locator(recruiteeSelectors.captchaChallenge).first(); return await captcha.isVisible().catch(() => false) ? { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' } : null }
  async isReadyForReview() { return this.page.locator(recruiteeSelectors.submit).isVisible().catch(() => false) }
  async submit() { const button = this.page.locator(recruiteeSelectors.submit); if (!await button.isVisible()) throw new Error('The Recruitee Send button is unavailable.'); await button.click(); const confirmation = this.page.getByText(/application (?:submitted|received)|thank you/i).first(); await confirmation.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined); const blocker = await this.detectBlocker(); if (blocker) throw new Error(blocker.message); if (await button.isVisible().catch(() => false)) throw new Error('Recruitee did not confirm submission. Review the highlighted fields.') }
  private inputFor(question: AdapterQuestion): Locator { if (question.locator.value === 'recruitee:phone-country') return this.page.locator(recruiteeSelectors.phoneCountry); if (question.locator.value === '_systemfield_resume') return this.page.locator(recruiteeSelectors.resume); if (question.locator.value.startsWith('name:')) return this.page.locator(`[name="${this.escapeAttribute(question.locator.value.slice(5))}"]`).first(); throw new Error(`Could not locate Recruitee field “${question.text}”.`) }
  private escapeAttribute(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
