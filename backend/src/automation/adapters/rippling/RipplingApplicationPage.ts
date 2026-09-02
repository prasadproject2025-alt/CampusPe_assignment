import type { Locator, Page } from 'playwright-core'
import { Country } from 'country-state-city'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { ripplingSelectors } from './selectors.js'

export class RipplingApplicationPage {
  constructor(private readonly page: Page) {}

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(ripplingSelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
    await this.page.locator(`${ripplingSelectors.form} input:not([type="file"]):not([type="hidden"]):not([type="radio"]), ${ripplingSelectors.form} textarea, ${ripplingSelectors.form} [role="combobox"]`).first().waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    return this.page.locator(ripplingSelectors.form).evaluate((form) => {
      type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement
      const questions: AdapterQuestion[] = []; const seen = new Set<string>()
      const controls = [...form.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"], [role="radiogroup"]')] as Control[]
      for (const control of controls) {
        const input = control as HTMLInputElement
        if (input.type === 'radio' || (control.getAttribute('role') === 'combobox' && control.closest('[data-testid="phone_number-code"]'))) continue
        const testId = control.getAttribute('data-testid')
        const isResume = input.type?.toLowerCase() === 'file' && testId === 'input-resume'
        const id = isResume ? '_systemfield_resume' : control.id || (input.type?.toLowerCase() === 'file' && testId ? `_rippling_testid_${testId}` : '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        const field = control.closest('[data-testid="field"]')
        const role = control.getAttribute('role')
        const isCustomQuestion = Boolean(control.closest('[data-testid^="customQuestions."]'))
        const useOuterQuestion = role === 'radiogroup' || isCustomQuestion
        let precedingLabel: Element | null = field?.previousElementSibling || null
        while (precedingLabel && !(precedingLabel.textContent || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()) precedingLabel = precedingLabel.previousElementSibling
        const outerQuestion = (precedingLabel?.textContent || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        const labelledBy = (control.getAttribute('aria-labelledby')?.split(/\s+/).map((labelId) => document.getElementById(labelId)?.textContent).filter(Boolean).join(' ') || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        const labelArea = field?.firstElementChild
        const internalLabel = (labelArea?.textContent || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        const placeholder = (control.getAttribute('placeholder') || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        const ariaLabel = (control.getAttribute('aria-label') || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        let text = useOuterQuestion
          ? outerQuestion || labelledBy || ariaLabel || placeholder || internalLabel
          : labelledBy || placeholder || internalLabel || ariaLabel
        if (isResume) text = 'Resume/CV'
        else if (testId === 'input-cover_letter') text = 'Cover Letter'
        if (!text || /^(?:select|search|textbox|\d+\/\d+)$/i.test(text)) text = (field?.parentElement?.previousElementSibling?.textContent || field?.parentElement?.parentElement?.firstElementChild?.textContent || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()
        if (!text) text = id
        const inputType = isResume ? 'file' : role === 'radiogroup' ? 'radio' : role === 'combobox' || control instanceof HTMLSelectElement ? 'select' : control instanceof HTMLTextAreaElement ? 'textarea' : input.type || 'text'
        const fieldType: FieldType = inputType === 'textarea' ? 'textarea' : inputType === 'select' || inputType === 'radio' ? 'select' : inputType === 'number' ? 'number' : 'text'
        const hasOuterRequiredMarker = useOuterQuestion && Boolean(precedingLabel?.querySelector('p > div:empty'))
        const required = isResume || control.getAttribute('aria-required') === 'true' || (control instanceof HTMLInputElement && control.required) || Boolean(labelArea?.textContent?.includes('*')) || hasOuterRequiredMarker
        const comboboxText = (control.textContent || '').replace(/\s+/g, ' ').trim()
        const emptyCombobox = /^(?:please )?select(?: an? option)?(?:\.{3}|…)?$/i.test(comboboxText)
        const answered = isResume
          ? Boolean(input.files?.length)
          : role === 'radiogroup'
            ? Boolean(control.querySelector('[aria-checked="true"]'))
            : role === 'combobox'
              ? Boolean(input.value?.trim() || (comboboxText && !emptyCombobox))
              : Boolean(input.value?.trim())
        const options = role === 'radiogroup' ? [...control.querySelectorAll('[role="radio"]')].map((option) => (option.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean) : undefined
        questions.push({ id, text, fieldType, options, required, locator: { kind: 'field', value: id }, answered, inputType })
      }
      const country = form.querySelector('[data-testid="phone_number-code"] [role="combobox"]') as HTMLInputElement | null
      if (country) questions.splice(Math.max(0, questions.findIndex((item) => /phone number/i.test(item.text))), 0, { id: '_rippling_phone_country', text: 'Phone country code', fieldType: 'select', required: true, locator: { kind: 'field', value: '_rippling_phone_country' }, answered: false, inputType: 'select' })
      return questions
    })
  }

  async focus(question: AdapterQuestion) {
    const input = this.inputFor(question)
    if (question.inputType === 'file') {
      const uploadLabel = input.locator('xpath=ancestor::label[1]')
      if (await uploadLabel.isVisible().catch(() => false)) await this.smoothScrollTo(uploadLabel)
      else await this.smoothScrollTo(input)
    } else {
      await this.smoothScrollTo(input)
    }
    await this.pause(550, 950)
  }

  async readOptions(question: AdapterQuestion) {
    if (question.options?.length) return question.options
    if (!['select', 'radio', 'checkbox', 'checkbox-group', 'radio-group', 'boolean'].includes(question.inputType || '')) return []
    const input = this.inputFor(question)
    if (!await input.isVisible().catch(() => false)) return []
    await input.click()
    await this.pause(350, 650)
    const options = this.page.getByRole('option')
    const visible: string[] = []
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index)
      if (!await option.isVisible().catch(() => false)) continue
      const text = (await option.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
      if (text && !visible.includes(text)) visible.push(text)
    }
    await input.press('Escape').catch(() => undefined)
    return visible
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const input = this.inputFor(question); const desired = String(answer)
    if (question.locator.value === '_rippling_phone_country') {
      const optionIsoCode = desired.match(/(?:^|\s)([A-Z]{2})(?:\s|[-–]|$)/)?.[1]
      const country = Country.getCountryByCode(optionIsoCode || desired.toUpperCase())
      const search = country ? `+${country.phonecode} ${country.isoCode.charAt(0)}` : desired
      await this.chooseOption(input, search, country?.name || desired)
    } else if (/^location$/i.test(question.text)) {
      await input.click(); await input.fill(''); await input.pressSequentially(desired, { delay: this.random(55, 95) }); await this.pause(800, 1_200)
      const option = this.page.getByRole('option').first()
      if (!await option.isVisible().catch(() => false)) throw new Error(`Rippling did not suggest a location for “${desired}”.`)
      await option.hover(); await this.pause(500, 900)
      await option.click()
    } else if (question.inputType === 'select') {
      await this.chooseOption(input, desired)
    } else if (question.inputType === 'radio') {
      const group = input
      const target = group.getByRole('radio', { name: new RegExp(`^${this.escapeRegex(desired)}(?:\\b|\\s|$)`, 'i') }).first()
      if (!await target.isVisible().catch(() => false)) throw new Error(`No matching Rippling choice for “${desired}”.`)
      await target.hover(); await this.pause(500, 900)
      await target.click()
    } else {
      await input.click(); await input.fill(''); await input.pressSequentially(desired, { delay: this.random(55, 95), timeout: 90_000 })
    }
    await this.pause(500, 900)
  }

  async fillEducation(_education: EducationRecord[]) { throw new Error('Rippling education fields require per-form handling.') }
  async uploadResume(resume: ResumeUpload) { await this.page.locator(ripplingSelectors.resume).setInputFiles(resume); await this.pause(1_000, 1_500) }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.inputFor(question).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> {
    const captcha = this.page.locator(ripplingSelectors.recaptchaChallenge).first()
    if (await captcha.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' }
    const verificationText = this.page.getByText(/verify (?:that )?you(?:'|’)re human|verify you are human|checking (?:that )?you are human|security verification|complete the security check/i).first()
    if (await verificationText.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the human verification in the visible browser, then continue.' }
    return null
  }
  async isReadyForReview() {
    const button = this.page.locator(ripplingSelectors.submit).first()
    return await button.isVisible().catch(() => false)
      && await button.isEnabled().catch(() => false)
      && await button.getAttribute('aria-disabled').catch(() => null) !== 'true'
  }
  async submit() {
    const button = this.page.locator(ripplingSelectors.submit).first()
    if (!await button.isVisible()) throw new Error('The Rippling Apply button is not available.')
    if (await button.getAttribute('aria-disabled') === 'true') throw new Error('Rippling still has missing or invalid fields. Review the highlighted fields in the browser.')
    await this.smoothScrollTo(button); await this.pause(600, 1_000); await button.click()
    const confirmation = this.page.getByText(/application (?:submitted|received)|thank you for applying/i).first()
    await confirmation.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined)
    const blocker = await this.detectBlocker()
    if (blocker) throw new Error(blocker.message)
    if (!await confirmation.isVisible().catch(() => false)) throw new Error('Rippling did not show an application-received confirmation. The application is not marked as submitted.')
  }

  private inputFor(question: AdapterQuestion) {
    if (question.locator.value === '_systemfield_resume') return this.page.locator(ripplingSelectors.resume).first()
    if (question.locator.value === '_rippling_phone_country') return this.page.locator('[data-testid="phone_number-code"] [role="combobox"]').first()
    if (question.locator.value.startsWith('_rippling_testid_')) return this.page.locator(`[data-testid="${question.locator.value.slice('_rippling_testid_'.length)}"]`).first()
    return this.page.locator(`#${this.escapeId(question.locator.value)}`).first()
  }
  private async chooseOption(input: Locator, answer: string, alternate?: string) {
    await input.click(); await this.pause(350, 650)
    if (await input.evaluate((element) => element instanceof HTMLInputElement).catch(() => false)) {
      await input.fill(''); await input.pressSequentially(answer, { delay: this.random(45, 80) }); await this.pause(500, 850)
    }
    const options = this.page.getByRole('option'); const wanted = [answer, alternate].filter(Boolean).map((value) => this.normalize(value!))
    let match: Locator | null = null
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index); if (!await option.isVisible().catch(() => false)) continue
      const candidate = this.normalize(await option.innerText())
      if (wanted.some((value) => candidate === value || candidate.includes(value) || value.includes(candidate))) { match = option; break }
    }
    if (!match && await options.first().isVisible().catch(() => false) && await options.count() === 1) match = options.first()
    if (!match) throw new Error(`No matching Rippling option for “${answer}”.`)
    await match.hover()
    await this.pause(550, 950)
    await match.click()
  }
  private escapeId(value: string) { return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1') }
  private escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
  private normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim() }
  private async smoothScrollTo(target: Locator) {
    await target.evaluate((element) => element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }))
    await this.pause(850, 1_250)
  }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
