import assert from 'node:assert/strict'
import test from 'node:test'
import { matchVisibleOption } from './ollama.js'

test('returns the employer option exactly for a normalized AI choice', () => {
  assert.equal(
    matchVisibleOption('yes i consent to receiving text messages', [
      'Yes - I consent to receiving text messages',
      'No - I do not consent to receiving text messages',
    ]),
    'Yes - I consent to receiving text messages',
  )
})

test('prefers an exact pronoun option over a longer combined option', () => {
  assert.equal(matchVisibleOption('He/him/his', ['He/him/his', 'He/him/his, they/them/theirs']), 'He/him/his')
})

test('matches a short country code as a complete option token', () => {
  assert.equal(matchVisibleOption('IN', ['+91 IN - India', '+246 IO - British Indian Ocean Territory', '+98 IR - Iran']), '+91 IN - India')
})

test('rejects an AI choice that is not displayed by the employer', () => {
  assert.equal(matchVisibleOption('Maybe', ['Yes', 'No']), null)
})

test('keeps written answers unchanged when there are no fixed options', () => {
  assert.equal(matchVisibleOption('I am excited about the role.', []), 'I am excited about the role.')
})
