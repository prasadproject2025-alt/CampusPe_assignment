import assert from 'node:assert/strict'
import test from 'node:test'
import { isGeneratedWorkableName, isOptionOnlyLabel, pickQuestionLabel, questionLabelFromMeta, semanticFieldKey } from './fieldNormalizer.js'

test('YES/NO option text is never used as the question label', () => {
  const label = questionLabelFromMeta({
    name: 'input_CA_10627_input',
    type: 'radio',
    wrappingLabel: 'YES',
    optionTexts: ['YES', 'NO'],
    groupHeading: 'Are you authorized to work in the United States?',
  })
  assert.equal(label, 'Are you authorized to work in the United States?')
  assert.equal(isOptionOnlyLabel('YES'), true)
  assert.equal(isOptionOnlyLabel('Are you authorized to work in the United States?'), false)
  assert.equal(semanticFieldKey(label, 'input_CA_10627_input'), 'us_work_authorized')
  assert.equal(isGeneratedWorkableName('input_CA_10627_input'), true)
})

test('falls back to a real question instead of an option wrapping label', () => {
  const label = pickQuestionLabel(['YES', 'NO', 'Work authorization'], ['YES', 'NO'])
  assert.equal(label, 'Work authorization')
})

test('rejects intl-tel country dumps as a Phone question', () => {
  const dump = 'Phone United States United Kingdom Afghanistan Albania Algeria American Samoa Andorra Angola'
  const label = pickQuestionLabel([dump, 'Phone'], [])
  assert.equal(label, 'Phone')
  assert.equal(pickQuestionLabel([dump], []), '')
})

test('keeps a complete narrative question longer than eighty characters', () => {
  const question = 'Describe a technical project you are proud of, including the problem you solved, your approach, and what you learned from the experience.'
  assert.equal(pickQuestionLabel([question]), question)
})
