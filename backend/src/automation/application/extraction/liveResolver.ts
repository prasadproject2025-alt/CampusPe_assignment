import type { Locator, Page } from 'playwright-core'
import type { AnswerValue } from '../../../resolver/types.js'
import type { AdapterQuestion } from '../../types.js'
import { AmbiguousFieldError, AnswerRequiresUserError, FieldResolutionError } from '../fieldResolution.js'
import { isGeneratedWorkableName } from './fieldNormalizer.js'

const RESOLVE_MS = 2_500
const VISIBLE_MS = 400

function escapeRegex(value: string) {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
}

function escapeAttribute(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function questionName(question: AdapterQuestion) {
  return question.text.split('\n')[0]!.replace(/\*$/, '').trim()
}

function isChoice(question: AdapterQuestion) {
  return ['radio', 'boolean', 'checkbox', 'checkbox-group', 'radio-group'].includes(question.inputType || '')
}

function isLocationQuestion(label: string) {
  return /^(current )?location(\s*\(city\))?$/i.test(label.trim()) || /^where are you (currently )?(based|located)/i.test(label.trim())
}

async function resolveLocationControl(scope: Locator, key: string, label: string) {
  const selectors = [
    'select[name="location"]',
    'input[name="location"]:not([type="hidden"])',
    'select[id="location"]',
    'input[id="location"]:not([type="hidden"])',
    'select[name="job_application[location]"]',
    'input[name="job_application[location]"]:not([type="hidden"])',
    '#job_application_location',
    '[data-field-path="location"]',
    '[name="job_application[location_city]"]',
  ]
  for (const selector of selectors) {
    const found = await uniqueVisible(scope.locator(selector), key, label)
    if (found) return found
  }
  const names = [label, 'Location', 'Location (City)', 'Current location']
  const seen = new Set<string>()
  for (const name of names) {
    const normalized = name.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    const combo = await uniqueVisible(scope.getByRole('combobox', { name, exact: true }), key, label)
    if (combo) return combo
    const textbox = await uniqueVisible(scope.getByRole('textbox', { name, exact: true }), key, label)
    if (textbox) return textbox
    const labeled = await uniqueVisible(scope.getByLabel(name, { exact: true }), key, label)
    if (labeled) return labeled
  }
  return null
}

async function isNativeControl(locator: Locator) {
  const tag = String(await locator.evaluate(`(node) => node && node.tagName ? String(node.tagName).toLowerCase() : ''`).catch(() => '') || '')
  const role = String(await locator.getAttribute('role').catch(() => '') || '').toLowerCase()
  const type = String(await locator.getAttribute('type').catch(() => '') || '').toLowerCase()
  if (['input', 'textarea', 'select'].includes(tag)) return true
  if (['radio', 'checkbox', 'combobox', 'listbox', 'textbox', 'switch'].includes(role)) return true
  return Boolean(type) && !['hidden', 'submit', 'button', 'image', 'reset'].includes(type)
}

async function classifyVisible(locator: Locator) {
  const total = await locator.count().catch(() => 0)
  const visible: Locator[] = []
  const native: Locator[] = []
  for (let index = 0; index < total; index += 1) {
    const candidate = locator.nth(index)
    if (!await candidate.isVisible({ timeout: VISIBLE_MS }).catch(() => false)) continue
    visible.push(candidate)
    if (await isNativeControl(candidate)) native.push(candidate)
  }
  return { total, visible, native }
}

async function uniqueVisible(locator: Locator, key: string, label: string): Promise<Locator | null> {
  const { visible, native } = await classifyVisible(locator)
  const tagged: Locator[] = []
  for (const candidate of native) {
    const tag = String(await candidate.evaluate(`(node) => node && node.tagName ? String(node.tagName).toLowerCase() : ''`).catch(() => '') || '')
    if (['input', 'textarea', 'select'].includes(tag)) tagged.push(candidate)
  }
  if (tagged.length === 1) return tagged[0]!
  if (tagged.length > 1) throw new AmbiguousFieldError(key, label)
  if (native.length === 1) return native[0]!
  if (native.length > 1) throw new AmbiguousFieldError(key, label)
  if (visible.length === 1) {
    const inner = visible[0]!.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select')
    const nested = await classifyVisible(inner)
    if (nested.native.length === 1) return nested.native[0]!
    if (nested.native.length > 1) throw new AmbiguousFieldError(key, label)
    return visible[0]!
  }
  if (visible.length > 1) throw new AmbiguousFieldError(key, label)
  return null
}

function locatorName(question: AdapterQuestion) {
  const value = question.locator.value
  if (value.startsWith('name:')) return value.slice(5)
  if (value.startsWith('id:')) return ''
  if (!value.startsWith('label:') && !value.startsWith('ats:') && !isGeneratedWorkableName(value)) return value
  return ''
}

async function groupFromNamedInputs(page: Page, question: AdapterQuestion) {
  const name = locatorName(question)
  if (!name || isGeneratedWorkableName(name)) return null
  const type = question.inputType === 'checkbox' || question.inputType === 'checkbox-group' ? 'checkbox' : 'radio'
  const inputs = page.locator(`input[type="${type}"][name="${escapeAttribute(name)}"]`)
  const count = await inputs.count().catch(() => 0)
  if (!count) return null
  const grouped = inputs.nth(0).locator('xpath=ancestor::*[contains(@class,"application-question") or contains(@class,"ashby-application-form-field-entry") or @role="radiogroup" or @role="group" or self::fieldset][1]')
  if (await grouped.count()) return grouped
  return inputs.nth(0).locator('xpath=ancestor::*[.//input[@type="radio" or @type="checkbox"]][1]')
}

async function questionGroupByHeading(page: Page, label: string, key: string) {
  const containers = page.locator('.application-question, .ashby-application-form-field-entry, [role="radiogroup"], [role="group"], fieldset')
  const total = await containers.count().catch(() => 0)
  const matches: Locator[] = []
  for (let index = 0; index < total; index += 1) {
    const container = containers.nth(index)
    const heading = container.locator('.application-label .text, .application-label, label.ashby-application-form-question-title, .ashby-application-form-question-title, legend').first()
    const labelledBy = await container.getAttribute('aria-labelledby').catch(() => '')
    const labelledText = labelledBy
      ? (await Promise.all(labelledBy.split(/\s+/).filter(Boolean).map(async (id) => (
        (await page.locator(`[id="${escapeAttribute(id)}"]`).innerText().catch(() => '')).split('\n')[0]!.replace(/[✱*]+$/g, '').trim()
      )))).filter((text) => text && !/^(yes|no|he\/him|she\/her|they\/them|male|female)$/i.test(text)).join(' ')
      : ''
    const text = (labelledText || (await heading.innerText().catch(() => ''))).split('\n')[0]!.replace(/[✱*]+$/g, '').replace(/\*$/, '').trim()
    if (text.toLowerCase() === label.toLowerCase()) matches.push(container)
  }
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) throw new AmbiguousFieldError(key, label)
  return null
}

async function controlInQuestionGroup(group: Locator, question: AdapterQuestion, key: string, label: string) {
  if (isChoice(question)) return group
  if (question.inputType === 'file' || /resume|cv|cover letter/i.test(label)) {
    return uniqueVisible(group.locator('input[type="file"]'), key, label)
  }
  const inner = group.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]):not([type="search"]), textarea, select')
  return uniqueVisible(inner, key, label)
}

export async function resolveLiveField(page: Page, question: AdapterQuestion): Promise<Locator> {
  const label = questionName(question)
  const key = question.id
  const form = page.locator('form')
  const formCount = await form.count()
  const scope = formCount === 1 ? form : page.locator('body')

  if (question.inputType === 'file' || /resume|cv|cover letter/i.test(label)) {
    const files = scope.locator('input[type="file"]')
    const cover = /cover/i.test(label)
    const matches: Locator[] = []
    for (let index = 0; index < await files.count(); index += 1) {
      const file = files.nth(index)
      const meta = `${await file.getAttribute('name') || ''} ${await file.getAttribute('id') || ''} ${await file.getAttribute('data-ui') || ''}`
      if (cover && /cover/i.test(meta)) matches.push(file)
      if (!cover && /resume|cv/i.test(meta)) matches.push(file)
    }
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) throw new AmbiguousFieldError(key, label)
  }

  const raw = question.locator.value.replace(/^(ats|name|id):/, '')
  if (!question.locator.value.startsWith('label:') && raw && !isGeneratedWorkableName(raw)) {
    if (isChoice(question)) {
      const namedGroup = await groupFromNamedInputs(page, question)
      if (namedGroup && await namedGroup.count()) return namedGroup
    } else {
      const ats = page.locator(`input[data-field-path="${escapeAttribute(raw)}"], textarea[data-field-path="${escapeAttribute(raw)}"], select[data-field-path="${escapeAttribute(raw)}"], input[name="${escapeAttribute(raw)}"], textarea[name="${escapeAttribute(raw)}"], select[name="${escapeAttribute(raw)}"], input[id="${escapeAttribute(raw)}"], textarea[id="${escapeAttribute(raw)}"], select[id="${escapeAttribute(raw)}"]`)
      const found = await uniqueVisible(ats, key, label)
      if (found) return found
    }
  }

  if (isLocationQuestion(label) || /(?:^|:)location$/i.test(question.locator.value)) {
    const location = await resolveLocationControl(scope, key, label)
    if (location) return location
  }

  if (isChoice(question)) {
    const namedGroup = await groupFromNamedInputs(page, question)
    if (namedGroup && await namedGroup.count()) return namedGroup
    const byHeading = await questionGroupByHeading(page, label, key)
    if (byHeading) return byHeading
    const radiogroup = await uniqueVisible(scope.getByRole('radiogroup', { name: label, exact: true }), key, label)
    if (radiogroup) return radiogroup
    const group = await uniqueVisible(scope.getByRole('group', { name: label, exact: true }), key, label)
    if (group) return group
    throw new FieldResolutionError(key, label)
  }

  const exactLabel = await uniqueVisible(scope.getByLabel(label, { exact: true }), key, label)
  if (exactLabel) return exactLabel
  const aria = await uniqueVisible(scope.locator(`[aria-label="${escapeAttribute(label)}"]`), key, label)
  if (aria) return aria
  const accessible = question.inputType === 'textarea' ? 'textbox' : question.inputType === 'select' || question.inputType === 'country-code' ? 'combobox' : 'textbox'
  const named = await uniqueVisible(scope.getByRole(accessible as 'textbox' | 'combobox', { name: label, exact: true }), key, label)
  if (named) return named
  const byHeading = await questionGroupByHeading(page, label, key)
  if (byHeading) {
    const inner = await controlInQuestionGroup(byHeading, question, key, label)
    if (inner) return inner
  }
  throw new FieldResolutionError(key, label)
}

export async function resolveLiveControl(page: Page, question: AdapterQuestion) {
  return resolveLiveField(page, question)
}

async function selectOptionInGroup(group: Locator, page: Page, desired: string, role: 'radio' | 'checkbox', key: string, label: string) {
  const exactRole = group.getByRole(role, { name: desired, exact: true })
  const found = await uniqueVisible(exactRole, key, `${label} / ${desired}`)
  if (found) return found
  const wrapped = group.locator('label').filter({ hasText: new RegExp(`^\\s*${escapeRegex(desired)}\\s*$`, 'i') }).locator(`input[type="${role}"]`)
  const wrappedMatch = await uniqueVisible(wrapped, key, `${label} / ${desired}`)
  if (wrappedMatch) return wrappedMatch
  const option = group.getByRole('option', { name: desired, exact: true })
  const listed = await uniqueVisible(option, key, `${label} / ${desired}`)
  if (listed) return listed
  const button = group.getByRole('button', { name: desired, exact: true })
  const clicked = await uniqueVisible(button, key, `${label} / ${desired}`)
  if (clicked) return clicked
  const yesNo = /^(yes|no)$/i.test(desired.trim()) ? (desired.trim().toLowerCase().startsWith('y') ? 'yes' : 'no') : ''
  if (yesNo) {
    const dataOption = group.locator(`button[data-option="${yesNo}"]`)
    const matched = await uniqueVisible(dataOption, key, `${label} / ${desired}`)
    if (matched) return matched
  }
  throw new FieldResolutionError(key, `${label} option ${desired}`)
}

export async function fillLiveAnswer(page: Page, question: AdapterQuestion, answer: AnswerValue) {
  const desired = String(answer)
  const label = questionName(question)
  const key = question.id

  if (question.inputType === 'radio' || question.inputType === 'boolean' || question.inputType === 'radio-group') {
    const group = await resolveLiveField(page, question)
    const option = await selectOptionInGroup(group, page, desired, 'radio', key, label)
    if (await option.isChecked().catch(() => false)) return
    await option.check({ timeout: RESOLVE_MS }).catch(async () => option.click({ timeout: RESOLVE_MS }))
    if (await option.getAttribute('data-option').catch(() => '')) return
    if (!await option.isChecked().catch(() => false)) throw new FieldResolutionError(key, label)
    return
  }

  if (question.inputType === 'checkbox' || question.inputType === 'checkbox-group') {
    const group = await resolveLiveField(page, question)
    const parts = desired.split(/[|;]/).map((part) => part.trim()).filter(Boolean)
    for (const part of parts.length ? parts : [desired]) {
      const box = await selectOptionInGroup(group, page, part, 'checkbox', key, label)
      await box.setChecked(true, { timeout: RESOLVE_MS })
      if (!await box.isChecked().catch(() => false)) throw new FieldResolutionError(key, `${label} / ${part}`)
    }
    return
  }

  const control = await resolveLiveField(page, question)
  const tag = String(await control.evaluate(`(node) => node && node.tagName ? String(node.tagName).toLowerCase() : ''`).catch(() => '') || '')
  const role = await control.getAttribute('role').catch(() => '')
  if (tag === 'select' || question.inputType === 'select') {
    const native = await control.selectOption({ label: desired }).then(() => true).catch(() => false)
    if (native) return
    const byValue = await control.selectOption(desired).then(() => true).catch(() => false)
    if (byValue) return
    const labels = (await control.locator('option:not([disabled])').allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const desiredNorm = desired.replace(/\s+/g, ' ').trim().toLowerCase()
    const matches = labels.filter((option) => {
      const optionNorm = option.toLowerCase()
      return optionNorm === desiredNorm || optionNorm.includes(desiredNorm) || desiredNorm.includes(optionNorm)
    })
    if (matches.length === 1) {
      const picked = await control.selectOption({ label: matches[0] }).then(() => true).catch(() => false)
      if (picked) return
    }
    if (isLocationQuestion(label)) {
      throw new AnswerRequiresUserError(label, `ANSWER_REQUIRES_USER: “${label}” could not be matched to a unique live option. Complete it in assisted mode.`)
    }
  }
  if (role === 'combobox' || tag === 'button' || question.inputType === 'select' || question.inputType === 'country-code') {
    await control.click({ timeout: RESOLVE_MS })
    const option = page.getByRole('option', { name: desired, exact: true })
    let picked: Locator | null = null
    try {
      picked = await uniqueVisible(option, key, desired)
    } catch (error) {
      if (error instanceof AmbiguousFieldError && isLocationQuestion(label)) {
        throw new AnswerRequiresUserError(label, `ANSWER_REQUIRES_USER: “${label}” could not be matched to a unique live option. Complete it in assisted mode.`)
      }
      throw error
    }
    if (picked) {
      await picked.click({ timeout: RESOLVE_MS })
      return
    }
    if (isLocationQuestion(label)) {
      throw new AnswerRequiresUserError(label, `ANSWER_REQUIRES_USER: “${label}” could not be matched to a unique live option. Complete it in assisted mode.`)
    }
    throw new FieldResolutionError(key, label)
  }
  await control.click({ timeout: RESOLVE_MS })
  await control.fill('')
  await control.pressSequentially(desired, { delay: 40, timeout: 8_000 })
}

export async function fieldIsUnique(locator: Locator) {
  const result = await classifyVisible(locator)
  return result.visible.length === 1 || result.native.length === 1
}
