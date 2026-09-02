import type { Locator, Page } from 'playwright-core'
import { Country } from 'country-state-city'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
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
    return this.page.locator(`${greenhouseSelectors.form} input[id], ${greenhouseSelectors.form} textarea[id], ${greenhouseSelectors.form} select[id]`).evaluateAll((controls) => {
      const questions: AdapterQuestion[] = []; const seen = new Set<string>()
      for (const control of controls) {
        const input = control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        if (!input.id || seen.has(input.id) || input.type === 'hidden' || input.name === 'g-recaptcha-response' || input.id.startsWith('iti-')) continue
        seen.add(input.id)
        const explicit = document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
        const labelledBy = input.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent).filter(Boolean).join(' ')
        const group = input.closest('[class*="field"], fieldset')
        const groupLabel = group?.querySelector('label, legend')?.textContent
        let text = (explicit?.textContent || labelledBy || input.getAttribute('aria-label') || groupLabel || input.id).replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        if (input.id === 'resume') text = 'Resume/CV'
        if (input.id === 'cover_letter') text = 'Cover Letter'
        if (input.id === 'country') text = 'Phone country code'
        const role = input.getAttribute('role')
        const inputType = input.type === 'file' ? 'file' : role === 'combobox' || input instanceof HTMLSelectElement ? 'select' : input instanceof HTMLTextAreaElement ? 'textarea' : input.type || 'text'
        const fieldType: FieldType = inputType === 'textarea' ? 'textarea' : inputType === 'select' ? 'select' : inputType === 'number' ? 'number' : 'text'
        const requiredText = group?.textContent?.includes('*') || explicit?.textContent?.includes('*') || false
        const required = input.getAttribute('aria-required') === 'true' || input.required || requiredText || input.id === 'resume'
        const answered = input instanceof HTMLInputElement && input.type === 'file' ? Boolean(input.files?.length) : Boolean(input.value.trim())
        const id = input.id === 'resume' ? '_systemfield_resume' : input.id
        const options = inputType === 'select' && /^(?:are|do|will|would|can|have|if)\b/i.test(text) ? ['Yes', 'No'] : undefined
        questions.push({ id, text, fieldType, options, required, locator: { kind: 'field', value: input.id }, answered, inputType })
      }
      return questions
    })
  }

  async focus(question: AdapterQuestion) {
    const input = this.inputFor(question)
    await input.scrollIntoViewIfNeeded(); await this.pause(600, 1_050)
  }

  async extractOptions(question: AdapterQuestion) {
    if (isGreenhouseSchoolSearch(question.text)) return []
    const input = this.inputFor(question)
    const tag = await input.evaluate((element) => element.tagName.toLowerCase())
    if (tag === 'select') return input.locator('option:not([disabled])').evaluateAll((options) => options.map((option) => option.textContent?.trim() || '').filter(Boolean))
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
    const input = this.inputFor(question)
    const desiredAnswer = question.locator.value === 'country' ? Country.getCountryByCode(String(answer).toUpperCase())?.name || String(answer) : String(answer)
    const tag = await input.evaluate((element) => element.tagName.toLowerCase())
    if (tag === 'select') {
      await input.selectOption({ label: desiredAnswer }).catch(() => input.selectOption(desiredAnswer))
    } else if (question.fieldType === 'select') {
      await input.hover(); await this.pause(350, 650); await input.click(); await this.pause(450, 800)
      const schoolField = isGreenhouseSchoolSearch(question.text)
      const degreeField = /^degree$/i.test(question.text.trim())
      const disciplineField = /\b(?:discipline|field of study|major)\b/i.test(question.text)
      const experienceRangeField = /\bhow many years\b|\byears? of .*experience\b/i.test(question.text)
      const staticSelect = schoolField || degreeField || disciplineField || experienceRangeField
      if (!staticSelect) {
        await input.fill(desiredAnswer)
        await this.pause(500, 850)
      }
      let option = schoolField ? await this.schoolOption(desiredAnswer) : await this.dropdownOption(desiredAnswer, disciplineField, experienceRangeField)
      if (disciplineField && !option) {
        const words = desiredAnswer.trim().split(/\s+/)
        for (let length = words.length - 1; length >= 2 && !option; length -= 1) {
          await input.fill(words.slice(0, length).join(' '))
          await this.pause(400, 700)
          option = await this.dropdownOption(desiredAnswer, true)
        }
      }
      if (schoolField && !option) {
        await input.fill('Other')
        await this.pause(450, 750)
        option = await this.schoolOption('Other')
      }
      if (schoolField && !option) {
        const visibleOther = this.page.getByText('Other', { exact: true }).last()
        if (await visibleOther.isVisible().catch(() => false)) option = visibleOther
      }
      if (schoolField && !option) {
        await input.press('End').catch(() => undefined)
        await input.press('Enter').catch(() => undefined)
        await this.pause(500, 850)
        const selected = this.normalize(await input.inputValue())
        if (selected === 'other') return
      }
      if (!option) throw new Error(schoolField ? `Greenhouse did not offer “${desiredAnswer}” or an “Other” school option.` : `No matching Greenhouse option for “${desiredAnswer}”.`)
      await option.hover(); await this.pause(350, 650); await option.click()
      if (schoolField) {
        await this.pause(350, 650)
        await input.press('Escape').catch(() => undefined)
        await this.page.keyboard.press('Escape').catch(() => undefined)
        await input.blur().catch(() => undefined)
        await this.pause(450, 800)
      }
    } else {
      await input.hover(); await this.pause(350, 650); await input.click(); await input.fill('')
      await input.pressSequentially(desiredAnswer, { delay: this.random(65, 110), timeout: 90_000 })
    }
    await this.pause(600, 1_050)
  }

  async fillEducation(_education: EducationRecord[]) { throw new Error('Greenhouse education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(greenhouseSelectors.resume).setInputFiles(resume) }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) {
    const input = this.inputFor(question)
    if (await input.getAttribute('type') !== 'file') throw new Error(`Could not locate the Greenhouse upload control for “${question.text}”.`)
    await input.setInputFiles(file)
  }

  async detectBlocker(): Promise<Blocker | null> {
    const challenge = this.page.locator(greenhouseSelectors.recaptchaChallenge).first()
    if (await challenge.count() && await challenge.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' }
    return null
  }

  async isReadyForReview() { return this.page.locator(greenhouseSelectors.submit).isVisible().catch(() => false) }

  async submit() {
    const button = this.page.locator(greenhouseSelectors.submit)
    if (!await button.isVisible()) throw new Error('The Greenhouse submit button is not available.')
    await button.scrollIntoViewIfNeeded(); await this.pause(650, 1_100); await button.hover(); await this.pause(450, 800); await button.click()
    const confirmation = this.page.getByText(/thank you.*(?:applying|application)|application (?:has been|was) submitted|application received/i).first()
    await Promise.race([confirmation.waitFor({ state: 'visible', timeout: 20_000 }), button.waitFor({ state: 'hidden', timeout: 20_000 })]).catch(() => undefined)
    const blocker = await this.detectBlocker()
    if (blocker) throw new Error(blocker.message)
    if (await button.isVisible().catch(() => false)) throw new Error('Greenhouse did not confirm submission. Review the highlighted fields in the browser.')
  }

  private inputFor(question: AdapterQuestion) { return this.page.locator(`#${this.escapeId(question.locator.value)}`).first() }
  private escapeId(value: string) { return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1') }
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
