import type { Locator, Page } from 'playwright-core'
import type { EducationRecord } from '../types.js'

/**
 * Shared education field utilities for ATS providers.
 * 
 * Education field patterns vary significantly across ATS providers:
 * - Ashby: Autocomplete school search + degree/major inputs + month/year selects (multiple entries)
 * - Breezy: ng-model fields with school/field_of_study/date_start/date_end (multiple entries)
 * - Greenhouse: Variable per form (requires per-form handling)
 * - Lever: Variable per form (requires per-form handling)
 * - Workable: Variable per form (requires per-form handling)
 * - BambooHR: Variable per form (requires per-form handling)
 * - Rippling: Variable per form (requires per-form handling)
 * - Recruitee: Variable per form (requires per-form handling)
 */

export type EducationFieldPattern = 
  | 'ashby' // Autocomplete school + degree/major inputs + month/year selects
  | 'breezy' // ng-model fields
  | 'generic-text' // Simple text inputs
  | 'generic-select' // Select dropdowns
  | 'unknown'

export interface EducationLocatorConfig {
  schoolSelector: string
  degreeSelector?: string
  fieldSelector?: string
  startDateSelector?: string
  endDateSelector?: string
  graduationYearSelector?: string
  addEntryButtonSelector?: string
  entrySelector?: string
  isAutocomplete?: boolean
  isMultiEntry?: boolean
}

/**
 * Date utilities common across education fields
 */
export function parseDateParts(dateString: string): { month?: string; year?: string; fullDate?: string } {
  if (!dateString.trim()) return {}
  
  // Try parsing YYYY-MM-DD, YYYY-MM, or YYYY before trying Date constructor
  const fullMatch = dateString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (fullMatch) {
    return { month: fullMatch[2], year: fullMatch[1], fullDate: dateString }
  }
  const monthMatch = dateString.match(/^(\d{4})-(\d{1,2})$/)
  if (monthMatch) {
    return { month: monthMatch[2], year: monthMatch[1], fullDate: dateString }
  }
  const yearMatch = dateString.match(/^(\d{4})$/)
  if (yearMatch) {
    return { month: undefined, year: yearMatch[1], fullDate: dateString }
  }
  
  const date = new Date(dateString)
  if (isNaN(date.getTime())) {
    return {}
  }
  
  const month = (date.getMonth() + 1).toString()
  const year = date.getFullYear().toString()
  return { month, year, fullDate: dateString }
}

/**
 * Format date for specific input types
 */
export function formatDateForInput(dateString: string, inputType: 'month' | 'year' | 'full' | 'yyyy-mm'): string {
  const parts = parseDateParts(dateString)
  if (!parts.fullDate) return ''
  
  switch (inputType) {
    case 'month':
      return parts.month || ''
    case 'year':
      return parts.year || ''
    case 'full':
      return parts.fullDate
    case 'yyyy-mm':
      return parts.year && parts.month ? `${parts.year}-${parts.month.padStart(2, '0')}` : parts.year || ''
    default:
      return parts.fullDate
  }
}

/**
 * Normalize education record to ensure required fields
 */
export function normalizeEducationRecord(record: EducationRecord): EducationRecord {
  return {
    school: record.school?.trim() || '',
    degree: record.degree?.trim() || '',
    field: record.field?.trim() || '',
    startDate: record.startDate || '',
    endDate: record.endDate || '',
    current: record.current || false,
  }
}

/**
 * Validate education record has minimum required fields
 */
export function isValidEducationRecord(record: EducationRecord): boolean {
  const normalized = normalizeEducationRecord(record)
  return Boolean(normalized.school && normalized.degree)
}

/**
 * Filter valid education records
 */
export function filterValidEducationRecords(records: EducationRecord[]): EducationRecord[] {
  return records.filter(isValidEducationRecord)
}

/**
 * Fill text-based education field with natural typing
 */
export async function fillEducationTextField(
  page: Page,
  locator: Locator,
  value: string,
  options: { delay?: number; clear?: boolean } = {}
): Promise<void> {
  const { delay = 50, clear = true } = options
  
  if (clear) {
    await locator.fill('')
  }
  
  if (value.trim()) {
    await locator.pressSequentially(value, { delay, timeout: 90_000 })
  }
}

/**
 * Select option from dropdown with error handling
 */
export async function selectEducationOption(
  page: Page,
  locator: Locator,
  value: string,
  options: { exact?: boolean; timeout?: number } = {}
): Promise<void> {
  const { exact = false, timeout = 5_000 } = options
  
  try {
    if (exact) {
      await locator.selectOption({ label: value }, { timeout })
    } else {
      await locator.selectOption(value, { timeout })
    }
  } catch (error) {
    // Try value-based selection if label fails
    try {
      await locator.selectOption(value, { timeout })
    } catch (fallbackError) {
      throw new Error(`Could not select option "${value}" in education field.`)
    }
  }
}

/**
 * Handle autocomplete school search (Ashby pattern)
 */
export async function fillAutocompleteSchool(
  page: Page,
  searchLocator: Locator,
  schoolName: string,
  options: { clearFirst?: boolean; delay?: number } = {}
): Promise<void> {
  const { clearFirst = true, delay = 100 } = options
  
  if (clearFirst) {
    await searchLocator.fill('')
  }
  
  await searchLocator.pressSequentially(schoolName, { delay, timeout: 90_000 })
  await page.waitForTimeout(500)
  
  // Try to find exact match first
  const exactOption = page.getByRole('option').filter({ hasText: schoolName }).first()
  const firstOption = page.getByRole('option').first()
  
  const schoolOption = await exactOption.count() > 0 ? exactOption : firstOption
  
  if (await schoolOption.count() === 0) {
    throw new Error(`School "${schoolName}" not found in autocomplete options. Manual selection required.`)
  }
  
  await schoolOption.click()
}

/**
 * Generic multi-entry education handler for providers with add/remove buttons
 */
export async function fillMultiEntryEducation(
  page: Page,
  config: EducationLocatorConfig,
  records: EducationRecord[],
  fillEntry: (page: Page, entryLocator: Locator, record: EducationRecord, index: number) => Promise<void>
): Promise<void> {
  const validRecords = filterValidEducationRecords(records)
  
  if (validRecords.length === 0) {
    throw new Error('No valid education records found. Add school and degree to your profile.')
  }
  
  for (let index = 0; index < validRecords.length; index++) {
    const record = validRecords[index]
    if (!record) continue
    
    // Add new entry if needed
    if (config.addEntryButtonSelector && config.entrySelector) {
      const currentEntries = await page.locator(config.entrySelector).count()
      if (index >= currentEntries) {
        const addButton = page.locator(config.addEntryButtonSelector)
        await addButton.scrollIntoViewIfNeeded()
        await addButton.click()
        await page.waitForTimeout(500)
      }
    }
    
    // Locate the entry
    const entryLocator = config.entrySelector 
      ? page.locator(config.entrySelector).nth(index)
      : page.locator('body') // Fallback
    
    await fillEntry(page, entryLocator, record, index)
  }
}

/**
 * Detect education field pattern from DOM structure
 */
export async function detectEducationPattern(page: Page): Promise<EducationFieldPattern> {
  // Ashby pattern: autocomplete school + degree/major inputs
  if (await page.locator('.ashby-application-form-input-education-entry').count() > 0) {
    return 'ashby'
  }
  
  // Breezy pattern: ng-model fields
  if (await page.locator('[ng-model="candidateSchool.school_name"]').count() > 0) {
    return 'breezy'
  }
  
  // Default to unknown - requires per-form handling
  return 'unknown'
}
