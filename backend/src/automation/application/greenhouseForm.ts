import type { FieldType } from '../../resolver/types.js'
import type { AdapterQuestion, JobDetails } from '../types.js'
import { greenhouseEmbedUrl } from './embedPolicy.js'
import { isOptionOnlyLabel } from './extraction/fieldNormalizer.js'
import { logApplicationSchema } from './schema.js'
import { canonicalFieldId, fileRole } from './canonicalIdentity.js'
import { classifyQuestion, normalizeQuestion } from '../../resolver/normalizer.js'
import type { ApplicationField } from './types.js'

export function parseGreenhouseJobUrl(jobUrl: string) {
  const url = new URL(jobUrl)
  const host = url.hostname.toLowerCase()
  if (host !== 'job-boards.greenhouse.io' && host !== 'boards.greenhouse.io') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const jobsIndex = parts.findIndex((part) => part === 'jobs')
  const board = parts[0]
  const jobId = jobsIndex >= 0 ? parts[jobsIndex + 1] : undefined
  if (!board || !/^[A-Za-z0-9_-]{1,80}$/.test(board) || !jobId || !/^\d{1,20}$/.test(jobId)) return null
  return { board, jobId }
}

export function greenhouseQuestionsApiUrl(board: string, jobId: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(board) || !/^\d{1,20}$/.test(jobId)) {
    throw new Error('Invalid Greenhouse board or job id.')
  }
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}?questions=true`
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function mapFieldType(type: string, options?: string[]): { fieldType: FieldType; inputType: string; isMany: boolean } {
  if (type === 'textarea') return { fieldType: 'textarea', inputType: 'textarea', isMany: false }
  if (type === 'input_file') return { fieldType: 'text', inputType: 'file', isMany: false }
  if (type === 'input_boolean' || (options?.length === 2 && options.every((option) => /^(yes|no)$/i.test(option)))) {
    return { fieldType: 'boolean', inputType: 'boolean', isMany: false }
  }
  const multi = /multi_value_multi_select|multi-select|multiselect|checkbox/i.test(type)
  if (type.includes('select') || type.includes('multi_value')) {
    return { fieldType: 'select', inputType: multi ? 'checkbox-group' : 'select', isMany: multi }
  }
  if (type === 'input_number' || type === 'number') return { fieldType: 'number', inputType: 'number', isMany: false }
  if (type === 'input_email') return { fieldType: 'text', inputType: 'email', isMany: false }
  if (type === 'input_phone' || type === 'phone') return { fieldType: 'text', inputType: 'tel', isMany: false }
  if (type === 'input_url') return { fieldType: 'text', inputType: 'url', isMany: false }
  if (type === 'input_date' || type === 'date') return { fieldType: 'text', inputType: 'date', isMany: false }
  return { fieldType: 'text', inputType: type || 'text', isMany: false }
}

function questionItems(value: unknown) {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  return asArray(record.questions)
}

function greenhouseQuestionGroups(payload: unknown) {
  const root = asRecord(payload)
  const named = [
    ['questions', 'Application'],
    ['location_questions', 'Location'],
    ['educations', 'Education'],
    ['education', 'Education'],
    ['compliance', 'Compliance'],
    ['data_compliance', 'Data compliance'],
    ['eeoc', 'EEOC'],
    ['demographic_questions', 'Demographic'],
    ['additional_questions', 'Additional'],
    ['keyed_questions', 'Additional'],
  ] as const
  const groups: Array<{ section: string; items: unknown[] }> = named.map(([key, section]) => ({ section, items: questionItems(root[key]) }))
  const used = new Set<string>(named.map(([key]) => key))
  for (const [key, value] of Object.entries(root)) {
    if (used.has(key) || !/question/i.test(key)) continue
    const items = questionItems(value)
    if (!items.length) continue
    groups.push({ section: key.replace(/[_-]+/g, ' '), items })
  }
  return groups
}

function walkGreenhouseFields(rawFields: unknown[], push: (field: Record<string, unknown>) => void) {
  for (const rawField of rawFields) {
    const field = asRecord(rawField)
    const nested = asArray(field.fields)
    if (nested.length) walkGreenhouseFields(nested, push)
    else push(field)
  }
}

export function mapGreenhouseQuestions(payload: unknown): ApplicationField[] {
  const fields: ApplicationField[] = []
  const seen = new Set<string>()
  for (const group of greenhouseQuestionGroups(payload)) {
    for (const rawQuestion of group.items) {
      const question = asRecord(rawQuestion)
      const label = asString(question.label) || asString(question.description)
      const description = asString(question.description) && asString(question.description) !== label ? asString(question.description) : ''
      const rawFields = asArray(question.fields)
      if (!rawFields.length && asString(question.name)) {
        rawFields.push({ name: question.name, type: asString(question.type) || 'input_text', values: question.values })
      }
      walkGreenhouseFields(rawFields, (field) => {
        const type = asString(field.type)
        const name = asString(field.name)
        if (!name || type === 'input_hidden' || seen.has(name)) return
        seen.add(name)
        const options = asArray(field.values).map((value) => {
          const record = asRecord(value)
          return asString(record.label) || asString(record.value) || asString(value)
        }).filter(Boolean)
        const mapped = mapFieldType(type, options)
        const phoneCountry = name === 'country' || /phone country/i.test(label)
        const text = phoneCountry ? 'Phone country code' : (label || name.replace(/[_-]+/g, ' '))
        if (isOptionOnlyLabel(text)) return
        const inputType = phoneCountry ? 'country-code' : mapped.inputType
        const normalizedQuestion = normalizeQuestion(text)
        const canonicalField = classifyQuestion(normalizedQuestion)
        fields.push({
          id: canonicalFieldId({
            provider: 'greenhouse',
            section: group.section,
            question: text,
            kind: inputType,
            atsId: phoneCountry ? 'phone_country_code' : name,
            options,
          }),
          path: phoneCountry ? 'phone_country_code' : name,
          text,
          description: description || undefined,
          fieldType: mapped.fieldType,
          inputType,
          required: Boolean(question.required) || name === 'resume',
          options: options.length ? options : undefined,
          section: group.section,
          isMany: mapped.isMany,
          locator: { kind: 'field', value: name },
          value: '',
          status: mapped.inputType === 'file' ? 'skipped' : 'empty',
          reason: mapped.inputType === 'file' ? 'The saved resume is attached when the application is submitted.' : undefined,
          raw: { name, type, required: Boolean(question.required), optionCount: options.length },
          canonicalId: canonicalField || undefined,
        })
      })
    }
  }
  const fileRoles = new Set(fields.filter((field) => field.inputType === 'file').map((field) => fileRole(field.text)))
  const files = new Set<string>()
  return fields.filter((field) => {
    if (field.inputType === 'file') {
      const role = fileRole(field.text)
      const key = role === 'resume' || role === 'cover_letter' ? role : field.id
      if (files.has(key)) return false
      files.add(key)
      return true
    }
    if (/resume|cv/i.test(field.text) && fileRoles.has('resume')) return false
    if (/cover[\s_-]*letter/i.test(field.text) && fileRoles.has('cover_letter')) return false
    return true
  })
}

export function greenhouseJobFromPayload(jobUrl: string, board: string, jobId: string, payload: unknown): JobDetails {
  const root = asRecord(payload)
  const location = asRecord(root.location)
  return {
    postingId: jobId,
    url: jobUrl,
    company: asString(root.company_name) || board.replace(/[-_]+/g, ' '),
    jobTitle: asString(root.title) || undefined,
    jobDescription: asString(root.content)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined,
    jobBoard: 'greenhouse',
    location: asString(location.name) || undefined,
  }
}

export function fieldsToQuestions(fields: ApplicationField[]): AdapterQuestion[] {
  return fields.map((field) => ({
    id: field.id,
    text: field.description ? `${field.text}\n${field.description}` : field.text,
    fieldType: field.fieldType,
    options: field.options,
    required: field.required,
    locator: field.locator || { kind: 'field', value: field.id },
    answered: Boolean(field.value.trim()) || field.status === 'skipped',
    inputType: field.inputType,
    canonicalField: field.canonicalId,
  }))
}

export async function fetchGreenhouseApplicationForm(jobUrl: string) {
  const parsed = parseGreenhouseJobUrl(jobUrl)
  if (!parsed) throw new Error('This Greenhouse URL is missing a board name or numeric job id.')
  const apiUrl = greenhouseQuestionsApiUrl(parsed.board, parsed.jobId)
  const response = await fetch(apiUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'JobCopilot/0.1' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Greenhouse questions API returned HTTP ${response.status}.`)
  const payload = await response.json() as unknown
  const fields = mapGreenhouseQuestions(payload)
  if (!fields.length) throw new Error('Greenhouse did not return application questions for this job.')
  const sections = [...new Set(fields.map((field) => field.section).filter(Boolean))].map((title) => ({ id: title!, title: title! }))
  logApplicationSchema({
    ats: 'Greenhouse',
    source: 'Greenhouse public Job Board API ?questions=true',
    sections: sections.length,
    fields: fields.length,
    required: fields.filter((field) => field.required).length,
    complete: false,
  })
  return {
    board: parsed.board,
    jobId: parsed.jobId,
    embedUrl: greenhouseEmbedUrl(parsed.board, parsed.jobId),
    job: greenhouseJobFromPayload(jobUrl, parsed.board, parsed.jobId, payload),
    fields,
    sections,
    schemaComplete: false,
    schemaStage: 'API_DISCOVERED' as const,
    schemaSource: 'public_api' as const,
    questions: fieldsToQuestions(fields),
  }
}
