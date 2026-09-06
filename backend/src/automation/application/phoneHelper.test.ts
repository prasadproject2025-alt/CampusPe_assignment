import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  getDialCode,
  parsePhoneNumber,
  formatPhoneForInput,
  validatePhoneNumber,
} from './phoneHelper.js'

describe('phoneHelper', () => {
  test('getDialCode returns dial code for country name', () => {
    assert.equal(getDialCode('India'), '+91')
    assert.equal(getDialCode('United States'), '+1')
    assert.equal(getDialCode('United Kingdom'), '+44')
  })

  test('getDialCode returns dial code for country code', () => {
    assert.equal(getDialCode('IN'), '+91')
    assert.equal(getDialCode('US'), '+1')
    assert.equal(getDialCode('UK'), '+44')
  })

  test('getDialCode returns null for unknown country', () => {
    assert.equal(getDialCode('Unknown Country'), null)
  })

  test('parsePhoneNumber extracts international format', () => {
    const result = parsePhoneNumber('+91 9876543210')
    assert.equal(result.countryCode, '+91')
    assert.equal(result.nationalNumber, '9876543210')
    assert.equal(result.internationalNumber, '+919876543210')
    assert.equal(result.isValid, true)
  })

  test('parsePhoneNumber extracts international format without spaces', () => {
    const result = parsePhoneNumber('+919876543210')
    assert.equal(result.countryCode, '+91')
    assert.equal(result.nationalNumber, '9876543210')
    assert.equal(result.isValid, true)
  })

  test('parsePhoneNumber handles 10-digit local number', () => {
    const result = parsePhoneNumber('9876543210')
    assert.equal(result.nationalNumber, '9876543210')
    assert.equal(result.internationalNumber, '+919876543210')
    assert.equal(result.isValid, true)
  })

  test('parsePhoneNumber handles invalid phone', () => {
    const result = parsePhoneNumber('invalid')
    assert.equal(result.isValid, false)
  })

  test('parsePhoneNumber handles empty phone', () => {
    const result = parsePhoneNumber('')
    assert.equal(result.isValid, false)
  })

  test('formatPhoneForInput returns international format', () => {
    const result = formatPhoneForInput('+91 9876543210', 'international')
    assert.equal(result, '+919876543210')
  })

  test('formatPhoneForInput returns national format', () => {
    const result = formatPhoneForInput('+91 9876543210', 'national')
    // The parsed result will have nationalNumber as the full number minus country code
    // For +91 9876543210, national is 9876543210
    assert.equal(result, '9876543210')
  })

  test('formatPhoneForInput returns country code', () => {
    const result = formatPhoneForInput('+91 9876543210', 'country-code')
    // The parsed result will have countryCode as +91
    assert.equal(result, '+91')
  })

  test('formatPhoneForInput handles invalid phone', () => {
    const result = formatPhoneForInput('invalid', 'international')
    assert.equal(result, 'invalid')
  })

  test('validatePhoneNumber validates correct international format', () => {
    const result = validatePhoneNumber('+91 9876543210')
    assert.equal(result.isValid, true)
    assert.equal(result.error, undefined)
  })

  test('validatePhoneNumber validates correct local format', () => {
    const result = validatePhoneNumber('9876543210')
    assert.equal(result.isValid, true)
  })

  test('validatePhoneNumber rejects too short phone', () => {
    const result = validatePhoneNumber('123')
    assert.equal(result.isValid, false)
    assert.equal(result.error, 'Invalid phone number format')
  })

  test('validatePhoneNumber rejects too long phone', () => {
    const result = validatePhoneNumber('1234567890123456')
    assert.equal(result.isValid, false)
    assert.equal(result.error, 'Invalid phone number format')
  })

  test('validatePhoneNumber rejects invalid format', () => {
    const result = validatePhoneNumber('invalid')
    assert.equal(result.isValid, false)
    assert.equal(result.error, 'Invalid phone number format')
  })
})
