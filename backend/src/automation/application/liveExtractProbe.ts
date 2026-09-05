import { extractApplicationSchema } from './extractor.js'
import { questionsToFields } from './formModel.js'
import { matchCanonicalField } from './matchCanonical.js'
import { fillLiveAnswer } from './extraction/liveResolver.js'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'
import { detectAdapter } from '../registry.js'
import type { ApplicationField } from './types.js'

const URLS = [
  { name: 'Workable', url: 'https://apply.workable.com/huggingface/j/002470F128/apply/' },
  { name: 'Ashby', url: 'https://jobs.ashbyhq.com/notion/59f2246d-9cb5-4e97-879e-46c902dc276a/application' },
  { name: 'Lever', url: 'https://jobs.lever.co/jumpcloud/4ebbdea9-39c2-465d-bbdf-bf379a8e4a06/apply' },
  { name: 'Greenhouse', url: 'https://job-boards.greenhouse.io/airtable/jobs/8403127002' },
]

function summarize(fields: Array<{ text: string; inputType?: string; options?: string[] }>) {
  const optionQuestions = fields.filter((field) => /^(yes|no|he\/him|she\/her|they\/them|male|female)$/i.test(field.text))
  const resumes = fields.filter((field) => field.inputType === 'file' && /resume|cv/i.test(field.text))
  const covers = fields.filter((field) => field.inputType === 'file' && /cover/i.test(field.text))
  return {
    count: fields.length,
    optionQuestions: optionQuestions.map((field) => field.text),
    resumeCount: resumes.length,
    coverCount: covers.length,
    pronouns: fields.find((field) => /^pronouns$/i.test(field.text)),
    sample: fields.map((field) => `${field.text} [${field.inputType || ''}]${field.options?.length ? ` options=${field.options.slice(0, 6).join('|')}` : ''}`),
  }
}

async function run() {
  for (const target of URLS) {
    console.log(`\n=== ${target.name} ===`)
    console.log(target.url)
    try {
      const schema = await extractApplicationSchema(target.name.toLowerCase(), target.url)
      const http = summarize(schema.fields)
      console.log('HTTP/start extract', JSON.stringify({ ...http, pronouns: http.pronouns?.text, optionQuestions: http.optionQuestions }, null, 2))
      const adapter = detectAdapter(target.url)
      if (!adapter) throw new Error('No adapter')
      const live = await runWithBrowserPermit('extract', async () => {
        const { browser, context } = await launchHeadlessAutomationBrowser()
        const page = await context.newPage()
        try {
          await adapter.openApplication(page, target.url)
          await adapter.waitForApplication(page)
          const blocker = await adapter.detectBlocker(page)
          const questions = await adapter.extractQuestions(page)
          const fields = questionsToFields(questions)
          const summary = summarize(fields)
          const fillResults: string[] = []
          if (blocker) fillResults.push(`blocker:${blocker.type}`)
          else {
            const pronouns = questions.find((question) => /pronoun/i.test(question.text.split('\n')[0] || ''))
            if (pronouns && (pronouns.options || []).some((option) => /he\/him/i.test(option))) {
              try {
                await fillLiveAnswer(page, pronouns, (pronouns.options || []).find((option) => /he\/him/i.test(option)) || 'He/Him')
                fillResults.push('Pronouns He/Him: filled')
              } catch (error) {
                fillResults.push(`Pronouns fill: ${error instanceof Error ? error.message : error}`)
              }
            }
            const first = questions.find((question) => /^(first name|full name|name)$/i.test(question.text.split('\n')[0] || '') && question.inputType !== 'file')
            if (first) {
              const match = matchCanonicalField(first, schema.fields.length ? schema.fields : fields as ApplicationField[])
              fillResults.push(`name match: ${match.status}`)
              try {
                await fillLiveAnswer(page, first, 'Ada Lovelace')
                fillResults.push('Name: filled')
              } catch (error) {
                fillResults.push(`Name fill: ${error instanceof Error ? error.message : error}`)
              }
            }
          }
          return { summary, fillResults, blocker: blocker?.type || null }
        } finally {
          await page.close().catch(() => undefined)
          await context.close().catch(() => undefined)
          await browser.close().catch(() => undefined)
        }
      })
      console.log('LIVE extract', JSON.stringify({ ...live.summary, pronouns: live.summary.pronouns?.text, optionQuestions: live.summary.optionQuestions, fillResults: live.fillResults, blocker: live.blocker }, null, 2))
    } catch (error) {
      console.log('ERROR', error instanceof Error ? error.message : error)
    }
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
