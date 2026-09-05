import assert from 'node:assert/strict'
import test from 'node:test'
import { greenhouseEmbedUrl, isAllowedEmbedUrl } from './embedPolicy.js'
import { greenhouseQuestionsApiUrl, mapGreenhouseQuestions, parseGreenhouseJobUrl } from './greenhouseForm.js'

test('parses Greenhouse job URLs and rejects other hosts', () => {
  assert.deepEqual(parseGreenhouseJobUrl('https://job-boards.greenhouse.io/airtable/jobs/8403127002'), { board: 'airtable', jobId: '8403127002' })
  assert.deepEqual(parseGreenhouseJobUrl('https://boards.greenhouse.io/eudia/jobs/4020070009'), { board: 'eudia', jobId: '4020070009' })
  assert.equal(parseGreenhouseJobUrl('https://jobs.ashbyhq.com/notion/abc/application'), null)
  assert.equal(parseGreenhouseJobUrl('https://evil.example/airtable/jobs/8403127002'), null)
})

test('builds the public questions API URL only on boards-api.greenhouse.io', () => {
  assert.equal(
    greenhouseQuestionsApiUrl('airtable', '8403127002'),
    'https://boards-api.greenhouse.io/v1/boards/airtable/jobs/8403127002?questions=true',
  )
  assert.throws(() => greenhouseQuestionsApiUrl('https://evil.test', '1'))
  assert.throws(() => greenhouseQuestionsApiUrl('airtable', '../jobs'))
})

test('maps Greenhouse public questions onto native form fields', () => {
  const fields = mapGreenhouseQuestions({
    title: 'Brand Designer',
    questions: [
      { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text', values: [] }] },
      { label: 'Resume', required: true, fields: [{ name: 'resume', type: 'input_file', values: [] }] },
      { label: 'Resume/CV', required: true, fields: [{ name: 'resume_duplicate', type: 'input_file', values: [] }] },
      { label: 'Resume/CV', required: false, fields: [{ name: 'resume_text', type: 'textarea', values: [] }] },
      { label: 'Cover Letter', required: false, fields: [{ name: 'cover_letter', type: 'input_file', values: [] }] },
      { label: 'Cover Letter', required: false, fields: [{ name: 'cover_letter_2', type: 'input_file', values: [] }] },
      { label: 'Phone', required: true, fields: [{ name: 'phone', type: 'input_phone', values: [] }] },
      { label: 'Country', required: true, fields: [{ name: 'country', type: 'input_text', values: [] }] },
      { label: 'Work authorization', required: true, fields: [{ name: 'question_123', type: 'multi_value_single_select', values: [{ label: 'Yes' }, { label: 'No' }] }] },
      { label: 'Hidden tracking', required: false, fields: [{ name: 'utm', type: 'input_hidden', values: [] }] },
    ],
  })
  assert.equal(fields[0]?.path, 'first_name')
  assert.equal(fields[0]?.fieldType, 'text')
  assert.equal(fields.filter((field) => field.inputType === 'file').length, 2)
  assert.equal(fields.some((field) => field.text === 'Phone country code' && field.path === 'phone_country_code'), true)
  assert.equal(fields.filter((field) => /resume/i.test(field.text)).length, 1)
  assert.equal(fields.filter((field) => /cover letter/i.test(field.text)).length, 1)
})

test('Greenhouse location questions keep Location and drop hidden coordinates', () => {
  const fields = mapGreenhouseQuestions({
    questions: [
      { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text', values: [] }] },
    ],
    location_questions: [
      { label: 'Longitude', required: true, fields: [{ name: 'longitude', type: 'input_hidden', values: [] }] },
      { label: 'Latitude', required: true, fields: [{ name: 'latitude', type: 'input_hidden', values: [] }] },
      { label: 'Location', required: true, fields: [{ name: 'location', type: 'input_text', values: [] }] },
    ],
    demographic_questions: {
      questions: [
        { label: 'Gender', required: false, fields: [{ name: 'gender', type: 'multi_value_single_select', values: [{ label: 'Male' }, { label: 'Female' }] }] },
        { label: 'Are you Hispanic/Latino?', required: false, fields: [{ name: 'hispanic_ethnicity', type: 'multi_value_single_select', values: [{ label: 'Yes' }, { label: 'No' }] }] },
        { label: 'Veteran Status', required: false, fields: [{ name: 'veteran_status', type: 'multi_value_single_select', values: [{ label: 'I am a veteran' }] }] },
        { label: 'Disability Status', required: false, fields: [{ name: 'disability_status', type: 'multi_value_single_select', values: [{ label: 'Yes' }, { label: 'No' }] }] },
      ],
    },
  })
  assert.equal(fields.some((field) => /longitude|latitude/i.test(field.text) || field.path === 'longitude'), false)
  assert.equal(fields.some((field) => field.path === 'location' && field.text === 'Location'), true)
  assert.equal(fields.some((field) => field.path === 'gender'), true)
  assert.equal(fields.some((field) => field.path === 'hispanic_ethnicity'), true)
  assert.equal(fields.some((field) => field.path === 'veteran_status'), true)
  assert.equal(fields.some((field) => field.path === 'disability_status'), true)
})

test('only allows the official Greenhouse embed path', () => {
  const embed = greenhouseEmbedUrl('airtable', '8403127002')
  assert.equal(embed, 'https://boards.greenhouse.io/embed/job_app?for=airtable&token=8403127002')
  assert.equal(isAllowedEmbedUrl(embed!), true)
  assert.equal(isAllowedEmbedUrl('https://jobs.ashbyhq.com/notion/abc/application'), false)
  assert.equal(isAllowedEmbedUrl('https://boards.greenhouse.io/airtable/jobs/8403127002'), false)
})
