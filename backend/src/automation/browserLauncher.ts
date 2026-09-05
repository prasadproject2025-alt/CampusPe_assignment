import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { automationViewport } from './preview.js'

export type BrowserPermit = 'extract' | 'submit' | 'resume-review' | 'test'

const launchPermit = new AsyncLocalStorage<BrowserPermit>()
let browserLaunchCount = 0
let testLauncher: (() => Promise<{ browser: Browser; context: BrowserContext }>) | null = null

export function getBrowserLaunchCount() { return browserLaunchCount }
export function resetBrowserLaunchCount() { browserLaunchCount = 0 }
export function setBrowserLauncherForTests(launcher: (() => Promise<{ browser: Browser; context: BrowserContext }>) | null) {
  testLauncher = launcher
}

export function runWithBrowserPermit<T>(permit: BrowserPermit, work: () => T): T {
  return launchPermit.run(permit, work)
}

export function currentBrowserPermit() {
  return launchPermit.getStore() || null
}

export function automationBrowserExecutable() {
  let dir = dirname(chromium.executablePath())
  while (dir !== dirname(dir)) {
    const release = existsSync(dir) ? readdirSync(dir).find((name) => name.startsWith('chromium_headless_shell-')) : undefined
    if (release) {
      const platformDir = readdirSync(join(dir, release)).find((name) => name.startsWith('chrome-headless-shell-'))
      const binary = platformDir
        ? join(dir, release, platformDir, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell')
        : ''
      if (binary && existsSync(binary)) return binary
    }
    dir = dirname(dir)
  }
  throw new Error('chrome-headless-shell is not installed. From the backend folder run: npx playwright install chromium-headless-shell')
}

export async function launchHeadlessAutomationBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const permit = launchPermit.getStore()
  if (!permit) {
    throw new Error('Playwright launch blocked: browser launcher is only allowed inside a SERVER_BROWSER_AUTOMATION worker (extract or submit).')
  }
  browserLaunchCount += 1
  if (testLauncher) return testLauncher()
  const executablePath = automationBrowserExecutable()
  if (/Google Chrome\.app|Google Chrome for Testing\.app/i.test(executablePath)) {
    throw new Error('Refusing to launch a Chrome app window. JobCopilot must use chrome-headless-shell.')
  }
  try {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-gpu', '--hide-scrollbars', `--window-size=${automationViewport.width},${automationViewport.height}`],
    })
    const context = await browser.newContext({ viewport: automationViewport })
    return { browser, context }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/Executable doesn't exist|browserType.launch/i.test(message)) {
      throw new Error('Playwright Chromium is not installed. From the backend folder run: npx playwright install chromium-headless-shell')
    }
    throw error
  }
}
