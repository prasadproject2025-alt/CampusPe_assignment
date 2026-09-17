export const SUBMISSION_FAILURE_CODES = [
  'ANSWER_REQUIRES_USER',
  'AMBIGUOUS_FIELD',
  'FIELD_NOT_FOUND',
  'MANUAL_REQUIRED',
  'SUBMISSION_TIMEOUT',
  'SUBMISSION_FAILED',
] as const

export type SubmissionFailureCode = typeof SUBMISSION_FAILURE_CODES[number]

export function parseSubmissionFailureCode(currentStep?: string | null, error?: string | null): SubmissionFailureCode | null {
  if (currentStep && SUBMISSION_FAILURE_CODES.includes(currentStep as SubmissionFailureCode)) {
    return currentStep as SubmissionFailureCode
  }
  const message = error || ''
  return SUBMISSION_FAILURE_CODES.find((code) => message.startsWith(`${code}:`) || message === code) || null
}

export function isEmployerSpamRejection(error?: string | null) {
  return /possible spam|flagged this submission as possible spam|submission was flagged/i.test(error || '')
}

export class FieldResolutionError extends Error {
  readonly code = 'FIELD_NOT_FOUND'
  readonly requiresManualAction = true

  constructor(
    readonly fieldKey: string,
    readonly label: string,
  ) {
    super(`FIELD_NOT_FOUND: “${label}” could not be resolved on the live form.`)
    this.name = 'FieldResolutionError'
  }
}

export class AmbiguousFieldError extends Error {
  readonly code = 'AMBIGUOUS_FIELD'
  readonly requiresManualAction = true

  constructor(
    readonly fieldKey: string,
    readonly label: string,
  ) {
    super(`AMBIGUOUS_FIELD: “${label}” matched more than one live control.`)
    this.name = 'AmbiguousFieldError'
  }
}

export class AnswerRequiresUserError extends Error {
  readonly code = 'ANSWER_REQUIRES_USER'
  readonly requiresManualAction = true

  constructor(readonly label: string, detail?: string) {
    super(detail || `ANSWER_REQUIRES_USER: “${label}” is still empty in the JobCopilot form.`)
    this.name = 'AnswerRequiresUserError'
  }
}

export class SubmissionTimeoutError extends Error {
  readonly code = 'SUBMISSION_TIMEOUT'

  constructor(message = 'Timed out waiting for the employer site to confirm the application was submitted.') {
    super(message)
    this.name = 'SubmissionTimeoutError'
  }
}

export class AtsRejectionError extends Error {
  readonly code = 'SUBMISSION_FAILED'

  constructor(message = 'SUBMISSION_FAILED: The employer could not accept the application. No successful submission was confirmed.') {
    super(message)
    this.name = 'AtsRejectionError'
  }
}

export class ManualRequiredError extends Error {
  readonly code = 'MANUAL_REQUIRED'

  constructor(readonly blocker: { type: 'LOGIN' | 'CAPTCHA'; message: string }) {
    super(blocker.message)
    this.name = 'ManualRequiredError'
  }
}
