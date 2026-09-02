import test from 'node:test'
import assert from 'node:assert/strict'
import { approvedDeclarationAnswer, manualPolicyReason, nonDisclosureOption, nonInferableFields, sensitiveFields } from './policy.js'

test('prevents AI inference for factual and preference answers', () => {
  for (const field of ['work_authorized', 'us_sponsorship', 'active_immigration_case', 'current_salary', 'expected_salary', 'willing_in_office', 'willing_relocate']) assert.ok(nonInferableFields.has(field))
})

test('keeps voluntary demographic fields out of AI fallback', () => {
  for (const field of ['pronouns', 'gender', 'ethnicity', 'disability', 'veteran']) assert.ok(sensitiveFields.has(field))
})

test('prefers non-disclosure instead of inventing a demographic answer in testing', () => {
  assert.equal(nonDisclosureOption(['Hispanic or Latino', 'Asian', 'Decline to self-identify']), 'Decline to self-identify')
  assert.equal(nonDisclosureOption(['Male', 'Female', 'Prefer not to answer']), 'Prefer not to answer')
})

test('requires the user to accept Breezy privacy consent directly', () => {
  assert.ok(manualPolicyReason('recruitment privacy notice consent'))
  assert.ok(manualPolicyReason('consent to the processing of my data'))
})

test('keeps interview acknowledgements manual unless explicitly approved', () => {
  assert.ok(manualPolicyReason('i acknowledge that i do not have permission to record the interview'))
  assert.ok(manualPolicyReason('no recording or transcribing acknowledgement'))
  assert.equal(approvedDeclarationAnswer(
    'i acknowledge that i do not have permission to record or transcribe any part of the interview process',
    ['Select...', 'I acknowledge'],
  ), 'I acknowledge')
  assert.equal(approvedDeclarationAnswer('i acknowledge that all information is truthful', ['I acknowledge']), null)
})
