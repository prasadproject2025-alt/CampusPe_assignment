import type { FieldType } from '../../resolver/types.js'
import type { JobDetails } from '../types.js'
import { fieldsToQuestions } from './greenhouseForm.js'
import { logApplicationSchema, stripHtml } from './schema.js'
import { canonicalFieldId } from './canonicalIdentity.js'
import type { ApplicationField, ApplicationSection } from './types.js'

export const ASHBY_GRAPHQL_URL = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting'

const FORM_ENTRY_SELECTION = `id isRequired isHidden descriptionHtml field`

const FORM_RENDER_SELECTION = `
  id
  sourceFormDefinitionId
  formControls { identifier title }
  fieldEntries { ${FORM_ENTRY_SELECTION} }
  sections {
    title
    descriptionHtml
    isHidden
    fieldEntries { ${FORM_ENTRY_SELECTION} }
  }
`

const ASHBY_POSTING_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    title
    locationName
    departmentName
    descriptionHtml
    applicationForm { ${FORM_RENDER_SELECTION} }
    surveyForms { ${FORM_RENDER_SELECTION} }
  }
}`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export function parseAshbyJobUrl(jobUrl: string) {
  const url = new URL(jobUrl)
  if (url.hostname.toLowerCase() !== 'jobs.ashbyhq.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const board = parts[0]
  const jobId = parts[1] === 'application' ? undefined : parts[1]
  if (!board || !/^[A-Za-z0-9_-]{1,80}$/.test(board) || !jobId || !UUID.test(jobId)) return null
  return { board, jobId }
}

function mapAshbyType(type: string, options?: string[], isMany?: boolean): { fieldType: FieldType; inputType: string; isMany: boolean } {
  if (type === 'LongText') return { fieldType: 'textarea', inputType: 'textarea', isMany: false }
  if (type === 'File') return { fieldType: 'text', inputType: 'file', isMany: false }
  if (type === 'Boolean' || (options?.length === 2 && options.every((option) => /^(yes|no)$/i.test(option)))) {
    return { fieldType: 'boolean', inputType: 'boolean', isMany: false }
  }
  if (type === 'MultiValueSelect' || isMany) {
    return { fieldType: 'select', inputType: 'checkbox-group', isMany: true }
  }
  if (type === 'ValueSelect') return { fieldType: 'select', inputType: 'select', isMany: false }
  if (type === 'Number') return { fieldType: 'number', inputType: 'number', isMany: false }
  if (type === 'Education') return { fieldType: 'text', inputType: 'education', isMany: false }
  if (type === 'Email') return { fieldType: 'text', inputType: 'email', isMany: false }
  if (type === 'Phone') return { fieldType: 'text', inputType: 'tel', isMany: false }
  if (type === 'Date') return { fieldType: 'text', inputType: 'date', isMany: false }
  return { fieldType: 'text', inputType: type.toLowerCase() || 'text', isMany: false }
}

function selectableLabels(field: Record<string, unknown>) {
  return asArray(field.selectableValues).map((value) => {
    const record = asRecord(value)
    return asString(record.label) || asString(record.value)
  }).filter(Boolean)
}

function formRendersFromPosting(posting: Record<string, unknown>) {
  const applicationForm = asRecord(posting.applicationForm)
  const surveys = asArray(posting.surveyForms).map((item) => asRecord(item))
  const renders: Array<{ title: string; form: Record<string, unknown> }> = []
  if (Object.keys(applicationForm).length) renders.push({ title: 'Application', form: applicationForm })
  surveys.forEach((form, index) => {
    renders.push({ title: asString(form.title) || `Additional questions ${index + 1}`, form })
  })
  return renders
}

function sectionsFromRender(title: string, form: Record<string, unknown>) {
  const nested = asArray(form.sections).map((item) => asRecord(item))
  if (nested.length) {
    return nested.map((section, index) => ({
      title: asString(section.title) || (index === 0 ? title : `${title} (${index + 1})`),
      descriptionHtml: asString(section.descriptionHtml),
      isHidden: section.isHidden === true,
      fieldEntries: asArray(section.fieldEntries),
    }))
  }
  return [{
    title,
    descriptionHtml: asString(form.descriptionHtml),
    isHidden: form.isHidden === true,
    fieldEntries: asArray(form.fieldEntries),
  }]
}

export function collectAshbyFieldEntries(payload: unknown) {
  const posting = asRecord(asRecord(payload).data).jobPosting || asRecord(payload)
  const postingRecord = asRecord(posting)
  const collected: Array<{ sectionTitle: string; sectionHidden: boolean; entry: Record<string, unknown> }> = []
  for (const render of formRendersFromPosting(postingRecord)) {
    for (const section of sectionsFromRender(render.title, render.form)) {
      for (const raw of section.fieldEntries) {
        collected.push({ sectionTitle: section.title, sectionHidden: section.isHidden, entry: asRecord(raw) })
      }
    }
  }
  return { posting: postingRecord, collected, surveyFormsPresent: Object.prototype.hasOwnProperty.call(postingRecord, 'surveyForms') }
}

export function mapAshbyFieldEntries(payload: unknown): ApplicationField[] {
  const { collected } = collectAshbyFieldEntries(payload)
  const fields: ApplicationField[] = []
  const seen = new Set<string>()
  for (const item of collected) {
    const entry = item.entry
    const field = asRecord(entry.field)
    const path = asString(field.path) || asString(entry.id)
    const title = asString(field.title) || asString(field.humanReadablePath) || path
    if (!path || field.isDeactivated === true || seen.has(path)) continue
    seen.add(path)
    const options = selectableLabels(field)
    const mapped = mapAshbyType(asString(field.type), options, field.isMany === true)
    const description = stripHtml(asString(entry.descriptionHtml) || asString(field.descriptionHtml))
    fields.push({
      id: canonicalFieldId({
        provider: 'ashby',
        section: item.sectionTitle,
        question: title,
        kind: mapped.inputType,
        atsId: path,
        options,
      }),
      path,
      text: title,
      description: description || undefined,
      fieldType: mapped.fieldType,
      inputType: mapped.inputType === 'education' ? 'education' : mapped.inputType,
      required: Boolean(entry.isRequired) || path === '_systemfield_resume',
      options: mapped.fieldType === 'boolean' ? (options.length ? options : ['Yes', 'No']) : options.length ? options : undefined,
      section: item.sectionTitle,
      isHidden: entry.isHidden === true || item.sectionHidden,
      isMany: mapped.isMany,
      locator: { kind: mapped.inputType === 'education' ? 'education' : 'field', value: path },
      value: '',
      status: mapped.inputType === 'file' ? 'skipped' : 'empty',
      reason: mapped.inputType === 'file' ? 'The saved resume is attached when the application is submitted.' : undefined,
      raw: {
        path,
        type: asString(field.type),
        isRequired: Boolean(entry.isRequired),
        isHidden: entry.isHidden === true,
        isMany: field.isMany === true,
        metadata: asRecord(field.metadata),
        optionCount: options.length,
      },
    })
  }
  return fields
}

export function ashbySectionsFromPayload(payload: unknown): ApplicationSection[] {
  const { collected } = collectAshbyFieldEntries(payload)
  const seen = new Set<string>()
  const sections: ApplicationSection[] = []
  for (const item of collected) {
    if (seen.has(item.sectionTitle)) continue
    seen.add(item.sectionTitle)
    sections.push({ id: item.sectionTitle, title: item.sectionTitle })
  }
  return sections
}

export function ashbyJobFromPayload(jobUrl: string, board: string, jobId: string, payload: unknown): JobDetails {
  const posting = asRecord(asRecord(asRecord(payload).data).jobPosting || payload)
  return {
    postingId: asString(posting.id) || jobId,
    url: jobUrl,
    company: board.replace(/[-_]+/g, ' '),
    jobTitle: asString(posting.title) || undefined,
    jobDescription: asString(posting.descriptionHtml)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined,
    jobBoard: 'ashby',
    location: asString(posting.locationName) || undefined,
  }
}

export async function fetchAshbyApplicationForm(jobUrl: string) {
  const parsed = parseAshbyJobUrl(jobUrl)
  if (!parsed) throw new Error('This Ashby URL is missing a board name or job posting id.')
  const response = await fetch(ASHBY_GRAPHQL_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'JobCopilot/0.1' },
    body: JSON.stringify({
      operationName: 'ApiJobPosting',
      variables: { organizationHostedJobsPageName: parsed.board, jobPostingId: parsed.jobId },
      query: ASHBY_POSTING_QUERY,
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`Ashby application form API returned HTTP ${response.status}.`)
  const payload = await response.json() as unknown
  const graphqlError = asArray(asRecord(payload).errors)[0]
  if (graphqlError) throw new Error(`Ashby application form API error: ${asString(asRecord(graphqlError).message) || 'unknown error'}`)
  const { posting, collected } = collectAshbyFieldEntries(payload)
  const fields = mapAshbyFieldEntries(payload)
  const sections = ashbySectionsFromPayload(payload)
  if (!fields.length) throw new Error('Ashby did not return application questions for this job.')
  if (!asRecord(posting).applicationForm) throw new Error('Ashby did not return an application form for this job.')
  void collected
  logApplicationSchema({
    ats: 'Ashby',
    source: 'Ashby hosted GraphQL applicationForm.sections + surveyForms',
    sections: sections.length,
    fields: fields.length,
    required: fields.filter((field) => field.required && !field.isHidden).length,
    complete: false,
  })
  return {
    board: parsed.board,
    jobId: parsed.jobId,
    embedUrl: null as string | null,
    job: ashbyJobFromPayload(jobUrl, parsed.board, parsed.jobId, payload),
    fields,
    sections,
    schemaComplete: false,
    schemaStage: 'API_DISCOVERED' as const,
    schemaSource: 'public_api' as const,
    questions: fieldsToQuestions(fields),
  }
}

export type LoadedCustomForm = Awaited<ReturnType<typeof fetchAshbyApplicationForm>>
