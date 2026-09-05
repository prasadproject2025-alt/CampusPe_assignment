import type { ApplicationField } from './types.js'
import { schemaFingerprint, slug } from './canonicalIdentity.js'
import { matchCanonicalField } from './matchCanonical.js'

function labelsAlign(left: string, right: string) {
  const a = slug(left)
  const b = slug(right)
  if (!a || !b) return false
  if (a === b) return true
  return a.startsWith(`${b}_`) || b.startsWith(`${a}_`)
}

function priorFor(existing: ApplicationField[], incoming: ApplicationField) {
  const byId = existing.find((field) => field.id === incoming.id)
  if (byId) return byId
  const match = matchCanonicalField(incoming, existing)
  if (match.status === 'MATCHED') return match.field
  const aligned = existing.filter((field) => labelsAlign(field.text, incoming.text))
  return aligned.length === 1 ? aligned[0] : undefined
}

export function reconcileCanonicalFields(existing: ApplicationField[], incoming: ApplicationField[]): ApplicationField[] {
  return incoming.map((field) => {
    const prior = priorFor(existing, field)
    if (!prior) return field
    const userEdited = prior.status === 'manual' || Boolean(prior.value.trim())
    return {
      ...field,
      value: userEdited ? prior.value : (prior.value || field.value),
      suggestion: prior.suggestion || field.suggestion,
      source: prior.source || field.source,
      confidence: prior.confidence ?? field.confidence,
      status: prior.status === 'empty' ? field.status : prior.status,
      reason: prior.reason || field.reason,
    }
  })
}

export function fingerprintsEqual(left: ApplicationField[], right: ApplicationField[]) {
  return schemaFingerprint(left.map((field) => field.id)) === schemaFingerprint(right.map((field) => field.id))
}
