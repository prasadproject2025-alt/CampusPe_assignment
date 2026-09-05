import type { Locator, Page } from 'playwright-core'
import { Country } from 'country-state-city'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { fillLiveAnswer, resolveLiveControl } from '../../application/extraction/liveResolver.js'
import { greenhouseSelectors } from './selectors.js'

export function isGreenhouseSchoolSearch(text: string) {
  return /\b(?:school|university|college|institution)\b/i.test(text)
}

export class GreenhouseApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(greenhouseSelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    return extractQuestionsFromPage(this.page)
  }

  async focus(question: AdapterQuestion) {
    const input = await resolveLiveControl(this.page, question)
    await input.scrollIntoViewIfNeeded(); await this.pause(600, 1_050)
  }

  async extractOptions(question: AdapterQuestion) {
    if (isGreenhouseSchoolSearch(question.text)) return []
    const input = await resolveLiveControl(this.page, question)
    const tag = await input.evaluate('node => node && node.tagName ? node.tagName.toLowerCase() : ""')
    if (tag === 'select') return (await input.locator('option:not([disabled])').evaluateAll('options => options.map(option => (option.textContent || "").trim()).filter(Boolean)')) as string[]
    await input.scrollIntoViewIfNeeded(); await input.click(); await this.pause(400, 700)
    const options: string[] = []
    const visible = this.page.getByRole('option')
    for (let index = 0; index < await visible.count(); index += 1) {
      const option = visible.nth(index)
      if (!await option.isVisible().catch(() => false)) continue
      const text = (await option.innerText()).replace(/\s+/g, ' ').trim()
      if (text && !options.includes(text)) options.push(text)
    }
    await input.press('Escape').catch(() => undefined)
    return options
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    if (question.locator.value === 'country' || /phone country/i.test(question.text)) {
      const desiredAnswer = Country.getCountryByCode(String(answer).toUpperCase())?.name || String(answer)
      await fillLiveAnswer(this.page, { ...question, text: question.text }, desiredAnswer)
      return
    }
    if (isGreenhouseSchoolSearch(question.text) || /^degree$/i.test(question.text.trim()) || /\b(?:discipline|field of study|major)\b/i.test(question.text) || /\bhow many years\b|\byears? of .*experience\b/i.test(question.text)) {
      const input = await resolveLiveControl(this.page, question)
      const desiredAnswer = String(answer)
      await input.hover(); await this.pause(350, 650); await input.click(); await this.pause(450, 800)
      const schoolField = isGreenhouseSchoolSearch(question.text)
      const disciplineField = /\b(?:discipline|field of study|major)\b/i.test(question.text)
      const experienceRangeField = /\bhow many years\b|\byears? of .*experience\b/i.test(question.text)
      if (!schoolField && !/^degree$/i.test(question.text.trim()) && !disciplineField && !experienceRangeField) await input.fill(desiredAnswer)
      let option = schoolField ? await this.schoolOption(desiredAnswer) : await this.dropdownOption(desiredAnswer, disciplineField, experienceRangeField)
      if (schoolField && !option) {
        await input.fill('Other')
        await this.pause(450, 750)
        option = await this.schoolOption('Other')
      }
      if (!option) throw new Error(schoolField ? `Greenhouse did not offer “${desiredAnswer}” or an “Other” school option.` : `No matching Greenhouse option for “${desiredAnswer}”.`)
      await option.click()
      return
    }
    await fillLiveAnswer(this.page, question, answer)
  }

  async fillEducation(_education: EducationRecord[]) { throw new Error('Greenhouse education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(greenhouseSelectors.resume).setInputFiles(resume) }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) {
    const input = this.page.locator(question.text.match(/cover/i) ? greenhouseSelectors.coverLetter : greenhouseSelectors.resume)
    if (await input.getAttribute('type') !== 'file') throw new Error(`Could not locate the Greenhouse upload control for “${question.text}”.`)
    await input.setInputFiles(file)
  }

  async detectBlocker(): Promise<Blocker | null> {
    const challenge = this.page.locator(greenhouseSelectors.recaptchaChallenge).first()
    if (await challenge.count() && await challenge.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.' }
    return null
  }

  async isReadyForReview() { return this.page.locator(greenhouseSelectors.submit).isVisible().catch(() => false) }

  async submit() {
    const button = this.page.locator(greenhouseSelectors.submit)
    if (!await button.isVisible()) throw new Error('The Greenhouse submit button is not available.')
    await button.scrollIntoViewIfNeeded(); await this.pause(650, 1_100); await button.hover(); await this.pause(450, 800); await button.click()
  }

  private async dropdownOption(answer: string, allowCandidateSubset = false, allowRangeMatch = false): Promise<Locator | null> {
    const desired = this.normalize(answer); const options = this.page.getByRole('option')
    let partial: Locator | null = null
    const desiredYears = allowRangeMatch ? this.representativeYears(answer) : null
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index)
      if (!await option.isVisible().catch(() => false)) continue
      const candidate = this.normalize(await option.innerText())
      if (candidate === desired || candidate.startsWith(`${desired} `)) return option
      const candidateTokens = candidate.split(' ')
      const desiredTokens = desired.split(' ')
      if (desiredYears !== null && this.rangeContains(await option.innerText(), desiredYears)) return option
      if (allowCandidateSubset && candidateTokens.length >= 2 && candidateTokens.every((token) => desiredTokens.includes(token))) return option
      if (!partial && desiredTokens.every((token) => candidateTokens.includes(token))) partial = option
    }
    return partial
  }
  private representativeYears(value: string) {
    const normalized = value.toLowerCase().replace(/[–—]/g, '-')
    const numbers = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
    if (!numbers.length) return null
    if (/less than|under|below/.test(normalized)) return Math.max(0, numbers[0]! - 0.5)
    if (numbers.length >= 2) return (numbers[0]! + numbers[1]!) / 2
    return numbers[0]!
  }
  private rangeContains(option: string, years: number) {
    const normalized = option.toLowerCase().replace(/[–—]/g, '-')
    const numbers = [...normalized.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
    if (!numbers.length) return false
    if (/less than|under|below/.test(normalized)) return years < numbers[0]!
    if (/\+|or more|and above|at least/.test(normalized)) return years >= numbers[0]!
    if (numbers.length >= 2) return years >= numbers[0]! && years <= numbers[1]!
    return years === numbers[0]
  }
  private async schoolOption(school: string): Promise<Locator | null> {
    const desired = this.normalize(school); const options = this.page.getByRole('option')
    let other: Locator | null = null
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index)
      if (!await option.isVisible().catch(() => false)) continue
      const candidate = this.normalize(await option.innerText())
      if (candidate === desired || candidate.startsWith(`${desired} `)) return option
      if (candidate === 'other') other = option
    }
    return other
  }
  private normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
