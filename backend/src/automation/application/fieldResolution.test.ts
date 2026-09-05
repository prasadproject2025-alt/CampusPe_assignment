import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSubmissionFailureCode } from './fieldResolution.js'

test('parses exact submission failure codes from step or error prefix', () => {
  assert.equal(parseSubmissionFailureCode('FIELD_NOT_FOUND', null), 'FIELD_NOT_FOUND')
  assert.equal(parseSubmissionFailureCode('AWAITING_FINAL_REVIEW', 'ANSWER_REQUIRES_USER: Location is still empty in the JobCopilot form.'), 'ANSWER_REQUIRES_USER')
  assert.equal(parseSubmissionFailureCode('READY_FOR_REVIEW', 'Ready for review'), null)
  assert.equal(parseSubmissionFailureCode('SUBMISSION_TIMEOUT', 'The employer site did not confirm submission.'), 'SUBMISSION_TIMEOUT')
})
