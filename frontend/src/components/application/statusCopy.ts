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

export function liveStatusLabel(run: AutomationRun | null) {
  if (!run) return 'Idle'
  if (run.assistedSession) {
    const assisted = assistedStatusLabel(run.assistedSession.status)
    if (assisted) return assisted
  }
  const failure = submissionFailureCode(run)
  if (failure && run.status !== 'SUBMITTED') return failure
  if (run.status === 'QUEUED' || run.status === 'OPENING_JOB' || run.status === 'EXTRACTING_JOB' || run.status === 'FILLING_APPLICATION') {
    return run.application?.fields?.length ? 'Application form' : 'Loading application...'
  }
  if (run.status.startsWith('PAUSED_')) return 'Needs user input'
  if (run.status === 'READY_FOR_REVIEW') return 'Ready for review'
  if (run.status === 'SUBMITTING') return 'Submission pending'
  if (run.status === 'SUBMITTED') return 'Submitted successfully'
  if (run.status === 'FAILED') return run.error?.toLowerCase().includes('not supported') ? 'Unsupported application' : 'Submission failed'
  return run.status.replaceAll('_', ' ')
}

export function liveStatusDetail(run: AutomationRun | null) {
  if (!run) return 'Paste a job link to open the application inside JobCopilot.'
  const strategy = runStrategy(run)
  const count = run.application?.fields?.length || 0
  const failure = submissionFailureCode(run)
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
  if (strategy === 'EMBED') return 'Official employer embed. This iframe is cross-origin, so JobCopilot cannot autofill or auto-submit it.'
  if (strategy === 'MANUAL_REQUIRED') return run.pause?.reason || 'This application needs a step JobCopilot cannot complete automatically.'
  if (count) return `${count} fields found. Review and complete your application before submitting.`
  return 'Extracting the application form…'
}

export function strategyHeadline(strategy: ApplicationStrategy | null) {
  if (strategy === 'EMBED') return 'Official embed'
  if (strategy === 'MANUAL_REQUIRED') return 'Manual action required'
  return 'Application form'
}
