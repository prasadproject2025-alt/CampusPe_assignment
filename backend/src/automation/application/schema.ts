import type { ApplicationField, ApplicationModel, ApplicationSection } from './types.js'

export type SchemaSource = 'public_api' | 'headless_extract' | 'none'

export function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function logApplicationSchema(info: {
  ats: string
  source: string
  sections: number
  fields: number
  required: number
  complete: boolean
}) {
  console.info(
    `[ApplicationSchema]\nATS: ${info.ats}\nSections: ${info.sections}\nFields: ${info.fields}\nRequired: ${info.required}`,
  )
  console.info(
    `[ApplicationSchema] ATS detected: ${info.ats} Application schema source: ${info.source} Sections discovered: ${info.sections} Fields discovered: ${info.fields} Required fields: ${info.required} Complete: ${info.complete}`,
  )
}

export function schemaStats(fields: ApplicationField[], sections: ApplicationSection[] = []) {
  const visible = fields.filter((field) => !field.isHidden)
  return {
    sections: sections.length || new Set(fields.map((field) => field.section).filter(Boolean)).size,
    fields: fields.length,
    required: visible.filter((field) => field.required).length,
  }
}

export function withSchemaMeta(application: ApplicationModel, extras: Partial<ApplicationModel>): ApplicationModel {
  const fields = extras.fields || application.fields
  const sections = extras.sections || application.sections || []
  const stats = schemaStats(fields, sections)
  return {
    ...application,
    ...extras,
    fields,
    sections,
    schemaFieldCount: extras.schemaFieldCount ?? stats.fields,
    schemaComplete: extras.schemaComplete ?? application.schemaComplete ?? true,
  }
}

export function fieldIsMultiSelect(field: ApplicationField) {
  return field.isMany === true || field.inputType === 'checkbox-group' || field.inputType === 'multi_select'
}

export function splitMultiSelectValue(value: string) {
  return value.split(/[|;]/).map((part) => part.trim()).filter(Boolean)
}

export function joinMultiSelectValue(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].join('|')
}

export function fieldIsVisible(field: ApplicationField, answers: Record<string, string>) {
  if (field.dependsOn?.fieldId) {
    const current = answers[field.dependsOn.fieldId] || ''
    const parts = splitMultiSelectValue(current)
    return field.dependsOn.values.some((value) => parts.includes(value) || current === value)
  }
  return !field.isHidden
}
