import test from 'node:test'
import assert from 'node:assert/strict'
import { isGreenhouseSchoolSearch } from './adapters/greenhouse/GreenhouseApplicationPage.js'

test('treats Greenhouse school controls as profile-backed autocomplete fields', () => {
  assert.equal(isGreenhouseSchoolSearch('School'), true)
  assert.equal(isGreenhouseSchoolSearch('College or University'), true)
  assert.equal(isGreenhouseSchoolSearch('How did you hear about us?'), false)
})
