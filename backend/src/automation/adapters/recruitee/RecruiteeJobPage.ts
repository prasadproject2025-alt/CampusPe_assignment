import type { Page } from 'playwright-core'
import type { JobDetails } from '../../types.js'
import { recruiteeSelectors } from './selectors.js'

export class RecruiteeJobPage {
  constructor(private readonly page: Page) {}
  static supports(url: URL) { return url.hostname.toLowerCase().endsWith('.recruitee.com') && /^\/o\/[^/]+(?:\/c\/new)?\/?$/i.test(url.pathname) }
  static applicationUrl(source: URL) { const url = new URL(source); url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/c\/new$/i, '')}/c/new`; url.hash = ''; return url }
  async openApplication(jobUrl: string) { await this.page.goto(RecruiteeJobPage.applicationUrl(new URL(jobUrl)).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 }); await this.page.locator(recruiteeSelectors.form).waitFor({ state: 'visible', timeout: 30_000 }) }
  async readDetails(originalUrl: string): Promise<JobDetails> {
    const details = await this.page.evaluate(async () => {
      const source = new URL(location.href); source.pathname = source.pathname.replace(/\/c\/new\/?$/i, ''); source.search = ''; source.hash = ''
      let description = ''; let locationText = ''; let title = ''
      try { const html = await fetch(source.toString(), { credentials: 'same-origin' }).then((response) => response.text()); const copy = new DOMParser().parseFromString(html, 'text/html'); title = copy.querySelector('h1')?.textContent?.trim() || ''; description = copy.querySelector('main')?.innerHTML || ''; locationText = copy.body.innerText.match(/(?:Remote|Hybrid|On-site)\s+([^\n]+)/i)?.[1] || '' } catch { /* visible fallback */ }
      return { title: title || document.querySelector('h1')?.textContent?.trim() || document.title.split(' - ')[1] || document.title, description, locationText }
    })
    const url = new URL(this.page.url()); const slug = url.pathname.match(/^\/o\/([^/]+)/i)?.[1] || null
    return { postingId: slug, url: originalUrl, company: url.hostname.split('.')[0]?.replace(/[-_]+/g, ' '), jobTitle: details.title || undefined, jobDescription: details.description || undefined, jobBoard: 'recruitee', location: details.locationText || undefined }
  }
}
