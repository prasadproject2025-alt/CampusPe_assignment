import type { AdapterQuestion, JobDetails } from '../types.js'
import { canonicalFieldId, controlKind, isStableAtsId } from './canonicalIdentity.js'
import { isOptionOnlyLabel, semanticFieldKey } from './extraction/fieldNormalizer.js'
import { matchQuestionToField as matchCanonicalQuestion } from './matchCanonical.js'
import type { ApplicationField, ApplicationModel, ApplicationStrategy } from './types.js'
import { emptyApplication } from './types.js'

export function questionsToFields(questions: AdapterQuestion[]): ApplicationField[] {
  return questions.filter((question) => !isOptionOnlyLabel(question.text)).map((question) => {
    const kind = controlKind(question.inputType, question.fieldType)
    const text = question.text.split('\n')[0]!.replace(/[✱*]+$/g, '').trim()
    const atsId = isStableAtsId(question.id) ? question.id : question.locator.value.replace(/^(name|id|ats):/, '')
    const id = canonicalFieldId({
      question: text,
      kind,
      atsId,
      options: question.options,
    })
    return {
      id,
      path: semanticFieldKey(text, isStableAtsId(question.id) ? question.id : ''),
      text,
      fieldType: question.fieldType,
      inputType: question.inputType,
      required: question.required,
      options: question.options,
      locator: question.locator,
      value: '',
      status: question.answered ? 'accepted' : 'empty',
      reason: question.answered ? 'Already completed on the employer form.' : undefined,
      isMany: question.inputType === 'checkbox-group' || question.inputType === 'checkbox',
    }
  })
}

export function fieldToQuestion(field: ApplicationField): AdapterQuestion {
  return {
    id: field.id,
    text: field.text,
    fieldType: field.fieldType,
    options: field.options,
    required: field.required,
    locator: field.locator || { kind: field.inputType === 'education' ? 'education' : 'field', value: field.id },
    answered: Boolean(field.value.trim()) || field.status === 'accepted' || field.status === 'skipped',
    inputType: field.inputType,
  }
}

export function matchQuestionToField(question: AdapterQuestion, fields: ApplicationField[]) {
  return matchCanonicalQuestion(question, fields)
}

export function applicationFromQuestions(
  provider: string,
  strategy: ApplicationStrategy,
  job: JobDetails | null,
  questions: AdapterQuestion[],
  reason: string,
  extras: Partial<ApplicationModel> = {},
): ApplicationModel {
  return emptyApplication(provider, strategy, reason, {
    ...extras,
    jobId: extras.jobId ?? job?.postingId ?? null,
    title: extras.title || job?.jobTitle || '',
    company: extras.company || job?.company || '',
    fields: extras.fields || questionsToFields(questions),
  })
}

export function firstUnresolvedRequired(fields: ApplicationField[]) {
  const visible = fields.filter((field) => !field.isHidden)
  return visible.find((field) => field.required && field.status === 'unresolved')
    || visible.find((field) => field.required && !field.value.trim() && field.status !== 'skipped' && field.inputType !== 'file')
}

export function mergeFieldUpdates(fields: ApplicationField[], updates: Array<{ id: string; value: string; status?: ApplicationField['status'] }>) {
  const byId = new Map(updates.map((update) => [update.id, update]))
  return fields.map((field) => {
    const update = byId.get(field.id)
    if (!update) return field
    const value = update.value
    return {
      ...field,
      value,
      status: update.status || (value.trim() ? 'manual' : 'empty'),
      reason: value.trim() ? 'Edited in the JobCopilot form.' : field.reason,
    }
  })
}

export function setFieldResolution(fields: ApplicationField[], fieldId: string, patch: Partial<ApplicationField>) {
  return fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field)
}
