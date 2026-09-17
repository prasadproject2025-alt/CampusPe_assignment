import { PhoneCountryField } from '../../ProfilePage'
import { Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ApplicationQuestion } from './ApplicationQuestion'
import type { ApplicationField, AutomationRun } from './types'

const MULTI_SELECT_TYPES = new Set(['checkbox-group', 'multi_select', 'checkbox'])

function splitValues(value: string) {
  return value.split(/[|;]/).map((part) => part.trim()).filter(Boolean)
}

function fieldVisible(field: ApplicationField, answers: Record<string, string>) {
  if (field.dependsOn?.fieldId) {
    const current = answers[field.dependsOn.fieldId] || ''
    const parts = splitValues(current)
    return field.dependsOn.values.some((value) => parts.includes(value) || current === value)
  }
  return !field.isHidden
}

function renderControl(
  field: ApplicationField,
  locked: boolean,
  onChange: (value: string) => void,
) {
  if (field.inputType === 'country-code' || /^phone country code$/i.test(field.text)) {
    return <PhoneCountryField value={field.value} onChange={onChange} disabled={locked} />
  }
  if (field.inputType === 'file') {
    return <input aria-label={field.text} value={field.value || 'No attachment selected'} disabled />
  }
  if ((MULTI_SELECT_TYPES.has(field.inputType || '') || field.isMany) && field.options?.length) {
    const selected = new Set(splitValues(field.value))
    return (
      <div className="option-list" role="group" aria-label={field.text}>
        {(field.options || []).map((option) => (
          <label key={option} className="option-chip">
            <input
              type="checkbox"
              checked={selected.has(option)}
              disabled={locked}
              onChange={(event) => {
                const next = new Set(selected)
                if (event.target.checked) next.add(option)
                else next.delete(option)
                onChange([...next].join('|'))
              }}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    )
  }
  if (field.fieldType === 'textarea') {
    return <textarea aria-label={field.text} rows={4} value={field.value} disabled={locked} onChange={(event) => onChange(event.target.value)} />
  }
  if (field.fieldType === 'boolean' || ((field.fieldType === 'select' || field.inputType === 'radio-group' || field.inputType === 'radio') && field.options?.length)) {
    return (
      <select aria-label={field.text} value={field.value} disabled={locked} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select…</option>
        {(field.options?.length ? field.options : ['Yes', 'No']).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    )
  }
  const htmlType = field.inputType === 'email' || field.inputType === 'tel' || field.inputType === 'url' || field.inputType === 'date' || field.fieldType === 'number'
    ? (field.fieldType === 'number' ? 'number' : field.inputType)
    : 'text'
  return <input aria-label={field.text} type={htmlType} value={field.value} placeholder={field.placeholder} disabled={locked} onChange={(event) => onChange(event.target.value)} />
}

export function CustomApplicationForm({
  run,
  disabled,
  onUpdateAnswers,
}: {
  run: AutomationRun
  disabled?: boolean
  onUpdateAnswers: (fields: Array<{ id: string; value: string }>) => void
}) {
  const incoming = run.application?.fields || []
  const [fields, setFields] = useState(incoming)
  const edits = useRef(new Map<string, string>())
  const pausedId = run.pause?.question?.id
  const schemaKey = incoming.map((field) => field.id).join('|')

  useEffect(() => {
    setFields((run.application?.fields || []).map(field => edits.current.has(field.id) ? { ...field, value: edits.current.get(field.id)!, status: edits.current.get(field.id)!.trim() ? 'manual' : 'empty' } : field))
  }, [run.id, run.status, run.updatedAt, schemaKey])

  const answers = useMemo(() => Object.fromEntries(fields.map((field) => [field.id, field.value])), [fields])
  const visible = fields.filter((field) => fieldVisible(field, answers))

  const updateField = (id: string, value: string, status?: ApplicationField['status']) => {
    edits.current.set(id, value)
    setFields((current) => current.map((field) => field.id === id ? { ...field, value, reason: value.trim() ? 'Edited in the JobCopilot form.' : field.reason, status: status || (value.trim() ? 'manual' : 'empty') } : field))
    onUpdateAnswers([{ id, value }])
  }

  if (run.application?.schemaComplete === false && !incoming.length) {
    return (
      <div className="live-browser-empty light">
        <Sparkles />
        <p>We couldn't retrieve the complete application form.</p>
      </div>
    )
  }

  if (!incoming.length) {
    return (
      <div className="live-browser-empty light">
        <Sparkles />
        <p>{run.application?.reason || 'Loading application…'}</p>
      </div>
    )
  }

  const sections: Array<{ title: string; items: ApplicationField[] }> = []
  for (const field of visible) {
    const title = field.section || 'Application'
    const last = sections[sections.length - 1]
    if (!last || last.title !== title) sections.push({ title, items: [field] })
    else last.items.push(field)
  }

  return (
    <form className="custom-application-form" onSubmit={(event) => event.preventDefault()}>
      {sections.map((section) => (
        <section key={section.title} className="application-section">
          <h3>{section.title}</h3>
          {section.items.map((field) => {
            const highlighted = field.id === pausedId || field.status === 'unresolved'
            const locked = disabled || field.inputType === 'file' || field.inputType === 'education'
            const analyzing = field.reason === 'Analyzing…' && field.status === 'empty'
            return (
              <ApplicationQuestion
                key={field.id}
                field={field}
                highlighted={highlighted}
                locked={Boolean(locked)}
                analyzing={analyzing}
                control={renderControl(field, Boolean(locked), (value) => updateField(field.id, value))}
                onAccept={() => updateField(field.id, field.suggestion || '', 'accepted')}
                onKeep={() => updateField(field.id, field.value, 'manual')}
                onReject={() => updateField(field.id, '', 'empty')}
              />
            )
          })}
        </section>
      ))}
    </form>
  )
}
