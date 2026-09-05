import { isOptionOnlyLabel } from './fieldNormalizer.js'
import type { ExtractedControl } from './types.js'

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function mergeOptions(existing: string[], incoming: string[]) {
  const seen = new Set(existing.map(normalize))
  const merged = [...existing]
  for (const option of incoming) {
    const key = normalize(option)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(option)
  }
  return merged
}

export function dedupeExtractedFields(controls: ExtractedControl[]): ExtractedControl[] {
  const visible = controls.filter((control) => control.visible !== false && !isOptionOnlyLabel(control.question))
  const byFingerprint = new Map<string, ExtractedControl>()
  for (const control of visible) {
    const optionSig = [...control.options].map(normalize).sort().join('|')
    const groupedChoice = control.kind === 'radio' || control.kind === 'checkbox'
    const fingerprint = groupedChoice
      ? [normalize(control.question), control.kind, normalize(control.section || '')].join('::')
      : [normalize(control.question), control.kind, optionSig].join('::')
    const existing = byFingerprint.get(fingerprint)
    if (!existing) {
      byFingerprint.set(fingerprint, control)
      continue
    }
    if (groupedChoice) {
      byFingerprint.set(fingerprint, {
        ...existing,
        options: mergeOptions(existing.options, control.options),
        required: existing.required || control.required,
        answered: existing.answered || control.answered,
      })
      continue
    }
    const prefer = (control.options.length > existing.options.length)
      || (control.kind === 'file' && existing.kind !== 'file')
      || (Boolean(control.id) && !existing.id)
    if (prefer) byFingerprint.set(fingerprint, control)
  }
  const collapsed = [...byFingerprint.values()]
  const hasTelPhone = collapsed.some((control) => control.kind === 'phone' && /phone/i.test(control.question) && !/country/i.test(control.question))
  const fileKinds = new Set(collapsed.filter((control) => control.kind === 'file').map((control) => /cover/i.test(control.question) ? 'cover_letter' : 'resume'))
  const filesKept = new Set<string>()
  return collapsed.filter((control) => {
    if (control.kind === 'file') {
      const key = /cover/i.test(control.question) ? 'cover_letter' : 'resume'
      if (filesKept.has(key)) return false
      filesKept.add(key)
      return true
    }
    if (/resume|cv/i.test(control.question) && fileKinds.has('resume')) return false
    if (/cover[\s_-]*letter/i.test(control.question) && fileKinds.has('cover_letter')) return false
    if (hasTelPhone && control.kind === 'text' && /phone/i.test(control.question) && !/country/i.test(control.question)) return false
    return true
  })
}
