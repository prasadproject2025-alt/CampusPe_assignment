import test from 'node:test'
import assert from 'node:assert/strict'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from './browserLauncher.js'
import { getRunPreview, startRunPreview, stopRunPreview, automationViewport } from './preview.js'

test('uses a fixed in-app viewport for the live application preview', () => {
  assert.equal(automationViewport.width, 1280)
  assert.equal(automationViewport.height, 800)
})

test('installed Chrome runs headlessly with a temporary profile and captures JPEG frames', async () => {
  const launched = await runWithBrowserPermit('test', launchHeadlessAutomationBrowser)
  const { browser, context } = launched
  try {
    const page = await context.newPage()
    await page.goto('chrome://version')
    const executable = await page.locator('#executable_path').innerText()
    const profile = await page.locator('#profile_path').innerText()
    const commandLine = await page.locator('#command_line').innerText()
    assert.match(commandLine, /--headless(?:[=\s]|$)/)
    assert.match(profile, /playwright_chromiumdev_profile-/)
    assert.match(executable, /Google Chrome|google-chrome|chrome.exe/)
    assert.doesNotMatch(executable, /headless-shell/)
    await page.goto('about:blank')
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
