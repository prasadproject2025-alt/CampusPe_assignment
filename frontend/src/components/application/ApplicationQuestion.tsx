import { Check, Sparkles, X } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ApplicationField } from './types'
import { SensitiveField } from './SensitiveField'

function sourceLabel(source?: string) {
  if (source === 'L1_PROFILE') return 'Profile'
  if (source === 'L2_MEMORY') return 'Resume'
  if (source === 'L3_LLM') return 'AI generated'
  if (source === 'derived') return 'Derived'
  return source || ''
}

export function ApplicationQuestion({
  field,
  highlighted,
  locked,
  analyzing,
  control,
  onAccept,
  onKeep,
  onReject,
}: {
  field: ApplicationField
  highlighted: boolean
  locked: boolean
  analyzing: boolean
  control: ReactNode
  onAccept: () => void
  onKeep: () => void
  onReject: () => void
}) {
  const userRequired = field.status === 'unresolved'
  const llm = field.source === 'L3_LLM'
  return (
    <div role="group" aria-label={field.text} className={`application-field ${highlighted ? 'needs-input' : ''} ${field.status}`}>
      <span>
        <b>{field.text}{field.required ? ' *' : ''}</b>
        {field.description && <small>{field.description}</small>}
        {analyzing && <small>Analyzing…</small>}
        {!analyzing && field.reason && <small>{field.reason}</small>}
        {userRequired && <SensitiveField />}
        {llm && field.status === 'suggested' && <small className="ai-review-note">AI generated — review recommended</small>}
        {field.source && field.status !== 'unresolved' && (
          <small className="field-source">
            Source: {sourceLabel(field.source)}
            {typeof field.confidence === 'number' ? ` · ${Math.round(field.confidence * 100)}%` : ''}
          </small>
        )}
      </span>
      {control}
      {field.suggestion && field.status === 'suggested' && !locked && (
        <div className="field-suggestion">
          <Sparkles />
          <p>{llm ? 'AI suggested' : `Suggested from ${sourceLabel(field.source) || 'your profile'}`}</p>
          <button type="button" onClick={onAccept}><Check /> Accept</button>
          <button type="button" onClick={onKeep}>Keep edit</button>
          <button type="button" onClick={onReject}><X /> Reject</button>
        </div>
      )}
    </div>
  )
}
