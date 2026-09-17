import { startSubmissionTrace } from './application/submissionTrace.js'
import { randomUUID } from 'node:crypto'
import type { Page } from 'playwright-core'
import { db } from '../database.js'
import { answerResolver } from '../resolver/engine.js'
import { fileRole } from './application/canonicalIdentity.js'
import { loadResumeForJob } from './application/applyAnswers.js'
import { extractApplicationSchema } from './application/extractor.js'
import { runReviewedSubmission } from './application/submission.js'
import { detectManualBlocker } from './application/submissionConfirmation.js'
import {
  assistedSessionExists,
  cancelAssistedSession,
  dispatchAssistedInput,
  getAssistedSessionForRun,
  startAssistedSession,
  submitAssistedApplication,
  type AssistedSessionSnapshot,
} from './application/assistedSession.js'
import { isAllowedEmbedUrl } from './application/embedPolicy.js'
import { firstUnresolvedRequired, mergeFieldUpdates, fieldToQuestion } from './application/formModel.js'
import { pipelineCapabilityForBoard } from './application/capabilities.js'
import { parseSubmissionFailureCode, isEmployerSpamRejection } from './application/fieldResolution.js'
import { canProgrammaticallySubmit, capabilitiesForBoard, resolveApplicationStrategy, shouldLaunchBrowserForStrategy } from './application/strategyResolver.js'
import { logApplicationSchema } from './application/schema.js'
import { emptyApplication, type ApplicationModel, type ApplicationStrategy } from './application/types.js'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from './browserLauncher.js'
import { dispatchPreviewInput, startRunPreview, stopRunPreview, type PreviewInput } from './preview.js'
import { canonicalJobUrl, detectAdapter } from './registry.js'
import { validateApplicationForRealSubmission } from './application/submissionValidator.js'
import {
  cleanupExpiredCaptchaSessions,
  getCaptchaSession,
  getCaptchaSessionInfo as getCaptchaSessionDetails,
} from './application/captchaHandoff.js'
import type { ActiveRun, AdapterQuestion, AutomationStatus, JobDetails } from './types.js'

type RunRow = {
  id: string; user_id: string; job_url: string; job_board: string; status: AutomationStatus; current_step: string
  job_json: string | null; questions_json: string | null; pause_json: string | null; error_message: string | null
  auto_submit: number; test_mode: number; strategy: string | null; application_json: string | null
  created_at: string; updated_at: string
}

const activeRuns = new Map<string, ActiveRun>()
const manualPauseRequests = new Set<string>()
const submissionLocks = new Set<string>()
let captchaCleanupInterval: ReturnType<typeof setInterval> | null = null

// Start CAPTCHA session cleanup interval
if (!captchaCleanupInterval) {
  captchaCleanupInterval = setInterval(() => {
    void cleanupExpiredCaptchaSessions().catch(() => undefined)
  }, 60000) // Check every minute
  captchaCleanupInterval.unref()
}

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

export class AutomationConflictError extends Error { }

export class AutomationManager {
  create(userId: string, jobUrl: string, _autoSubmit = false, testMode = false) {
    jobUrl = canonicalJobUrl(jobUrl)
    const adapter = detectAdapter(jobUrl)
    if (!adapter) throw new Error('This job board is not supported yet. Use an Ashby, Greenhouse, Rippling, Breezy, Lever, Workable, BambooHR, or Recruitee job link.')
    const { strategy, capabilities } = resolveApplicationStrategy(adapter.id, jobUrl)
    const id = randomUUID(); const now = new Date().toISOString()
    const application = emptyApplication(adapter.id, strategy, 'Loading application…', { displayMode: 'native_form' })
    db.prepare('INSERT INTO automation_runs (id,user_id,job_url,job_board,status,current_step,auto_submit,test_mode,strategy,application_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id, userId, jobUrl, adapter.id, 'QUEUED', 'QUEUED', 0, testMode ? 1 : 0, strategy, JSON.stringify(application), now, now,
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
      throw new AutomationConflictError('Answers can only be edited while the application is filling or waiting for review.')
    }
    if (updates.some(item => !application.fields.some(field => field.id === item.id))) {
      throw new AutomationConflictError('The application fields changed. Refresh the form before saving this answer.')
    }
    application.fields = mergeFieldUpdates(application.fields, updates)
    let pause = row.pause_json ? JSON.parse(row.pause_json) : null
    if (row.status === 'PAUSED_NEEDS_INPUT' && row.current_step === 'WAITING_FOR_USER' && pause?.question) {
      const unresolved = firstUnresolvedRequired(application.fields)
      pause = unresolved
        ? { question: fieldToQuestion(unresolved), reason: unresolved.reason || 'Complete this required field.', instruction: 'Complete this field in the JobCopilot form, then click Continue automation on the right.' }
        : { reason: 'Your answers are saved.', instruction: 'Click Continue automation to validate the completed form.' }
    }
    update(runId, row.status, row.current_step, { application, pause, error: row.error_message })
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
    if (assistedSessionExists(runId)) {
      await submitAssistedApplication(userId, runId)
      return this.get(userId, runId)
    }
    if (!row.status.startsWith('PAUSED_')) throw new Error('This run is not waiting for manual input.')
    manualPauseRequests.delete(runId)
    const adapter = detectAdapter(row.job_url)

    if (!activeRuns.has(runId) && row.strategy !== 'BROWSER_AUTOMATION') {
      const application = parseApplication(row)
      const unresolved = application ? firstUnresolvedRequired(application.fields) : undefined
      if (unresolved && !unresolved.value.trim() && unresolved.inputType !== 'file') {
        this.pause(runId, { id: unresolved.id, text: unresolved.text, fieldType: unresolved.fieldType, required: unresolved.required, locator: unresolved.locator || { kind: 'field', value: unresolved.id }, answered: false, inputType: unresolved.inputType }, unresolved.reason || 'Complete this field in the JobCopilot form.', 'CUSTOM_FORM')
        return this.get(userId, runId)
      }
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', { application: application || undefined, questions: application?.fields.map((field) => ({ id: field.id, text: field.text, fieldType: field.fieldType, options: field.options, required: field.required, locator: field.locator || { kind: 'field', value: field.id }, answered: Boolean(field.value.trim()), inputType: field.inputType })) })
      const fieldCount = application?.fields.length || 0
      const requiredCount = application?.fields.filter(f => f.required).length || 0
      const resolvedCount = application?.fields.filter(f => f.value.trim()).length || 0
      const unresolvedRequired = application?.fields.filter(f => f.required && !f.value.trim()).length || 0
      const ambiguousCount = application?.fields.filter(f => f.status === 'unresolved').length || 0

      event(runId, 'READY_FOR_REVIEW', `Application is filled and ready for your review and submission approval. Fields: ${fieldCount}, Required: ${requiredCount}, Resolved: ${resolvedCount}, Unresolved required: ${unresolvedRequired}, Ambiguous: ${ambiguousCount}, Provider: ${adapter?.id || 'unknown'}`)

      // Auto-submit guard conditions
      if (row.auto_submit && canProgrammaticallySubmit('CUSTOM_FORM') && !row.test_mode) {
        // Verify all guard conditions before auto-submitting
        if (unresolvedRequired > 0) {
          event(runId, 'READY_FOR_REVIEW', `Auto-submit blocked: ${unresolvedRequired} required fields are unresolved`)
          return this.get(userId, runId)
        }

        if (ambiguousCount > 0) {
          event(runId, 'READY_FOR_REVIEW', `Auto-submit blocked: ${ambiguousCount} fields are ambiguous`)
          return this.get(userId, runId)
        }

        // Pre-submit integrity validation
        const validation = validateApplicationForRealSubmission(application, Boolean(row.test_mode))
        if (!validation.isValid) {
          event(runId, 'READY_FOR_REVIEW', `Auto-submit blocked by integrity validation: ${validation.violations.join('; ')}`)
          return this.get(userId, runId)
        }

        // Check duplicate submission lock
        if (submissionLocks.has(runId)) {
          event(runId, 'READY_FOR_REVIEW', 'Auto-submit blocked: Submission already in progress')
          return this.get(userId, runId)
        }

        event(runId, 'SUBMITTING', 'Auto-submit starting approved application submission.')
        queueMicrotask(() => {
          void submitAssistedApplication(userId, runId).catch((error) => {
            console.error('Auto-submit error:', error)
          })
        })
      }
      return this.get(userId, runId)
    }

    if (!activeRuns.has(runId)) throw new Error('The browser session is no longer active. Start a new run from the job link.')
    if (row.current_step === 'WAITING_FOR_SUBMIT_CAPTCHA') {
      event(runId, 'SUBMITTING', 'User completed the submission CAPTCHA. Retrying the approved submission in the existing browser.')
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW')
      this.scheduleAssisted(userId, runId)
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
    if (!row) throw new AutomationConflictError('Application run not found.')
    if (row.test_mode) throw new AutomationConflictError('Testing mode never opens an assisted submission session.')
    if (row.status === 'SUBMITTED') throw new AutomationConflictError('This application was already submitted.')
    if (row.status === 'SUBMITTING') throw new AutomationConflictError('This application is already submitting.')
    if (!['READY_FOR_REVIEW', 'PAUSED_BY_USER', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA'].includes(row.status)) {
      throw new AutomationConflictError('Start assisted browser after the application is ready for review or waiting for a manual step.')
    }
    if (row.current_step === 'SUBMISSION_TIMEOUT' && !activeRuns.has(runId) && !assistedSessionExists(runId)) throw new AutomationConflictError('The original timed-out session is no longer available. Check with the employer before starting another application; JobCopilot will not replay this uncertain submission.')
    if (isEmployerSpamRejection(row.error_message)) throw new AutomationConflictError('The employer rejected this run as possible spam. This run cannot be retried in an assisted browser.')
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
          pause: { reason: view.reason, instruction: 'Use the assisted browser to finish and submit. Use the side Submit application button after reviewing the live form.' },
        })
        event(runId, 'PAUSED_NEEDS_INPUT', view.reason)
        return
      }
      update(runId, 'PAUSED_NEEDS_INPUT', 'WAITING_FOR_USER', {
        pause: { reason: view.reason, instruction: 'Use the assisted browser to finish and submit. Use the side Submit application button after reviewing the live form.' },
      })
      event(runId, 'PAUSED_NEEDS_INPUT', view.reason)
    }
    event(runId, 'FILLING_APPLICATION', 'Starting an isolated headless Chrome session for this application.')
    const retained = activeRuns.get(runId)
    activeRuns.delete(runId)
    const view = await startAssistedSession({
      userId,
      runId,
      jobUrl: row.job_url,
      fields: application?.fields || [],
      existingBrowser: retained,
      observeOnly: row.current_step === 'SUBMISSION_TIMEOUT',
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

  async resumeAfterCaptcha(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')

    if (row.status !== 'PAUSED_CAPTCHA') {
      throw new Error('This application is not paused due to CAPTCHA.')
    }

    if (assistedSessionExists(runId)) return this.get(userId, runId)
    throw new Error('Continue in the assisted browser and submit when ready. Automatic CAPTCHA resubmission is disabled.')
  }

  getCaptchaSessionInfo(userId: string, runId: string) {
    const captchaSession = getCaptchaSession(runId)
    if (!captchaSession || captchaSession.userId !== userId) {
      return null
    }
    return getCaptchaSessionDetails(runId)
  }

  private scheduleAssisted(userId: string, runId: string) {
    queueMicrotask(() => {
      void this.startAssisted(userId, runId).catch(error => {
        // Another request may already own the assisted/submission session.
        // A background request must not crash the API or overwrite that owner.
        if (error instanceof AutomationConflictError) return
        const message = error instanceof Error ? error.message : 'Submission failed.'
        update(runId, 'FAILED', 'SUBMISSION_FAILED', { error: message })
        event(runId, 'FAILED', message)
      })
    })
  }

  async submit(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new AutomationConflictError('Application run not found.')
    if (row.test_mode) throw new AutomationConflictError('Testing mode never submits applications. Start a normal run when you are ready to apply.')
    if (assistedSessionExists(runId)) {
      await submitAssistedApplication(userId, runId)
      return this.get(userId, runId)
    }
    if (row.status === 'SUBMITTING' || row.status === 'SUBMITTED') return this.get(userId, runId)
    if (submissionLocks.has(runId)) return this.get(userId, runId)
    const retryableFailure = parseSubmissionFailureCode(row.current_step, row.error_message)
    if (retryableFailure === 'SUBMISSION_TIMEOUT') throw new AutomationConflictError('The previous submission has an unknown outcome. Check the original assisted session or employer confirmation before starting another application.')
    if (retryableFailure === 'SUBMISSION_FAILED' && isEmployerSpamRejection(row.error_message)) {
      throw new AutomationConflictError('The employer rejected this run as possible spam. Automatic retries are disabled; no successful submission was confirmed.')
    }
    if (row.status !== 'READY_FOR_REVIEW' && !(row.status === 'PAUSED_NEEDS_INPUT' && retryableFailure)) {
      throw new AutomationConflictError('This application is not ready to submit yet.')
    }
    const adapter = detectAdapter(row.job_url)
    if (!adapter) throw new AutomationConflictError('The job-board adapter is unavailable.')
    const strategy = (row.strategy as ApplicationStrategy) || resolveApplicationStrategy(adapter.id, row.job_url).strategy
    if (!canProgrammaticallySubmit(strategy)) {
      throw new AutomationConflictError('This application requires you to finish it on the employer site. JobCopilot will not open Chrome.')
    }

    submissionLocks.add(runId)
    update(runId, 'SUBMITTING', 'SUBMITTING_APPLICATION')
    let stopTrace: (() => Promise<void>) | undefined
    event(runId, 'SUBMITTING', row.auto_submit ? 'Auto-submit mode started the approved automatic submission.' : 'Submission approved by the user.')
    try {
      const application = parseApplication(row)

      // Pre-submit integrity validation
      const validation = validateApplicationForRealSubmission(application, Boolean(row.test_mode))
      if (!validation.isValid) {
        throw new Error(`Application contains invalid data for real submission: ${validation.violations.join('; ')}`)
      }

      event(runId, 'SUBMITTING', 'Sending reviewed answers through a disposable windowless browser worker.')
      const active = await runWithBrowserPermit('submit', async () => {
        const existing = activeRuns.get(runId)
        if (existing?.browser.isConnected() && !existing.page.isClosed()) {
          stopTrace = await startSubmissionTrace(existing.context, runId)
          return existing
        }
        const created = await this.ensureBrowser(runId, userId, adapter, true)
        stopTrace = await startSubmissionTrace(created.context, runId)
        await adapter.openApplication(created.page, row.job_url)
        if (!await detectManualBlocker(created.page, adapter)) await adapter.waitForApplication(created.page)
        // Warm up the page — build behavioral telemetry before form interaction
        const { warmUpPage } = await import('./application/stealthHelpers.js')
        await warmUpPage(created.page)
        return created
      })
      const result = await runReviewedSubmission({
        adapter, page: active.page, userId, jobUrl: row.job_url,
        fields: application?.fields || [], runId,
        onPhase: phase => update(runId, 'SUBMITTING', phase, { application: application || undefined }),
      })
      if (!result.ok && ['MANUAL_REQUIRED', 'ANSWER_REQUIRES_USER', 'AMBIGUOUS_FIELD', 'FIELD_NOT_FOUND', 'SUBMISSION_TIMEOUT'].includes(result.code)) {
        const reason = 'blocker' in result ? result.blocker.message : result.error
        update(runId, 'PAUSED_NEEDS_INPUT', result.code, { error: reason, application: application || undefined })
        await this.startAssisted(userId, runId)
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
      if (stopTrace) await stopTrace().catch(error => console.error('Could not save local submission trace:', error instanceof Error ? error.message : 'Unknown trace error'))
      submissionLocks.delete(runId)
      const retained = activeRuns.get(runId)
      if (retained) {
        activeRuns.delete(runId)
        await stopRunPreview(runId)
        await retained.browser.close().catch(() => undefined)
      }
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
      const form = await extractApplicationSchema(board, row.job_url, row.test_mode ? undefined : worker => {
        activeRuns.set(runId, { ...worker, processing: false })
      })
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
        if (activeRuns.has(runId)) await this.startAssisted(userId, runId)
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
      event(runId, 'FILLING_APPLICATION', `${application.fields.length} fields found. Analyzing the resume and drafting answers with Ollama.`)
      const resume = loadResumeForJob(userId, row.job_url)
      for (const field of application.fields) {
        if (manualPauseRequests.has(runId)) return
        if (field.inputType === 'file') {
          const hasResume = fileRole(field.text) === 'resume' && Boolean(resume?.resume_storage_name)
          field.status = hasResume ? 'accepted' : field.required ? 'unresolved' : 'skipped'
          field.value = hasResume ? resume?.resume_filename || '' : ''
          field.reason = hasResume ? 'The saved resume will be attached when you submit.' : field.required ? `An attachment is required for ${field.text}.` : 'Optional file skipped.'
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
          if (!field.canonicalId && resolution.canonicalField) {
            field.canonicalId = resolution.canonicalField
          }
          event(runId, 'FILLING_APPLICATION', `Suggested “${field.text}” from ${resolution.source}.`, { source: resolution.source, confidence: resolution.confidence })
        } else if (field.required) {
          field.status = 'unresolved'
          field.reason = resolution.reason
          if (!field.canonicalId && resolution.canonicalField) {
            field.canonicalId = resolution.canonicalField
          }
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
      if (unresolved?.inputType === 'file' && unresolved.required) {
        update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job: form.job, questions: form.questions, application })
        this.pause(runId, { id: unresolved.id, text: unresolved.text, fieldType: unresolved.fieldType, required: true, locator: { kind: 'field', value: 'resume' }, answered: false, inputType: 'file' }, unresolved.reason || 'A required attachment is missing.', 'CUSTOM_FORM')
        return
      }
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', { job: form.job, questions: form.questions, application })

      const unresolvedRequired = application?.fields.filter(f => f.required && !f.value.trim()).length || 0
      const ambiguousCount = application?.fields.filter(f => f.status === 'unresolved').length || 0

      event(runId, 'READY_FOR_REVIEW', row.test_mode ? 'Testing complete. Review the in-page form. Submission is disabled.' : row.auto_submit ? 'Form is filled in JobCopilot and passed pre-submission checks.' : 'Form is filled in JobCopilot and ready for your review.')

      // Auto-submit guard conditions
      if (row.auto_submit && !row.test_mode) {
        // Verify all guard conditions before auto-submitting
        if (unresolvedRequired > 0) {
          event(runId, 'READY_FOR_REVIEW', `Auto-submit blocked: ${unresolvedRequired} required fields are unresolved`)
          return this.get(userId, runId)
        }

        if (ambiguousCount > 0) {
          event(runId, 'READY_FOR_REVIEW', `Auto-submit blocked: ${ambiguousCount} fields are ambiguous`)
          return this.get(userId, runId)
        }

        // Pre-submit integrity validation
        const validation = validateApplicationForRealSubmission(application, Boolean(row.test_mode))
        if (!validation.isValid) {
          event(runId, 'READY_FOR_REVIEW', `Auto-submit blocked by integrity validation: ${validation.violations.join('; ')}`)
          return this.get(userId, runId)
        }

        // Check duplicate submission lock
        if (submissionLocks.has(runId)) {
          event(runId, 'READY_FOR_REVIEW', 'Auto-submit blocked: Submission already in progress')
          return this.get(userId, runId)
        }

        event(runId, 'SUBMITTING', 'Auto-submit starting approved application submission.')
        queueMicrotask(() => {
          void submitAssistedApplication(userId, runId).catch((error) => {
            console.error('Auto-submit error:', error)
          })
        })
      }
    } catch (error) {
      throw error
    }
  }

  private async ensureBrowser(runId: string, _userId: string, adapter: { id: string }, startPreview: boolean) {
    const existing = activeRuns.get(runId)
    if (existing?.browser.isConnected() && !existing.page.isClosed()) return existing
    const { browser, context } = await launchHeadlessAutomationBrowser()
    event(runId, 'OPENING_JOB', `Started an isolated headless Chrome session for this run (${adapter.id}). Your personal Chrome profile is not used.`)
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

  private boardName(id: string) { return id.charAt(0).toUpperCase() + id.slice(1) }

}


export const automationManager = new AutomationManager()
