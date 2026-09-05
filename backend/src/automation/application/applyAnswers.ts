import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from 'playwright-core'
import type { AnswerValue } from '../../resolver/types.js'
import { tailoredResumeDir, uploadDir } from '../../config.js'
import { db } from '../../database.js'
import type { EducationRecord, JobBoardAdapter, ResumeUpload } from '../types.js'
import { classifyQuestion, normalizeQuestion } from '../../resolver/normalizer.js'
import { fileRole } from './canonicalIdentity.js'
import { AmbiguousFieldError, AnswerRequiresUserError, FieldResolutionError } from './fieldResolution.js'
import { questionsToFields, fieldToQuestion } from './formModel.js'
import { matchCanonicalField } from './matchCanonical.js'
import { fingerprintsEqual, reconcileCanonicalFields } from './reconcileCanonical.js'
import type { ApplicationField } from './types.js'

type ResumeRecord = { resume_storage_name: string | null; resume_filename: string | null; resume_mime: string | null; tailored?: boolean }

export function loadResumeForJob(userId: string, jobUrl: string): ResumeRecord | undefined {
  const savedResume = db.prepare('SELECT resume_storage_name,resume_filename,resume_mime FROM profiles WHERE user_id=?').get(userId) as ResumeRecord | undefined
  const tailored = db.prepare("SELECT storage_name,job_title FROM resume_optimizations WHERE user_id=? AND job_url=? AND status='APPROVED' AND storage_name IS NOT NULL ORDER BY approved_at DESC LIMIT 1").get(userId, jobUrl) as { storage_name: string; job_title: string } | undefined
  const tailoredPath = tailored?.storage_name ? resolve(tailoredResumeDir, tailored.storage_name) : ''
  return tailored && tailoredPath.startsWith(`${tailoredResumeDir}/`) && existsSync(tailoredPath)
    ? { resume_storage_name: tailored.storage_name, resume_filename: `Tailored Resume - ${tailored.job_title}.docx`, resume_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tailored: true }
    : savedResume ? { ...savedResume, tailored: false } : undefined
}

export function resumeFile(resume: ResumeRecord): ResumeUpload | null {
  if (!resume.resume_storage_name) return null
  const resumePath = resume.tailored ? resolve(tailoredResumeDir, resume.resume_storage_name) : resolve(uploadDir, resume.resume_storage_name)
  const expectedRoot = resume.tailored ? tailoredResumeDir : uploadDir
  if (!resumePath.startsWith(expectedRoot) || !existsSync(resumePath)) return null
  return { name: basenameSafe(resume.resume_filename || 'resume.pdf'), mimeType: resume.resume_mime || 'application/pdf', buffer: readFileSync(resumePath) }
}

function basenameSafe(name: string) {
  return name.replace(/^.*[/\\]/, '')
}

export async function applyStoredAnswers(adapter: JobBoardAdapter, page: Page, fields: ApplicationField[], userId: string, jobUrl: string) {
  const resume = loadResumeForJob(userId, jobUrl)
  const file = resume ? resumeFile(resume) : null
  const profileEducation = db.prepare('SELECT education_json FROM profiles WHERE user_id=?').get(userId) as { education_json: string } | undefined
  const filled = new Set<string>()
  const deferred: Error[] = []
  const MAX_DYNAMIC_ROUNDS = 5
  let schema = fields
  let questions: Awaited<ReturnType<JobBoardAdapter['extractQuestions']>> = []
  if (file) {
    await adapter.uploadResume(page, file)
    if (adapter.waitForResumeParsing) await adapter.waitForResumeParsing(page)
  }
  for (let round = 0; round < MAX_DYNAMIC_ROUNDS; round += 1) {
    const before = schema
    questions = await adapter.extractQuestions(page)
    schema = reconcileCanonicalFields(schema, questionsToFields(questions))
    for (const question of questions) {
      const match = matchCanonicalField(question, schema)
      if (match.status === 'AMBIGUOUS') {
        deferred.push(new AmbiguousFieldError(question.id, question.text))
        continue
      }
      const field = match.field
      const key = field?.id || `${question.id}::${question.text}`
      if (filled.has(key)) continue
      if (question.answered && !['radio', 'boolean', 'checkbox', 'checkbox-group', 'radio-group', 'select'].includes(question.inputType || '')) continue
      if (question.inputType === 'file' && (field?.id === 'file:resume' || fileRole(question.text) === 'resume' || question.id === '_systemfield_resume')) { filled.add(key); continue }
      if (question.inputType === 'file' && fileRole(question.text) === 'cover_letter') {
        if (question.required) deferred.push(new AnswerRequiresUserError(question.text))
        filled.add(key)
        continue
      }
      if (question.locator.kind === 'education') {
        const education = JSON.parse(profileEducation?.education_json || '[]') as EducationRecord[]
        await adapter.fillEducation(page, education)
        filled.add(key)
        continue
      }
      if (question.inputType === 'file') {
        if (question.required) deferred.push(new AnswerRequiresUserError(question.text))
        continue
      }
      let value = field?.value.trim()
      if (!value && classifyQuestion(normalizeQuestion(question.text)) === 'phone_country_code') {
        const profile = db.prepare('SELECT phone_country_code FROM profiles WHERE user_id=?').get(userId) as { phone_country_code?: string } | undefined
        value = profile?.phone_country_code?.trim() || ''
      }
      if (!value) {
        if (question.required && match.status === 'NOT_FOUND') {
          deferred.push(new FieldResolutionError(question.id, question.text))
          continue
        }
        if (question.required) {
          deferred.push(new AnswerRequiresUserError(question.text))
          continue
        }
        continue
      }
      if (adapter.extractQuestionOptions && (question.fieldType === 'select' || question.fieldType === 'boolean') && !question.options?.length) {
        const options = await adapter.extractQuestionOptions(page, question)
        if (options.length) question.options = options
      }
      try {
        await adapter.fillAnswer(page, field ? fieldToQuestion({ ...field, value }) : question, value as AnswerValue)
      } catch (error) {
        if (error instanceof AnswerRequiresUserError || error instanceof AmbiguousFieldError || error instanceof FieldResolutionError) {
          deferred.push(error)
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        if (/timeout.*exceeded|waiting for/i.test(message)) {
          deferred.push(new FieldResolutionError(question.id, question.text))
          continue
        }
        throw error
      }
      filled.add(key)
    }
    const latest = await adapter.extractQuestions(page)
    const next = reconcileCanonicalFields(schema, questionsToFields(latest))
    if (fingerprintsEqual(before, next)) break
    schema = next
  }
  if (deferred.length) throw deferred[0]
}
