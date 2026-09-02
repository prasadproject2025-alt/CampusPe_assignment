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
    await this.page.locator(greenhouseSelectors.jobHeading).first().waitFor({ state: 'visible', timeout: 30_000 })
    const apply = this.page.getByRole('button', { name: /^apply$/i }).first()
    if (await apply.isVisible().catch(() => false)) {
      await apply.hover(); await this.page.waitForTimeout(this.random(350, 700)); await apply.click(); await this.page.waitForTimeout(this.random(500, 900))
    }
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
