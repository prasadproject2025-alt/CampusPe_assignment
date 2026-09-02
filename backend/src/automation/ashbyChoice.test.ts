import test from 'node:test'
import assert from 'node:assert/strict'
import { ashbyChoiceAnswerParts, ashbyChoiceMatches, ashbyRadioChoiceMatches } from './adapters/ashby/AshbyApplicationPage.js'

test('does not confuse Male with Female in Ashby radio choices', () => {
  assert.equal(ashbyChoiceMatches('male', 'female'), false)
  assert.equal(ashbyChoiceMatches('female', 'male'), false)
  assert.equal(ashbyChoiceMatches('male', 'male'), true)
})

test('still matches an answer contained as a complete phrase', () => {
  assert.equal(ashbyChoiceMatches('yes i can relocate', 'yes'), true)
})

test('requires an exact Ashby radio label for race choices', () => {
  assert.equal(ashbyRadioChoiceMatches('hispanic or latino', 'asian not hispanic or latino'), false)
  assert.equal(ashbyRadioChoiceMatches('asian not hispanic or latino', 'asian not hispanic or latino'), true)
})

test('keeps descriptive Ashby radio answers intact', () => {
  const answer = '4 - Main architect; expert called when application code breaks.'
  assert.deepEqual(ashbyChoiceAnswerParts(answer, 'radio-group'), [answer])
})
