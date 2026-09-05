import { isGeneratedWorkableName } from './extraction/fieldNormalizer.js'

export type CanonicalParts = {
  provider?: string
  section?: string
  question: string
  kind: string
  atsId?: string
  options?: string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '_')
}

export function optionSignature(options?: string[]) {
  return [...(options || [])].map(slug).filter(Boolean).sort().join('|')
}

export function controlKind(inputType?: string, fieldType?: string) {
  const value = (inputType || fieldType || 'text').toLowerCase()
  if (value === 'file') return 'file'
  if (value === 'radio' || value === 'radio-group' || value === 'boolean') return 'radio'
  if (value === 'checkbox' || value === 'checkbox-group') return 'checkbox'
  if (value === 'select' || value === 'country-code') return 'select'
  if (value === 'textarea') return 'textarea'
  if (value === 'tel' || value === 'phone') return 'phone'
  if (value === 'education') return 'education'
  if (value === 'email') return 'email'
  if (value === 'url') return 'url'
  if (value === 'date') return 'date'
  if (value === 'number') return 'number'
  return 'text'
}

export function fileRole(question: string): 'resume' | 'cover_letter' | 'other_attachment' | null {
  if (/cover[\s_-]*letter/i.test(question)) return 'cover_letter'
  if (/\bresume\b|\bcv\b/i.test(question)) return 'resume'
  if (/attach|upload|file/i.test(question)) return 'other_attachment'
  return null
}

export function isStableAtsId(value?: string) {
  const id = (value || '').trim()
  if (!id || isGeneratedWorkableName(id)) return false
  if (/^(label|name|id|css):/i.test(id)) return false
  if (id.startsWith('_systemfield_') || UUID.test(id)) return true
  return /^[A-Za-z][A-Za-z0-9]*([_.-][A-Za-z0-9]+)+$/.test(id)
}

export function canonicalFieldId(parts: CanonicalParts) {
  const kind = controlKind(parts.kind)
  const question = slug(parts.question.split('\n')[0] || '')
  if (kind === 'file') {
    const role = fileRole(parts.question)
    if (role === 'resume') return 'file:resume'
    if (role === 'cover_letter') return 'file:cover_letter'
    return `file:other:${question || 'attachment'}`
  }
  const provider = slug(parts.provider || 'ats') || 'ats'
  const section = slug(parts.section || 'application') || 'application'
  const atsId = isStableAtsId(parts.atsId) ? parts.atsId!.trim() : ''
  if (atsId) return `${provider}:${atsId}:${kind}`
  const options = optionSignature(parts.options)
  return [provider, section, kind, question, options].filter(Boolean).join(':')
}

export function schemaFingerprint(ids: string[]) {
  return [...ids].sort().join('\n')
}
