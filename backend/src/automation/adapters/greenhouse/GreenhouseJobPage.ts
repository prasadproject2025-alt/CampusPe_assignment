import type { Page } from 'playwright-core'
import type { JobDetails } from '../../types.js'
import { greenhouseSelectors } from './selectors.js'

export class GreenhouseJobPage {
  constructor(private readonly page: Page) {}

  static supports(url: URL) {
    const host = url.hostname.toLowerCase()
    return (host === 'job-boards.greenhouse.io' || host === 'boards.greenhouse.io') && /\/jobs\/\d+/.test(url.pathname)
  }

  static applicationUrl(source: URL) {
    const url = new URL(source)
    url.hash = ''
    return url
  }

  async openApplication(jobUrl: string) {
    await this.page.goto(GreenhouseJobPage.applicationUrl(new URL(jobUrl)).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await this.page.waitForFunction(() => Boolean(document.querySelector('#application-form, #application_form')) || !['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(location.hostname), undefined, { timeout: 30_000 })
    // Some boards redirect to an employer careers page. Follow its published
    // application entry point, then navigate the ATS form as the top-level page.
    // Keep the employer-provided URL (including any validity token) intact.
    if (!GreenhouseJobPage.supports(new URL(this.page.url()))) {
      for (let step = 0; step < 2; step += 1) {
        await this.page.locator('iframe[src*="greenhouse.io/embed/job_app"], a[href*="/apply"], #application-form, #application_form').first().waitFor({ state: 'attached', timeout: 15_000 })
        const embedded = this.page.locator('iframe[src*="greenhouse.io/embed/job_app"]')
        if (await embedded.count()) {
          const source = await embedded.first().getAttribute('src')
          if (source) {
            const target = new URL(source, this.page.url())
            if (['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(target.hostname) && target.protocol === 'https:') {
              await this.page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
              return
            }
          }
        }
        const applyLink = this.page.locator('a[href*="/apply"]:visible').filter({ hasText: /^\s*apply\b/i }).first()
        await applyLink.waitFor({ state: 'visible', timeout: 10_000 })
        const href = await applyLink.getAttribute('href')
        if (!href) break
        const target = new URL(href, this.page.url())
        if (target.protocol !== 'https:') break
        if (await applyLink.getAttribute('target') === '_blank') {
          await this.page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
        } else {
          await applyLink.click()
          await this.page.waitForLoadState('domcontentloaded')
        }
        await this.page.waitForTimeout(500)
      }
    }
    const apply = this.page.getByRole('button', { name: /^apply$/i }).first()
    if (await apply.isVisible().catch(() => false)) {
      await apply.hover(); await this.page.waitForTimeout(this.random(350, 700)); await apply.click(); await this.page.waitForTimeout(this.random(500, 900))
    }
    await this.page.locator(greenhouseSelectors.form).first().waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readDetails(originalUrl: string): Promise<JobDetails> {
    const details = await this.page.evaluate(() => {
      const heading = document.querySelector('main h1')?.textContent?.trim()
      const title = document.title.match(/^Job Application for (.+?) at (.+)$/)
      const location = document.querySelector('main h1')?.parentElement?.textContent?.replace(heading || '', '').trim()
      const form = document.querySelector('#application-form')
      const boundary = form?.previousElementSibling
      const descriptionParts: string[] = []
      let node = document.querySelector('main h1')?.parentElement?.parentElement?.nextElementSibling
      while (node && node !== boundary && node !== form) { descriptionParts.push((node as HTMLElement).innerHTML); node = node.nextElementSibling }
      return { heading, company: title?.[2]?.trim(), location, description: descriptionParts.join('\n') }
    })
    return {
      postingId: this.postingIdFromUrl(this.page.url()),
      url: originalUrl,
      company: details.company || this.boardFromUrl(this.page.url()),
      jobTitle: details.heading || undefined,
      jobDescription: details.description || undefined,
      jobBoard: 'greenhouse',
      location: details.location || undefined,
    }
  }

  private postingIdFromUrl(value: string) { return new URL(value).pathname.match(/\/jobs\/(\d+)/)?.[1] ?? null }
  private boardFromUrl(value: string) { return new URL(value).pathname.split('/').filter(Boolean)[0]?.replace(/[-_]+/g, ' ') }
  private random(minimum: number, maximum: number) { return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum }
}
