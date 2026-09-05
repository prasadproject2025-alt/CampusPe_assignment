import type { Locator, Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { AnswerRequiresUserError } from '../../application/fieldResolution.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { fillLiveAnswer, resolveLiveControl } from '../../application/extraction/liveResolver.js'
import { leverSelectors } from './selectors.js'

export function leverOptionMatches(candidate: string, desired: string) {
  if (candidate === desired) return true
  const containsPhrase = (value: string, phrase: string) => value === phrase || value.startsWith(`${phrase} `) || value.endsWith(` ${phrase}`) || value.includes(` ${phrase} `)
  return containsPhrase(candidate, desired) || containsPhrase(desired, candidate)
}

export class LeverApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(leverSelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
    await this.page.locator(`${leverSelectors.form} input[name="name"]`).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    return extractQuestionsFromPage(this.page)
  }

  async focus(question: AdapterQuestion) {
    const target = question.inputType === 'file' ? this.page.locator(leverSelectors.resumeButton) : await resolveLiveControl(this.page, question)
    await this.scrollNaturally(target)
    await target.hover().catch(() => undefined)
    await this.pause(750, 1_300)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const desired = String(answer)
    if (/^current location$/i.test(question.text)) {
      const input = await resolveLiveControl(this.page, question)
      await input.hover(); await this.pause(400, 700); await input.click(); await input.fill(''); await input.pressSequentially(desired, { delay: this.random(75, 125) }); await this.pause(850, 1_350)
      const results = this.page.locator(`${leverSelectors.locationResults} > *`)
      const count = await results.count()
      if (!count) {
        throw new AnswerRequiresUserError(question.text, `ANSWER_REQUIRES_USER: Lever did not suggest a unique location for “${desired}”. Complete it in assisted mode.`)
      }
      if (count > 1) {
        const exact = results.filter({ hasText: new RegExp(desired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
        if (await exact.count() === 1) {
          await exact.click()
          return
        }
        throw new AnswerRequiresUserError(question.text, `ANSWER_REQUIRES_USER: Lever location suggestions for “${desired}” were not unique. Complete it in assisted mode.`)
      }
      await results.click()
      return
    }
    await fillLiveAnswer(this.page, question, answer)
    await this.pause(700, 1_200)
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
    const captchas = this.page.locator(leverSelectors.captchaChallenge)
    for (let index = 0; index < await captchas.count(); index += 1) {
      if (await captchas.nth(index).isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.' }
    }
    const challengeText = this.page.getByText(/drag one animal|matching silhouette|verify you are human|complete the challenge/i).first()
    if (await challengeText.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.' }
    return null
  }
  async isReadyForReview() {
    const button = await this.submitButton()
    return await button.count() > 0
  }
  async submit() {
    const button = await this.submitButton()
    if (!await button.count()) throw new Error('The Lever Submit Application button is not available.')
    await this.scrollNaturally(button); await button.hover(); await this.pause(650, 1_050); await button.click({ timeout: 15_000 })
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
