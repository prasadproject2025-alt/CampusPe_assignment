import assert from 'node:assert/strict'
import test from 'node:test'
import { validateApplicationForRealSubmission, isTestPlaceholder } from './submissionValidator.js'

test('accepts application with genuine candidate data', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'email', text: 'Email', value: 'john@example.com', required: true },
      { id: 'phone', text: 'Phone', value: '+1 234-567-8900', required: true },
      { id: 'linkedin', text: 'LinkedIn URL', value: 'https://linkedin.com/in/johndoe', required: false },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, true)
  assert.equal(result.violations.length, 0)
  assert.equal(result.blockedFields.length, 0)
})

test('rejects application with "Testing mode answer — review only." placeholder', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'email', text: 'Email', value: 'john@example.com', required: true },
      { id: 'company', text: 'Current company', value: 'Testing mode answer — review only.', required: false },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('test placeholder'))
  assert.equal(result.blockedFields.length, 1)
  assert.equal(result.blockedFields[0]?.id, 'company')
})

test('rejects application with @campuspe.local email', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'email', text: 'Email', value: 'test@campuspe.local', required: true },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('fabricated pattern'))
})

test('rejects application with 555 phone number', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'phone', text: 'Phone', value: '+1 555-123-4567', required: true },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('fabricated pattern'))
})

test('rejects application with test LinkedIn URL', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'linkedin', text: 'LinkedIn URL', value: 'https://linkedin.com/in/test', required: false },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('fabricated pattern'))
})

test('accepts application with example.com (not test@example.com)', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'email', text: 'Email', value: 'user@example.com', required: true },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, true)
  assert.equal(result.violations.length, 0)
})

test('rejects application with "Testing mode" in value', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'company', text: 'Current company', value: 'Testing mode selected', required: false },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('test placeholder'))
})

test('rejects application with sentinel values in reason', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'company', text: 'Current company', value: 'Some Company', required: false, reason: 'Testing mode selected a visible option. This run cannot be submitted.' },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('testing-only explanation'))
})

test('rejects application with L3_LLM test-only fallback', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'company', text: 'Current company', value: 'Some Company', required: false, source: 'L3_LLM', reason: 'Used a testing-only fallback because the model declined. This run cannot be submitted.' },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations.length > 0)
  assert.ok(result.violations[0]?.toLowerCase().includes('llm') || result.violations[0]?.toLowerCase().includes('fallback'))
})

test('rejects application with empty required fields', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'email', text: 'Email', value: '', required: true },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('Required field'))
  assert.ok(result.violations[0]?.includes('empty'))
})

test('allows empty optional fields', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'email', text: 'Email', value: 'john@example.com', required: true },
      { id: 'linkedin', text: 'LinkedIn URL', value: '', required: false },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, true)
  assert.equal(result.violations.length, 0)
})

test('handles missing application gracefully', () => {
  const result = validateApplicationForRealSubmission(null, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('not found'))
})

test('handles missing fields gracefully', () => {
  const application = {}
  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations[0]?.includes('not found'))
})

test('collects all violations', () => {
  const application = {
    fields: [
      { id: 'name', text: 'Full name', value: 'John Doe', required: true },
      { id: 'email', text: 'Email', value: 'test@campuspe.local', required: true },
      { id: 'company', text: 'Current company', value: 'Testing mode answer — review only.', required: false },
      { id: 'phone', text: 'Phone', value: '+1 555-123-4567', required: true },
    ],
  }

  const result = validateApplicationForRealSubmission(application, false)

  assert.equal(result.isValid, false)
  assert.ok(result.violations.length >= 3)
  assert.ok(result.blockedFields.length >= 3)
})

test('isTestPlaceholder detects "Testing mode answer — review only."', () => {
  assert.equal(isTestPlaceholder('Testing mode answer — review only.'), true)
})

test('isTestPlaceholder detects case variations', () => {
  assert.equal(isTestPlaceholder('TESTING MODE ANSWER'), true)
  assert.equal(isTestPlaceholder('testing mode answer'), true)
})

test('isTestPlaceholder detects sentinel values', () => {
  assert.equal(isTestPlaceholder('review only'), true)
  assert.equal(isTestPlaceholder('cannot be submitted'), true)
})

test('isTestPlaceholder returns false for genuine values', () => {
  assert.equal(isTestPlaceholder('John Doe'), false)
  assert.equal(isTestPlaceholder('john@example.com'), false)
  assert.equal(isTestPlaceholder('Microsoft'), false)
  assert.equal(isTestPlaceholder('Stanford University'), false)
})

test('isTestPlaceholder returns false for empty string', () => {
  assert.equal(isTestPlaceholder(''), false)
})

