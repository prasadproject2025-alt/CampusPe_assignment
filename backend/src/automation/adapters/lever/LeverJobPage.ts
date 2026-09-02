import type { Page } from 'playwright-core'
import type { JobDetails } from '../../types.js'
import { leverSelectors } from './selectors.js'

export class LeverJobPage {
  constructor(private readonly page: Page) {}

  static supports(url: URL) {
    return /^jobs(?:\.[a-z]{2})?\.lever\.co$/i.test(url.hostname)
      && /^\/[^/]+\/[0-9a-f-]{36}(?:\/apply)?\/?$/i.test(url.pathname)
  }

  static applicationUrl(source: URL) {
    const url = new URL(source)
    url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/apply$/i, '')}/apply`
    url.hash = ''
    return url
  }

  async openApplication(jobUrl: string) {
    await this.page.goto(LeverJobPage.applicationUrl(new URL(jobUrl)).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const denyCookies = this.page.getByRole('button', { name: /^deny$/i }).first()
    if (await denyCookies.isVisible().catch(() => false)) await denyCookies.click()
    await this.page.locator(leverSelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readDetails(originalUrl: string): Promise<JobDetails> {
    const details = await this.page.evaluate(async () => {
      const source = new URL(location.href); source.pathname = source.pathname.replace(/\/apply\/?$/i, ''); source.search = ''; source.hash = ''
      let description = ''; let title = ''; let categories: string[] = []
      try {
        const html = await fetch(source.toString(), { credentials: 'same-origin' }).then((response) => response.text())
        const documentCopy = new DOMParser().parseFromString(html, 'text/html')
        description = documentCopy.querySelector('.content')?.innerHTML || ''
        title = documentCopy.querySelector('.posting-headline h2')?.textContent?.trim() || ''
        categories = [...documentCopy.querySelectorAll('.posting-categories .sort-by-time, .posting-categories .sort-by-team, .posting-categories .sort-by-commitment, .posting-categories .workplaceTypes')].map((node) => node.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean)
      } catch { /* Core metadata is also available on the application page. */ }
      return {
        title: title || document.querySelector('.posting-headline h2, h2')?.textContent?.trim() || document.title,
        description,
        location: categories.find((value) => /,|remote|india|united|canada|europe/i.test(value)) || '',
        employmentType: categories.find((value) => /full.?time|part.?time|contract|temporary|intern/i.test(value)) || '',
        workplaceType: categories.find((value) => /remote|hybrid|on.?site/i.test(value)) || '',
      }
    })
    const url = new URL(this.page.url()); const parts = url.pathname.split('/').filter(Boolean)
    return {
      postingId: parts[1] || null,
      url: originalUrl,
      company: parts[0]?.replace(/[-_]+/g, ' '),
      jobTitle: details.title || undefined,
      jobDescription: details.description || undefined,
      jobBoard: 'lever',
      location: details.location || undefined,
      employmentType: details.employmentType || undefined,
      workplaceType: details.workplaceType || undefined,
    }
  }
}
