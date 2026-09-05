import type { AdapterQuestion } from '../types.js'
import { semanticFieldKey } from './extraction/fieldNormalizer.js'
import type { ApplicationField } from './types.js'
import { canonicalFieldId, controlKind, optionSignature, slug } from './canonicalIdentity.js'

export type CanonicalMatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'NOT_FOUND'

export type CanonicalMatch = {
  status: CanonicalMatchStatus
  field?: ApplicationField
  confidence: number
}

function liveAsField(question: AdapterQuestion): ApplicationField {
  const kind = controlKind(question.inputType, question.fieldType)
  const atsId = question.locator.value.replace(/^(name|id|label|ats):/, '')
  return {
    id: canonicalFieldId({
      question: question.text,
      kind,
      atsId,
      options: question.options,
    }),
    path: question.id,
    text: question.text,
    fieldType: question.fieldType,
    inputType: question.inputType,
    required: question.required,
    options: question.options,
    locator: question.locator,
    value: '',
    status: 'empty',
  }
}

function locationLike(text: string) {
  const key = semanticFieldKey(text)
  const slugText = slug(text)
  return key === 'location' || key === 'current_city' || slugText === 'location' || slugText === 'location_city' || slugText === 'current_location'
}

function kindsCompatible(left: string, right: string, leftText: string, rightText: string) {
  if (left === right) return true
  const choice = new Set(['radio', 'select', 'checkbox', 'boolean'])
  if (choice.has(left) && choice.has(right)) return true
  if ((left === 'text' && right === 'phone') || (left === 'phone' && right === 'text')) return true
  if (locationLike(leftText) && locationLike(rightText)) {
    return ['text', 'select', 'phone'].includes(left) && ['text', 'select', 'phone'].includes(right)
  }
  return false
}

function labelsAlign(left: string, right: string) {
  const a = slug(left)
  const b = slug(right)
  if (!a || !b) return false
  if (a === b) return true
  return a.startsWith(`${b}_`) || b.startsWith(`${a}_`)
}

function stableControlKey(field: ApplicationField) {
  const locator = field.locator?.value || ''
  if (!locator || locator.startsWith('label:')) return ''
  const raw = locator.replace(/^(name|id|ats):/, '')
  if (!raw || /input_ca_/i.test(raw)) return ''
  return raw
}

function score(source: ApplicationField, live: ApplicationField) {
  const sourceKind = controlKind(source.inputType, source.fieldType)
  const liveKind = controlKind(live.inputType, live.fieldType)
  if (source.id === live.id) return 1
  const sourceControl = stableControlKey(source)
  const liveControl = stableControlKey(live)
  if (sourceControl && liveControl && sourceControl === liveControl) return 0.95
  const sourceName = source.path || ''
  const liveName = live.path || ''
  if (sourceName && liveName && sourceName === liveName && !/input_ca_/i.test(sourceName) && sourceName !== 'unknown_field') return 0.93
  if (!kindsCompatible(sourceKind, liveKind, source.text, live.text)) return 0
  const sourceKey = semanticFieldKey(source.text, source.path || '')
  const liveKey = semanticFieldKey(live.text, live.path || '')
  const sameSemantic = Boolean(sourceKey && liveKey && sourceKey === liveKey && sourceKey !== 'unknown_field')
  const sameQuestion = slug(source.text) === slug(live.text)
  const optionOverlap = optionSignature(source.options) && optionSignature(source.options) === optionSignature(live.options)
  if (sameSemantic && optionOverlap) return 0.9
  if (sameQuestion && optionOverlap) return 0.9
  if (sameSemantic && slug(source.section || '') === slug(live.section || '')) return 0.86
  if (sameQuestion && slug(source.section || '') === slug(live.section || '')) return 0.85
  if (sameSemantic) return 0.82
  if (labelsAlign(source.text, live.text)) return 0.8
  if (sameQuestion) return 0.75
  return 0
}

export function matchCanonicalField(sourceField: AdapterQuestion | ApplicationField, liveFields: ApplicationField[]): CanonicalMatch {
  const source: ApplicationField = 'locator' in sourceField && 'answered' in sourceField
    ? liveAsField(sourceField as AdapterQuestion)
    : sourceField as ApplicationField
  const ranked = liveFields.map((field) => ({ field, confidence: score(source, field) })).filter((item) => item.confidence >= 0.7).sort((a, b) => b.confidence - a.confidence)
  if (!ranked.length) return { status: 'NOT_FOUND', confidence: 0 }
  const best = ranked[0]!
  const ties = ranked.filter((item) => item.confidence >= 0.75 && item.field.id !== best.field.id && Math.abs(item.confidence - best.confidence) < 0.05)
  if (ties.length) return { status: 'AMBIGUOUS', confidence: best.confidence }
  if (best.confidence < 0.75 && ranked.length > 1) return { status: 'AMBIGUOUS', confidence: best.confidence }
  return { status: 'MATCHED', field: best.field, confidence: best.confidence }
}

export function matchQuestionToField(question: AdapterQuestion, fields: ApplicationField[]) {
  const match = matchCanonicalField(question, fields)
  return match.status === 'MATCHED' ? match.field : undefined
}
