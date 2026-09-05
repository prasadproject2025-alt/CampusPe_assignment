import type { Locator, Page } from 'playwright-core'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { fillLiveAnswer } from '../../application/extraction/liveResolver.js'
import { bambooHrSelectors } from './selectors.js'

export class BambooHrApplicationPage {
  constructor(private readonly page: Page) {}
  async waitUntilReady() { await this.page.locator(bambooHrSelectors.form).waitFor({ state: 'visible', timeout: 30_000 }); await this.page.locator('#firstName').waitFor({ state: 'visible', timeout: 30_000 }) }
  async readQuestions(): Promise<AdapterQuestion[]> {
    return extractQuestionsFromPage(this.page)
  }
  async focus(question: AdapterQuestion) { await this.page.getByText(question.text, { exact: false }).first().scrollIntoViewIfNeeded(); await this.pause(350, 650) }
  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const desired = String(answer)
    if (question.inputType === 'select') {
      const button = this.page.getByRole('combobox', { name: new RegExp(question.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
      await button.click(); await this.pause(300, 550)
      const option = this.page.getByRole('option', { name: new RegExp(`^${this.escapeRegex(desired)}$`, 'i') }).first()
      if (!await option.isVisible({ timeout: 2_500 }).catch(() => false)) throw new Error(`No matching BambooHR option for “${desired}”.`)
      await option.click()
      return
    }
    await fillLiveAnswer(this.page, question, answer)
    await this.pause(400, 700)
  }
  async fillEducation(_education: EducationRecord[]) { throw new Error('BambooHR education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(bambooHrSelectors.resume).setInputFiles(resume) }
  async waitForResumeParsing() { const resumeId = this.page.locator(bambooHrSelectors.resumeId); const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if ((await resumeId.inputValue().catch(() => '')).trim()) return; await this.page.waitForTimeout(300) } throw new Error('BambooHR did not finish saving the résumé. Check the uploaded file in the live preview.') }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.inputFor(question).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> { const captcha = this.page.locator(bambooHrSelectors.captchaChallenge).first(); return await captcha.isVisible().catch(() => false) ? { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.' } : null }
  async isReadyForReview() { return this.page.locator(bambooHrSelectors.submit).isVisible().catch(() => false) }
  async submit() { const button = this.page.locator(bambooHrSelectors.submit); if (!await button.isVisible()) throw new Error('The BambooHR Submit Application button is unavailable.'); await button.click() }
  private inputFor(question: AdapterQuestion): Locator { const value = question.locator.value; if (value === '_systemfield_resume') return this.page.locator(bambooHrSelectors.resume); if (value.startsWith('name:')) return this.page.locator(`[name="${this.escapeAttribute(value.slice(5))}"]`).first(); if (value.startsWith('id:')) return this.page.locator(`#${this.escapeId(value.slice(3))}`).first(); throw new Error(`Could not locate BambooHR field “${question.text}”.`) }
  private interactiveFor(question: AdapterQuestion) { return question.inputType === 'select' ? this.selectButton(question) : this.inputFor(question) }
  private selectButton(question: AdapterQuestion) { return this.inputFor(question).locator('xpath=ancestor::*[@data-fabric-component="SelectField InputWrapper"][1]//button[@aria-haspopup="true"]').first() }
  private escapeId(value: string) { return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1') }
  private escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  private escapeAttribute(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
