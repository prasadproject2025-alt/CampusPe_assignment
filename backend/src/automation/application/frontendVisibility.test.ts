import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../../../../')
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8')

test('normal frontend apply flow uses headless Chrome without a personal profile, visible window, or new tab', () => {
  const launcher = read('backend/src/automation/browserLauncher.ts')
  const manager = read('backend/src/automation/manager.ts')
  const live = read('frontend/src/components/application/LiveApplication.tsx')
  const custom = read('frontend/src/components/application/CustomApplicationForm.tsx')
  const embed = read('frontend/src/components/application/EmbeddedApplication.tsx')
  const preview = read('frontend/src/components/application/BrowserApplicationPreview.tsx')

  for (const source of [launcher, manager]) {
    assert.doesNotMatch(source, /launchPersistentContext/)
    assert.doesNotMatch(source, /headless\s*:\s*false/)
  }
  assert.match(launcher, /headless:\s*true/)
  assert.match(launcher, /channel:\s*'chrome'/)
  assert.doesNotMatch(manager, /chromium\.launch/)

  for (const source of [live, custom, embed, preview]) {
    assert.doesNotMatch(source, /window\.open\s*\(/)
    assert.doesNotMatch(source, /target\s*=\s*["_']_blank["_']/)
  }

  assert.match(manager, /if \(shouldLaunchBrowserForStrategy\(strategy\)\)/)
  assert.match(manager, /processInPageRun/)
  assert.doesNotMatch(manager, /persistentBrowsers/)
  assert.match(manager, /isolated headless Chrome session/)
  assert.doesNotMatch(manager, /update\(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', \{ error:/)
  assert.match(manager, /Start application must not start a browser for the native form/)
  assert.match(manager, /existingBrowser: retained/)
  assert.doesNotMatch(manager, /processBrowserRun|startCaptchaMonitoring/)
  assert.doesNotMatch(embed, /<iframe/)
  assert.match(custom, /type="checkbox"/)
  assert.match(custom, /schema\.fields\.map|fields\.map|visible\.filter|section\.items\.map/)
  assert.match(custom, /checkbox-group|isMany/)
})

test('LiveApplication renders a native form and only uses the remote preview for assisted sessions', () => {
  const live = read('frontend/src/components/application/LiveApplication.tsx')
  const copy = read('frontend/src/components/application/statusCopy.ts')
  assert.match(live, /ApplicationForm/)
  assert.match(live, /BrowserApplicationPreview/)
  assert.match(live, /assistedActive/)
  assert.match(live, /Continue in assisted browser/)
  assert.match(live, /Cancel session/)
  assert.match(live, /Manual action required/)
  assert.match(copy, /Application form/)
  assert.match(copy, /USER_ACTION_REQUIRED/)
  assert.match(copy, /Application submitted/)
  assert.match(copy, /Manual action required/)
  assert.match(copy, /submissionFailureCode/)
  assert.match(live, /failureCode/)
  assert.match(live, /application-readiness/)
  assert.match(read('frontend/src/components/application/ApplicationQuestion.tsx'), /User input required|SensitiveField/)
  assert.match(read('frontend/src/components/application/SensitiveField.tsx'), /Please provide this information/)
})


test('ready applications submit through the reviewed submission path; assisted sessions retain their own submit endpoint', () => {
  const routes = read('backend/src/index.ts')
  const manager = read('backend/src/automation/manager.ts')
  const live = read('frontend/src/components/application/LiveApplication.tsx')
  assert.match(routes, /automationManager\.submit\(/)
  assert.doesNotMatch(manager, /void this\.submit\(/)
  assert.match(live, /onClick=\{onSubmit\}/)
  assert.match(live, /onClick=\{onSubmitAssisted\}/)
  assert.match(live, /Continue in assisted browser/)
})
