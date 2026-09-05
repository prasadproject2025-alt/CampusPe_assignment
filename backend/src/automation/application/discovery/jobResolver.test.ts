import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveJob } from './jobResolver.js'

test('discovers Workable company and job id from an apply URL', () => {
  const discovered = resolveJob('https://apply.workable.com/huggingface/j/002470F128/apply/')
  assert.equal(discovered?.ats, 'workable')
  assert.equal(discovered?.company, 'huggingface')
  assert.equal(discovered?.jobId, '002470F128')
  assert.equal(discovered?.isApplicationPage, true)
  assert.match(discovered?.applicationUrl || '', /\/apply\/?$/)
})

test('discovers Ashby board and job id without inferring fields', () => {
  const discovered = resolveJob('https://jobs.ashbyhq.com/notion/59f2246d-9cb5-4e97-879e-46c902dc276a/application')
  assert.equal(discovered?.ats, 'ashby')
  assert.equal(discovered?.company, 'notion')
  assert.equal(discovered?.jobId, '59f2246d-9cb5-4e97-879e-46c902dc276a')
})
