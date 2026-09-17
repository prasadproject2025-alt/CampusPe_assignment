import assert from 'node:assert/strict'
import test from 'node:test'
import { DOM_EXTRACT_SCRIPT } from './domExtractScript.js'
import { controlsToQuestions } from './domExtractor.js'
import { dedupeExtractedFields } from './deduplicator.js'
import { isOptionOnlyLabel } from './fieldNormalizer.js'
import type { ExtractedControl } from './types.js'

test('DOM extract script is a string and cannot leak __name into the page', () => {
  assert.equal(typeof DOM_EXTRACT_SCRIPT, 'string')
  assert.doesNotMatch(DOM_EXTRACT_SCRIPT, /__name/)
  assert.match(DOM_EXTRACT_SCRIPT, /^\(\(\) => \{/)
})

test('option labels never become questions', () => {
  assert.equal(isOptionOnlyLabel('YES'), true)
  assert.equal(isOptionOnlyLabel('He/Him'), true)
  assert.equal(isOptionOnlyLabel('Male'), true)
  assert.equal(isOptionOnlyLabel('Asian'), true)
  assert.equal(isOptionOnlyLabel('Pronouns'), false)
  assert.equal(isOptionOnlyLabel('Are you authorized to work in the United States?'), false)
})

test('radio groups keep the question and treat He/Him as options', () => {
  const questions = controlsToQuestions([
    {
      question: 'Pronouns',
      kind: 'radio',
      required: false,
      visible: true,
      options: ['He/Him', 'She/Her', 'They/Them'],
      name: 'pronouns',
      id: '',
      dataUi: '',
      answered: true,
      generatedName: false,
    },
    {
      question: 'He/Him',
      kind: 'radio',
      required: false,
      visible: true,
      options: ['He/Him'],
      name: 'pronouns',
      id: 'pronouns-he',
      dataUi: '',
      answered: true,
      generatedName: false,
    },
  ])
  assert.equal(questions.length, 1)
  assert.equal(questions[0]?.text, 'Pronouns')
  assert.deepEqual(questions[0]?.options, ['He/Him', 'She/Her', 'They/Them'])
})

test('deduplicates resume/CV file controls without dropping unrelated text fields', () => {
  const controls: ExtractedControl[] = [
    { question: 'Resume/CV', kind: 'file', required: true, visible: true, options: [], name: 'resume', id: 'resume', dataUi: '', answered: false, generatedName: false },
    { question: 'Resume/CV', kind: 'file', required: true, visible: true, options: [], name: 'resume_text', id: 'resume_text', dataUi: '', answered: false, generatedName: false },
    { question: 'Cover Letter', kind: 'file', required: false, visible: true, options: [], name: 'cover_letter', id: 'cover_letter', dataUi: '', answered: false, generatedName: false },
    { question: 'Cover Letter', kind: 'file', required: false, visible: true, options: [], name: 'cover_letter_text', id: 'cover_letter_text', dataUi: '', answered: false, generatedName: false },
    { question: 'Full name', kind: 'text', required: true, visible: true, options: [], name: 'name', id: 'name', dataUi: '', answered: false, generatedName: false },
  ]
  const unique = dedupeExtractedFields(controls)
  assert.equal(unique.filter((control) => control.kind === 'file').length, 2)
  assert.equal(unique.some((control) => control.question === 'Full name'), true)
})

test('checkbox fragments with unique names collapse into one question', () => {
  const unique = dedupeExtractedFields([
    { question: 'How did you hear about this job?', kind: 'checkbox', required: false, visible: true, options: ['LinkedIn'], name: 'src_li', id: '', dataUi: '', answered: false, generatedName: false },
    { question: 'How did you hear about this job?', kind: 'checkbox', required: false, visible: true, options: ['Glassdoor'], name: 'src_gd', id: '', dataUi: '', answered: false, generatedName: false },
    { question: 'How did you hear about this job?', kind: 'checkbox', required: false, visible: true, options: ['Other'], name: 'src_ot', id: '', dataUi: '', answered: false, generatedName: false },
  ])
  assert.equal(unique.length, 1)
  assert.deepEqual(unique[0]?.options, ['LinkedIn', 'Glassdoor', 'Other'])
})

test('keeps phone country code and tel, drops leftover phone text', () => {
  const unique = dedupeExtractedFields([
    { question: 'Phone country code', kind: 'select', required: true, visible: true, options: ['US', 'IN'], name: 'country', id: 'country', dataUi: '', answered: false, generatedName: false },
    { question: 'Phone', kind: 'text', required: true, visible: true, options: [], name: '', id: 'phone-display', dataUi: '', answered: false, generatedName: false },
    { question: 'Phone', kind: 'phone', required: true, visible: true, options: [], name: 'phone', id: 'phone', dataUi: '', answered: false, generatedName: false },
  ])
  assert.equal(unique.filter((control) => /phone/i.test(control.question)).length, 2)
  assert.equal(unique.some((control) => control.kind === 'text' && control.question === 'Phone'), false)
  assert.equal(unique.some((control) => control.kind === 'phone'), true)
  assert.equal(unique.some((control) => control.question === 'Phone country code'), true)
})

test('keeps Portfolio Link and Portfolio Password as separate text fields', () => {
  const unique = dedupeExtractedFields([
    { question: 'Portfolio Link', kind: 'text', required: false, visible: true, options: [], name: 'portfolio', id: 'portfolio', dataUi: '', answered: false, generatedName: false },
    { question: 'Portfolio Password', kind: 'text', required: false, visible: true, options: [], name: 'portfolio_password', id: 'portfolio_password', dataUi: '', answered: false, generatedName: false },
  ])
  assert.equal(unique.length, 2)
  assert.equal(unique.some((control) => control.question === 'Portfolio Link'), true)
  assert.equal(unique.some((control) => control.question === 'Portfolio Password'), true)
})

test('generated Workable names are not used as the canonical question identity', () => {
  const questions = controlsToQuestions([
    {
      question: 'Are you authorized to work in the United States?',
      kind: 'radio',
      required: true,
      visible: true,
      options: ['YES', 'NO'],
      name: 'input_CA_10627_input',
      id: '',
      dataUi: '',
      answered: false,
      generatedName: true,
    },
  ])
  assert.equal(questions[0]?.locator.value.startsWith('label:'), true)
  assert.doesNotMatch(questions[0]?.id || '', /input_CA_/)
})

test('resume deduplication preserves a separate required attachment', () => {
  const controls = ['Resume', 'CV', 'Upload work sample'].map((question, i): ExtractedControl => ({
    question, kind: 'file', required: true, visible: true, options: [], name: `file_${i}`, id: `file_${i}`, dataUi: '', answered: false, generatedName: false,
  }))
  const fields = dedupeExtractedFields(controls)
  assert.equal(fields.length, 2)
  assert.equal(fields[1]?.question, 'Upload work sample')
})
