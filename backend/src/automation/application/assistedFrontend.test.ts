import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '../../../../')
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8')

test('frontend shows manual-required, assisted browser, cancel, success, and failure states', () => {
  const live = read('frontend/src/components/application/LiveApplication.tsx')
  const copy = read('frontend/src/components/application/statusCopy.ts')
  const preview = read('frontend/src/components/application/BrowserApplicationPreview.tsx')
  const app = read('frontend/src/App.tsx')

  assert.match(live, /Manual action required/)
  assert.match(live, /Continue in assisted browser/)
  assert.match(live, /Cancel session/)
  assert.match(live, /Submitted successfully/)
  assert.match(live, /This application could not be opened inside JobCopilot|run\.error/)
  assert.match(copy, /Preparing application/)
  assert.match(copy, /Filling application/)
  assert.match(copy, /Waiting for your action/)
  assert.match(copy, /User reviewing/)
  assert.match(copy, /Verifying submission/)
  assert.match(copy, /Application submitted/)
  assert.match(copy, /Manual action required/)
  assert.match(copy, /Submission failed/)
  assert.match(preview, /live-frames/)
  assert.match(preview, /live-input/)
  assert.doesNotMatch(preview, /<iframe/)
  assert.match(app, /\/assisted/)
  assert.match(app, /assisted\/cancel/)
})
