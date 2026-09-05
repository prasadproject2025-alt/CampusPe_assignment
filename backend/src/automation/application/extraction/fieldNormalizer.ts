import { classifyQuestion, normalizeQuestion } from '../../../resolver/normalizer.js'

export const OPTION_ONLY_LABEL = /^(yes|no|true|false|n\/a|na|none|other|i agree|agree|disagree|prefer not to say|male|female|non-binary|he\/him(?:\/his)?|she\/her(?:\/hers)?|they\/them(?:\/theirs)?|asian|white|black|hispanic|latino|decline to self-identify)$/i

export function isOptionOnlyLabel(text: string) {
  const value = text.replace(/\s+/g, ' ').replace(/\*$/, '').trim()
  return !value || OPTION_ONLY_LABEL.test(value)
}

export function slugKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 80)
}

export function semanticFieldKey(label: string, fallback = '') {
  const classified = classifyQuestion(normalizeQuestion(label))
  if (classified) return classified
  const slug = slugKey(label)
  if (slug && !/^input_ca_\d+/i.test(slug) && !/^input_/.test(slug)) return slug
  return fallback || slug || 'unknown_field'
}

export function isBloatedControlLabel(text: string) {
  const value = text.replace(/\s+/g, ' ').trim()
  if (value.length > 80) return true
  return /united states.*united kingdom|afghanistan.*albania|\+\d{1,3}.*\+\d{1,3}.*\+\d{1,3}/i.test(value)
}

export function pickQuestionLabel(candidates: Array<string | undefined>, optionTexts: string[] = []) {
  const options = optionTexts.map((option) => option.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const candidate of candidates) {
    const text = (candidate || '').replace(/\s+/g, ' ').replace(/^\*+/, '').replace(/\*+$/, '').trim()
    if (!text || isOptionOnlyLabel(text) || isBloatedControlLabel(text)) continue
    if (options.includes(text) && text.length < 24) continue
    if (options.length && options.every((option) => text === option)) continue
    return text
  }
  return ''
}

export type ControlMeta = {
  name?: string
  id?: string
  type?: string
  wrappingLabel?: string
  ariaLabel?: string
  labelledByText?: string
  legend?: string
  groupHeading?: string
  dataUi?: string
  placeholder?: string
  optionTexts?: string[]
}

export function questionLabelFromMeta(meta: ControlMeta) {
  const dataUi = (meta.dataUi || '').replace(/[_-]+/g, ' ').trim()
  const fromDataUi = dataUi && !/^input /i.test(dataUi) && !isOptionOnlyLabel(dataUi) ? dataUi.replace(/\b\w/g, (char) => char.toUpperCase()) : ''
  return pickQuestionLabel([
    meta.groupHeading,
    meta.legend,
    meta.labelledByText,
    fromDataUi,
    meta.ariaLabel,
    meta.placeholder,
    meta.wrappingLabel,
  ], meta.optionTexts)
}

export function isGeneratedWorkableName(name: string) {
  return /^input_CA_\d+_input$/i.test(name) || /^input_[A-Z0-9]+_input$/i.test(name)
}
