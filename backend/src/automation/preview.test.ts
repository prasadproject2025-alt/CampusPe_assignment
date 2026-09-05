import test from 'node:test'
import assert from 'node:assert/strict'
import { automationBrowserExecutable, launchHeadlessAutomationBrowser, runWithBrowserPermit } from './browserLauncher.js'
import { getRunPreview, startRunPreview, stopRunPreview, automationViewport } from './preview.js'

test('uses a fixed in-app viewport for the live application preview', () => {
  assert.equal(automationViewport.width, 1280)
  assert.equal(automationViewport.height, 800)
})

test('never launches Google Chrome.app or Chrome for Testing', (t) => {
  let executable: string
  try {
    executable = automationBrowserExecutable()
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  assert.match(executable, /chrome-headless-shell/)
  assert.doesNotMatch(executable, /Google Chrome\.app/)
  assert.doesNotMatch(executable, /Google Chrome for Testing\.app/)
})

test('captures JPEG frames from windowless headless-shell', async (t) => {
  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('test', () => launchHeadlessAutomationBrowser())
  } catch (error) {
    t.skip(`Headless shell is not available here: ${error instanceof Error ? error.message : error}`)
    return
  }
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.setContent('<html><body style="background:#5a55d6;color:#fff;font:700 48px sans-serif"><h1>Phone</h1></body></html>')
    await startRunPreview('preview-test', page)
    const preview = getRunPreview('preview-test')
    assert.ok(preview?.frame && preview.frame.length > 100)
    assert.equal(preview.frame[0], 0xff)
    assert.equal(preview.frame[1], 0xd8)
    assert.equal(browser.isConnected(), true)
  } finally {
    await stopRunPreview('preview-test')
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
})
