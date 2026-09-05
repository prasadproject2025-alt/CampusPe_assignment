import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApplicationField } from './types.js'
import { canonicalFieldId } from './canonicalIdentity.js'
import { matchCanonicalField } from './matchCanonical.js'
import { reconcileCanonicalFields } from './reconcileCanonical.js'

function field(partial: Partial<ApplicationField> & Pick<ApplicationField, 'id' | 'text'>): ApplicationField {
  return {
    fieldType: 'text',
    required: false,
    value: '',
    status: 'empty',
    ...partial,
  }
}

test('canonical ids never use generated Workable names', () => {
  const id = canonicalFieldId({
    question: 'Are you authorized to work in the United States?',
    kind: 'radio',
    atsId: 'input_CA_10627_input',
    options: ['YES', 'NO'],
  })
  assert.doesNotMatch(id, /input_CA_/)
})

test('file controls collapse to one resume and one cover letter identity', () => {
  assert.equal(canonicalFieldId({ question: 'Resume/CV', kind: 'file', atsId: 'resume' }), 'file:resume')
  assert.equal(canonicalFieldId({ question: 'Resume/CV', kind: 'file', atsId: 'resume_text' }), 'file:resume')
  assert.equal(canonicalFieldId({ question: 'Cover Letter', kind: 'file', atsId: 'cover_letter' }), 'file:cover_letter')
})

test('reconciliation keeps live Location (City) and EEOC fields and drops HTTP-only phantoms', () => {
  const http = [
    field({ id: 'greenhouse:location:text', text: 'Location', inputType: 'text', path: 'location', value: 'San Francisco', status: 'manual' }),
    field({ id: 'greenhouse:first_name:text', text: 'First Name', inputType: 'text', path: 'first_name', value: 'Ada', status: 'manual' }),
  ]
  const live = [
    field({ id: 'greenhouse:first_name:text', text: 'First Name', inputType: 'text', path: 'first_name' }),
    field({ id: 'greenhouse:location:select', text: 'Location (City)', inputType: 'select', path: 'location' }),
    field({ id: 'greenhouse:gender:select', text: 'Gender', inputType: 'select', options: ['Male', 'Female'] }),
    field({ id: 'greenhouse:hispanic:select', text: 'Are you Hispanic/Latino?', inputType: 'select' }),
    field({ id: 'greenhouse:veteran:select', text: 'Veteran Status', inputType: 'select' }),
    field({ id: 'greenhouse:disability:select', text: 'Disability Status', inputType: 'select' }),
  ]
  const next = reconcileCanonicalFields(http, live)
  assert.equal(next.some((item) => item.text === 'Location'), false)
  assert.equal(next.find((item) => item.text === 'Location (City)')?.value, 'San Francisco')
  assert.equal(next.some((item) => item.text === 'Gender'), true)
  assert.equal(next.some((item) => item.text === 'Are you Hispanic/Latino?'), true)
  assert.equal(next.some((item) => item.text === 'Veteran Status'), true)
  assert.equal(next.some((item) => item.text === 'Disability Status'), true)
  assert.equal(next.find((item) => item.text === 'First Name')?.value, 'Ada')
})

test('reconciliation drops stale fields and preserves answers on the same canonical id', () => {
  const existing = [
    field({ id: 'file:resume', text: 'Resume/CV', inputType: 'file', value: 'resume.pdf', status: 'accepted' }),
    field({ id: 'stale:yes', text: 'YES', value: 'YES', status: 'manual' }),
  ]
  const incoming = [
    field({ id: 'file:resume', text: 'Resume/CV', inputType: 'file' }),
    field({ id: 'ats:pronouns:radio', text: 'Pronouns', inputType: 'radio', options: ['He/Him', 'She/Her'] }),
  ]
  const next = reconcileCanonicalFields(existing, incoming)
  assert.equal(next.length, 2)
  assert.equal(next.find((item) => item.id === 'file:resume')?.value, 'resume.pdf')
  assert.equal(next.some((item) => item.text === 'YES'), false)
})

test('Greenhouse Location text matches live Location (City) select', () => {
  const live = field({ id: 'greenhouse:location:select', text: 'Location (City)', inputType: 'select', path: 'location', locator: { kind: 'field', value: 'name:location' } })
  const matched = matchCanonicalField(
    field({ id: 'greenhouse:location:text', text: 'Location', inputType: 'text', path: 'location', locator: { kind: 'field', value: 'location' }, value: 'San Francisco' }),
    [live],
  )
  assert.equal(matched.status, 'MATCHED')
  assert.equal(matched.field?.text, 'Location (City)')
})

test('duplicate live questions with the same wording stay AMBIGUOUS', () => {
  const ambiguous = matchCanonicalField(
    field({ id: 'review:website', text: 'Website', inputType: 'text' }),
    [
      field({ id: 'a:website:text', text: 'Website', inputType: 'text', locator: { kind: 'field', value: 'name:site_a' } }),
      field({ id: 'b:website:text', text: 'Website', inputType: 'text', locator: { kind: 'field', value: 'name:site_b' } }),
    ],
  )
  assert.equal(ambiguous.status, 'AMBIGUOUS')
})

test('matchCanonicalField requires confidence and does not silently pick an ambiguous pair', () => {
  const live = field({ id: 'ashby:pronouns:radio', text: 'Pronouns', inputType: 'radio', options: ['He/Him', 'She/Her'] })
  const matched = matchCanonicalField(
    { id: 'x', text: 'Pronouns', fieldType: 'select', required: false, locator: { kind: 'field', value: 'label:Pronouns' }, answered: false, inputType: 'radio', options: ['He/Him', 'She/Her'] },
    [live],
  )
  const matchedSelect = matchCanonicalField(
    { id: 'x', text: 'Pronouns', fieldType: 'select', required: false, locator: { kind: 'field', value: 'label:Pronouns' }, answered: false, inputType: 'select', options: ['He/Him', 'She/Her'] },
    [live],
  )
  assert.equal(matched.status, 'MATCHED')
  assert.equal(matchedSelect.status, 'MATCHED')
  const ambiguous = matchCanonicalField(
    { id: 'x', text: 'Gender', fieldType: 'select', required: false, locator: { kind: 'field', value: 'label:Gender' }, answered: false, inputType: 'radio', options: ['Male', 'Female'] },
    [
      field({ id: 'a:gender:radio', text: 'Gender', inputType: 'radio', options: ['Male', 'Female'], section: 'EEOC' }),
      field({ id: 'b:gender:radio', text: 'Gender', inputType: 'radio', options: ['Male', 'Female'], section: 'Demographic' }),
    ],
  )
  assert.equal(ambiguous.status, 'AMBIGUOUS')
})
