import type { Page } from 'playwright-core'
import type { JobDetails } from '../../types.js'
import { ashbySelectors } from './selectors.js'

type AshbyAppData = {
  organization?: { name?: string }
  posting?: { id?: string; title?: string; locationName?: string; secondaryLocationNames?: string[]; employmentType?: string; workplaceType?: string; compensationTierSummary?: string; descriptionHtml?: string }
}

export class AshbyJobPage {
  constructor(private readonly page: Page) {}

  static supports(url: URL) { return url.hostname.toLowerCase() === 'jobs.ashbyhq.com' && url.pathname.split('/').filter(Boolean).length >= 2 }

  static applicationUrl(source: URL) {
    const url = new URL(source)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.at(-1) !== 'application') parts.push('application')
    url.pathname = `/${parts.join('/')}`
    url.search = ''
    url.hash = ''
    return url
  }

  async openApplication(jobUrl: string) {
    const url = new URL(jobUrl)
    if (url.pathname.split('/').filter(Boolean).at(-1) === 'application') {
      await this.page.goto(AshbyJobPage.applicationUrl(url).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    }

    await this.page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await this.page.locator(ashbySelectors.jobHeading).first().waitFor({ state: 'visible', timeout: 30_000 })
    const applyLinks = this.page.locator(ashbySelectors.applyLink).filter({ hasText: /apply/i })
    await applyLinks.first().waitFor({ state: 'attached', timeout: 15_000 })
    const targetIndex = await applyLinks.evaluateAll((links) => {
      let selected = 0; let greatestTop = Number.NEGATIVE_INFINITY
      links.forEach((link, index) => { const top = link.getBoundingClientRect().top + window.scrollY; if (top > greatestTop) { greatestTop = top; selected = index } })
      return selected
    })
    const apply = applyLinks.nth(targetIndex)

    await this.page.mouse.move(850, 620, { steps: 12 })
    for (let step = 0; step < 30 && !await apply.isVisible(); step += 1) {
      await this.page.mouse.wheel(0, 420)
      await this.page.waitForTimeout(this.random(180, 340))
    }
    if (!await apply.isVisible()) {
      await apply.scrollIntoViewIfNeeded()
      await this.page.waitForTimeout(this.random(400, 750))
    }
    const box = await apply.boundingBox()
    if (box) await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 })
    await this.page.waitForTimeout(this.random(450, 900))
    await Promise.all([
      this.page.waitForURL(/\/application(?:[/?#]|$)/, { timeout: 20_000 }),
      apply.click(),
    ])
  }

  async readDetails(originalUrl: string): Promise<JobDetails> {
    const embedded = await this.page.evaluate(() => (window as typeof window & { __appData?: AshbyAppData }).__appData ?? null)
    const posting = embedded?.posting
    const heading = await this.page.locator(ashbySelectors.jobHeading).first().textContent()
    return {
      postingId: posting?.id ?? this.postingIdFromUrl(this.page.url()), url: originalUrl,
      company: embedded?.organization?.name?.trim(), jobTitle: posting?.title?.trim() || heading?.trim(),
      jobDescription: posting?.descriptionHtml, jobBoard: 'ashby',
      location: [posting?.locationName, ...(posting?.secondaryLocationNames ?? [])].filter(Boolean).join('; ') || undefined,
      employmentType: posting?.employmentType, workplaceType: posting?.workplaceType,
      compensation: posting?.compensationTierSummary,
    }
  }

  private postingIdFromUrl(value: string) {
    const parts = new URL(value).pathname.split('/').filter(Boolean)
    const applicationIndex = parts.indexOf('application')
    return applicationIndex > 0 ? parts[applicationIndex - 1]! : parts.at(-1) ?? null
  }

  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
}
