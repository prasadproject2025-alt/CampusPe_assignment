import type { Locator, Page } from 'playwright-core'

/**
 * Shared phone field utilities for ATS providers.
 * 
 * Phone field patterns vary significantly across ATS providers:
 * - Ashby: Single text input (international format)
 * - Greenhouse: Separate country dropdown + phone input
 * - Lever: Single text input with optional country code
 * - Workable: Country dropdown + phone input with validation
 * - BambooHR: Phone text input
 * - Breezy: Phone text input
 * - Rippling: Location-based phone with country
 * - Recruitee: Country dropdown + phone input
 */

export type PhoneFieldPattern =
  | 'single-text' // Single international phone input
  | 'country-dropdown' // Country dropdown + phone input
  | 'country-autocomplete' // Country autocomplete + phone input
  | 'combined' // Combined country code + phone in one field
  | 'unknown'

export interface PhoneLocatorConfig {
  phoneSelector: string
  countrySelector?: string
  countryButtonSelector?: string
  countryOptionSelector?: string
  isDropdown?: boolean
  isAutocomplete?: boolean
  combinedFormat?: 'local-first' | 'country-first' | 'international'
}

/**
 * Parse phone number into components
 */
export interface PhoneComponents {
  country?: string // Country name or code (e.g., "India", "IN", "+91")
  countryCode?: string // Dial code (e.g., "+91", "1")
  nationalNumber?: string // National number without country code (e.g., "9876543210")
  internationalNumber?: string // Full international format (e.g., "+91 9876543210")
  isValid: boolean
}

/**
 * Country code mappings (simplified subset)
 */
const COUNTRY_DIAL_CODES: Record<string, string> = {
  'india': '+91',
  'in': '+91',
  'united states': '+1',
  'us': '+1',
  'usa': '+1',
  'united kingdom': '+44',
  'uk': '+44',
  'gb': '+44',
  'canada': '+1',
  'ca': '+1',
  'australia': '+61',
  'au': '+61',
  'germany': '+49',
  'de': '+49',
  'france': '+33',
  'fr': '+33',
  'japan': '+81',
  'jp': '+81',
  'china': '+86',
  'cn': '+86',
  'singapore': '+65',
  'sg': '+65',
  'united arab emirates': '+971',
  'uae': '+971',
}

/**
 * Extract country code from country name/code
 */
export function getDialCode(country: string): string | null {
  const normalized = country.toLowerCase().trim()
  return COUNTRY_DIAL_CODES[normalized] || null
}

/**
 * Parse phone number into components
 */
export function parsePhoneNumber(phone: string): PhoneComponents {
  if (!phone?.trim()) {
    return { isValid: false }
  }
  
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '')
  
  // Check for international format with country code
  // Try to match common patterns: +CC NUMBER where CC is 1-3 digits
  // We'll try 2-digit country codes first (most common like +91, +44, +1), then 1-digit, then 3-digit
  if (cleaned.startsWith('+')) {
    const twoDigit = cleaned.match(/^\+(\d{2})(\d+)$/)
    const oneDigit = cleaned.match(/^\+(\d)(\d+)$/)
    const threeDigit = cleaned.match(/^\+(\d{3})(\d+)$/)
    
    if (twoDigit && twoDigit[2] && twoDigit[2].length >= 6 && twoDigit[2].length <= 15) {
      return {
        countryCode: `+${twoDigit[1]}`,
        nationalNumber: twoDigit[2],
        internationalNumber: cleaned,
        isValid: true,
      }
    }
    if (oneDigit && oneDigit[2] && oneDigit[2].length >= 6 && oneDigit[2].length <= 15) {
      return {
        countryCode: `+${oneDigit[1]}`,
        nationalNumber: oneDigit[2],
        internationalNumber: cleaned,
        isValid: true,
      }
    }
    if (threeDigit && threeDigit[2] && threeDigit[2].length >= 6 && threeDigit[2].length <= 15) {
      return {
        countryCode: `+${threeDigit[1]}`,
        nationalNumber: threeDigit[2],
        internationalNumber: cleaned,
        isValid: true,
      }
    }
  }
  
  // Check for local format (assume 10-digit for India as fallback)
  const localMatch = cleaned.match(/^(\d{10})$/)
  if (localMatch) {
    return {
      nationalNumber: localMatch[1],
      internationalNumber: `+91${localMatch[1]}`, // Default to India
      isValid: true,
    }
  }
  
  // Generic international-like format
  if (/^\d{10,15}$/.test(cleaned)) {
    return {
      nationalNumber: cleaned,
      internationalNumber: cleaned,
      isValid: true,
    }
  }
  
  return { isValid: false }
}

/**
 * Format phone for specific input type
 */
export function formatPhoneForInput(
  phone: string,
  format: 'international' | 'national' | 'country-code' | 'combined'
): string {
  const parsed = parsePhoneNumber(phone)
  
  if (!parsed.isValid) {
    return phone
  }
  
  switch (format) {
    case 'international':
      return parsed.internationalNumber || ''
    case 'national':
      return parsed.nationalNumber || ''
    case 'country-code':
      return parsed.countryCode || ''
    case 'combined':
      // For combined fields, use international format
      return parsed.internationalNumber || ''
    default:
      return phone
  }
}

/**
 * Fill single text phone input
 */
export async function fillSinglePhoneInput(
  page: Page,
  locator: Locator,
  phone: string,
  options: { format?: 'international' | 'national'; clear?: boolean } = {}
): Promise<void> {
  const { format = 'international', clear = true } = options
  
  if (clear) {
    await locator.fill('')
  }
  
  const formatted = formatPhoneForInput(phone, format)
  if (formatted) {
    await locator.fill(formatted)
  }
}

/**
 * Fill country dropdown + phone input
 */
export async function fillCountryPhoneInput(
  page: Page,
  config: PhoneLocatorConfig,
  phone: string,
  country: string,
  options: { phoneFormat?: 'national' | 'international' } = {}
): Promise<void> {
  const { phoneFormat = 'national' } = options
  
  // Fill country dropdown if present
  if (config.countrySelector) {
    const countryLocator = page.locator(config.countrySelector)
    const dialCode = getDialCode(country)
    
    if (dialCode) {
      // Try to select by dial code
      try {
        const options = await countryLocator.locator('option').all()
        for (const option of options) {
          const text = await option.textContent()
          if (text && text.includes(dialCode.replace('+', ''))) {
            await option.click()
            break
          }
        }
      } catch {
        // Fallback to country name
        try {
          await countryLocator.selectOption(country)
        } catch (error) {
          throw new Error(`Could not select country "${country}" in phone field dropdown.`)
        }
      }
    } else {
      // Select by country name
      try {
        await countryLocator.selectOption(country)
      } catch (error) {
        throw new Error(`Could not select country "${country}" in phone field dropdown.`)
      }
    }
  }
  
  // Fill phone input
  if (config.phoneSelector) {
    const phoneLocator = page.locator(config.phoneSelector)
    const parsed = parsePhoneNumber(phone)
    const phoneValue = phoneFormat === 'national' ? parsed.nationalNumber : parsed.internationalNumber
    
    if (phoneValue) {
      await phoneLocator.fill(phoneValue)
    }
  }
}

/**
 * Handle country autocomplete phone (Workable pattern)
 */
export async function fillAutocompleteCountryPhone(
  page: Page,
  config: PhoneLocatorConfig,
  phone: string,
  country: string,
  options: { phoneFormat?: 'national' } = {}
): Promise<void> {
  const { phoneFormat = 'national' } = options
  
  // Fill country autocomplete if present
  if (config.countryButtonSelector && config.countryOptionSelector) {
    const countryButton = page.locator(config.countryButtonSelector)
    await countryButton.click()
    
    const dialCode = getDialCode(country)
    if (dialCode) {
      // Search by dial code
      const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first()
      await searchInput.fill(dialCode)
      await page.waitForTimeout(300)
      
      const optionSelector = config.countryOptionSelector
        .replace('{code}', dialCode.replace('+', ''))
      
      const option = page.locator(optionSelector).first()
      if (await option.isVisible().catch(() => false)) {
        await option.click()
      } else {
        // Try country name
        await searchInput.fill(country)
        await page.waitForTimeout(300)
        const nameOption = page.locator(config.countryOptionSelector).first()
        if (await nameOption.isVisible().catch(() => false)) {
          await nameOption.click()
        } else {
          throw new Error(`Could not find country "${country}" in autocomplete.`)
        }
      }
    }
  }
  
  // Fill phone input
  if (config.phoneSelector) {
    const phoneLocator = page.locator(config.phoneSelector)
    const parsed = parsePhoneNumber(phone)
    const phoneValue = phoneFormat === 'national' ? parsed.nationalNumber : parsed.internationalNumber
    
    if (phoneValue) {
      await phoneLocator.fill(phoneValue)
    }
  }
}

/**
 * Detect phone field pattern from DOM structure
 */
export async function detectPhonePattern(page: Page): Promise<PhoneFieldPattern> {
  // Workable pattern: country button + phone input
  if (await page.locator('[data-country-code], [data-dial-code]').count() > 0) {
    return 'country-autocomplete'
  }
  
  // Greenhouse pattern: country select + phone input
  if (await page.locator('select[name*="country"], select[id*="country"]').count() > 0 &&
      await page.locator('input[type="tel"], input[name*="phone"]').count() > 0) {
    return 'country-dropdown'
  }
  
  // Recruitee pattern: phone country button
  if (await page.locator('button[id*="country-select"]').count() > 0) {
    return 'country-dropdown'
  }
  
  // Single text input (most common)
  if (await page.locator('input[type="tel"], input[name*="phone"]').count() > 0) {
    return 'single-text'
  }
  
  return 'unknown'
}

/**
 * Validate phone number format
 */
export function validatePhoneNumber(phone: string): { isValid: boolean; error?: string } {
  const parsed = parsePhoneNumber(phone)
  
  if (!parsed.isValid) {
    return { isValid: false, error: 'Invalid phone number format' }
  }
  
  if (parsed.nationalNumber && parsed.nationalNumber.length < 6) {
    return { isValid: false, error: 'Phone number too short' }
  }
  
  if (parsed.nationalNumber && parsed.nationalNumber.length > 15) {
    return { isValid: false, error: 'Phone number too long' }
  }
  
  return { isValid: true }
}
