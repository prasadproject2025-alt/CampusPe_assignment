import type { ApplicationStrategy, AutomationRun } from './types'
import { runStrategy } from './types'

export function assistedStatusLabel(status: NonNullable<AutomationRun['assistedSession']>['status'] | AutomationRun['status'] | undefined) {
  if (status === 'PREPARING') return 'Preparing application'
  if (status === 'FILLING' || status === 'FILLING_APPLICATION') return 'Filling application'
  if (status === 'WAITING_FOR_USER') return 'Waiting for your action'
  if (status === 'USER_REVIEWING') return 'User reviewing'
  if (status === 'SUBMITTING') return 'Submitting'
  if (status === 'VERIFYING') return 'Verifying submission'
  if (status === 'SUBMITTED') return 'Application submitted'
  if (status === 'MANUAL_REQUIRED' || status === 'PAUSED_CAPTCHA' || status === 'PAUSED_LOGIN' || status === 'PAUSED_NEEDS_INPUT') return 'Manual action required'
  if (status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELLED') return 'Submission failed'
  return ''
}

export function submissionFailureCode(run: AutomationRun | null) {
  if (!run) return null
  if (run.errorCode) return run.errorCode
  const known = ['ANSWER_REQUIRES_USER', 'AMBIGUOUS_FIELD', 'FIELD_NOT_FOUND', 'MANUAL_REQUIRED', 'SUBMISSION_TIMEOUT', 'SUBMISSION_FAILED'] as const
  if (known.includes(run.currentStep as typeof known[number])) return run.currentStep as typeof known[number]
  return known.find((code) => run.error?.startsWith(`${code}:`) || run.error === code) || null
}

export function isEmployerSpamRejection(error?: string | null) {
  return /possible spam|flagged this submission as possible spam|submission was flagged/i.test(error || '')
}

export function applicationState(run: AutomationRun | null) {
  if (!run) return 'PREPARING'
  if (run.status === 'SUBMITTED') return 'SUBMITTED'
  if (run.status === 'FAILED' || ['SUBMISSION_TIMEOUT', 'SUBMISSION_FAILED'].includes(submissionFailureCode(run) || '')) return 'FAILED'
  if (run.error) return 'USER_ACTION_REQUIRED'
  const assisted = run.assistedSession?.status
  if (assisted === 'FAILED' || assisted === 'EXPIRED' || assisted === 'CANCELLED') return 'FAILED'
  if (assisted === 'VERIFYING' || run.currentStep.includes('VERIFYING')) return 'VERIFYING'
  if (assisted === 'SUBMITTING' || run.status === 'SUBMITTING') return 'SUBMITTING'
  if (assisted === 'USER_REVIEWING') return 'REVIEW'
  if (assisted === 'MANUAL_REQUIRED' || assisted === 'WAITING_FOR_USER' || run.status.startsWith('PAUSED_')) return 'USER_ACTION_REQUIRED'
  if (run.status === 'READY_FOR_REVIEW') return 'REVIEW'
  if (assisted === 'FILLING' || run.status === 'FILLING_APPLICATION') return 'FILLING'
  return 'PREPARING'
}

export function liveStatusLabel(run: AutomationRun | null) {
  if (!run) return 'Idle'
  const labels = {
    PREPARING: 'Preparing application', FILLING: 'Filling application', REVIEW: 'Ready for review',
    USER_ACTION_REQUIRED: 'Manual action required', SUBMITTING: 'Submitting', VERIFYING: 'Verifying submission',
    SUBMITTED: 'Application submitted', FAILED: 'Submission failed',
  }
  return labels[applicationState(run)]
}

export function liveStatusDetail(run: AutomationRun | null) {
  if (!run) return 'Paste a job link to open the application inside JobCopilot.'
  const strategy = runStrategy(run)
  const count = run.application?.fields?.length || 0
  const failure = submissionFailureCode(run)
  if (isEmployerSpamRejection(run.error || run.pause?.reason)) {
    return 'The employer rejected this submission as possible spam. It did not disclose the cause. This run will not be retried automatically.'
  }
  if (run.status === 'FAILED') return run.error || 'This application could not be opened inside JobCopilot.'
  if (run.status === 'SUBMITTED') return 'The job board confirmed your application was received.'
  if (run.status === 'SUBMITTING') return 'Sending reviewed answers from the server. Chrome stays off your machine.'
  if (failure) return run.error || run.pause?.reason || failure
  if (run.status === 'READY_FOR_REVIEW') {
    if (run.testMode) return 'Testing mode filled the form for inspection. Submission is disabled.'
    return count ? `${count} fields discovered. Review every answer, then submit when you are ready.` : 'Review every answer, then submit when you are ready.'
  }
  if (run.status.startsWith('PAUSED_')) return run.pause?.instruction || 'Complete the highlighted field, then continue on the right.'
  if (run.assistedSession?.status === 'MANUAL_REQUIRED') return run.assistedSession.reason
  if (strategy === 'EMBED') return 'Application embeds are disabled. Continue in the assisted browser.'
  if (strategy === 'MANUAL_REQUIRED') return run.pause?.reason || 'This application needs a step JobCopilot cannot complete automatically.'
  if (count) return `${count} fields found. Review and complete your application before submitting.`
  return 'Extracting the application form…'
}

export function strategyHeadline(strategy: ApplicationStrategy | null) {
  if (strategy === 'EMBED') return 'Official embed'
  if (strategy === 'MANUAL_REQUIRED') return 'Manual action required'
  return 'Application form'
}
