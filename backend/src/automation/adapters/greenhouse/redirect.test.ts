import test from 'node:test'
import assert from 'node:assert/strict'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../../browserLauncher.js'
import { GreenhouseAdapter } from './GreenhouseAdapter.js'

for (const linkFirst of [false, true]) test(`Greenhouse follows ${linkFirst ? 'visible employer apply link' : 'delayed employer redirect'} in the same page`, async () => {
  await runWithBrowserPermit('test', async () => {
    const { browser, context } = await launchHeadlessAutomationBrowser()
    try {
      const page = await context.newPage()
      const employer = 'https://employer.example/careers/123'
      const formUrl = 'https://job-boards.greenhouse.io/embed/job_app?for=fixture&token=123&validityToken=employer-token'
      await context.route('**/*', async route => {
        const url = route.request().url()
        let html: string
        if (url.includes('/fixture/jobs/')) html = `<script>setTimeout(()=>location.href=${JSON.stringify(employer)},100)</script>`
        else if (url === employer && linkFirst) html = '<a hidden href="/wrong">Apply now</a><a href="/apply/123">Apply for this role</a>'
        else if (url.includes('employer.example')) html = `<iframe src="${formUrl.replaceAll('&', '&amp;')}"></iframe>`
        else html = '<main><h1>Engineer</h1><form id="application-form"><label>First name<input name="first_name" required></label><button type="submit">Submit application</button></form></main>'
        await route.fulfill({ contentType: 'text/html', body: html })
      })
      const adapter = new GreenhouseAdapter()
      await adapter.openApplication(page, 'https://job-boards.greenhouse.io/fixture/jobs/123')
      await adapter.waitForApplication(page)
      assert.equal(page.url(), formUrl)
      assert.equal(context.pages().length, 1)
      assert.equal(page.frames().length, 1)
      assert.ok((await adapter.extractQuestions(page)).some(q => q.text === 'First name'))
    } finally { await browser.close() }
  })
})

test('Greenhouse opens a collapsed native form before waiting for visible fields', async () => {
  await runWithBrowserPermit('test', async () => {
    const { browser, context } = await launchHeadlessAutomationBrowser()
    try {
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<main><h1>Engineer</h1><button onclick="document.querySelector(\'form\').hidden=false">Apply</button><form hidden id="application-form"><label>Email<input name="email"></label></form></main>' }))
      const page = await context.newPage()
      await new GreenhouseAdapter().openApplication(page, 'https://job-boards.greenhouse.io/fixture/jobs/123')
      assert.equal(await page.locator('#application-form').isVisible(), true)
    } finally { await browser.close() }
  })
})
