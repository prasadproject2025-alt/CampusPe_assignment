import test from 'node:test'
import assert from 'node:assert/strict'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'
import { GreenhouseAdapter } from '../adapters/greenhouse/GreenhouseAdapter.js'
import { LeverAdapter } from '../adapters/lever/LeverAdapter.js'
import { detectManualBlocker, isPassiveRecaptchaBadge } from './submissionConfirmation.js'

const badgeUrl = 'https://www.recaptcha.net/recaptcha/enterprise/anchor?size=invisible&k=fixture'

test('only known invisible reCAPTCHA anchor badges are passive', () => {
  assert.equal(isPassiveRecaptchaBadge(badgeUrl), true)
  assert.equal(isPassiveRecaptchaBadge(badgeUrl.replace('size=invisible', 'size=normal')), false)
  assert.equal(isPassiveRecaptchaBadge(badgeUrl.replace('/anchor', '/bframe')), false)
  assert.equal(isPassiveRecaptchaBadge(badgeUrl.replace('www.recaptcha.net', 'unknown.example')), false)
})

for (const adapter of [new GreenhouseAdapter(), new LeverAdapter()]) test(`${adapter.id}: passive badge permits filling, interactive challenge still pauses`, async () => {
  await runWithBrowserPermit('test', async () => {
    const { browser, context } = await launchHeadlessAutomationBrowser()
    try {
      await context.route('**/*', route => route.fulfill({ body: '<html></html>', contentType: 'text/html' }))
      const page = await context.newPage()
      await page.setContent(`<form id="application-form"><label>Email<input name="email" required></label></form><iframe title="reCAPTCHA" src="${badgeUrl}" width="256" height="60"></iframe>`)
      assert.equal(await detectManualBlocker(page, adapter), null)
      assert.equal(await page.locator('iframe').count(), 1, 'the badge remains untouched')
      await page.evaluate(() => {
        const frame = document.createElement('iframe')
        frame.src = 'https://www.recaptcha.net/recaptcha/enterprise/bframe?k=fixture'
        frame.title = 'reCAPTCHA challenge'
        frame.width = '300'; frame.height = '150'
        document.body.append(frame)
      })
      assert.equal((await detectManualBlocker(page, adapter))?.type, 'CAPTCHA')
    } finally { await browser.close() }
  })
})
