/**
 * Pre-submit integrity validator
 *
 * Ensures applications contain only genuine candidate data before
 * allowing real employer submissions.
 */

export interface ValidationResult {
  isValid: boolean
  violations: string[]
  blockedFields: Array<{ id: string; label: string; value: string; reason: string }>
}

const TEST_PLACEHOLDERS = [
  'Testing mode answer — review only.',
  'Testing mode answer',
  'Testing mode',
]

const FABRICATED_PATTERNS = [
  /@campuspe\.local/i,
  /\+1\s*555/,
  /555-123-4567/,
  /linkedin\.com\/in\/test\b/i,
]

const SENTINEL_VALUES = [
  'review only',
  'cannot be submitted',
  'testing-only fallback',
  'testing mode',
]

/**
 * Validates that an application is safe for real submission.
 *
 * Rejects if ANY field contains:
 * - testing-only fallback values
 * - placeholder values
 * - dummy/test candidate values
 * - fabricated sentinel values
 *
 * @param application - The application JSON from automation_runs
 * @param testMode - Whether this is a test mode run
 * @returns ValidationResult with isValid flag and detailed violations
 */
export function validateApplicationForRealSubmission(
  application: any,
  testMode: boolean
): ValidationResult {
  if (testMode) {
    return { isValid: true, violations: [], blockedFields: [] }
  }

  const violations: string[] = []
  const blockedFields: Array<{ id: string; label: string; value: string; reason: string }> = []

  if (!application || !application.fields) {
    return {
      isValid: false,
      violations: ['Application or fields not found'],
      blockedFields: [],
    }
  }

  const fields = application.fields || []

  for (const field of fields) {
    const value = String(field.value || '').trim()
    const label = field.text || field.label || field.id || 'Unknown field'
    const fieldId = field.id || 'unknown'

    // Skip empty values for optional fields
    if (!value && !field.required) {
      continue
    }

    // Skip all validation for empty values (they're already handled by required check above)
    if (!value) {
      continue
    }

    // Check for test placeholders
    if (TEST_PLACEHOLDERS.some((placeholder) => value.includes(placeholder))) {
      violations.push(`Field "${label}" contains test placeholder: "${value}"`)
      blockedFields.push({
        id: fieldId,
        label,
        value,
        reason: 'Contains test placeholder value',
      })
      continue
    }

    // Check for fabricated patterns
    if (FABRICATED_PATTERNS.some((pattern) => pattern.test(value))) {
      violations.push(`Field "${label}" matches fabricated pattern: "${value}"`)
      blockedFields.push({
        id: fieldId,
        label,
        value,
        reason: 'Matches fabricated/test pattern',
      })
      continue
    }

    // Check for sentinel values
    if (SENTINEL_VALUES.some((sentinel) => value.toLowerCase().includes(sentinel))) {
      violations.push(`Field "${label}" contains sentinel value: "${value}"`)
      blockedFields.push({
        id: fieldId,
        label,
        value,
        reason: 'Contains sentinel value indicating test mode',
      })
      continue
    }

    // Check for testing-only explanations
    if (field.reason && field.reason.includes('Testing mode')) {
      violations.push(`Field "${label}" has testing-only explanation: "${field.reason}"`)
      blockedFields.push({
        id: fieldId,
        label,
        value,
        reason: 'Field resolved with testing-only fallback',
      })
      continue
    }

    // Check for L3_LLM source with test mode explanation
    if (field.source === 'L3_LLM' && field.reason?.includes('This run cannot be submitted')) {
      violations.push(`Field "${label}" was resolved with test-only LLM fallback: "${value}"`)
      blockedFields.push({
        id: fieldId,
        label,
        value,
        reason: 'L3_LLM test-only fallback',
      })
      continue
    }
  }

  // Additional validation: required fields must have genuine values
  const requiredFields = fields.filter((f: any) => f.required)
  for (const field of requiredFields) {
    const value = String(field.value || '').trim()
    if (!value) {
      violations.push(`Required field "${field.text || field.id}" is empty`)
      blockedFields.push({
        id: field.id,
        label: field.text || field.id,
        value,
        reason: 'Required field is empty',
      })
    }
  }

  // In test mode, we allow placeholders but flag them
  // In production mode, any placeholder results in rejection
  const isValid = violations.length === 0

  return {
    isValid,
    violations,
    blockedFields,
  }
}

/**
 * Checks if a field value is a test placeholder.
 * Used for dry-run reporting without blocking.
 */
export function isTestPlaceholder(value: string): boolean {
  if (!value) return false
  const normalized = String(value).trim().toLowerCase()
  return TEST_PLACEHOLDERS.some((placeholder) => normalized.includes(placeholder.toLowerCase())) ||
         SENTINEL_VALUES.some((sentinel) => normalized.includes(sentinel.toLowerCase()))
}
