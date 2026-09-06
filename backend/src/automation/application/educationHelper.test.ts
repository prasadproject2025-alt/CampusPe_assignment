import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  parseDateParts,
  formatDateForInput,
  normalizeEducationRecord,
  isValidEducationRecord,
  filterValidEducationRecords,
} from './educationHelper.js'

describe('educationHelper', () => {
  test('parseDateParts extracts month and year from YYYY-MM-DD', () => {
    const result = parseDateParts('2020-05-15')
    assert.equal(result.month, '05')
    assert.equal(result.year, '2020')
    assert.equal(result.fullDate, '2020-05-15')
  })

  test('parseDateParts extracts month and year from YYYY-MM', () => {
    const result = parseDateParts('2020-05')
    assert.equal(result.month, '05')
    assert.equal(result.year, '2020')
    assert.equal(result.fullDate, '2020-05')
  })

  test('parseDateParts extracts year from YYYY', () => {
    const result = parseDateParts('2020')
    assert.equal(result.year, '2020')
    assert.equal(result.month, undefined)
    assert.equal(result.fullDate, '2020')
  })

  test('parseDateParts handles invalid date', () => {
    const result = parseDateParts('invalid')
    assert.equal(result.year, undefined)
    assert.equal(result.month, undefined)
  })

  test('formatDateForInput returns month for month format', () => {
    const result = formatDateForInput('2020-05-15', 'month')
    assert.equal(result, '05')
  })

  test('formatDateForInput returns year for year format', () => {
    const result = formatDateForInput('2020-05-15', 'year')
    assert.equal(result, '2020')
  })

  test('formatDateForInput returns full date for full format', () => {
    const result = formatDateForInput('2020-05-15', 'full')
    assert.equal(result, '2020-05-15')
  })

  test('formatDateForInput returns YYYY-MM for yyyy-mm format', () => {
    const result = formatDateForInput('2020-05-15', 'yyyy-mm')
    assert.equal(result, '2020-05')
  })

  test('normalizeEducationRecord trims and ensures fields', () => {
    const result = normalizeEducationRecord({
      school: '  Stanford  ',
      degree: ' BS ',
      field: ' CS ',
      startDate: '2020-09',
      endDate: '2024-05',
      current: false,
    })
    assert.equal(result.school, 'Stanford')
    assert.equal(result.degree, 'BS')
    assert.equal(result.field, 'CS')
  })

  test('isValidEducationRecord requires school and degree', () => {
    assert.equal(isValidEducationRecord({ school: 'Stanford', degree: 'BS', field: '', startDate: '', endDate: '' }), true)
    assert.equal(isValidEducationRecord({ school: '', degree: 'BS', field: '', startDate: '', endDate: '' }), false)
    assert.equal(isValidEducationRecord({ school: 'Stanford', degree: '', field: '', startDate: '', endDate: '' }), false)
  })

  test('filterValidEducationRecords filters invalid records', () => {
    const records = [
      { school: 'Stanford', degree: 'BS', field: '', startDate: '', endDate: '' },
      { school: '', degree: 'MS', field: '', startDate: '', endDate: '' },
      { school: 'MIT', degree: 'PhD', field: '', startDate: '', endDate: '' },
    ]
    const result = filterValidEducationRecords(records)
    assert.equal(result.length, 2)
    assert.equal(result[0]?.school, 'Stanford')
    assert.equal(result[1]?.school, 'MIT')
  })
})
