import type { Page } from 'playwright-core'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { ashbySelectors } from './selectors.js'

export function ashbyChoiceMatches(label: string, desired: string) {
  if (label === desired) return true
  const containsPhrase = (value: string, phrase: string) => value === phrase || value.startsWith(`${phrase} `) || value.endsWith(` ${phrase}`) || value.includes(` ${phrase} `)
  return containsPhrase(label, desired) || containsPhrase(desired, label)
}

export function ashbyRadioChoiceMatches(label: string, desired: string) {
  return label === desired
}

export function ashbyChoiceAnswerParts(answer: AnswerValue, inputType?: string) {
  const value = String(answer)
  return inputType === 'radio-group' ? [value] : value.split(/[,;|]/)
}

export class AshbyApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(ashbySelectors.questionTitle).first().waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    return this.page.locator(ashbySelectors.fieldContainer).evaluateAll((containers) => {
      const questions: AdapterQuestion[] = []; const seen = new Set<string>()
      for (const [index, container] of containers.entries()) {
        const directLabel = [...container.children].find((child) => child.matches('label.ashby-application-form-question-title')) as HTMLLabelElement | undefined
        const label = directLabel ?? container.querySelector('label.ashby-application-form-question-title') as HTMLLabelElement | null
        const text = label?.textContent?.replace(/\s+/g, ' ').trim()
        if (!label || !text) continue
        const fieldPath = (container as HTMLElement).dataset.fieldPath || label.htmlFor || `ashby-field-${index}`
        if (seen.has(fieldPath)) continue
        seen.add(fieldPath)
        const input = container.querySelector('input:not([type="hidden"]), textarea, select') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
        const yesNo = container.querySelector('.ashby-application-form-input-yesno')
        const radios = [...container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[]
        const checkboxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
        const choices = radios.length ? radios : checkboxes
        const options = yesNo ? [...yesNo.querySelectorAll('button[data-option]')].map((button) => button.textContent?.trim() || '') : choices.length ? choices.map((control) => {
          const aria = control.getAttribute('aria-label')?.trim()
          if (aria && !/^\d+$/.test(aria)) return aria
          const explicit = control.id ? container.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent?.trim() : ''
          if (explicit) return explicit.replace(/\s+/g, ' ')
          const wrapping = control.closest('label')?.textContent?.trim()
          if (wrapping) return wrapping.replace(/\s+/g, ' ')
          return control.parentElement?.textContent?.trim().replace(/\s+/g, ' ') || ''
        }).filter(Boolean) : input instanceof HTMLSelectElement ? [...input.options].filter((option) => !option.disabled && option.value).map((option) => option.textContent?.trim() || option.value) : undefined
        const inputType = checkboxes.length ? 'checkbox-group' : radios.length ? 'radio-group' : input?.getAttribute('type') || input?.tagName.toLowerCase() || (yesNo ? 'boolean' : '')
        let fieldType: FieldType = input instanceof HTMLTextAreaElement ? 'textarea' : yesNo ? 'boolean' : choices.length ? 'select' : input instanceof HTMLSelectElement || input?.getAttribute('role') === 'combobox' ? 'select' : inputType === 'number' ? 'number' : 'text'
        if (inputType === 'file') fieldType = 'text'
        const answered = yesNo ? Boolean(yesNo.querySelector('button[aria-pressed="true"]')) : choices.length ? choices.some((choice) => choice.checked) : input instanceof HTMLInputElement && input.type === 'file' ? Boolean(input.files?.length) : Boolean(input && 'value' in input && input.value.trim())
        const required = label.className.includes('required') || Boolean(input?.hasAttribute('required'))
        questions.push({ id: fieldPath, text, fieldType, options, required, locator: { kind: 'field', value: fieldPath }, answered, inputType })
      }
      const degree = document.querySelector('#_systemfield_education_history-degree')
      const education = degree?.closest('.ashby-application-form-field-entry')
      if (education) {
        const school = education.querySelector('input[placeholder="Search schools..."]') as HTMLInputElement | null
        const existing = questions.find((question) => question.id === '_systemfield_education_history' || question.text === 'Education History')
        if (existing) {
          existing.id = '_systemfield_education_history'; existing.fieldType = 'text'; existing.inputType = 'education'; existing.locator = { kind: 'education', value: '_systemfield_education_history' }; existing.answered = Boolean(school?.value.trim())
        } else questions.push({ id: '_systemfield_education_history', text: 'Education History', fieldType: 'text', required: true, locator: { kind: 'education', value: '_systemfield_education_history' }, answered: Boolean(school?.value.trim()), inputType: 'education' })
      }
      return questions
    })
  }

  async focus(question: AdapterQuestion) {
    const container = await this.containerFor(question)
    await container.scrollIntoViewIfNeeded()
    await this.pause(700, 1_300)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    if (question.locator.kind === 'education') throw new Error('Education requires structured handling.')
    const container = await this.containerFor(question)
    const yesNo = container.locator(ashbySelectors.yesNo)
    if (await yesNo.count()) {
      const desired = String(answer).toLowerCase().startsWith('y') ? 'yes' : 'no'
      const option = yesNo.locator(`button[data-option="${desired}"]`)
      await option.hover(); await this.pause(500, 950); await option.click(); await this.pause(650, 1_150); return
    }
    const choices = container.locator('input[type="radio"], input[type="checkbox"]')
    if (await choices.count()) {
      const desiredAnswers = ashbyChoiceAnswerParts(answer, question.inputType).map((value) => this.normalizeChoice(value)).filter(Boolean)
      let matched = 0
      for (let index = 0; index < await choices.count(); index += 1) {
        const choice = choices.nth(index)
        const label = this.normalizeChoice(await this.choiceLabel(container, choice))
        const matches = desiredAnswers.some((desired) => question.inputType === 'radio-group' ? ashbyRadioChoiceMatches(label, desired) : ashbyChoiceMatches(label, desired))
        if (matches) {
          await choice.scrollIntoViewIfNeeded(); await choice.hover(); await this.pause(500, 950); await choice.check(); await this.pause(650, 1_150); matched += 1
          if (question.inputType === 'radio-group') break
        }
      }
      if (matched) return
      throw new Error(`No matching choice for “${String(answer)}”.`)
    }
    const input = container.locator('input:not([type="hidden"]), textarea, select').first()
    const tag = await input.evaluate((element) => element.tagName.toLowerCase())
    if (tag === 'select') {
      await input.hover(); await this.pause(450, 850); await input.click(); await this.pause(550, 1_000)
      await input.selectOption({ label: String(answer) }).catch(() => input.selectOption(String(answer)))
    } else {
      await input.hover(); await this.pause(450, 850); await input.click(); await this.pause(350, 700); await input.fill('')
      await input.pressSequentially(String(answer), { delay: this.random(75, 125), timeout: 90_000 })
      if (question.fieldType === 'select') {
        await this.pause(700, 1_200)
        const option = await this.dropdownOption(String(answer), question.text)
        if (!option) throw new Error(`No matching dropdown option for “${String(answer)}”.`)
        await option.hover(); await this.pause(500, 900); await option.click()
      }
    }
    await this.pause(750, 1_350)
  }

  async fillEducation(records: EducationRecord[]) {
    const education = records.filter((record) => record.school.trim() && record.degree.trim())
    if (!education.length) throw new Error('Add a school and degree to your JobCopilot profile first.')

    for (const [index, record] of education.entries()) {
      if (index > 0) {
        const addButton = this.page.getByRole('button', { name: /add education/i })
        await addButton.scrollIntoViewIfNeeded(); await addButton.hover(); await this.pause(500, 900); await addButton.click(); await this.pause(750, 1_250)
      }
      const entry = this.page.locator('.ashby-application-form-input-education-entry').nth(index)
      await entry.scrollIntoViewIfNeeded(); await this.pause(700, 1_200)
      const school = entry.locator(ashbySelectors.schoolSearch)
      await school.hover(); await this.pause(450, 800); await school.click(); await school.fill(''); await school.pressSequentially(record.school, { delay: this.random(75, 120), timeout: 90_000 }); await this.pause(850, 1_350)
      const exactSchool = this.page.getByRole('option').filter({ hasText: record.school }).first()
      const firstSchool = this.page.getByRole('option').first()
      const schoolOption = await exactSchool.count() ? exactSchool : firstSchool
      if (!await schoolOption.count()) throw new Error(`Choose the school “${record.school}” manually.`)
      await schoolOption.hover(); await this.pause(500, 900); await schoolOption.click(); await this.pause(700, 1_200)

      await this.typeNaturally(entry.locator('input[id$="-degree"]'), record.degree)
      if (record.field.trim()) await this.typeNaturally(entry.locator('input[id$="-major"]'), record.field)
      const selects = entry.locator('select')
      const start = this.dateParts(record.startDate)
      const end = this.dateParts(record.endDate)
      if (start.month) await selects.nth(0).selectOption(start.month)
      if (start.year) await selects.nth(1).selectOption(start.year)
      if (end.month) await selects.nth(2).selectOption(end.month)
      if (end.year) await selects.nth(3).selectOption(end.year)
      if (record.current || !record.endDate.trim()) await entry.locator('input[id$="-isCurrent"]').check()
      await this.pause(800, 1_400)
    }
  }

  async uploadResume(resume: ResumeUpload) { await this.page.locator(ashbySelectors.resume).setInputFiles(resume) }

  async uploadFile(question: AdapterQuestion, file: ResumeUpload) {
    const container = await this.containerFor(question)
    const input = container.locator('input[type="file"]').first()
    if (!await input.count()) throw new Error(`Could not locate the upload control for “${question.text}”.`)
    await input.setInputFiles(file)
  }

  async detectBlocker(): Promise<Blocker | null> {
    const challenge = this.page.locator(ashbySelectors.recaptchaChallenge)
    if (await challenge.count() && await challenge.first().isVisible()) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' }
    const login = this.page.getByText(/sign in|log in/i).first()
    if (await login.count() && !await this.page.locator(ashbySelectors.questionTitle).count()) return { type: 'LOGIN', message: 'Sign in in the visible browser, then continue.' }
    return null
  }

  async isReadyForReview() { return this.page.getByRole('button', { name: /submit application/i }).isVisible().catch(() => false) }

  async submit() {
    const button = this.page.getByRole('button', { name: /submit application/i })
    if (!await button.isVisible()) throw new Error('The Ashby submit button is not available.')
    await button.scrollIntoViewIfNeeded(); await this.pause(700, 1_200); await button.hover(); await this.pause(550, 950); await button.click()
    const confirmation = this.page.getByText(/application (?:was )?submitted|thank you.*(?:applying|application)|application received/i).first()
    await Promise.race([confirmation.waitFor({ state: 'visible', timeout: 15_000 }), button.waitFor({ state: 'hidden', timeout: 15_000 })]).catch(() => undefined)
    if (await button.isVisible().catch(() => false)) throw new Error('Ashby did not confirm submission. Review the highlighted fields in the browser.')
  }

  private async containerFor(question: AdapterQuestion) {
    const safeId = question.id.replace(/[^a-zA-Z0-9_-]/g, '')
    const safeAttribute = question.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const byPath = this.page.locator(`[data-field-path="${safeAttribute}"]`).first()
    if (await byPath.count()) return byPath
    const byId = this.page.locator(`#${safeId}`).first()
    if (await byId.count()) return byId.locator('xpath=ancestor::*[contains(@class,"ashby-application-form-field-entry") or self::fieldset][1]').or(byId).first()
    throw new Error(`Could not locate Ashby field “${question.text}”.`)
  }

  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
  private async dropdownOption(answer: string, question: string) {
    const options = this.page.getByRole('option')
    const desired = this.normalizeChoice(answer)
    let bestIndex = -1
    let bestScore = 0
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index)
      if (!await option.isVisible().catch(() => false)) continue
      const candidate = this.normalizeChoice(await option.innerText())
      if (candidate === desired || candidate.includes(desired) || desired.includes(candidate)) return option
      if (!/location|city/i.test(question)) continue
      const desiredTokens = new Set(desired.split(' ').filter((token) => token.length > 2))
      const candidateTokens = new Set(candidate.split(' ').filter((token) => token.length > 2))
      const matches = [...desiredTokens].filter((token) => candidateTokens.has(token)).length
      const score = desiredTokens.size ? matches / desiredTokens.size : 0
      if (score > bestScore) { bestScore = score; bestIndex = index }
    }
    return bestIndex >= 0 && bestScore >= 0.5 ? options.nth(bestIndex) : null
  }
  private normalizeChoice(value: string) {
    return value.toLowerCase().replace(/bangalore/g, 'bengaluru').replace(/\bundergraduate\b|\bbachelors?(?: degree)?\b/g, 'bachelor').replace(/\bmasters?(?: degree)?\b/g, 'master').replace(/[^a-z0-9]+/g, ' ').trim()
  }
  private async choiceLabel(container: ReturnType<Page['locator']>, choice: ReturnType<Page['locator']>) {
    const aria = (await choice.getAttribute('aria-label'))?.trim()
    if (aria && !/^\d+$/.test(aria)) return aria
    const id = await choice.getAttribute('id')
    if (id) {
      const label = container.locator(`label[for="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).first()
      if (await label.count()) return (await label.innerText()).trim()
    }
    return choice.evaluate((element) => element.closest('label')?.textContent?.trim() || element.parentElement?.textContent?.trim() || '')
  }
  private dateParts(value: string) {
    const match = value.trim().match(/^(\d{4})(?:-(\d{1,2}))?/)
    return { year: match?.[1] ?? '', month: match?.[2] ? String(Number(match[2])) : '' }
  }
  private async typeNaturally(input: ReturnType<Page['locator']>, value: string) {
    await input.hover(); await this.pause(400, 750); await input.click(); await this.pause(300, 600); await input.fill(''); await input.pressSequentially(value, { delay: this.random(75, 120), timeout: 90_000 }); await this.pause(700, 1_200)
  }
}
