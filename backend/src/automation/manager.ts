import { randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { db } from '../database.js'
import { answerResolver } from '../resolver/engine.js'
import { applyStoredAnswers, loadResumeForJob, resumeFile } from './application/applyAnswers.js'
import { extractApplicationSchema } from './application/extractor.js'
import { runReviewedSubmission, submitApplicationWithServerBrowser } from './application/submission.js'
import {
  assistedSessionExists,
  cancelAssistedSession,
  dispatchAssistedInput,
  getAssistedSessionForRun,
  startAssistedSession,
  type AssistedSessionSnapshot,
} from './application/assistedSession.js'
import { greenhouseEmbedUrl, isAllowedEmbedUrl } from './application/embedPolicy.js'
import { firstUnresolvedRequired, mergeFieldUpdates, questionsToFields, applicationFromQuestions, matchQuestionToField, fieldToQuestion } from './application/formModel.js'
import { reconcileCanonicalFields } from './application/reconcileCanonical.js'
import { parseGreenhouseJobUrl } from './application/greenhouseForm.js'
import { pipelineCapabilityForBoard } from './application/capabilities.js'
import { parseSubmissionFailureCode } from './application/fieldResolution.js'
import { canProgrammaticallySubmit, capabilitiesForBoard, resolveApplicationStrategy, shouldLaunchBrowserForStrategy } from './application/strategyResolver.js'
import { logApplicationSchema } from './application/schema.js'
import { emptyApplication, type ApplicationField, type ApplicationModel, type ApplicationStrategy } from './application/types.js'
import { launchHeadlessAutomationBrowser } from './browserLauncher.js'
import { dispatchPreviewInput, startRunPreview, stopRunPreview, type PreviewInput } from './preview.js'
import { canonicalJobUrl, detectAdapter } from './registry.js'
import type { ActiveRun, AdapterQuestion, AutomationStatus, EducationRecord, JobBoardAdapter, JobDetails } from './types.js'

type RunRow = {
  id: string; user_id: string; job_url: string; job_board: string; status: AutomationStatus; current_step: string
  job_json: string | null; questions_json: string | null; pause_json: string | null; error_message: string | null
  auto_submit: number; test_mode: number; strategy: string | null; application_json: string | null
  created_at: string; updated_at: string
}

const activeRuns = new Map<string, ActiveRun>()
const manualPauseRequests = new Set<string>()
const submissionLocks = new Set<string>()

export function automationBrowserKey(userId: string, _board: string, runId = '') {
  return `user:${userId}:run:${runId || 'none'}`
}

function event(runId: string, status: AutomationStatus, message: string, detail?: unknown) {
  db.prepare('INSERT INTO automation_events (id,run_id,status,message,detail_json,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), runId, status, message, detail ? JSON.stringify(detail) : null, new Date().toISOString())
}

function update(runId: string, status: AutomationStatus, currentStep: string, values: { job?: JobDetails; questions?: AdapterQuestion[]; pause?: unknown; error?: string | null; strategy?: ApplicationStrategy; application?: ApplicationModel } = {}) {
  db.prepare(`UPDATE automation_runs SET status=?,current_step=?,job_json=COALESCE(?,job_json),questions_json=COALESCE(?,questions_json),pause_json=?,error_message=?,strategy=COALESCE(?,strategy),application_json=COALESCE(?,application_json),updated_at=? WHERE id=?`).run(
    status, currentStep,
    values.job ? JSON.stringify(values.job) : null,
    values.questions ? JSON.stringify(values.questions) : null,
    values.pause ? JSON.stringify(values.pause) : null,
    values.error ?? null,
    values.strategy ?? null,
    values.application ? JSON.stringify(values.application) : null,
    new Date().toISOString(), runId,
  )
}

function parseApplication(row: RunRow): ApplicationModel | null {
  if (!row.application_json) return null
  try { return JSON.parse(row.application_json) as ApplicationModel } catch { return null }
}

function serializeRun(row: RunRow) {
  const capabilities = capabilitiesForBoard(row.job_board)
  const strategy = (row.strategy as ApplicationStrategy) || capabilities.preferredStrategy
  return {
    id: row.id, jobUrl: row.job_url, jobBoard: row.job_board, status: row.status, currentStep: row.current_step,
    autoSubmit: Boolean(row.auto_submit), testMode: Boolean(row.test_mode),
    strategy, capabilities, pipeline: pipelineCapabilityForBoard(row.job_board), application: parseApplication(row),
    job: row.job_json ? JSON.parse(row.job_json) : null,
    questions: row.questions_json ? JSON.parse(row.questions_json) : [],
    pause: row.pause_json ? JSON.parse(row.pause_json) : null,
    error: row.error_message,
    errorCode: parseSubmissionFailureCode(row.current_step, row.error_message),
    createdAt: row.created_at, updatedAt: row.updated_at,
    assistedSession: getAssistedSessionForRun(row.user_id, row.id),
    browserActive: Boolean(activeRuns.has(row.id) || assistedSessionExists(row.id)),
  }
}

export class AutomationManager {
  create(userId: string, jobUrl: string, autoSubmit = false, testMode = false) {
    jobUrl = canonicalJobUrl(jobUrl)
    const adapter = detectAdapter(jobUrl)
    if (!adapter) throw new Error('This job board is not supported yet. Use an Ashby, Greenhouse, Rippling, Breezy, Lever, Workable, BambooHR, or Recruitee job link.')
    const { strategy, capabilities } = resolveApplicationStrategy(adapter.id, jobUrl)
    const id = randomUUID(); const now = new Date().toISOString()
    const application = emptyApplication(adapter.id, strategy, 'Loading application…', { displayMode: 'native_form' })
    db.prepare('INSERT INTO automation_runs (id,user_id,job_url,job_board,status,current_step,auto_submit,test_mode,strategy,application_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, userId, jobUrl, adapter.id, 'QUEUED', 'QUEUED', testMode ? 0 : autoSubmit ? 1 : 0, testMode ? 1 : 0, strategy, JSON.stringify(application), now, now,
    )
    event(id, 'QUEUED', `Application run created (${strategy.replaceAll('_', ' ').toLowerCase()}). ${capabilities.customFormReason}`)
    queueMicrotask(() => void this.process(id, userId))
    return this.get(userId, id)
  }

  get(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) return null
    const events = db.prepare('SELECT status,message,detail_json,created_at FROM automation_events WHERE run_id=? ORDER BY created_at').all(runId) as Array<{ status: string; message: string; detail_json: string | null; created_at: string }>
    return { ...serializeRun(row), events: events.map((item) => ({ status: item.status, message: item.message, detail: item.detail_json ? JSON.parse(item.detail_json) : null, createdAt: item.created_at })) }
  }

  list(userId: string) { return (db.prepare('SELECT * FROM automation_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(userId) as unknown as RunRow[]).map(serializeRun) }

  updateAnswers(userId: string, runId: string, updates: Array<{ id: string; value: string }>) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    const application = parseApplication(row)
    if (!application?.fields.length) throw new Error('This application does not have an editable in-page form yet.')
    if (!['PAUSED_BY_USER', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA', 'READY_FOR_REVIEW', 'FILLING_APPLICATION'].includes(row.status)) {
      throw new Error('Answers can only be edited while the application is filling or waiting for review.')
    }
    application.fields = mergeFieldUpdates(application.fields, updates)
    update(runId, row.status, row.current_step, { application, pause: row.pause_json ? JSON.parse(row.pause_json) : null, error: row.error_message })
    return this.get(userId, runId)
  }

  pauseRun(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    if (['READY_FOR_REVIEW', 'SUBMITTING', 'SUBMITTED', 'FAILED'].includes(row.status)) throw new Error('This run cannot be paused at its current stage.')
    if (row.status.startsWith('PAUSED_')) return this.get(userId, runId)
    manualPauseRequests.add(runId)
    const pause = { reason: 'Automation paused by you.', instruction: 'Edit the form in this page, then click Continue automation on the right.' }
    update(runId, 'PAUSED_BY_USER', 'WAITING_FOR_USER', { pause })
    event(runId, 'PAUSED_BY_USER', 'Automation paused by the user.')
    return this.get(userId, runId)
  }

  async resume(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    if (!row.status.startsWith('PAUSED_')) throw new Error('This run is not waiting for manual input.')
    manualPauseRequests.delete(runId)

    if (!activeRuns.has(runId) && row.strategy !== 'BROWSER_AUTOMATION') {
      const application = parseApplication(row)
      const unresolved = application ? firstUnresolvedRequired(application.fields) : undefined
      if (unresolved && !unresolved.value.trim() && unresolved.inputType !== 'file') {
        this.pause(runId, { id: unresolved.id, text: unresolved.text, fieldType: unresolved.fieldType, required: unresolved.required, locator: unresolved.locator || { kind: 'field', value: unresolved.id }, answered: false, inputType: unresolved.inputType }, unresolved.reason || 'Complete this field in the JobCopilot form.', 'CUSTOM_FORM')
        return this.get(userId, runId)
      }
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', { application: application || undefined, questions: application?.fields.map((field) => ({ id: field.id, text: field.text, fieldType: field.fieldType, options: field.options, required: field.required, locator: field.locator || { kind: 'field', value: field.id }, answered: Boolean(field.value.trim()), inputType: field.inputType })) })
      event(runId, 'READY_FOR_REVIEW', row.test_mode ? 'Testing complete. Review the in-page form. Submission is disabled.' : 'Application is filled and ready for your review and submission approval.')
      if (row.auto_submit && canProgrammaticallySubmit('CUSTOM_FORM') && !row.test_mode) {
        event(runId, 'READY_FOR_REVIEW', 'Auto-submit mode is enabled. Submitting the completed application now.')
        queueMicrotask(() => void this.submit(userId, runId))
      }
      return this.get(userId, runId)
    }

    if (!activeRuns.has(runId)) throw new Error('The browser session is no longer active. Start a new run from the job link.')
    if (row.current_step === 'WAITING_FOR_SUBMIT_CAPTCHA') {
      event(runId, 'SUBMITTING', 'User completed the submission CAPTCHA. Retrying the approved submission in the existing browser.')
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW')
      queueMicrotask(() => void this.submit(userId, runId))
      return this.get(userId, runId)
    }
    event(runId, 'FILLING_APPLICATION', 'User continued the automation. Completed fields will be skipped.')
    update(runId, 'FILLING_APPLICATION', 'RESUMING')
    queueMicrotask(() => void this.process(runId, userId))
    return this.get(userId, runId)
  }

  async handleInput(userId: string, runId: string, input: PreviewInput) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    if (assistedSessionExists(runId)) {
      await dispatchAssistedInput(userId, runId, input)
      return this.get(userId, runId)
    }
    if (!activeRuns.has(runId)) throw new Error('The live application view is no longer active.')
    if (!row.status.startsWith('PAUSED_') && row.status !== 'READY_FOR_REVIEW') throw new Error('Wait until automation pauses before filling fields in the live preview.')
    await dispatchPreviewInput(runId, input)
    return this.get(userId, runId)
  }

  async startAssisted(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    if (row.test_mode) throw new Error('Testing mode never opens an assisted submission session.')
    if (row.status === 'SUBMITTED') throw new Error('This application was already submitted.')
    if (row.status === 'SUBMITTING') throw new Error('This application is already submitting.')
    if (!['READY_FOR_REVIEW', 'PAUSED_BY_USER', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA'].includes(row.status)) {
      throw new Error('Start assisted browser after the application is ready for review or waiting for a manual step.')
    }
    const adapter = detectAdapter(row.job_url)
    if (!adapter) throw new Error('The job-board adapter is unavailable.')
    const application = parseApplication(row)
    const applyAssistedStatus = (view: AssistedSessionSnapshot) => {
      if (view.status === 'SUBMITTED') {
        update(runId, 'SUBMITTED', 'APPLICATION_SUBMITTED')
        event(runId, 'SUBMITTED', `${this.boardName(adapter.id)} confirmed that the application was submitted.`)
        return
      }
      if (view.status === 'FAILED' || view.status === 'EXPIRED') {
        const code = view.status === 'EXPIRED' ? 'SUBMISSION_TIMEOUT' : 'SUBMISSION_FAILED'
        update(runId, 'PAUSED_NEEDS_INPUT', code, {
          error: view.reason.startsWith(`${code}:`) ? view.reason : `${code}: ${view.reason}`,
          pause: { reason: view.reason, instruction: 'You can start a new assisted browser session or retry submit after reviewing answers.' },
        })
        event(runId, 'PAUSED_NEEDS_INPUT', view.reason)
        return
      }
      if (view.status === 'CANCELLED') {
        update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', {
          pause: { reason: 'Assisted browser session cancelled.', instruction: 'Review the form, then submit automatically or continue in assisted browser.' },
        })
        event(runId, 'READY_FOR_REVIEW', 'Assisted browser session cancelled.')
        return
      }
      if (view.status === 'MANUAL_REQUIRED') {
        const captcha = /captcha|anti-bot/i.test(view.reason)
        const login = /sign in|log in/i.test(view.reason)
        const status = captcha ? 'PAUSED_CAPTCHA' : login ? 'PAUSED_LOGIN' : 'PAUSED_NEEDS_INPUT'
        update(runId, status, captcha || login ? 'MANUAL_REQUIRED' : (parseSubmissionFailureCode(undefined, view.reason) || 'WAITING_FOR_USER'), {
          error: view.reason,
          pause: { reason: view.reason, instruction: 'Complete the step in the assisted browser. JobCopilot will not bypass employer protections.' },
        })
        event(runId, status, view.reason)
        return
      }
      if (view.status === 'FILLING' || view.status === 'PREPARING') {
        update(runId, 'FILLING_APPLICATION', 'ASSISTED_FILLING')
        event(runId, 'FILLING_APPLICATION', view.reason)
        return
      }
      if (view.status === 'VERIFYING' || view.status === 'SUBMITTING') {
        update(runId, 'SUBMITTING', 'ASSISTED_VERIFYING')
        event(runId, 'SUBMITTING', view.reason)
        return
      }
      if (view.status === 'WAITING_FOR_USER' || view.status === 'USER_REVIEWING') {
        update(runId, 'PAUSED_NEEDS_INPUT', view.status, {
          pause: { reason: view.reason, instruction: 'Use the assisted browser to finish and submit. JobCopilot will not click Submit for you.' },
        })
        event(runId, 'PAUSED_NEEDS_INPUT', view.reason)
        return
      }
      update(runId, 'PAUSED_NEEDS_INPUT', 'WAITING_FOR_USER', {
        pause: { reason: view.reason, instruction: 'Use the assisted browser to finish and submit. JobCopilot will not click Submit for you.' },
      })
      event(runId, 'PAUSED_NEEDS_INPUT', view.reason)
    }
    event(runId, 'FILLING_APPLICATION', 'Starting an assisted chrome-headless-shell session for this application.')
    const view = await startAssistedSession({
      userId,
      runId,
      jobUrl: row.job_url,
      fields: application?.fields || [],
      onChange: applyAssistedStatus,
    })
    applyAssistedStatus(view)
    return this.get(userId, runId)
  }

  async cancelAssisted(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    const view = await cancelAssistedSession(userId, runId)
    if (view) {
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', {
        pause: { reason: 'Assisted browser session cancelled.', instruction: 'Review the form, then submit automatically or continue in assisted browser.' },
      })
      event(runId, 'READY_FOR_REVIEW', 'Assisted browser session cancelled.')
    }
    return this.get(userId, runId)
  }

  async submit(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    if (row.test_mode) throw new Error('Testing mode never submits applications. Start a normal run when you are ready to apply.')
    if (assistedSessionExists(runId)) {
      throw new Error('This application is already open in the assisted browser. Submit it there. JobCopilot will not start a second browser.')
    }
    if (row.status === 'SUBMITTING' || row.status === 'SUBMITTED') throw new Error('This application was already submitted or is submitting.')
    if (submissionLocks.has(runId)) throw new Error('This application was already submitted or is submitting.')
    const retryableFailure = parseSubmissionFailureCode(row.current_step, row.error_message)
    if (row.status !== 'READY_FOR_REVIEW' && !(row.status === 'PAUSED_NEEDS_INPUT' && retryableFailure)) {
      throw new Error('This application is not ready to submit yet.')
    }
    const adapter = detectAdapter(row.job_url)
    if (!adapter) throw new Error('The job-board adapter is unavailable.')
    const strategy = (row.strategy as ApplicationStrategy) || resolveApplicationStrategy(adapter.id, row.job_url).strategy
    if (!canProgrammaticallySubmit(strategy)) {
      throw new Error('This application requires you to finish it on the employer site. JobCopilot will not open Chrome.')
    }

    submissionLocks.add(runId)
    update(runId, 'SUBMITTING', 'SUBMITTING_APPLICATION')
    event(runId, 'SUBMITTING', row.auto_submit ? 'Auto-submit mode started the approved automatic submission.' : 'Submission approved by the user.')
    try {
      const application = parseApplication(row)
      event(runId, 'SUBMITTING', 'Sending reviewed answers through a disposable windowless browser worker.')
      const active = activeRuns.get(runId)
      const result = active?.browser.isConnected() && !active.page.isClosed()
        ? await runReviewedSubmission({
          adapter,
          page: active.page,
          userId,
          jobUrl: row.job_url,
          fields: application?.fields || [],
        })
        : await submitApplicationWithServerBrowser(row.job_url, userId, application?.fields || [])
      if (!result.ok && 'blocker' in result && result.blocker) {
        this.pauseForBlocker(runId, result.blocker.type === 'CAPTCHA' ? 'PAUSED_CAPTCHA' : 'PAUSED_LOGIN', result.blocker.message)
        update(runId, result.blocker.type === 'CAPTCHA' ? 'PAUSED_CAPTCHA' : 'PAUSED_LOGIN', 'MANUAL_REQUIRED', {
          strategy: 'MANUAL_REQUIRED',
          pause: { reason: result.blocker.message, instruction: 'Complete this step on the employer site. JobCopilot will not open Chrome automatically.' },
        })
        return this.get(userId, runId)
      }
      if (!result.ok) {
        const message = 'error' in result && result.error ? result.error : result.code
        const prefixed = message.startsWith(`${result.code}:`) ? message : `${result.code}: ${message}`
        update(runId, 'PAUSED_NEEDS_INPUT', result.code, {
          error: prefixed,
          pause: {
            reason: prefixed,
            instruction: result.code === 'ANSWER_REQUIRES_USER' || result.code === 'AMBIGUOUS_FIELD' || result.code === 'FIELD_NOT_FOUND'
              ? 'Complete this field in the review form or continue in the assisted browser. JobCopilot will not invent an answer.'
              : 'The employer site did not confirm submission. Continue in the assisted browser if you need to finish it there.',
          },
        })
        event(runId, 'PAUSED_NEEDS_INPUT', prefixed)
        return this.get(userId, runId)
      }
      update(runId, 'SUBMITTED', 'APPLICATION_SUBMITTED')
      event(runId, 'SUBMITTED', `${this.boardName(adapter.id)} confirmed that the application was submitted.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The job board did not confirm submission.'
      const code = parseSubmissionFailureCode(undefined, message) || 'SUBMISSION_FAILED'
      update(runId, 'PAUSED_NEEDS_INPUT', code, {
        error: message.startsWith(`${code}:`) ? message : `${code}: ${message}`,
        pause: { reason: message, instruction: 'Review the form, then retry submit or continue in the assisted browser.' },
      })
      event(runId, 'PAUSED_NEEDS_INPUT', message)
    } finally {
      submissionLocks.delete(runId)
    }
    return this.get(userId, runId)
  }

  private async process(runId: string, userId: string) {
    let active = activeRuns.get(runId)
    if (active?.processing) return
    try {
      const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow
      const adapter = detectAdapter(row.job_url)
      if (!adapter) throw new Error('The job-board adapter is unavailable.')
      const strategy = (row.strategy as ApplicationStrategy) || resolveApplicationStrategy(adapter.id, row.job_url).strategy
      if (shouldLaunchBrowserForStrategy(strategy)) {
        throw new Error('Playwright launch blocked: Start application must not start a browser for the native form.')
      }
      await this.processInPageRun(runId, userId, row, adapter.id, strategy)
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Automation failed.'
      const failedState = db.prepare('SELECT current_step,job_board FROM automation_runs WHERE id=?').get(runId) as { current_step: string; job_board: string } | undefined
      const timedOut = /timeout.*exceeded|pressSequentially/i.test(rawMessage)
      const message = timedOut && failedState?.current_step === 'WAITING_FOR_FORM'
        ? `Timed out while waiting for the ${this.boardName(failedState.job_board)} application form. The application was not submitted.`
        : timedOut ? 'Timed out while filling a field. The application was not submitted.' : rawMessage.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0]!.slice(0, 300)
      update(runId, 'FAILED', 'FAILED', { error: message }); event(runId, 'FAILED', message)
      const failedRun = activeRuns.get(runId)
      activeRuns.delete(runId)
      await stopRunPreview(runId)
      if (failedRun) await failedRun.page.close().catch(() => undefined)
    } finally {
      const current = activeRuns.get(runId)
      if (current) current.processing = false
    }
  }

  private async processInPageRun(runId: string, userId: string, row: RunRow, board: string, strategy: ApplicationStrategy) {
    update(runId, 'EXTRACTING_JOB', 'LOADING_PUBLIC_FORM')
    event(runId, 'EXTRACTING_JOB', `Loading the ${this.boardName(board)} application schema into JobCopilot.`)
    try {
      const form = await extractApplicationSchema(board, row.job_url)
      if (form.manualRequired) {
        const application = emptyApplication(board, 'MANUAL_REQUIRED', form.manualRequired.reason, { displayMode: 'native_form', fields: form.fields, jobId: form.jobId, title: form.job.jobTitle || '', company: form.job.company || form.board, schemaComplete: false })
        const status = form.manualRequired.code === 'CAPTCHA' ? 'PAUSED_CAPTCHA' : form.manualRequired.code === 'LOGIN' ? 'PAUSED_LOGIN' : 'PAUSED_NEEDS_INPUT'
        update(runId, status, 'MANUAL_REQUIRED', {
          job: form.job,
          strategy: 'MANUAL_REQUIRED',
          application,
          pause: { reason: form.manualRequired.reason, instruction: 'JobCopilot will not open Chrome. Finish this step on the employer site if needed, or retry.' },
        })
        event(runId, status, form.manualRequired.reason)
        return
      }
      const application = emptyApplication(board, 'CUSTOM_FORM', `Native ${this.boardName(board)} form. Playwright is not used until you submit.`, {
        jobId: form.jobId,
        title: form.job.jobTitle || '',
        company: form.job.company || form.board,
        embedUrl: form.embedUrl && isAllowedEmbedUrl(form.embedUrl) ? form.embedUrl : null,
        fields: form.fields,
        sections: form.sections,
        schemaSource: form.schemaSource,
        schemaComplete: form.schemaComplete,
        schemaFieldCount: form.fields.length,
        displayMode: 'native_form',
      })
      logApplicationSchema({
        ats: this.boardName(board),
        source: form.schemaSource === 'public_api' ? 'public API' : String(form.schemaSource),
        sections: form.sections?.length || 0,
        fields: form.fields.length,
        required: form.fields.filter((field) => field.required && !field.isHidden).length,
        complete: form.schemaComplete !== false,
      })
      if (form.schemaComplete === false && !form.fields.length) {
        update(runId, 'PAUSED_NEEDS_INPUT', 'INCOMPLETE_SCHEMA', {
          job: form.job,
          questions: form.questions,
          strategy: 'CUSTOM_FORM',
          application: { ...application, reason: 'We couldn\'t retrieve the complete application form.' },
          pause: { reason: 'We couldn\'t retrieve the complete application form.', instruction: 'Retry this application. JobCopilot will not submit an incomplete schema.' },
        })
        event(runId, 'PAUSED_NEEDS_INPUT', 'We couldn\'t retrieve the complete application form.')
        return
      }
      update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job: form.job, questions: form.questions, strategy: 'CUSTOM_FORM', application })
      event(runId, 'FILLING_APPLICATION', `${application.fields.length} fields found. Generating profile-based suggestions.`)
      const resume = loadResumeForJob(userId, row.job_url)
      for (const field of application.fields) {
        if (manualPauseRequests.has(runId)) return
        if (field.inputType === 'file') {
          field.status = resume?.resume_storage_name ? 'accepted' : field.required ? 'unresolved' : 'skipped'
          field.value = resume?.resume_filename || ''
          field.reason = resume?.resume_storage_name ? 'The saved resume will be attached when you submit.' : field.required ? 'Upload a resume in your profile before submitting.' : 'Optional file skipped.'
          continue
        }
        if (field.inputType === 'education') {
          field.status = 'accepted'
          field.reason = 'Education from your profile is applied when you submit.'
          continue
        }
        field.reason = field.reason || 'Analyzing…'
        const question = form.questions.find((item) => item.id === field.id) || fieldToQuestion(field)
        const resolution = await answerResolver.resolve(userId, question, form.job, { testMode: Boolean(row.test_mode) })
        if (resolution.status === 'RESOLVED') {
          field.value = String(resolution.answer)
          field.suggestion = field.value
          field.source = resolution.source
          field.confidence = resolution.confidence
          field.status = 'suggested'
          field.reason = resolution.explanation
          event(runId, 'FILLING_APPLICATION', `Suggested “${field.text}” from ${resolution.source}.`, { source: resolution.source, confidence: resolution.confidence })
        } else if (field.required) {
          field.status = 'unresolved'
          field.reason = resolution.reason
        } else {
          field.status = 'skipped'
          field.reason = resolution.reason
        }
        update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job: form.job, questions: form.questions, application })
      }
      const unresolved = firstUnresolvedRequired(application.fields)
      if (unresolved && unresolved.inputType !== 'file') {
        update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job: form.job, questions: form.questions, application })
        this.pause(runId, { id: unresolved.id, text: unresolved.text, fieldType: unresolved.fieldType, required: true, locator: unresolved.locator || { kind: 'field', value: unresolved.id }, answered: false, inputType: unresolved.inputType }, unresolved.reason || 'Complete this field in the JobCopilot form.', 'CUSTOM_FORM')
        return
      }
      if (unresolved?.inputType === 'file' && unresolved.required && !resume?.resume_storage_name) {
        update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job: form.job, questions: form.questions, application })
        this.pause(runId, { id: unresolved.id, text: unresolved.text, fieldType: unresolved.fieldType, required: true, locator: { kind: 'field', value: 'resume' }, answered: false, inputType: 'file' }, 'A saved resume is required for this application.', 'CUSTOM_FORM')
        return
      }
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', { job: form.job, questions: form.questions, application })
      event(runId, 'READY_FOR_REVIEW', row.test_mode ? 'Testing complete. Review the in-page form. Submission is disabled.' : row.auto_submit ? 'Form is filled in JobCopilot and passed pre-submission checks.' : 'Form is filled in JobCopilot and ready for your review.')
      if (row.auto_submit && !row.test_mode) {
        event(runId, 'READY_FOR_REVIEW', 'Auto-submit mode is enabled. Submitting through a windowless browser now.')
        queueMicrotask(() => void this.submit(userId, runId))
      }
    } catch (error) {
      if (board === 'greenhouse' && strategy !== 'EMBED') {
        const identity = parseGreenhouseJobUrl(row.job_url)
        const embedUrl = identity ? greenhouseEmbedUrl(identity.board, identity.jobId) : null
        if (embedUrl && isAllowedEmbedUrl(embedUrl)) {
          const application = emptyApplication('greenhouse', 'EMBED', `The public questions API was unavailable (${error instanceof Error ? error.message : 'unknown error'}). Showing Greenhouse’s official embed. Auto-submit is disabled because the iframe is cross-origin.`, {
            embedUrl,
            displayMode: 'official_embed',
          })
          update(runId, 'PAUSED_NEEDS_INPUT', 'WAITING_FOR_USER', {
            strategy: 'EMBED',
            application,
            pause: { reason: application.reason, instruction: 'Complete and submit the official Greenhouse form in the Live application panel. JobCopilot will not open Chrome.' },
          })
          event(runId, 'PAUSED_NEEDS_INPUT', 'Fell back to the official Greenhouse embed inside JobCopilot.')
          return
        }
      }
      throw error
    }
  }

  private async processBrowserRun(runId: string, userId: string, initialRow: RunRow, adapter: JobBoardAdapter) {
    const strategy = (initialRow.strategy as ApplicationStrategy) || resolveApplicationStrategy(adapter.id, initialRow.job_url).strategy
    if (!shouldLaunchBrowserForStrategy(strategy)) {
      throw new Error('Refusing to start Playwright for an in-page application strategy.')
    }
    let active = activeRuns.get(runId)
    if (!active) {
      update(runId, 'OPENING_JOB', 'LAUNCHING_BROWSER')
      event(runId, 'OPENING_JOB', 'Opening the application in a windowless browser. This is a browser-assisted flow, not a native React form.')
      active = await this.ensureBrowser(runId, userId, adapter, true)
      await adapter.openApplication(active.page, initialRow.job_url)
    }
    active.processing = true
    const stopForManualPause = () => manualPauseRequests.has(runId)
    if (stopForManualPause()) return
    const stopForBlocker = async () => {
      const detected = await adapter.detectBlocker(active!.page)
      if (!detected) return false
      this.pauseForBlocker(runId, detected.type === 'CAPTCHA' ? 'PAUSED_CAPTCHA' : 'PAUSED_LOGIN', detected.message)
      return true
    }
    if (await stopForBlocker()) return
    if (stopForManualPause()) return
    update(runId, 'EXTRACTING_JOB', 'WAITING_FOR_FORM'); event(runId, 'EXTRACTING_JOB', `Waiting for the ${this.boardName(adapter.id)} application form.`)
    await adapter.waitForApplication(active.page)
    if (stopForManualPause()) return
    const job = await adapter.extractJob(active.page, initialRow.job_url)
    await this.stabilizeApplicationForm(active.page)
    let questions = await adapter.extractQuestions(active.page)
    if (stopForManualPause()) return
    let application = applicationFromQuestions(adapter.id, strategy, job, questions, 'Browser-assisted application. The image is a live preview of chrome-headless-shell, not the employer DOM.', { displayMode: 'browser_assisted', schemaSource: 'headless_extract', schemaComplete: true, schemaFieldCount: questions.length })
    logApplicationSchema({
      ats: this.boardName(adapter.id),
      source: 'headless DOM extract',
      sections: 1,
      fields: questions.length,
      required: questions.filter((question) => question.required).length,
      complete: true,
    })
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId) as RunRow
    update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job, questions, strategy, application })
    event(runId, 'FILLING_APPLICATION', `Found ${questions.length} application fields.`, { questionCount: questions.length })

    const resume = loadResumeForJob(userId, row.job_url)
    const profileEducation = db.prepare('SELECT education_json FROM profiles WHERE user_id=?').get(userId) as { education_json: string } | undefined
    let resumeProcessed = false
    for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
      if (stopForManualPause()) return
      const question = questions[questionIndex]!
      if (question.answered) continue
      const latest = db.prepare('SELECT application_json FROM automation_runs WHERE id=?').get(runId) as { application_json: string | null }
      if (latest.application_json) {
        try { application = JSON.parse(latest.application_json) as ApplicationModel } catch { /* keep */ }
      }
      const stored = matchQuestionToField(question, application.fields)
      if (resumeProcessed && question.inputType === 'file' && question.id === '_systemfield_resume') continue
      if (await stopForBlocker()) return
      try { await adapter.focusQuestion(active.page, question) }
      catch (error) {
        if (await stopForBlocker()) return
        throw error
      }
      if (stopForManualPause()) return
      if (await stopForBlocker()) return
      if (this.isChoiceControl(question) && !question.options?.length && adapter.extractQuestionOptions) {
        const options = await adapter.extractQuestionOptions(active.page, question)
        if (options.length) {
          question.options = options
          if (stored) stored.options = options
          update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job, questions, application })
          event(runId, 'FILLING_APPLICATION', `Read ${options.length} choices for “${question.text}”.`, { options })
        }
      }
      if (stopForManualPause()) return
      event(runId, 'FILLING_APPLICATION', `Inspecting “${question.text}”.`, { fieldType: question.fieldType, inputType: question.inputType, required: question.required })
      if (stored?.value.trim() && stored.status !== 'unresolved') {
        try { await adapter.fillAnswer(active.page, question, stored.value) }
        catch {
          if (await stopForBlocker()) return
          return this.pause(runId, question, 'JobCopilot could not complete this control from the in-page answer. Check it in the form.', strategy)
        }
        stored.status = stored.status === 'manual' ? 'manual' : 'accepted'
        update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job, questions, application })
        event(runId, 'FILLING_APPLICATION', `Filled “${question.text}” from the in-page form.`)
        continue
      }
      if (question.inputType === 'file' && question.id === '_systemfield_resume') {
        const file = resume ? resumeFile(resume) : null
        if (file) {
          await adapter.uploadResume(active.page, file)
          resumeProcessed = true
          event(runId, 'FILLING_APPLICATION', 'Waiting for résumé parsing to finish before filling the form.')
          if (adapter.waitForResumeParsing) await adapter.waitForResumeParsing(active.page)
          else await this.waitForResumeParsing(active.page)
          if (stopForManualPause()) return
          await this.waitForFormStability(active.page)
          if (await stopForBlocker()) return
          event(runId, 'FILLING_APPLICATION', resume?.tailored ? 'Attached the approved job-specific resume.' : 'Attached the saved resume.', { filename: resume?.resume_filename })
          questions = await adapter.extractQuestions(active.page)
          application.fields = reconcileCanonicalFields(application.fields, questionsToFields(questions))
          update(runId, 'FILLING_APPLICATION', 'RESOLVING_REMAINING_QUESTIONS', { job, questions, application })
          event(runId, 'FILLING_APPLICATION', 'Résumé parsing finished. Refreshed the form and will fill only the remaining empty fields.', { remainingCount: questions.filter((item) => !item.answered && item.id !== '_systemfield_resume').length })
          questionIndex = -1
          continue
        }
        if (question.required) return this.pause(runId, question, 'A saved resume is required for this application.', strategy)
        continue
      }
      if (question.inputType === 'file') {
        const isCoverLetter = /cover.?letter/i.test(`${question.id} ${question.text}`)
        if (!question.required) {
          event(runId, 'FILLING_APPLICATION', `Skipped optional file field “${question.text}”.`, { fieldId: question.id })
          continue
        }
        const file = resume ? resumeFile(resume) : null
        if (isCoverLetter && file) {
          await adapter.uploadFile(active.page, question, file)
          await active.page.waitForTimeout(700)
          if (await stopForBlocker()) return
          event(runId, 'FILLING_APPLICATION', 'Attached the saved resume to the required cover-letter upload.', { filename: resume?.resume_filename })
          continue
        }
        return this.pause(runId, question, isCoverLetter ? 'A saved resume is required for this mandatory cover-letter upload.' : `“${question.text}” requires a file.`, strategy)
      }
      if (question.locator.kind === 'education') {
        try {
          const education = JSON.parse(profileEducation?.education_json || '[]') as EducationRecord[]
          await adapter.fillEducation(active.page, education)
          if (await stopForBlocker()) return
          event(runId, 'FILLING_APPLICATION', 'Filled education history from your profile.', { count: education.length })
        } catch (error) {
          return this.pause(runId, question, error instanceof Error ? error.message : 'Complete the education section in the live form.', strategy)
        }
        continue
      }
      const resolution = await answerResolver.resolve(userId, question, job, { testMode: Boolean(row.test_mode) })
      if (stopForManualPause()) return
      if (resolution.status === 'RESOLVED') {
        try { await adapter.fillAnswer(active.page, question, resolution.answer) }
        catch {
          if (await stopForBlocker()) return
          return this.pause(runId, question, 'JobCopilot could not complete this control reliably. Check or complete it in the live form.', strategy)
        }
        if (stored) {
          stored.value = String(resolution.answer)
          stored.suggestion = stored.value
          stored.source = resolution.source
          stored.confidence = resolution.confidence
          stored.status = 'suggested'
          stored.reason = resolution.explanation
        }
        if (stopForManualPause()) return
        if (await stopForBlocker()) return
        update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job, questions, application })
        event(runId, 'FILLING_APPLICATION', `Filled “${question.text}” from ${resolution.source}.`, { source: resolution.source, confidence: resolution.confidence, requiresReview: resolution.requiresReview })
        if (this.isChoiceControl(question)) {
          const refreshed = await adapter.extractQuestions(active.page)
          const knownIds = new Set(questions.map((item) => item.id))
          const revealed = refreshed.filter((item) => !knownIds.has(item.id))
          if (revealed.length) {
            questions = refreshed
            application.fields = reconcileCanonicalFields(application.fields, questionsToFields(questions))
            update(runId, 'FILLING_APPLICATION', 'RESOLVING_REVEALED_QUESTIONS', { job, questions, application })
            event(runId, 'FILLING_APPLICATION', `Found ${revealed.length} additional field${revealed.length === 1 ? '' : 's'} revealed by “${question.text}”.`, { fields: revealed.map((item) => item.text) })
            questionIndex = -1
          }
        }
        continue
      }
      if (stored) {
        stored.status = question.required ? 'unresolved' : 'skipped'
        stored.reason = resolution.reason
        update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job, questions, application })
      }
      if (question.required) return this.pause(runId, question, resolution.reason, strategy)
      event(runId, 'FILLING_APPLICATION', `Skipped optional field “${question.text}”.`, { reason: resolution.reason })
    }
    if (stopForManualPause()) return
    if (await stopForBlocker()) return
    if (!await adapter.isReviewReady(active.page)) throw new Error('The application form did not reach the review boundary.')
    questions = await adapter.extractQuestions(active.page)
            application.fields = reconcileCanonicalFields(application.fields, questionsToFields(questions))
    update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', { job, questions, application, strategy })
    event(runId, 'READY_FOR_REVIEW', row.test_mode ? 'Testing complete. The form was filled for inspection and submission is disabled.' : row.auto_submit ? 'Application is filled and passed the pre-submission checks.' : 'Application is filled and ready for your review and submission approval.')
    if (row.auto_submit && canProgrammaticallySubmit(strategy) && !row.test_mode) {
      event(runId, 'READY_FOR_REVIEW', 'Auto-submit mode is enabled. Submitting the completed application now.')
      queueMicrotask(() => void this.submit(userId, runId))
    }
  }

  private async ensureBrowser(runId: string, _userId: string, adapter: { id: string }, startPreview: boolean) {
    const existing = activeRuns.get(runId)
    if (existing?.browser.isConnected() && !existing.page.isClosed()) return existing
    const { browser, context } = await launchHeadlessAutomationBrowser()
    event(runId, 'OPENING_JOB', `Started an isolated windowless headless-shell session for this run (${adapter.id}). Google Chrome is not launched.`)
    browser.on('disconnected', () => {
      const active = activeRuns.get(runId)
      if (!active || active.browser !== browser) return
      activeRuns.delete(runId)
      const current = db.prepare('SELECT status FROM automation_runs WHERE id=?').get(runId) as { status: AutomationStatus } | undefined
      void stopRunPreview(runId)
      if (current && !['READY_FOR_REVIEW', 'SUBMITTED', 'FAILED'].includes(current.status)) {
        update(runId, 'FAILED', 'BROWSER_CLOSED', { error: 'The automation browser was closed. Start a new run to continue.' })
        event(runId, 'FAILED', 'The automation browser was closed before review.')
      }
    })
    const page = await context.newPage()
    const active = { browser, context, page, processing: false }
    activeRuns.set(runId, active)
    if (startPreview) {
      await startRunPreview(runId, page).catch((error) => {
        event(runId, 'OPENING_JOB', `Live preview could not start yet: ${error instanceof Error ? error.message : 'unknown error'}`)
      })
    }
    return active
  }

  private pause(runId: string, question: AdapterQuestion, reason: string, strategy: ApplicationStrategy = 'BROWSER_AUTOMATION') {
    const instruction = strategy === 'CUSTOM_FORM'
      ? 'Complete this field in the JobCopilot form, then click Continue automation on the right.'
      : 'Complete this field in the live form, then click Continue automation on the right.'
    const pause = { question, reason, instruction }
    update(runId, 'PAUSED_NEEDS_INPUT', 'WAITING_FOR_USER', { pause }); event(runId, 'PAUSED_NEEDS_INPUT', `Waiting for “${question.text}”.`, pause)
  }

  private pauseForBlocker(runId: string, status: 'PAUSED_LOGIN' | 'PAUSED_CAPTCHA', message: string, currentStep = 'WAITING_FOR_USER') {
    const pause = { reason: message, instruction: 'Complete the step in the live form, then click Continue automation on the right.' }
    update(runId, status, currentStep, { pause }); event(runId, status, message)
  }

  private async waitForResumeParsing(page: Page) {
    const busy = page.getByText(/analyzing (?:your )?resume|parsing (?:your )?resume|processing (?:your )?resume|uploading (?:your )?resume/i)
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      let visible = false
      for (let index = 0; index < await busy.count(); index += 1) {
        if (await busy.nth(index).isVisible().catch(() => false)) { visible = true; break }
      }
      if (!visible) break
      await page.waitForTimeout(500)
    }
    if (Date.now() >= deadline) throw new Error('Résumé parsing did not finish within 30 seconds. The application was not submitted.')
  }

  private async stabilizeApplicationForm(page: Page) {
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    await page.evaluate(`(() => { var form = document.querySelector('form'); if (form) form.scrollTo(0, form.scrollHeight); window.scrollTo(0, document.body.scrollHeight); })()`).catch(() => undefined)
    await this.waitForFormStability(page)
    await page.evaluate(`(() => { window.scrollTo(0, 0); })()`).catch(() => undefined)
  }

  private async waitForFormStability(page: Page) {
    await page.waitForTimeout(1_200)
    const fields = page.locator('form input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), form textarea, form select')
    let previous = ''; let stableSamples = 0
    const stabilizationDeadline = Date.now() + 15_000
    while (Date.now() < stabilizationDeadline && stableSamples < 3) {
      const snapshot = JSON.stringify(await fields.evaluateAll('controls => controls.map(control => control.value)'))
      stableSamples = snapshot === previous ? stableSamples + 1 : 0
      previous = snapshot
      await page.waitForTimeout(500)
    }
  }

  private boardName(id: string) { return id.charAt(0).toUpperCase() + id.slice(1) }
  private isChoiceControl(question: AdapterQuestion) {
    return question.fieldType === 'select' || question.fieldType === 'boolean' || ['select', 'radio', 'checkbox', 'checkbox-group', 'radio-group', 'boolean'].includes(question.inputType || '')
  }
}


export const automationManager = new AutomationManager()
