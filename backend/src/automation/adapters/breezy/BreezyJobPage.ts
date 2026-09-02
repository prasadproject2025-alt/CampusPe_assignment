import type { Page } from 'playwright-core'
import type { JobDetails } from '../../types.js'
import { breezySelectors } from './selectors.js'

export class BreezyJobPage {
  constructor(private readonly page: Page) {}

  static supports(url: URL) {
    return url.hostname.toLowerCase().endsWith('.breezy.hr') && /^\/p\/[^/]+(?:\/apply)?\/?$/i.test(url.pathname)
  }

  static applicationUrl(source: URL) {
    const url = new URL(source)
    url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/apply$/i, '')}/apply`
    url.hash = ''
    return url
  }

  async openApplication(jobUrl: string) {
    await this.page.goto(BreezyJobPage.applicationUrl(new URL(jobUrl)).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await this.page.locator(breezySelectors.form).waitFor({ state: 'visible', timeout: 30_000 })
  }

  async readDetails(originalUrl: string): Promise<JobDetails> {
    const details = await this.page.evaluate(async () => {
      const source = new URL(location.href); source.pathname = source.pathname.replace(/\/apply\/?$/i, ''); source.search = ''; source.hash = ''
      let description = ''; let locationText = ''; let employmentType = ''; let department = ''
      try {
        const html = await fetch(source.toString(), { credentials: 'same-origin' }).then((response) => response.text())
        const documentCopy = new DOMParser().parseFromString(html, 'text/html')
        description = documentCopy.querySelector('.position-description .description')?.innerHTML || ''
        const meta = [...documentCopy.querySelectorAll('.details li, .position-details li')].map((node) => node.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean) as string[]
        locationText = meta[0] || ''
        employmentType = meta.find((value) => /full.?time|part.?time|contract|temporary|intern/i.test(value)) || ''
        department = meta.find((value) => value !== locationText && value !== employmentType) || ''
      } catch { /* The visible application page still provides the core job metadata. */ }
      return {
        title: document.querySelector('h1')?.textContent?.trim() || document.title.replace(/\s+at\s+.+$/i, ''),
        description, location: locationText, employmentType, department,
      }
    })
    const url = new URL(this.page.url()); const slug = url.pathname.match(/^\/p\/([^/]+)/i)?.[1] || null
    return {
      postingId: slug?.match(/^[0-9a-f]+/i)?.[0] || slug,
      url: originalUrl,
      company: url.hostname.split('.')[0]?.replace(/[-_]+/g, ' '),
      jobTitle: details.title || undefined,
      jobDescription: details.description || undefined,
      jobBoard: 'breezy',
      location: details.location || undefined,
      employmentType: details.employmentType || undefined,
    }
  }
}
