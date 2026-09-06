import type { Page } from 'playwright-core'
import type { JobBoardAdapter } from '../types.js'
import type { ApplicationField } from './types.js'

/**
 * Live-form reconciliation utilities.
 * 
 * Real ATS forms can:
 * - Reveal new required fields after answering questions
 * - Hide/show fields conditionally
 * - Modify field values after resume parsing
 * - Have browser-native validation errors
 * 
 * This module provides shared logic to detect and handle these changes.
 */

export interface ReconciliationResult {
  newFields: ApplicationField[]
  removedFields: ApplicationField[]
  modifiedFields: { field: ApplicationField; oldValue: string; newValue: string }[]
  validationErrors: string[]
  isReadyForSubmit: boolean
  requiresReResolution: boolean
}

export interface ReconciliationOptions {
  maxPasses?: number
  resumeParsingTimeout?: number
  detectValidationErrors?: boolean
}

const DEFAULT_RECONCILIATION_OPTIONS: ReconciliationOptions = {
  maxPasses: 3,
  resumeParsingTimeout: 30_000,
  detectValidationErrors: true,
}

/**
 * Reconcile live application state with expected fields
 */
export async function reconcileLiveApplication(
  page: Page,
  adapter: JobBoardAdapter,
  expectedFields: ApplicationField[],
  options: ReconciliationOptions = {}
): Promise<ReconciliationResult> {
  const opts = { ...DEFAULT_RECONCILIATION_OPTIONS, ...options }
  
  const result: ReconciliationResult = {
    newFields: [],
    removedFields: [],
    modifiedFields: [],
    validationErrors: [],
    isReadyForSubmit: false,
    requiresReResolution: false,
  }
  
  // Extract current fields from live DOM
  const currentFields = await adapter.extractQuestions(page)
  const currentApplicationFields = questionsToFields(currentFields)
  
  // Detect new fields
  const expectedIds = new Set(expectedFields.map(f => f.id))
  for (const current of currentApplicationFields) {
    if (!expectedIds.has(current.id)) {
      result.newFields.push(current)
      result.requiresReResolution = true
    }
  }
  
  // Detect removed fields
  const currentIds = new Set(currentApplicationFields.map(f => f.id))
  for (const expected of expectedFields) {
    if (!currentIds.has(expected.id)) {
      result.removedFields.push(expected)
    }
  }
  
  // Detect modified field values
  for (const current of currentApplicationFields) {
    const expected = expectedFields.find(f => f.id === current.id)
    if (expected && expected.value !== current.value) {
      result.modifiedFields.push({
        field: current,
        oldValue: expected.value,
        newValue: current.value,
      })
    }
  }
  
  // Detect browser validation errors
  if (opts.detectValidationErrors) {
    result.validationErrors = await detectValidationErrors(page)
  }
  
  // Check if ready for submit
  try {
    result.isReadyForSubmit = await adapter.isReviewReady(page)
  } catch {
    result.isReadyForSubmit = false
  }
  
  return result
}

/**
 * Detect browser-native validation errors
 */
async function detectValidationErrors(page: Page): Promise<string[]> {
  const errors: string[] = []
  
  // Check for invalid inputs
  const invalidInputs = page.locator('input:invalid, select:invalid, textarea:invalid')
  const invalidCount = await invalidInputs.count()
  
  for (let i = 0; i < invalidCount; i++) {
    const input = invalidInputs.nth(i)
    const name = await input.getAttribute('name').catch(() => 'unknown')
    const type = await input.getAttribute('type').catch(() => 'text')
    errors.push(`Invalid ${type} field: ${name}`)
  }
  
  // Check for custom validation messages
  const validationMessages = page.locator('[data-validation-error], .error-message, .validation-error')
  const messageCount = await validationMessages.count()
  
  for (let i = 0; i < messageCount; i++) {
    const message = validationMessages.nth(i)
    const text = await message.textContent().catch(() => '')
    if (text?.trim()) {
      errors.push(text.trim())
    }
  }
  
  return errors
}

/**
 * Wait for resume parsing to complete
 */
export async function waitForResumeParsing(
  page: Page,
  adapter: JobBoardAdapter,
  options: { timeout?: number } = {}
): Promise<{ success: boolean; error?: string }> {
  const timeout = options.timeout || 30_000
  const deadline = Date.now() + timeout
  
  // Check if adapter has specific resume parsing wait logic
  if ('waitForResumeParsing' in adapter) {
    try {
      await (adapter as any).waitForResumeParsing(page)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  
  // Generic wait: look for common parsing indicators
  while (Date.now() < deadline) {
    const parsing = page.locator('[class*="parsing"], [class*="processing"], [aria-busy="true"]')
    const progress = page.locator('[role="progressbar"], [class*="progress"]')
    
    const hasParsing = await parsing.count() > 0
    const hasProgress = await progress.count() > 0
    
    if (!hasParsing && !hasProgress) {
      return { success: true }
    }
    
    await page.waitForTimeout(500)
  }
  
  return { success: false, error: 'Resume parsing timeout' }
}

/**
 * Reconcile after resume upload
 */
export async function reconcileAfterResumeUpload(
  page: Page,
  adapter: JobBoardAdapter,
  originalFields: ApplicationField[],
  options: ReconciliationOptions = {}
): Promise<ReconciliationResult> {
  // Wait for resume parsing
  const parsingResult = await waitForResumeParsing(page, adapter, {
    timeout: options.resumeParsingTimeout,
  })
  
  if (!parsingResult.success) {
    // Log warning but continue
    console.warn(`Resume parsing warning: ${parsingResult.error}`)
  }
  
  // Wait a bit for DOM to settle
  await page.waitForTimeout(1000)
  
  // Reconcile fields
  return reconcileLiveApplication(page, adapter, originalFields, options)
}

/**
 * Perform multi-pass reconciliation for dynamic fields
 */
export async function reconcileDynamicFields(
  page: Page,
  adapter: JobBoardAdapter,
  initialFields: ApplicationField[],
  fillFunction: (newFields: ApplicationField[]) => Promise<void>,
  options: ReconciliationOptions = {}
): Promise<{ finalFields: ApplicationField[]; passes: number; result: ReconciliationResult }> {
  const opts = { ...DEFAULT_RECONCILIATION_OPTIONS, ...options }
  const maxPasses = opts.maxPasses || 3
  let currentFields = [...initialFields]
  let pass = 0
  let lastResult: ReconciliationResult = {
    newFields: [],
    removedFields: [],
    modifiedFields: [],
    validationErrors: [],
    isReadyForSubmit: false,
    requiresReResolution: false,
  }
  
  while (pass < maxPasses) {
    pass++
    
    // Reconcile current state
    lastResult = await reconcileLiveApplication(page, adapter, currentFields, opts)
    
    // If no new fields and ready for submit, we're done
    if (lastResult.newFields.length === 0 && lastResult.isReadyForSubmit) {
      break
    }
    
    // If new fields appeared, fill them
    if (lastResult.newFields.length > 0) {
      await fillFunction(lastResult.newFields)
      currentFields = [...currentFields, ...lastResult.newFields]
      
      // Wait for potential conditional field reveals
      await page.waitForTimeout(1000)
    } else {
      // No new fields but not ready - might be validation issue
      break
    }
  }
  
  return {
    finalFields: currentFields,
    passes: pass,
    result: lastResult,
  }
}

/**
 * Helper: convert adapter questions to application fields
 */
function questionsToFields(questions: any[]): ApplicationField[] {
  return questions.map((q, index) => ({
    id: q.id || `field-${index}`,
    text: q.text || '',
    fieldType: q.fieldType || 'text',
    value: q.answered ? (q.value || '') : '',
    required: q.required || false,
    options: q.options || [],
    locator: q.locator || { kind: 'field', value: q.id || `field-${index}` },
    answered: q.answered || false,
    inputType: q.inputType || 'text',
    status: 'empty' as const,
  }))
}

/**
 * Check if field resolution is needed
 */
export function needsReResolution(result: ReconciliationResult): boolean {
  return (
    result.newFields.length > 0 ||
    result.modifiedFields.length > 0 ||
    result.validationErrors.length > 0 ||
    !result.isReadyForSubmit
  )
}

/**
 * Generate reconciliation summary for logging
 */
export function summarizeReconciliation(result: ReconciliationResult): string {
  const parts: string[] = []
  
  if (result.newFields.length > 0) {
    parts.push(`${result.newFields.length} new fields`)
  }
  
  if (result.removedFields.length > 0) {
    parts.push(`${result.removedFields.length} removed fields`)
  }
  
  if (result.modifiedFields.length > 0) {
    parts.push(`${result.modifiedFields.length} modified fields`)
  }
  
  if (result.validationErrors.length > 0) {
    parts.push(`${result.validationErrors.length} validation errors`)
  }
  
  if (result.isReadyForSubmit) {
    parts.push('ready for submit')
  } else {
    parts.push('not ready for submit')
  }
  
  return parts.length > 0 ? parts.join(', ') : 'no changes'
}
