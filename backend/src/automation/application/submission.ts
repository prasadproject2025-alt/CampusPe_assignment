import { applyStoredAnswers } from './applyAnswers.js'
import {
  AmbiguousFieldError,
  AnswerRequiresUserError,
  FieldResolutionError,
  ManualRequiredError,
  SubmissionTimeoutError,
} from './fieldResolution.js'
import type { Page } from 'playwright-core'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../browserLauncher.js'
import { detectAdapter } from '../registry.js'
import type { JobBoardAdapter } from '../types.js'
import type { ApplicationField } from './types.js'
import { matchCanonicalField } from './matchCanonical.js'
import {
  atsConfirmationDetected,
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  detectManualBlocker,
  waitForAtsConfirmation,
} from './submissionConfirmation.js'

export type SubmissionResult =
  | { ok: true; code: 'SUBMISSION_SUCCESS' }
  | { ok: false; code: 'MANUAL_REQUIRED'; blocker: { type: 'LOGIN' | 'CAPTCHA'; message: string } }
  | { ok: false; code: 'ANSWER_REQUIRES_USER'; error: string; label?: string }
  | { ok: false; code: 'AMBIGUOUS_FIELD'; error: string; fieldKey?: string; label?: string }
  | { ok: false; code: 'FIELD_NOT_FOUND'; error: string; fieldKey?: string; label?: string }
  | { ok: false; code: 'SUBMISSION_TIMEOUT'; error: string }
  | { ok: false; code: 'SUBMISSION_FAILED'; error: string }

export type SubmissionOptions = {
  adapter?: JobBoardAdapter
  confirmationTimeoutMs?: number
}

async function stabilizeApplicationForm(page: Page) {
  await page.evaluate(`(() => { var form = document.querySelector('form'); if (form && 'scrollTo' in form) form.scrollTo(0, form.scrollHeight); window.scrollTo(0, document.body.scrollHeight); })()`)
  await page.waitForTimeout(400)
}

async function assertLiveFormReadyToSubmit(adapter: JobBoardAdapter, page: Page, fields: ApplicationField[]) {
  const questions = await adapter.extractQuestions(page)
  for (const question of questions) {
    if (!question.required || question.answered) continue
    if (question.inputType === 'file' && /resume|\bcv\b/i.test(question.text)) continue
    const match = matchCanonicalField(question, fields)
    if (match.status === 'AMBIGUOUS') throw new AmbiguousFieldError(question.id, question.text)
    const value = match.field?.value.trim() || ''
    if (!value) throw new AnswerRequiresUserError(question.text)
  }
  const validity = await page.evaluate(`(() => {
    var form = document.querySelector('form');
    if (!form) return { valid: true, label: '' };
    var invalid = Array.prototype.slice.call(form.querySelectorAll(':invalid'));
    for (var i = 0; i < invalid.length; i++) {
      var el = invalid[i];
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden') continue;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      var label = el.getAttribute('aria-label') || el.getAttribute('name') || el.id || 'Required field';
      return { valid: false, label: String(label) };
    }
    return { valid: true, label: '' };
  })()`) as { valid: boolean; label: string }
  if (!validity.valid) throw new AnswerRequiresUserError(validity.label || 'Required field')
  if (!await adapter.isReviewReady(page)) {
    throw new Error('The live application is not ready to submit.')
  }
}

function mapSubmissionError(error: unknown): SubmissionResult {
  if (error instanceof ManualRequiredError) return { ok: false, code: 'MANUAL_REQUIRED', blocker: error.blocker }
  if (error instanceof AmbiguousFieldError) {
    return { ok: false, error: error.message, code: 'AMBIGUOUS_FIELD', fieldKey: error.fieldKey, label: error.label }
  }
  if (error instanceof AnswerRequiresUserError) {
    return { ok: false, error: error.message, code: 'ANSWER_REQUIRES_USER', label: error.label }
  }
  if (error instanceof FieldResolutionError) {
    return { ok: false, error: error.message, code: 'FIELD_NOT_FOUND', fieldKey: error.fieldKey, label: error.label }
  }
  if (error instanceof SubmissionTimeoutError) {
    return { ok: false, error: error.message, code: 'SUBMISSION_TIMEOUT' }
  }
  const message = error instanceof Error ? error.message : 'The job board did not confirm submission.'
  if (message.startsWith('ANSWER_REQUIRES_USER:')) return { ok: false, error: message, code: 'ANSWER_REQUIRES_USER' }
  if (message.startsWith('AMBIGUOUS_FIELD:')) return { ok: false, error: message, code: 'AMBIGUOUS_FIELD' }
  if (/timeout.*exceeded|timed out waiting/i.test(message)) {
    return { ok: false, error: message, code: 'SUBMISSION_TIMEOUT' }
  }
  return { ok: false, error: message, code: 'SUBMISSION_FAILED' }
}

export async function fillReviewedApplicationOnPage(params: {
  adapter: JobBoardAdapter
  page: Page
  userId: string
  jobUrl: string
  fields: ApplicationField[]
}): Promise<SubmissionResult | { ok: true; code: 'FILLED' }> {
  try {
    await stabilizeApplicationForm(params.page)
    const blocker = await detectManualBlocker(params.page, params.adapter)
    if (blocker) return { ok: false, blocker, code: 'MANUAL_REQUIRED' }
    await applyStoredAnswers(params.adapter, params.page, params.fields, params.userId, params.jobUrl)
    const afterFill = await detectManualBlocker(params.page, params.adapter)
    if (afterFill) return { ok: false, blocker: afterFill, code: 'MANUAL_REQUIRED' }
    return { ok: true, code: 'FILLED' }
  } catch (error) {
    return mapSubmissionError(error)
  }
}

export async function runReviewedSubmission(params: {
  adapter: JobBoardAdapter
  page: Page
  userId: string
  jobUrl: string
  fields: ApplicationField[]
  confirmationTimeoutMs?: number
}): Promise<SubmissionResult> {
  const timeoutMs = params.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS
  try {
    const filled = await fillReviewedApplicationOnPage(params)
    if (!filled.ok) return filled
    await assertLiveFormReadyToSubmit(params.adapter, params.page, params.fields)
    await params.adapter.submitApplication(params.page)
    if (!await atsConfirmationDetected(params.page)) {
      await waitForAtsConfirmation(params.page, {
        timeoutMs,
        detectBlocker: () => detectManualBlocker(params.page, params.adapter),
      })
    }
    if (!await atsConfirmationDetected(params.page)) {
      return {
        ok: false,
        code: 'SUBMISSION_TIMEOUT',
        error: 'The employer site did not confirm submission. Clicking Submit is not enough.',
      }
    }
    return { ok: true, code: 'SUBMISSION_SUCCESS' }
  } catch (error) {
    return mapSubmissionError(error)
  }
}

export async function submitApplicationWithServerBrowser(
  jobUrl: string,
  userId: string,
  fields: ApplicationField[],
  options: SubmissionOptions = {},
) {
  const adapter = options.adapter || detectAdapter(jobUrl)
  if (!adapter) throw new Error('The job-board adapter is unavailable.')
  return runWithBrowserPermit('submit', async () => {
    const { browser, context } = await launchHeadlessAutomationBrowser()
    const page = await context.newPage()
    try {
      await adapter.openApplication(page, jobUrl)
      await adapter.waitForApplication(page)
      return await runReviewedSubmission({
        adapter,
        page,
        userId,
        jobUrl,
        fields,
        confirmationTimeoutMs: options.confirmationTimeoutMs,
      })
    } catch (error) {
      return mapSubmissionError(error)
    } finally {
      await page.close().catch(() => undefined)
      await context.close().catch(() => undefined)
      await browser.close().catch(() => undefined)
    }
  })
}
