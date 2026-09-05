import assert from 'node:assert/strict'
import test from 'node:test'
import { ASHBY_GRAPHQL_URL, mapAshbyFieldEntries, parseAshbyJobUrl } from './ashbyForm.js'

test('parses Ashby job URLs and rejects other hosts', () => {
  assert.deepEqual(parseAshbyJobUrl('https://jobs.ashbyhq.com/notion/d177d052-ef57-4900-acf2-d58e9eded620/application'), {
    board: 'notion',
    jobId: 'd177d052-ef57-4900-acf2-d58e9eded620',
  })
  assert.equal(parseAshbyJobUrl('https://jobs.ashbyhq.com/notion/not-a-uuid'), null)
  assert.equal(parseAshbyJobUrl('https://evil.example/notion/d177d052-ef57-4900-acf2-d58e9eded620'), null)
})

test('maps Ashby hosted applicationForm fieldEntries onto native form fields', () => {
  const fields = mapAshbyFieldEntries({
    data: {
      jobPosting: {
        title: 'Brand Designer',
        applicationForm: {
          fieldEntries: [
            { isRequired: true, field: { path: '_systemfield_name', title: 'Full Name', type: 'String' } },
            { isRequired: true, field: { path: '_systemfield_resume', title: 'Resume', type: 'File' } },
            { isRequired: true, field: { path: '7a1e4d9a-2a48-40e5-8aa5-4a29b9909101', title: 'Portfolio Link', type: 'String' } },
            { isRequired: false, field: { path: 'pronouns', title: 'Pronouns', type: 'ValueSelect', selectableValues: [{ label: 'They/Them' }, { label: 'Prefer not to say' }] } },
          ],
        },
      },
    },
  })
  assert.equal(fields.length, 4)
  assert.equal(fields[0]?.path, '_systemfield_name')
  assert.equal(fields[1]?.path, '_systemfield_resume')
  assert.equal(fields[1]?.inputType, 'file')
  assert.equal(fields[2]?.text, 'Portfolio Link')
  assert.equal(fields[2]?.path, '7a1e4d9a-2a48-40e5-8aa5-4a29b9909101')
  assert.equal(fields[3]?.fieldType, 'select')
  assert.deepEqual(fields[3]?.options, ['They/Them', 'Prefer not to say'])
})

test('maps Ashby surveyForms that appear after the referral question', () => {
  const fields = mapAshbyFieldEntries({
    data: {
      jobPosting: {
        applicationForm: {
          fieldEntries: [
            { isRequired: false, field: { path: '0b3b7773-f6d9-4032-9ab1-368c4164e95a', title: 'How did you hear about this opportunity? (select all that apply)', type: 'MultiValueSelect', selectableValues: [{ label: 'LinkedIn' }, { label: 'Glassdoor' }] } },
          ],
        },
        surveyForms: [
          { fieldEntries: [{ isRequired: false, field: { path: '_systemfield_eeoc_gender', title: 'Gender', type: 'ValueSelect', selectableValues: [{ label: 'Male' }] } }] },
        ],
      },
    },
  })
  assert.equal(fields[0]?.inputType, 'checkbox-group')
  assert.equal(fields[1]?.path, '_systemfield_eeoc_gender')
})

test('Ashby form loader posts only to the hosted jobs.ashbyhq.com GraphQL endpoint', () => {
  assert.equal(ASHBY_GRAPHQL_URL, 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting')
  assert.doesNotMatch(ASHBY_GRAPHQL_URL, /api\.ashbyhq\.com/)
})
