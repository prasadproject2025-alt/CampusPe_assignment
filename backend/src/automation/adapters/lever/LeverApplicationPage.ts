import type { Locator, Page } from 'playwright-core'
import type { AnswerValue, FieldType } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
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
    return this.page.locator(leverSelectors.question).evaluateAll((containers) => {
      const questions: AdapterQuestion[] = []; const seen = new Set<string>()
      for (const container of containers) {
        if (!(container as HTMLElement).offsetParent) continue
        const controls = [...container.querySelectorAll('input:not([type="hidden"]), textarea, select')] as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
        if (!controls.length) continue
        const first = controls[0]!
        const isResume = first.type === 'file' && (first.id === 'resume-upload-input' || first.getAttribute('data-qa') === 'input-resume')
        const locator = isResume ? 'id:resume-upload-input' : first.id ? `id:${first.id}` : first.name ? `name:${first.name}` : ''
        const id = isResume ? '_systemfield_resume' : locator
        if (!id || seen.has(id)) continue
        seen.add(id)
        let text = (container.querySelector('.application-label .text')?.textContent || container.querySelector('.application-label')?.textContent || '').replace(/\s+/g, ' ').replace(/\s*✱\s*$/, '').trim()
        if (isResume) text = 'Resume/CV'
        const radioControls = controls.filter((control) => control instanceof HTMLInputElement && control.type === 'radio') as HTMLInputElement[]
        const inputType = isResume ? 'file' : radioControls.length ? 'radio' : first instanceof HTMLSelectElement ? 'select' : first instanceof HTMLTextAreaElement ? 'textarea' : first.type || 'text'
        const fieldType: FieldType = inputType === 'textarea' ? 'textarea' : inputType === 'radio' || inputType === 'select' ? 'select' : 'text'
        const options = radioControls.length ? radioControls.map((control) => control.value) : first instanceof HTMLSelectElement ? [...first.options].map((option) => option.textContent?.trim() || option.value).filter((value) => value && !/^select/i.test(value)) : undefined
        const answered = radioControls.length ? radioControls.some((control) => control.checked) : Boolean(first.value.trim())
        const required = controls.some((control) => control.required) || Boolean(container.querySelector('.required'))
        questions.push({ id, text: text || first.name || first.id, fieldType, options, required, locator: { kind: 'field', value: locator }, answered, inputType })
      }
      return questions
    })
  }

  async focus(question: AdapterQuestion) {
    const input = this.inputFor(question)
    const target = question.inputType === 'file' ? this.page.locator(leverSelectors.resumeButton).first() : input
    await this.scrollNaturally(target)
    await target.hover().catch(() => undefined)
    await this.pause(750, 1_300)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    const input = this.inputFor(question); const desired = String(answer)
    if (/^current location$/i.test(question.text)) {
      await input.hover(); await this.pause(400, 700); await input.click(); await input.fill(''); await input.pressSequentially(desired, { delay: this.random(75, 125) }); await this.pause(850, 1_350)
      const result = this.page.locator(`${leverSelectors.locationResults} > *`).first()
      if (!await result.isVisible().catch(() => false)) throw new Error(`Lever did not suggest a location for “${desired}”.`)
      await result.click()
    } else if (question.inputType === 'radio') {
      const option = await this.matchOption(this.page.locator(`[name="${this.escapeAttribute(question.locator.value.slice(5))}"]`), desired)
      if (!option) throw new Error(`No matching Lever choice for “${desired}”.`)
      await option.hover(); await this.pause(500, 900); await option.click()
    } else if (question.inputType === 'select') {
      const option = await this.matchSelectOption(input, desired)
      if (!option) throw new Error(`No matching Lever option for “${desired}”.`)
      await input.hover(); await this.pause(450, 800); await input.click(); await this.pause(700, 1_200)
      await input.selectOption(option)
      await this.pause(650, 1_050)
      await input.blur().catch(() => undefined)
    } else {
      await input.hover(); await this.pause(400, 700); await input.click(); await input.fill(''); await input.pressSequentially(desired, { delay: this.random(75, 125), timeout: 90_000 })
    }
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
      if (await failure.isVisible().catch(() => false)) throw new Error('Lever could not parse the résumé. Check the uploaded file in the visible browser.')
      const storedResumeId = (await storageId.inputValue().catch(() => '')).trim()
      if (storedResumeId) return
      const parsingVisible = await parsing.isVisible().catch(() => false)
      const successVisible = await success.isVisible().catch(() => false)
      const filenameVisible = Boolean((await filename.textContent().catch(() => ''))?.trim())
      if (!parsingVisible && (successVisible || filenameVisible)) return
      await this.page.waitForTimeout(350)
    }
    throw new Error('Lever résumé parsing did not finish. Check the uploaded file in the visible browser.')
  }
  async uploadFile(question: AdapterQuestion, file: ResumeUpload) { await this.inputFor(question).setInputFiles(file) }
  async detectBlocker(): Promise<Blocker | null> {
    const captchas = this.page.locator(leverSelectors.captchaChallenge)
    for (let index = 0; index < await captchas.count(); index += 1) {
      if (await captchas.nth(index).isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' }
    }
    const challengeText = this.page.getByText(/drag one animal|matching silhouette|verify you are human|complete the challenge/i).first()
    if (await challengeText.isVisible().catch(() => false)) return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the visible browser, then continue.' }
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
    const confirmation = this.page.getByText(/application (?:was |has been )?(?:submitted|received)|thank you for applying/i).first()
    await confirmation.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined)
    const blocker = await this.detectBlocker(); if (blocker) throw new Error(blocker.message)
    if (await button.isVisible().catch(() => false)) throw new Error('Lever did not confirm submission. Review the highlighted fields in the browser.')
  }

  private inputFor(question: AdapterQuestion): Locator {
    const value = question.locator.value
    if (value === 'id:resume-upload-input') return this.page.locator(leverSelectors.resume).first()
    if (value.startsWith('id:')) return this.page.locator(`#${this.escapeId(value.slice(3))}`).first()
    if (value.startsWith('name:')) return this.page.locator(`[name="${this.escapeAttribute(value.slice(5))}"]`).first()
    throw new Error(`Could not locate Lever field “${question.text}”.`)
  }
  private async submitButton() {
    const exact = this.page.locator('#application-form #btn-submit').first()
    if (await exact.count()) return exact
    const css = this.page.locator(leverSelectors.submit).first()
    if (await css.count()) return css
    return this.page.getByRole('button', { name: /submit application/i }).first()
  }
  private async matchOption(options: Locator, answer: string): Promise<Locator | null> {
    const desired = this.normalize(answer); let partial: Locator | null = null
    for (let index = 0; index < await options.count(); index += 1) {
      const option = options.nth(index); const candidate = this.normalize(await option.getAttribute('value') || '')
      if (candidate === desired) return option
      if (!partial && leverOptionMatches(candidate, desired)) partial = option
    }
    return partial
  }
  private async matchSelectOption(select: Locator, answer: string) {
    const desired = this.normalize(answer)
    return select.locator('option').evaluateAll((options, normalized) => {
      let partial = ''
      for (const option of options as HTMLOptionElement[]) {
        const candidate = (option.textContent || option.value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        if (candidate === normalized) return option.value
        if (!partial && (candidate.includes(normalized) || normalized.includes(candidate))) partial = option.value
      }
      return partial
    }, desired)
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
  private escapeId(value: string) { return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1') }
  private escapeAttribute(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
}
