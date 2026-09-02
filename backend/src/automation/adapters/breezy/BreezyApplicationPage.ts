import type { Locator, Page } from 'playwright-core'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { breezySelectors } from './selectors.js'

export class BreezyApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(breezySelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
    await this.page.locator(`${breezySelectors.form} input[name="cName"]`).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    return this.page.locator(breezySelectors.form).evaluate((form) => {
      type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      const questions: AdapterQuestion[] = []; const seen = new Set<string>()
      const controls = [...form.querySelectorAll('input:not([type="hidden"]), textarea, select')] as Control[]
      for (const control of controls) {
        if (control.closest('[aria-hidden="true"]') || control.getAttribute('tabindex') === '-1' || control.getAttribute('ng-model')?.includes('candidateSchool')) continue
        const isResume = control.type === 'file' && control.id === 'main-attachment'
        const locator = control.id ? `id:${control.id}` : control.name ? `name:${control.name}` : control.matches('select.salary-details') ? 'class:salary-details' : ''
        const id = isResume ? '_systemfield_resume' : locator
        if (!id || seen.has(id)) continue
        seen.add(id)
        let text = control.getAttribute('placeholder') || ''
        if (isResume) text = 'Resume/CV'
        if (control.name === 'cSummary') text = 'Experience Summary'
        if (control.name === 'cCoverLetter') text = 'Cover Letter'
        if (control.name === 'gdprAgreement') text = 'Recruitment Privacy Notice consent'
        if (!text && control instanceof HTMLSelectElement && control.matches('.salary-details')) text = 'Desired Salary period'
        if (!text) {
          const label = control.closest('label')
          const section = control.closest('.section, .desired-salary')
          text = (label?.textContent || section?.querySelector('h3')?.textContent || control.name || control.id).replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        }
        const inputType = isResume ? 'file' : control.type === 'checkbox' ? 'checkbox' : control instanceof HTMLSelectElement ? 'select' : control instanceof HTMLTextAreaElement ? 'textarea' : control.type || 'text'
        const fieldType: FieldType = inputType === 'textarea' ? 'textarea' : inputType === 'select' || inputType === 'checkbox' ? 'select' : inputType === 'number' ? 'number' : 'text'
        const options = control instanceof HTMLSelectElement ? [...control.options].map((option) => option.textContent?.trim() || option.value).filter(Boolean) : inputType === 'checkbox' ? ['Yes'] : undefined
        const answered = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : Boolean(control.value.trim())
        questions.push({ id, text, fieldType, options, required: control.required, locator: { kind: 'field', value: locator }, answered, inputType })
      }
      const educationRequired = (form.querySelector('#education_required') as HTMLInputElement | null)?.value === 'required'
      if (educationRequired) questions.push({ id: '_breezy_education', text: 'Education', fieldType: 'text', required: true, locator: { kind: 'education', value: '_breezy_education' }, answered: Boolean(form.querySelector('li[ng-repeat*="candidateSchool"]')), inputType: 'group' })
      return questions
    })
  }

  async focus(question: AdapterQuestion) {
    if (question.locator.kind === 'education') { await this.page.locator(breezySelectors.addEducation).scrollIntoViewIfNeeded(); return }
    const input = this.inputFor(question)
    if (question.inputType === 'file') await this.page.locator(breezySelectors.resumeButton).first().scrollIntoViewIfNeeded()
    else await input.scrollIntoViewIfNeeded()
    await this.pause(400, 750)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const input = this.inputFor(question); const desired = String(answer)
    if (question.inputType === 'checkbox') {
      const shouldCheck = /^(?:yes|true|1|agree|accepted)$/i.test(desired)
      if (await input.isChecked() !== shouldCheck) await input.click()
    } else if (question.inputType === 'select') {
      await input.selectOption({ label: desired }).catch(() => input.selectOption(desired.toLowerCase()))
    } else {
      await input.click(); await input.fill(''); await input.pressSequentially(desired, { delay: this.random(50, 90), timeout: 90_000 })
    }
    await this.pause(450, 800)
  }

  async fillEducation(education: EducationRecord[]) {
    if (!education.length) throw new Error('Add education to your profile before completing this Breezy application.')
    for (let index = 0; index < education.length; index += 1) {
      if (index >= await this.page.locator(breezySelectors.educationEntry).count()) {
        await this.page.locator(breezySelectors.addEducation).click(); await this.pause(350, 650)
      }
      const entry = this.page.locator(breezySelectors.educationEntry).nth(index); const record = education[index]!
      await entry.locator('[ng-model="candidateSchool.school_name"]').fill(record.school)
      await entry.locator('[ng-model="candidateSchool.field_of_study"]').fill(record.field || record.degree)
      if (record.startDate) await entry.locator('[ng-model="candidateSchool.date_start"]').fill(this.dateValue(record.startDate))
      if (record.endDate && !record.current) await entry.locator('[ng-model="candidateSchool.date_end"]').fill(this.dateValue(record.endDate))
    }
  }

  async uploadResume(resume: ResumeUpload) { await this.page.locator(breezySelectors.resume).setInputFiles(resume); await this.pause(900, 1_300) }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.inputFor(question).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> {
    const captcha = this.page.locator(breezySelectors.recaptchaChallenge).first()
    if (await captcha.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' }
    return null
  }
  async isReadyForReview() { return this.page.locator(breezySelectors.submit).isVisible().catch(() => false) }
  async submit() {
    const button = this.page.locator(breezySelectors.submit)
    if (!await button.isVisible()) throw new Error('The Breezy Submit Application button is not available.')
    await button.scrollIntoViewIfNeeded(); await this.pause(550, 900); await button.click()
    const confirmation = this.page.getByText(/application (?:was |has been )?(?:submitted|received)|thank you for applying/i).first()
    await confirmation.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined)
    const blocker = await this.detectBlocker(); if (blocker) throw new Error(blocker.message)
    if (await button.isVisible().catch(() => false)) throw new Error('Breezy did not confirm submission. Review the highlighted fields in the browser.')
  }

  private inputFor(question: AdapterQuestion): Locator {
    const value = question.locator.value
    if (value === 'id:main-attachment') return this.page.locator(breezySelectors.resume)
    if (value.startsWith('id:')) return this.page.locator(`#${this.escapeId(value.slice(3))}`).first()
    if (value.startsWith('name:')) return this.page.locator(`[name="${value.slice(5).replaceAll('"', '\\"')}"]`).first()
    if (value === 'class:salary-details') return this.page.locator('select.salary-details').first()
    throw new Error(`Could not locate Breezy field “${question.text}”.`)
  }
  private dateValue(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : /^\d{4}-\d{2}$/.test(value) ? `${value}-01` : /^\d{4}$/.test(value) ? `${value}-01-01` : value.slice(0, 10) }
  private escapeId(value: string) { return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1') }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
