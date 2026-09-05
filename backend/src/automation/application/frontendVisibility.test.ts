import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../../../../')
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8')

test('normal frontend apply flow never launches Chrome, a visible window, or a new tab', () => {
  const launcher = read('backend/src/automation/browserLauncher.ts')
  const manager = read('backend/src/automation/manager.ts')
  const live = read('frontend/src/components/application/LiveApplication.tsx')
  const custom = read('frontend/src/components/application/CustomApplicationForm.tsx')
  const embed = read('frontend/src/components/application/EmbeddedApplication.tsx')
  const preview = read('frontend/src/components/application/BrowserApplicationPreview.tsx')

  for (const source of [launcher, manager]) {
    assert.doesNotMatch(source, /channel\s*:\s*['"]chrome['"]/)
    assert.doesNotMatch(source, /launchPersistentContext/)
    assert.doesNotMatch(source, /headless\s*:\s*false/)
  }
  assert.match(launcher, /headless:\s*true/)
  assert.match(launcher, /chrome-headless-shell/)
  assert.match(launcher, /Refusing to launch a Chrome app window/)
  assert.doesNotMatch(manager, /chromium\.launch/)

  for (const source of [live, custom, embed, preview]) {
    assert.doesNotMatch(source, /window\.open\s*\(/)
    assert.doesNotMatch(source, /target\s*=\s*["_']_blank["_']/)
    assert.doesNotMatch(source, /channel\s*:\s*['"]chrome['"]/)
  }

  assert.match(manager, /if \(shouldLaunchBrowserForStrategy\(strategy\)\)/)
  assert.match(manager, /processInPageRun/)
  assert.doesNotMatch(manager, /persistentBrowsers/)
  assert.match(manager, /isolated windowless headless-shell session/)
  assert.doesNotMatch(manager, /update\(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', \{ error:/)
  assert.match(manager, /Refusing to start Playwright for an in-page application strategy/)
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
  assert.match(copy, /Needs user input/)
  assert.match(copy, /Submitted successfully/)
  assert.match(copy, /Manual action required/)
  assert.match(copy, /submissionFailureCode/)
  assert.match(live, /failureCode/)
  assert.match(live, /application-readiness/)
  assert.match(read('frontend/src/components/application/ApplicationQuestion.tsx'), /User input required|SensitiveField/)
  assert.match(read('frontend/src/components/application/SensitiveField.tsx'), /Please provide this information/)
})
