import { type ReactNode } from 'react'
import { ArrowRight, Pause, ShieldCheck, MonitorPlay, X } from 'lucide-react'
import { ApplicationForm } from './ApplicationForm'
import { ApplicationLoading, ApplicationEmpty } from './ApplicationLoading'
import { ApplicationReview } from './ApplicationReview'
import { ApplicationStatus } from './ApplicationStatus'
import { BrowserApplicationPreview } from './BrowserApplicationPreview'
import { EmbeddedApplication } from './EmbeddedApplication'
import { assistedStatusLabel, isEmployerSpamRejection, liveStatusDetail, liveStatusLabel, strategyHeadline, submissionFailureCode } from './statusCopy'
import type { AutomationRun } from './types'
import { runStrategy } from './types'

function readiness(run: AutomationRun) {
  const fields = (run.application?.fields || []).filter((field) => !field.isHidden)
  const filled = fields.filter((field) => field.value.trim() && field.status !== 'unresolved' && field.status !== 'empty').length
  const llm = fields.filter((field) => field.source === 'L3_LLM' && field.status === 'suggested').length
  const required = fields.filter((field) => field.status === 'unresolved').length
  const profile = fields.filter((field) => field.source === 'L1_PROFILE' || field.source === 'L1_RESUME').length
  return { total: fields.length, filled, llm, required, profile }
}

export function LiveApplication({
  run,
  loading,
  onContinue,
  onPause,
  onUpdateAnswers,
  onAssisted,
  onCancelAssisted,
  onSubmitAssisted,
  onSubmit,
}: {
  run: AutomationRun | null
  loading: boolean
  onContinue: () => void
  onPause: () => void
  onUpdateAnswers: (fields: Array<{ id: string; value: string }>) => void
  onAssisted: () => void
  onCancelAssisted: () => void
  onSubmitAssisted: () => void
  onSubmit?: () => void
}) {
  const strategy = runStrategy(run)
  const queueAnswers = onUpdateAnswers

  const assisted = run?.assistedSession
  const assistedActive = Boolean(assisted && !['SUBMITTED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(assisted.status))
  const failureCode = submissionFailureCode(run)
  const manualRequired = Boolean(
    assisted?.status === 'MANUAL_REQUIRED'
    || run?.status === 'PAUSED_CAPTCHA'
    || run?.status === 'PAUSED_LOGIN'
    || strategy === 'MANUAL_REQUIRED'
    || failureCode === 'MANUAL_REQUIRED',
  )
  const editable = Boolean(run && (run.status.startsWith('PAUSED_') || run.status === 'READY_FOR_REVIEW' || run.status === 'FILLING_APPLICATION') && !assistedActive)
  const fieldCount = run?.application?.fields?.length || 0
  const requiredCount = run?.application?.fields?.filter((field) => field.required).length || 0
  const loadingForm = Boolean(run && ['QUEUED', 'OPENING_JOB', 'EXTRACTING_JOB', 'FILLING_APPLICATION'].includes(run.status) && !fieldCount && !assistedActive)
  const stats = run ? readiness(run) : null
  const canStartAssisted = Boolean(run && !run.testMode && !assistedActive && !isEmployerSpamRejection(run.error || run.pause?.reason) && ['READY_FOR_REVIEW', 'PAUSED_BY_USER', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA'].includes(run.status))
  const showReady = Boolean(run?.status === 'READY_FOR_REVIEW' && !assistedActive && !failureCode && !run.error)
  const spamBlocked = isEmployerSpamRejection(run?.error || run?.pause?.reason)

  let body: ReactNode
  if (!run) body = <ApplicationEmpty />
  else if (run.status === 'FAILED' && !assistedActive) body = <div className="live-browser-empty light"><ShieldCheck /><p>{run.error || 'This application could not be opened inside JobCopilot.'}</p></div>
  else if (assistedActive) body = <BrowserApplicationPreview run={run} />
  else if (strategy === 'EMBED' && run.application?.embedUrl) body = <EmbeddedApplication application={run.application} />
  else if (loadingForm) body = <ApplicationLoading message="Extracting application fields…" />
  else body = <ApplicationForm run={run} disabled={!editable} onUpdateAnswers={queueAnswers} />

  return (
    <div className="live-application-shell">
      <aside className={`live-browser ${assistedActive ? 'interactive' : 'form-mode'}`}>
        <header>
          <span>
            <b>{assistedActive ? 'Assisted browser' : strategyHeadline(strategy)}</b>
            <small>{liveStatusDetail(run)}</small>
            {fieldCount > 0 && !assistedActive && (
              <ApplicationStatus
                fieldCount={fieldCount}
                requiredCount={requiredCount}
                filledCount={stats?.profile}
                llmCount={stats?.llm}
                userRequiredCount={stats?.required}
              />
            )}
            {assisted && (
              <em className="assisted-status-chip" data-status={assisted.status}>{assistedStatusLabel(assisted.status)}</em>
            )}
          </span>
          {run && <em>{liveStatusLabel(run)}</em>}
        </header>
        <div className={`live-browser-viewport ${assistedActive ? '' : 'form-viewport'}`}>{body}</div>
      </aside>
      <aside className="automation-side-panel">
        {!run ? (
          <div className="automation-side-empty"><ShieldCheck /><b>Ready when you are</b><p>Start an application to fill it here. AI suggestions and continue/submit controls appear in this column.</p></div>
        ) : (
          <div className={`automation-run ${run.status.toLowerCase()}`} role="status">
            <div className="automation-run-heading">
              <span><b>{run.job?.jobTitle || run.application?.title || 'Job application'}</b><small>{run.job?.company || run.application?.company || run.currentStep.replaceAll('_', ' ')}</small></span>
              <div className="automation-run-heading-actions">
                <em>{liveStatusLabel(run)}</em>
                {['QUEUED', 'OPENING_JOB', 'EXTRACTING_JOB', 'FILLING_APPLICATION'].includes(run.status) && !assistedActive && (
                  <button className="automation-pause-button" type="button" disabled={loading} onClick={onPause}><Pause /> Pause</button>
                )}
              </div>
            </div>
            {stats && stats.total > 0 && (
              <ul className="application-readiness">
                <li>✓ {stats.total} fields discovered</li>
                <li>✓ {stats.profile} answered from profile/resume</li>
                <li>✓ {stats.filled} filled in the review form</li>
                {stats.llm > 0 && <li>⚠ {stats.llm} AI suggestions</li>}
                {stats.required > 0 && <li>⚠ {stats.required} require your input</li>}
              </ul>
            )}
            {manualRequired && (
              <div className="automation-pause assisted-manual">
                <strong>Manual action required</strong>
                <p>{assisted?.reason || run.pause?.reason || 'Complete the CAPTCHA in the assisted browser. JobCopilot will continue monitoring the application.'}</p>
                <small>{run.pause?.instruction || 'JobCopilot will not bypass CAPTCHA, login, or anti-bot protection.'}</small>
                {canStartAssisted && (
                  <button className="button primary" disabled={loading} onClick={onAssisted}><MonitorPlay /> Continue in assisted browser</button>
                )}
              </div>
            )}
            {run.pause && !manualRequired && !assistedActive && !failureCode && (
              <div className="automation-pause">
                <strong>{run.pause.question?.text || (run.status === 'PAUSED_BY_USER' ? 'Automation paused' : 'Your action is needed')}</strong>
                <p>{run.pause.reason}</p>
                <small>{run.pause.instruction}</small>
                <button className="button primary" disabled={loading} onClick={onContinue}>Continue <ArrowRight /></button>
              </div>
            )}
            {failureCode && !assistedActive && !manualRequired && (
              <div className="automation-pause assisted-manual">
                <strong>{failureCode}</strong>
                <p>{spamBlocked ? 'The employer rejected this submission as possible spam. Automatic retries are disabled.' : run?.error || run?.pause?.reason}</p>
                <small>{spamBlocked
                  ? 'No successful submission was confirmed. The employer did not disclose why it rejected the application. Check the employer’s application guidance before taking further action.'
                  : (run?.pause?.instruction || 'Backend status is the source of truth. JobCopilot will not invent an answer or claim success without ATS confirmation.')}</small>
                {canStartAssisted && (
                  <button className="button primary" disabled={loading} onClick={onAssisted}><MonitorPlay /> Continue in assisted browser</button>
                )}
              </div>
            )}
            {showReady && (
              <div className="automation-ready">
                <ShieldCheck />
                <div>
                  <strong>Ready for submission</strong>
                  <ApplicationReview message={run.testMode ? 'Testing mode never submits.' : 'Your answers are filled and verified. Submit automatically or review the live form in the assisted browser.'} />
                  {strategy !== 'EMBED' && !run.testMode && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                      <button className="button primary full" disabled={loading} onClick={onSubmit}>
                        {loading ? 'Submitting…' : 'Submit Application'} <ArrowRight size={16} />
                      </button>
                      <button className="button secondary assisted-browser-button full" disabled={loading} onClick={onAssisted}>
                        <MonitorPlay size={16} /> Review in assisted browser
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {assistedActive && (
              <div className="automation-ready">
                <MonitorPlay />
                <div>
                  <strong>{assistedStatusLabel(assisted?.status)}</strong>
                  <p>{assisted?.reason}</p>
                  {['WAITING_FOR_USER', 'USER_REVIEWING', 'MANUAL_REQUIRED'].includes(assisted?.status || '') && !/SUBMISSION_TIMEOUT/.test(assisted?.reason || '') && <button className="button primary" disabled={loading} onClick={onSubmitAssisted}>{loading ? 'Checking form…' : 'Submit application'}</button>}
                  <button className="button secondary" disabled={loading} onClick={onCancelAssisted}><X /> Cancel session</button>
                </div>
              </div>
            )}
            {run.status === 'SUBMITTING' && !assistedActive && <div className="automation-ready"><ShieldCheck /><div><strong>Submission pending</strong><p>The backend is sending your answers. Keep this page open.</p></div></div>}
            {run.status === 'SUBMITTED' && <div className="automation-ready automation-submitted"><ShieldCheck /><div><strong>Submitted successfully</strong><p>The job board confirmed your application was received.</p></div></div>}
            {run.status === 'FAILED' && <p className="automation-error">{run.error}</p>}
            {run.events?.length ? <ul className="automation-event-list">{run.events.slice(-4).reverse().map((item, index) => <li key={`${item.createdAt}-${index}`}>{item.message}</li>)}</ul> : null}
          </div>
        )}
      </aside>
    </div>
  )
}
