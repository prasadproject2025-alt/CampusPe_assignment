import assert from 'node:assert/strict'
import test from 'node:test'
import { launchHeadlessAutomationBrowser, resetBrowserLaunchCount, runWithBrowserPermit, setBrowserLauncherForTests } from '../browserLauncher.js'

test('Playwright launch is blocked without a SERVER_BROWSER_AUTOMATION permit', async () => {
  await assert.rejects(
    () => launchHeadlessAutomationBrowser(),
    /Playwright launch blocked/,
  )
})

test('Playwright launch is allowed inside an extract or submit worker permit', async () => {
  resetBrowserLaunchCount()
  setBrowserLauncherForTests(async () => {
    throw new Error('permitted-extract-launch')
  })
  try {
    await assert.rejects(
      () => runWithBrowserPermit('extract', () => launchHeadlessAutomationBrowser()),
      /permitted-extract-launch/,
    )
  } finally {
    setBrowserLauncherForTests(null)
    resetBrowserLaunchCount()
  }
})
