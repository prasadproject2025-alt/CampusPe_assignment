import type { Locator, Page } from 'playwright-core'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { fillLiveAnswer } from '../../application/extraction/liveResolver.js'
import { breezySelectors } from './selectors.js'

export class BreezyApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(breezySelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
    await this.page.locator(`${breezySelectors.form} input[name="cName"]`).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    const questions = await extractQuestionsFromPage(this.page)
    const educationRequired = await this.page.locator('#education_required').inputValue().catch(() => '')
    if (educationRequired === 'required' && !questions.some((question) => question.locator.kind === 'education')) {
      questions.push({ id: '_breezy_education', text: 'Education', fieldType: 'text', required: true, locator: { kind: 'education', value: '_breezy_education' }, answered: false, inputType: 'group' })
    }
    return questions
  }

  async focus(question: AdapterQuestion) {
    if (question.locator.kind === 'education') { await this.page.locator(breezySelectors.addEducation).scrollIntoViewIfNeeded(); return }
    if (question.inputType === 'file') await this.page.locator(breezySelectors.resumeButton).first().scrollIntoViewIfNeeded()
    else await this.page.getByText(question.text, { exact: false }).first().scrollIntoViewIfNeeded()
    await this.pause(400, 750)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    await fillLiveAnswer(this.page, question, answer)
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
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.page.locator(breezySelectors.resume).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> {
    const captcha = this.page.locator(breezySelectors.recaptchaChallenge).first()
    if (await captcha.isVisible().catch(() => false)) {
      return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.', provider: 'breezy', challengeType: 'recaptcha' }
    }
    return null
  }
  async isReadyForReview() { return this.page.locator(breezySelectors.submit).isVisible().catch(() => false) }
  async submit() {
    const button = this.page.locator(breezySelectors.submit)
    if (!await button.isVisible()) throw new Error('The Breezy Submit Application button is not available.')
    await button.scrollIntoViewIfNeeded(); await this.pause(550, 900); await button.click()
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
