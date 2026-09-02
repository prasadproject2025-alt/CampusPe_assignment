import type { Page } from 'playwright-core'
import type { JobDetails } from '../../types.js'
import { workableSelectors } from './selectors.js'

export class WorkableJobPage {
  constructor(private readonly page: Page) {}

  static supports(url: URL) {
    return url.hostname.toLowerCase() === 'apply.workable.com'
      && /^\/[^/]+\/j\/[a-z0-9]+(?:\/apply)?\/?$/i.test(url.pathname)
  }

  static applicationUrl(source: URL) {
    const url = new URL(source)
    const base = url.pathname.replace(/\/+$/, '').replace(/\/apply$/i, '')
    url.pathname = `${base}/apply/`
    url.hash = ''
    return url
  }

  async openApplication(jobUrl: string) {
    await this.page.goto(WorkableJobPage.applicationUrl(new URL(jobUrl)).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const acceptCookies = this.page.getByRole('button', { name: /^accept all$/i }).first()
    if (await acceptCookies.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) await acceptCookies.click()
    await this.page.locator(workableSelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readDetails(originalUrl: string): Promise<JobDetails> {
    const details = await this.page.evaluate(() => {
      const title = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || document.title.replace(/\s+-\s+Application.*$/i, '')
      const body = document.body.innerText
      const employmentType = body.match(/\b(?:full[ -]?time|part[ -]?time|contract|temporary|internship)\b/i)?.[0]
      const workplaceType = body.match(/\b(?:remote|hybrid|on[ -]?site)\b/i)?.[0]
      return { title, employmentType, workplaceType }
    })
    const url = new URL(this.page.url()); const parts = url.pathname.split('/').filter(Boolean)
    return {
      postingId: parts[2] || null,
      url: originalUrl,
      company: parts[0]?.replace(/[-_]+/g, ' '),
      jobTitle: details.title || undefined,
      jobBoard: 'workable',
      employmentType: details.employmentType || undefined,
      workplaceType: details.workplaceType || undefined,
    }
  }
}
