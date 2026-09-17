import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion, Blocker, EducationRecord, ResumeUpload } from '../../types.js'
import { extractQuestionsFromPage } from '../../application/extraction/domExtractor.js'
import { fillLiveAnswer, resolveLiveControl } from '../../application/extraction/liveResolver.js'
import { ashbySelectors } from './selectors.js'
import { bezierMouseMove, humanPause, naturalScroll, preSubmitReview, randomInt } from '../../application/stealthHelpers.js'

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
  constructor(private readonly page: Page) { }

  async waitUntilReady() {
    await this.page.waitForLoadState('domcontentloaded')
    await this.page.locator(ashbySelectors.questionTitle).first().waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readQuestions(): Promise<AdapterQuestion[]> {
    return extractQuestionsFromPage(this.page)
  }

  async focus(question: AdapterQuestion) {
    const target = await resolveLiveControl(this.page, question)
    await target.scrollIntoViewIfNeeded()
    await this.pause(900, 1_800)
  }

  async fill(question: AdapterQuestion, answer: AnswerValue) {
    if (question.locator.kind === 'education') throw new Error('Education requires structured handling.')
    await fillLiveAnswer(this.page, question, answer)
    await this.pause(900, 2_000)
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
      await school.hover(); await this.pause(450, 800); await school.click(); await school.fill(''); await school.pressSequentially(record.school, { delay: this.random(85, 140), timeout: 90_000 }); await this.pause(1_000, 1_800)
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
    const input = await resolveLiveControl(this.page, question)
    if ((await input.getAttribute('type').catch(() => '')) !== 'file') throw new Error(`Could not locate the upload control for “${question.text}”.`)
    await input.setInputFiles(file)
  }

  async detectBlocker(): Promise<Blocker | null> {
    const challenge = this.page.locator(ashbySelectors.recaptchaChallenge)
    if (await challenge.count() && await challenge.first().isVisible()) {
      return { type: 'CAPTCHA', message: 'Complete the CAPTCHA in the live preview, then continue.', provider: 'ashby', challengeType: 'recaptcha' }
    }
    const login = this.page.getByText(/sign in|log in/i).first()
    if (await login.count() && !await this.page.locator(ashbySelectors.questionTitle).count()) {
      return { type: 'LOGIN', message: 'Sign in in the live preview, then continue.', provider: 'ashby' }
    }
    return null
  }

  async isReadyForReview() { return this.page.getByRole('button', { name: /submit application/i }).isVisible().catch(() => false) }

  async submit() {
    const button = this.page.getByRole('button', { name: /submit application/i })
    if (!await button.isVisible().catch(() => false)) throw new Error('The Ashby submit button is not available.')
    if (!await button.isEnabled({ timeout: 5000 }).catch(() => false)) {
      throw new Error('The Submit button is currently disabled on the employer form. Complete all required fields on the form first.')
    }

    // --- Pre-submit review: simulate user reading through the form ----------
    await preSubmitReview(this.page)

    // --- Scroll to submit button naturally -----------------------------------
    await button.scrollIntoViewIfNeeded()
    await humanPause(this.page, 500, 1000)

    // Gentle natural scroll to ensure the button is well in view
    await naturalScroll(this.page, randomInt(50, 150), { scrollSteps: randomInt(2, 4) })
    await humanPause(this.page, 600, 1200)

    // --- Bézier curve mouse approach to the button --------------------------
    const box = await button.boundingBox().catch(() => null)
    if (box) {
      const vp = this.page.viewportSize() ?? { width: 1280, height: 800 }
      const targetX = Math.max(20, Math.min(vp.width - 20, box.x + box.width / 2 + (Math.random() * 6 - 3)))
      const targetY = Math.max(20, Math.min(vp.height - 20, box.y + box.height / 2 + (Math.random() * 4 - 2)))

      // Pick a starting point bounded safely inside the visible viewport
      const startX = Math.max(20, Math.min(vp.width - 20, targetX - randomInt(60, 180)))
      const startY = Math.max(20, Math.min(vp.height - 20, targetY - randomInt(40, 140)))

      // Move mouse into position via Bézier curve
      await bezierMouseMove(this.page, targetX, targetY, {
        fromX: startX,
        fromY: startY,
        steps: randomInt(20, 35),
      })
      await humanPause(this.page, 300, 700)
    }

    // --- Hover and pause (simulate reading the button label) ----------------
    await button.hover().catch(() => undefined)
    await humanPause(this.page, 400, 900)

    // --- Click with natural timing ------------------------------------------
    await button.click({ timeout: 10_000 }).catch(async () => {
      await humanPause(this.page, 200, 500)
      await button.click({ force: true })
    })
  }

  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
  private async pause(minimum: number, maximum: number) { await this.page.waitForTimeout(this.random(minimum, maximum)) }
  private dateParts(value: string) {
    const match = value.trim().match(/^(\d{4})(?:-(\d{1,2}))?/)
    return { year: match?.[1] ?? '', month: match?.[2] ? String(Number(match[2])) : '' }
  }
  private async typeNaturally(input: ReturnType<Page['locator']>, value: string) {
    await input.hover(); await this.pause(400, 750); await input.click(); await this.pause(300, 600); await input.fill(''); await input.pressSequentially(value, { delay: this.random(85, 140), timeout: 90_000 }); await this.pause(800, 1_500)
  }
}
