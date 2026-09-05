import assert from 'node:assert/strict'
import test from 'node:test'
import { mapAshbyFieldEntries } from './ashbyForm.js'
import { mapGreenhouseQuestions } from './greenhouseForm.js'
import { questionsToFields } from './formModel.js'
import { fieldIsMultiSelect, fieldIsVisible, joinMultiSelectValue, splitMultiSelectValue } from './schema.js'
import type { AdapterQuestion } from '../types.js'

const notionLikeAshby = {
  data: {
    jobPosting: {
      title: 'Brand Designer, Creative Studio',
      applicationForm: {
        sections: [
          {
            fieldEntries: [
              { isRequired: true, field: { path: '_systemfield_name', title: 'Full Name', type: 'String' } },
              { isRequired: true, field: { path: '_systemfield_email', title: 'Email', type: 'Email' } },
              { isRequired: true, field: { path: '7a1e4d9a-2a48-40e5-8aa5-4a29b9909101', title: 'Portfolio Link', type: 'String' } },
            ],
          },
          {
            fieldEntries: [
              { isRequired: false, field: { path: '0b3b7773-f6d9-4032-9ab1-368c4164e95a', title: 'How did you hear about this opportunity? (select all that apply)', type: 'MultiValueSelect', selectableValues: [{ label: 'LinkedIn' }, { label: 'Glassdoor' }, { label: 'Notion Blog' }, { label: 'Notion Employee' }, { label: 'Notion Website' }, { label: 'Billboard/Outdoor Ads' }, { label: 'Conference or Meetup' }] } },
            ],
          },
        ],
      },
      surveyForms: [
        {
          sections: [
            {
              fieldEntries: [
                { isRequired: false, field: { path: '_systemfield_eeoc_gender', title: 'Gender', type: 'ValueSelect', selectableValues: [{ label: 'Male' }, { label: 'Female' }, { label: 'Decline to self-identify' }] } },
                { isRequired: false, field: { path: '_systemfield_eeoc_race', title: 'Race', type: 'ValueSelect', selectableValues: [{ label: 'White' }, { label: 'Asian' }] } },
              ],
            },
            {
              fieldEntries: [
                { isRequired: false, field: { path: '_systemfield_eeoc_veteran_status', title: 'Veteran Status', type: 'ValueSelect', selectableValues: [{ label: 'I am a veteran' }, { label: 'I am not a veteran' }, { label: 'I don\'t wish to answer' }] } },
              ],
            },
          ],
        },
      ],
    },
  },
}

test('should discover every Ashby application field including survey forms after referral', () => {
  const fields = mapAshbyFieldEntries(notionLikeAshby)
  const referralIndex = fields.findIndex((field) => /how did you hear/i.test(field.text))
  assert.ok(referralIndex >= 0)
  assert.ok(fields.length > referralIndex + 1, 'must not truncate after the referral question')
  assert.ok(fields.some((field) => field.path === '_systemfield_eeoc_gender'))
  assert.ok(fields.some((field) => field.path === '_systemfield_eeoc_race'))
  assert.ok(fields.some((field) => field.path === '_systemfield_eeoc_veteran_status'))
  assert.ok(fields.some((field) => field.text === 'Portfolio Link'))
})

test('should preserve Ashby multi-select options and required state', () => {
  const fields = mapAshbyFieldEntries(notionLikeAshby)
  const referral = fields.find((field) => /how did you hear/i.test(field.text))
  assert.equal(referral?.inputType, 'checkbox-group')
  assert.equal(referral?.isMany, true)
  assert.equal(fieldIsMultiSelect(referral!), true)
  assert.deepEqual(referral?.options, ['LinkedIn', 'Glassdoor', 'Notion Blog', 'Notion Employee', 'Notion Website', 'Billboard/Outdoor Ads', 'Conference or Meetup'])
  assert.equal(fields.find((field) => field.path === '_systemfield_name')?.required, true)
  assert.equal(referral?.required, false)
})

test('should preserve custom Ashby questions', () => {
  const fields = mapAshbyFieldEntries(notionLikeAshby)
  assert.equal(fields.find((field) => field.text === 'Portfolio Link')?.path, '7a1e4d9a-2a48-40e5-8aa5-4a29b9909101')
})

test('should discover Greenhouse custom questions, compliance, and multi-select', () => {
  const fields = mapGreenhouseQuestions({
    questions: [
      { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text', values: [] }] },
      { label: 'What is your experience with distributed systems?', required: true, fields: [{ name: 'question_custom_1', type: 'textarea', values: [] }] },
      { label: 'Which tools have you used?', required: false, fields: [{ name: 'question_tools', type: 'multi_value_multi_select', values: [{ label: 'Figma' }, { label: 'Sketch' }, { label: 'Framer' }] }] },
    ],
    compliance: [
      { label: 'Are you authorized to work in the US?', required: true, fields: [{ name: 'question_auth', type: 'multi_value_single_select', values: [{ label: 'Yes' }, { label: 'No' }] }] },
    ],
    demographic_questions: {
      questions: [
        { label: 'Gender', required: false, fields: [{ name: 'gender', type: 'multi_value_single_select', values: [{ label: 'Male' }, { label: 'Female' }] }] },
      ],
    },
  })
  assert.ok(fields.some((field) => field.path === 'question_custom_1'))
  assert.equal(fields.find((field) => field.path === 'question_tools')?.inputType, 'checkbox-group')
  assert.deepEqual(fields.find((field) => field.path === 'question_tools')?.options, ['Figma', 'Sketch', 'Framer'])
  assert.ok(fields.some((field) => field.path === 'question_auth'))
  assert.ok(fields.some((field) => field.path === 'gender'))
})

function customQuestion(id: string, text: string, inputType = 'text'): AdapterQuestion {
  return { id, text, fieldType: inputType === 'textarea' ? 'textarea' : 'text', required: true, locator: { kind: 'field', value: id }, answered: false, inputType }
}

test('should discover Lever custom questions', () => {
  const fields = questionsToFields([customQuestion('name', 'Full name'), customQuestion('custom_lever', 'Why Lever?')])
  assert.ok(fields.some((field) => field.text === 'Why Lever?'))
})

test('should discover Breezy custom questions', () => {
  const fields = questionsToFields([customQuestion('cName', 'Name'), customQuestion('custom_breezy', 'What is your design process?')])
  assert.ok(fields.some((field) => field.text === 'What is your design process?'))
})

test('should discover BambooHR custom questions', () => {
  const fields = questionsToFields([customQuestion('firstName', 'First Name'), customQuestion('customQuestion0', 'Are you able to work hybrid?')])
  assert.ok(fields.some((field) => field.text === 'Are you able to work hybrid?'))
})

test('should discover Rippling custom questions', () => {
  const fields = questionsToFields([customQuestion('full_name', 'Name'), customQuestion('customQuestions.0', 'Describe a product you shipped.')])
  assert.ok(fields.some((field) => field.text === 'Describe a product you shipped.'))
})

test('should discover Workable custom questions', () => {
  const fields = questionsToFields([customQuestion('firstname', 'First name'), customQuestion('qa_custom', 'Portfolio walkthrough')])
  assert.ok(fields.some((field) => field.text === 'Portfolio walkthrough'))
})

test('should discover Recruitee custom questions', () => {
  const fields = questionsToFields([customQuestion('candidate.name', 'Full name'), customQuestion('open_question_1', 'What should we know?')])
  assert.ok(fields.some((field) => field.text === 'What should we know?'))
})

test('conditional fields become visible when the parent answer matches', () => {
  const field = {
    id: 'sponsorship_details',
    text: 'Which visa do you need?',
    fieldType: 'text' as const,
    required: false,
    value: '',
    status: 'empty' as const,
    dependsOn: { fieldId: 'authorized', values: ['No'] },
  }
  assert.equal(fieldIsVisible(field, { authorized: 'Yes' }), false)
  assert.equal(fieldIsVisible(field, { authorized: 'No' }), true)
  assert.deepEqual(splitMultiSelectValue('LinkedIn|Glassdoor'), ['LinkedIn', 'Glassdoor'])
  assert.equal(joinMultiSelectValue(['LinkedIn', 'Glassdoor', 'LinkedIn']), 'LinkedIn|Glassdoor')
})
