import { describe, test } from 'node:test'
import assert from 'node:assert'
import type { FieldType } from '../../resolver/types.js'
import {
  summarizeReconciliation,
  needsReResolution,
} from './liveReconciliation.js'

describe('liveReconciliation', () => {
  test('summarizeReconciliation reports new fields', () => {
    const result = {
      newFields: [{ id: '1', text: 'Field 1', fieldType: 'text' as FieldType, value: '', required: true, options: [], locator: { kind: 'field' as const, value: '1' }, answered: false, inputType: 'text', status: 'empty' as const }],
      removedFields: [],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: true,
    }
    const summary = summarizeReconciliation(result)
    assert.ok(summary.includes('1 new fields'))
  })

  test('summarizeReconciliation reports removed fields', () => {
    const result = {
      newFields: [],
      removedFields: [{ id: '1', text: 'Field 1', fieldType: 'text' as FieldType, value: '', required: true, options: [], locator: { kind: 'field' as const, value: '1' }, answered: false, inputType: 'text', status: 'empty' as const }],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    const summary = summarizeReconciliation(result)
    assert.ok(summary.includes('1 removed fields'))
  })

  test('summarizeReconciliation reports modified fields', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [{ field: { id: '1', text: 'Field 1', fieldType: 'text' as FieldType, value: 'new', required: true, options: [], locator: { kind: 'field' as const, value: '1' }, answered: false, inputType: 'text', status: 'empty' as const }, oldValue: 'old', newValue: 'new' }],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    const summary = summarizeReconciliation(result)
    assert.ok(summary.includes('1 modified fields'))
  })

  test('summarizeReconciliation reports validation errors', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [],
      validationErrors: ['Error 1', 'Error 2'],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    const summary = summarizeReconciliation(result)
    assert.ok(summary.includes('2 validation errors'))
  })

  test('summarizeReconciliation reports ready for submit', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: true,
      requiresReResolution: false,
    }
    const summary = summarizeReconciliation(result)
    assert.ok(summary.includes('ready for submit'))
  })

  test('summarizeReconciliation reports not ready for submit', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    const summary = summarizeReconciliation(result)
    assert.ok(summary.includes('not ready for submit'))
  })

  test('summarizeReconciliation reports no changes when empty', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    const summary = summarizeReconciliation(result)
    assert.equal(summary, 'not ready for submit')
  })

  test('needsReResolution returns true for new fields', () => {
    const result = {
      newFields: [{ id: '1', text: 'Field 1', fieldType: 'text' as FieldType, value: '', required: true, options: [], locator: { kind: 'field' as const, value: '1' }, answered: false, inputType: 'text', status: 'empty' as const }],
      removedFields: [],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: true,
    }
    assert.equal(needsReResolution(result), true)
  })

  test('needsReResolution returns true for modified fields', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [{ field: { id: '1', text: 'Field 1', fieldType: 'text' as FieldType, value: 'new', required: true, options: [], locator: { kind: 'field' as const, value: '1' }, answered: false, inputType: 'text', status: 'empty' as const }, oldValue: 'old', newValue: 'new' }],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    assert.equal(needsReResolution(result), true)
  })

  test('needsReResolution returns true for validation errors', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [],
      validationErrors: ['Error 1'],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    assert.equal(needsReResolution(result), true)
  })

  test('needsReResolution returns true when not ready for submit', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: false,
      requiresReResolution: false,
    }
    assert.equal(needsReResolution(result), true)
  })

  test('needsReResolution returns false when ready and no changes', () => {
    const result = {
      newFields: [],
      removedFields: [],
      modifiedFields: [],
      validationErrors: [],
      isReadyForSubmit: true,
      requiresReResolution: false,
    }
    assert.equal(needsReResolution(result), false)
  })
})
