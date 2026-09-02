import type { Locator, Page } from 'playwright-core'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { bambooHrSelectors } from './selectors.js'

export class BambooHrApplicationPage {
  constructor(private readonly page: Page) {}
  async waitUntilReady() { await this.page.locator(bambooHrSelectors.form).waitFor({ state: 'visible', timeout: 30_000 }); await this.page.locator('#firstName').waitFor({ state: 'visible', timeout: 30_000 }) }
  async readQuestions(): Promise<AdapterQuestion[]> {
    return this.page.locator(bambooHrSelectors.form).evaluate((form) => {
      type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      const questions: AdapterQuestion[] = []; const seen = new Set<string>()
      const controls = [...form.querySelectorAll('input:not([type="hidden"]), textarea, select')] as Control[]
      for (const control of controls) {
        if (control.name?.startsWith('nickname_') || control.id === 'g-recaptcha-response' || control.name === 'g-recaptcha-response') continue
        const isResume = control.type === 'file'; const key = isResume ? '_systemfield_resume' : control.name || control.id
        if (!key || seen.has(key)) continue
        seen.add(key)
        const radios = control.type === 'radio' && control.name ? [...form.querySelectorAll(`input[type="radio"][name="${CSS.escape(control.name)}"]`)] as HTMLInputElement[] : []
        const fieldset = control.closest('fieldset')
        let text = fieldset?.querySelector('legend')?.textContent || (control.id ? form.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent : '') || control.name || control.id
        text = text.replace(/\s+/g, ' ').replace(/[ *]+$/, '').trim()
        if (isResume) text = 'Resume/CV'
        const inputType = isResume ? 'file' : radios.length ? 'radio' : control.tagName === 'SELECT' ? 'select' : control.tagName === 'TEXTAREA' ? 'textarea' : control.type || 'text'
        const fieldType: FieldType = inputType === 'textarea' ? 'textarea' : inputType === 'select' || inputType === 'radio' ? 'select' : inputType === 'number' ? 'number' : 'text'
        const required = isResume || control.required || fieldset?.getAttribute('aria-required') === 'true' || Boolean(control.closest('[data-fabric-component$="InputWrapper"]')?.querySelector('.Mui-required'))
        const options = radios.length ? radios.map((radio) => radio.value) : undefined
        const answered = radios.length ? radios.some((radio) => radio.checked) : inputType === 'select' && control.name === 'countryId.value' ? false : Boolean(control.value.trim())
        questions.push({ id: key, text, fieldType, options, required, locator: { kind: 'field', value: isResume ? '_systemfield_resume' : control.name ? `name:${control.name}` : `id:${control.id}` }, answered, inputType })
      }
      const countryIndex = questions.findIndex((question) => question.id === 'countryId.value')
      if (countryIndex > 0) questions.unshift(...questions.splice(countryIndex, 1))
      const stateIndex = questions.findIndex((question) => question.id === 'state.value')
      if (stateIndex >= 0 && stateIndex < questions.length - 1) questions.push(...questions.splice(stateIndex, 1))
      return questions
    })
  }
  async focus(question: AdapterQuestion) { await this.interactiveFor(question).scrollIntoViewIfNeeded(); await this.pause(350, 650) }
  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const desired = String(answer)
    if (question.inputType === 'select') {
      const button = this.selectButton(question); await button.click(); await this.pause(300, 550)
      const option = this.page.getByRole('option', { name: new RegExp(`^${this.escapeRegex(desired)}$`, 'i') }).first()
      if (!await option.isVisible().catch(() => false)) throw new Error(`No matching BambooHR option for “${desired}”.`)
      await option.click()
    } else if (question.inputType === 'radio') {
      const radio = this.page.locator(`input[type="radio"][name="${this.escapeAttribute(question.locator.value.slice(5))}"][value="${this.escapeAttribute(desired)}"]`).first()
      if (!await radio.count()) throw new Error(`No matching BambooHR choice for “${desired}”.`)
      await radio.click({ force: true })
    } else {
      const input = this.inputFor(question); await input.click(); await input.fill(''); await input.pressSequentially(desired, { delay: this.random(45, 85), timeout: 90_000 })
    }
    await this.pause(400, 700)
  }
  async fillEducation(_education: EducationRecord[]) { throw new Error('BambooHR education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(bambooHrSelectors.resume).setInputFiles(resume) }
  async waitForResumeParsing() { const resumeId = this.page.locator(bambooHrSelectors.resumeId); const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if ((await resumeId.inputValue().catch(() => '')).trim()) return; await this.page.waitForTimeout(300) } throw new Error('BambooHR did not finish saving the résumé. Check the uploaded file in the visible browser.') }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.inputFor(question).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> { const captcha = this.page.locator(bambooHrSelectors.captchaChallenge).first(); return await captcha.isVisible().catch(() => false) ? { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' } : null }
  async isReadyForReview() { return this.page.locator(bambooHrSelectors.submit).isVisible().catch(() => false) }
  async submit() { const button = this.page.locator(bambooHrSelectors.submit); if (!await button.isVisible()) throw new Error('The BambooHR Submit Application button is unavailable.'); await button.click(); const confirmation = this.page.getByText(/application (?:submitted|received)|thank you for applying/i).first(); await confirmation.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined); const blocker = await this.detectBlocker(); if (blocker) throw new Error(blocker.message); if (await button.isVisible().catch(() => false)) throw new Error('BambooHR did not confirm submission. Review the highlighted fields in the browser.') }
  private inputFor(question: AdapterQuestion): Locator { const value = question.locator.value; if (value === '_systemfield_resume') return this.page.locator(bambooHrSelectors.resume); if (value.startsWith('name:')) return this.page.locator(`[name="${this.escapeAttribute(value.slice(5))}"]`).first(); if (value.startsWith('id:')) return this.page.locator(`#${this.escapeId(value.slice(3))}`).first(); throw new Error(`Could not locate BambooHR field “${question.text}”.`) }
  private interactiveFor(question: AdapterQuestion) { return question.inputType === 'select' ? this.selectButton(question) : this.inputFor(question) }
  private selectButton(question: AdapterQuestion) { return this.inputFor(question).locator('xpath=ancestor::*[@data-fabric-component="SelectField InputWrapper"][1]//button[@aria-haspopup="true"]').first() }
  private escapeId(value: string) { return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1') }
  private escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  private escapeAttribute(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
