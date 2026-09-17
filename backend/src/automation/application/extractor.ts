import type { Browser, BrowserContext, Page } from 'playwright-core'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'
import { detectAdapter } from '../registry.js'
import { fetchAshbyApplicationForm } from './ashbyForm.js'
import { boardCapabilities } from './capabilities.js'
import { questionsToFields } from './formModel.js'
import { assessExtractionCompleteness } from './extraction/validation.js'
import { fetchGreenhouseApplicationForm } from './greenhouseForm.js'
import { logApplicationSchema } from './schema.js'
import type { ExtractedApplication } from './resolver.js'

type RetainBlockedBrowser = (worker: { browser: Browser; context: BrowserContext; page: Page }) => void

async function extractWithDisposableBrowser(board: string, jobUrl: string, retainBlocked?: RetainBlockedBrowser): Promise<ExtractedApplication> {
  const adapter = detectAdapter(jobUrl)
  if (!adapter || adapter.id !== board) throw new Error('The job-board adapter is unavailable.')
  return runWithBrowserPermit('extract', async () => {
    const { browser, context } = await launchHeadlessAutomationBrowser()
    const page = await context.newPage()
    let retained = false
    try {
      await adapter.openApplication(page, jobUrl)
      const blocker = await adapter.detectBlocker(page)
      if (blocker) {
        if (retainBlocked) { retainBlocked({ browser, context, page }); retained = true }
        return {
          board,
          jobId: '',
          embedUrl: null,
          job: { postingId: null, url: jobUrl, company: board, jobBoard: board },
          fields: [],
          sections: [],
          schemaComplete: false,
          schemaSource: 'headless_extract',
          questions: [],
          manualRequired: { reason: blocker.message, code: blocker.type },
        }
      }
      await adapter.waitForApplication(page)
      await page.evaluate(`(() => { var form = document.querySelector('form'); if (form) form.scrollTo(0, form.scrollHeight); window.scrollTo(0, document.body.scrollHeight); })()`)
      await page.waitForTimeout(400)
      const job = await adapter.extractJob(page, jobUrl)
      const questions = await adapter.extractQuestions(page)
      const fields = questionsToFields(questions)
      const completeness = assessExtractionCompleteness(questions, fields.length)
      const sections = [{ id: 'Application', title: 'Application' }]
      logApplicationSchema({
        ats: board,
        source: 'disposable headless extract',
        sections: 1,
        fields: fields.length,
        required: fields.filter((field) => field.required).length,
        complete: completeness.complete,
      })
      if (!fields.length) {
        return {
          board,
          jobId: job.postingId || '',
          embedUrl: null,
          job,
          fields: [],
          sections,
          schemaComplete: false,
          schemaSource: 'headless_extract',
          questions,
          manualRequired: { reason: 'We couldn\'t retrieve the complete application form.', code: 'UNSUPPORTED' },
        }
      }
      return {
        board,
        jobId: job.postingId || '',
        embedUrl: null,
        job,
        fields,
        sections,
        schemaComplete: completeness.complete,
        schemaSource: 'headless_extract',
        questions,
      }
    } finally {
      if (!retained) {
      await page.close().catch(() => undefined)
      await context.close().catch(() => undefined)
      await browser.close().catch(() => undefined)
      }
    }
  })
}

export async function extractApplicationSchema(board: string, jobUrl: string, retainBlocked?: RetainBlockedBrowser): Promise<ExtractedApplication> {
  const capabilities = boardCapabilities(board)
  if (capabilities.extractMode === 'http') {
    const form = board === 'ashby'
      ? await fetchAshbyApplicationForm(jobUrl)
      : board === 'greenhouse'
        ? await fetchGreenhouseApplicationForm(jobUrl)
        : null
    if (!form) throw new Error(`${board} does not support HTTP application-form extraction.`)
    return {
      board: form.board,
      jobId: form.jobId,
      embedUrl: form.embedUrl,
      job: form.job,
      fields: form.fields,
      sections: form.sections || [],
      schemaComplete: form.schemaComplete === true,
      schemaSource: form.schemaSource,
      questions: form.questions,
    }
  }
  if (capabilities.extractMode === 'server_browser') {
    return extractWithDisposableBrowser(board, jobUrl, retainBlocked)
  }
  throw new Error(`${board} cannot extract an application schema.`)
}
