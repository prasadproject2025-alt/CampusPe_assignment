import assert from 'node:assert/strict'
import test from 'node:test'
import { firstUnresolvedRequired, matchQuestionToField, mergeFieldUpdates, questionsToFields } from './formModel.js'
import type { AdapterQuestion } from '../types.js'

const questions: AdapterQuestion[] = [
  { id: 'first_name', text: 'First Name', fieldType: 'text', required: true, locator: { kind: 'field', value: 'first_name' }, answered: false },
  { id: 'portfolio', text: 'Portfolio Link', fieldType: 'text', required: true, locator: { kind: 'field', value: 'portfolio' }, answered: false, inputType: 'text' },
]

test('maps adapter questions onto application fields for AI answers', () => {
  const fields = questionsToFields(questions)
  assert.equal(fields[0]?.status, 'empty')
  const matched = matchQuestionToField(questions[1]!, fields)
  assert.equal(matched?.path, 'portfolio_url')
})

test('does not keep YES/NO option text as a question and prefers semantic match over generated names', () => {
  const extracted: AdapterQuestion[] = [
    { id: 'input_CA_10627_input', text: 'YES', fieldType: 'select', required: true, locator: { kind: 'field', value: 'name:input_CA_10627_input' }, answered: false, inputType: 'radio', options: ['YES', 'NO'] },
    { id: 'input_CA_10627_input', text: 'Are you authorized to work in the United States?', fieldType: 'select', required: true, locator: { kind: 'field', value: 'label:Are you authorized to work in the United States?' }, answered: false, inputType: 'radio', options: ['YES', 'NO'] },
  ]
  const fields = questionsToFields(extracted)
  assert.equal(fields.length, 1)
  assert.equal(fields[0]?.text, 'Are you authorized to work in the United States?')
  assert.equal(fields[0]?.path, 'us_work_authorized')
  const live = { ...extracted[1]!, id: 'input_CA_99999_input', locator: { kind: 'field' as const, value: 'name:input_CA_99999_input' } }
  assert.equal(matchQuestionToField(live, fields)?.path, 'us_work_authorized')
})

test('stores manual AI and user edits and finds unresolved required fields', () => {
  const fields = questionsToFields(questions)
  const updated = mergeFieldUpdates(fields, [
    { id: fields[0]!.id, value: 'Ada Lovelace', status: 'suggested' },
  ])
  assert.equal(updated[0]?.value, 'Ada Lovelace')
  assert.equal(updated[0]?.status, 'suggested')
  const unresolved = firstUnresolvedRequired(updated)
  assert.equal(unresolved?.path, 'portfolio_url')
})
