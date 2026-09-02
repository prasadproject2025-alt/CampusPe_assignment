import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { browserDataDir, tailoredResumeDir, uploadDir } from '../config.js'
import { db } from '../database.js'
import { answerResolver } from '../resolver/engine.js'
import { canonicalJobUrl, detectAdapter } from './registry.js'
import type { ActiveRun, AdapterQuestion, AutomationStatus, EducationRecord, JobDetails } from './types.js'

type RunRow = { id: string; user_id: string; job_url: string; job_board: string; status: AutomationStatus; current_step: string; job_json: string | null; questions_json: string | null; pause_json: string | null; error_message: string | null; auto_submit: number; test_mode: number; created_at: string; updated_at: string }

const activeRuns = new Map<string, ActiveRun>()
const persistentBrowsers = new Map<string, { browser: Browser; context: BrowserContext }>()
const manualPauseRequests = new Set<string>()
const leverCdpEndpoint = process.env.LEVER_CDP_URL || 'http://127.0.0.1:9222'

export function automationBrowserKey(userId: string, board: string) { return `${board === 'lever' ? 'lever-cdp' : 'standard'}:${userId}` }

async function ensureLeverCdpBrowser() {
  const ready = async () => fetch(`${leverCdpEndpoint}/json/version`, { signal: AbortSignal.timeout(1_500) }).then((response) => response.ok).catch(() => false)
  if (!await ready()) {
    const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome')
    if (!existsSync(chromePath)) throw new Error('Google Chrome was not found. Set CHROME_PATH before starting JobCopilot.')
    const port = new URL(leverCdpEndpoint).port || '9222'
    spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${resolve(browserDataDir, 'lever-cdp')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: false, stdio: 'ignore' }).unref()
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && !await ready()) await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    if (!await ready()) throw new Error('The dedicated Lever Chrome browser did not open its local CDP connection.')
  }
  const browser = await chromium.connectOverCDP(leverCdpEndpoint)
  const context = browser.contexts()[0]
  if (!context) throw new Error('The Lever CDP browser did not expose its default Chrome context.')
  return { browser, context }
}

function event(runId: string, status: AutomationStatus, message: string, detail?: unknown) {
  db.prepare('INSERT INTO automation_events (id,run_id,status,message,detail_json,created_at) VALUES (?,?,?,?,?,?)').run(randomUUID(), runId, status, message, detail ? JSON.stringify(detail) : null, new Date().toISOString())
}

function update(runId: string, status: AutomationStatus, currentStep: string, values: { job?: JobDetails; questions?: AdapterQuestion[]; pause?: unknown; error?: string | null } = {}) {
  db.prepare(`UPDATE automation_runs SET status=?,current_step=?,job_json=COALESCE(?,job_json),questions_json=COALESCE(?,questions_json),pause_json=?,error_message=?,updated_at=? WHERE id=?`).run(status, currentStep, values.job ? JSON.stringify(values.job) : null, values.questions ? JSON.stringify(values.questions) : null, values.pause ? JSON.stringify(values.pause) : null, values.error ?? null, new Date().toISOString(), runId)
}

function serializeRun(row: RunRow) {
  return { id: row.id, jobUrl: row.job_url, jobBoard: row.job_board, status: row.status, currentStep: row.current_step, autoSubmit: Boolean(row.auto_submit), testMode: Boolean(row.test_mode), job: row.job_json ? JSON.parse(row.job_json) : null, questions: row.questions_json ? JSON.parse(row.questions_json) : [], pause: row.pause_json ? JSON.parse(row.pause_json) : null, error: row.error_message, createdAt: row.created_at, updatedAt: row.updated_at }
}

export class AutomationManager {
  create(userId: string, jobUrl: string, autoSubmit = false, testMode = false) {
    jobUrl = canonicalJobUrl(jobUrl)
    const adapter = detectAdapter(jobUrl)
    if (!adapter) throw new Error('This job board is not supported yet. Use an Ashby, Greenhouse, Rippling, Breezy, Lever, Workable, BambooHR, or Recruitee job link.')
    const id = randomUUID(); const now = new Date().toISOString()
    db.prepare('INSERT INTO automation_runs (id,user_id,job_url,job_board,status,current_step,auto_submit,test_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, userId, jobUrl, adapter.id, 'QUEUED', 'QUEUED', testMode ? 0 : autoSubmit ? 1 : 0, testMode ? 1 : 0, now, now)
    event(id, 'QUEUED', 'Application run created.')
    queueMicrotask(() => void this.process(id, userId))
    return this.get(userId, id)
  }

  get(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) return null
    const events = db.prepare('SELECT status,message,detail_json,created_at FROM automation_events WHERE run_id=? ORDER BY created_at').all(runId) as Array<{ status: string; message: string; detail_json: string | null; created_at: string }>
    return { ...serializeRun(row), browserActive: activeRuns.has(runId), events: events.map((item) => ({ status: item.status, message: item.message, detail: item.detail_json ? JSON.parse(item.detail_json) : null, createdAt: item.created_at })) }
  }

  list(userId: string) { return (db.prepare('SELECT * FROM automation_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(userId) as unknown as RunRow[]).map(serializeRun) }

  pauseRun(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    if (!activeRuns.has(runId)) throw new Error('The browser session is no longer active.')
    if (['READY_FOR_REVIEW', 'SUBMITTING', 'SUBMITTED', 'FAILED'].includes(row.status)) throw new Error('This run cannot be paused at its current stage.')
    if (row.status.startsWith('PAUSED_')) return this.get(userId, runId)
    manualPauseRequests.add(runId)
    const pause = { reason: 'Automation paused by you.', instruction: 'Click Continue automation when you are ready.' }
    update(runId, 'PAUSED_BY_USER', 'WAITING_FOR_USER', { pause })
    event(runId, 'PAUSED_BY_USER', 'Automation paused by the user.')
    return this.get(userId, runId)
  }

  async resume(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    if (!activeRuns.has(runId)) throw new Error('The browser session is no longer active. Start a new run from the job link.')
    if (!row.status.startsWith('PAUSED_')) throw new Error('This run is not waiting for manual input.')
    manualPauseRequests.delete(runId)
    if (row.current_step === 'WAITING_FOR_SUBMIT_CAPTCHA') {
      event(runId, 'SUBMITTING', 'User completed the submission CAPTCHA. Retrying the approved submission in the existing browser.')
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW')
      queueMicrotask(() => void this.submit(userId, runId))
      return this.get(userId, runId)
    }
    event(runId, 'FILLING_APPLICATION', 'User continued the automation in the existing browser session. Completed fields will be skipped.')
    update(runId, 'FILLING_APPLICATION', 'RESUMING')
    queueMicrotask(() => void this.process(runId, userId))
    return this.get(userId, runId)
  }

  async submit(userId: string, runId: string) {
    const row = db.prepare('SELECT * FROM automation_runs WHERE id=? AND user_id=?').get(runId, userId) as RunRow | undefined
    if (!row) throw new Error('Application run not found.')
    const active = activeRuns.get(runId)
    if (!active) throw new Error('The browser session is no longer active. Start a new run from the job link.')
    if (row.test_mode) throw new Error('Testing mode never submits applications. Start a normal run when you are ready to apply.')
    if (row.status !== 'READY_FOR_REVIEW') throw new Error('This application is not ready to submit yet.')
    const adapter = detectAdapter(row.job_url)
    if (!adapter) throw new Error('The job-board adapter is unavailable.')

    update(runId, 'SUBMITTING', 'SUBMITTING_APPLICATION')
    event(runId, 'SUBMITTING', row.auto_submit ? 'Auto-submit mode started the approved automatic submission.' : 'Submission approved by the user.')
    try {
      await adapter.submitApplication(active.page)
      update(runId, 'SUBMITTED', 'APPLICATION_SUBMITTED')
      event(runId, 'SUBMITTED', `${this.boardName(adapter.id)} confirmed that the application was submitted.`)
    } catch (error) {
      const blocker = await adapter.detectBlocker(active.page)
      if (blocker) {
        this.pauseForBlocker(runId, blocker.type === 'CAPTCHA' ? 'PAUSED_CAPTCHA' : 'PAUSED_LOGIN', blocker.message, 'WAITING_FOR_SUBMIT_CAPTCHA')
        return this.get(userId, runId)
      }
      const message = error instanceof Error ? error.message : 'The job board did not confirm submission.'
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', { error: message })
      event(runId, 'READY_FOR_REVIEW', message)
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
      if (!active) {
        update(runId, 'OPENING_JOB', 'LAUNCHING_BROWSER'); event(runId, 'OPENING_JOB', 'Opening a visible Chrome window.')
        const browserKey = automationBrowserKey(userId, adapter.id)
        let persistent = persistentBrowsers.get(browserKey)
        if (!persistent?.browser.isConnected()) {
          let browser: Browser; let context: BrowserContext
          if (adapter.id === 'lever') {
            ({ browser, context } = await ensureLeverCdpBrowser())
            event(runId, 'OPENING_JOB', 'Connected to the dedicated Lever Chrome session over local CDP.')
          } else {
            try {
              context = await chromium.launchPersistentContext(resolve(browserDataDir, userId), { channel: 'chrome', headless: false, viewport: null })
            } catch (error) {
              const message = error instanceof Error ? error.message : ''
              if (!/existing browser session|profile.*(?:in use|locked)|process singleton/i.test(message)) throw error
              const fallbackProfile = resolve(browserDataDir, `${userId}-${runId}`)
              event(runId, 'OPENING_JOB', 'The saved Chrome profile is already open. Using an isolated browser session for this run.')
              context = await chromium.launchPersistentContext(fallbackProfile, { channel: 'chrome', headless: false, viewport: null })
            }
            const launchedBrowser = context.browser()
            if (!launchedBrowser) throw new Error('Chrome did not expose a persistent browser session.')
            browser = launchedBrowser
          }
          persistent = { browser, context }
          persistentBrowsers.set(browserKey, persistent)
          browser.on('disconnected', () => {
            persistentBrowsers.delete(browserKey)
            for (const [activeRunId, activeRun] of activeRuns) {
              if (activeRun.browser !== browser) continue
              activeRuns.delete(activeRunId)
              const current = db.prepare('SELECT status FROM automation_runs WHERE id=?').get(activeRunId) as { status: AutomationStatus } | undefined
              if (current && !['READY_FOR_REVIEW', 'SUBMITTED', 'FAILED'].includes(current.status)) {
                update(activeRunId, 'FAILED', 'BROWSER_CLOSED', { error: 'The automation browser was closed. Start a new run to continue.' })
                event(activeRunId, 'FAILED', 'The automation browser was closed before review.')
              }
            }
          })
        }
        const { browser, context } = persistent
        const initialPage = context.pages().find((candidate) => candidate.url() === 'about:blank')
        const page = initialPage ?? await context.newPage()
        active = { browser, context, page, processing: false }; activeRuns.set(runId, active)
        await adapter.openApplication(page, row.job_url)
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
      const job = await adapter.extractJob(active.page, row.job_url)
      let questions = await adapter.extractQuestions(active.page)
      if (stopForManualPause()) return
      update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job, questions }); event(runId, 'FILLING_APPLICATION', `Found ${questions.length} application fields.`, { questionCount: questions.length })

      const savedResume = db.prepare('SELECT resume_storage_name,resume_filename,resume_mime FROM profiles WHERE user_id=?').get(userId) as { resume_storage_name: string | null; resume_filename: string | null; resume_mime: string | null } | undefined
      const tailored = db.prepare("SELECT storage_name,job_title FROM resume_optimizations WHERE user_id=? AND job_url=? AND status='APPROVED' AND storage_name IS NOT NULL ORDER BY approved_at DESC LIMIT 1").get(userId, row.job_url) as { storage_name: string; job_title: string } | undefined
      const tailoredPath = tailored?.storage_name ? resolve(tailoredResumeDir, tailored.storage_name) : ''
      const resume = tailoredPath.startsWith(`${tailoredResumeDir}/`) && existsSync(tailoredPath)
        ? { resume_storage_name: tailored!.storage_name, resume_filename: `Tailored Resume - ${tailored!.job_title}.docx`, resume_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tailored: true }
        : savedResume ? { ...savedResume, tailored: false } : undefined
      const profileEducation = db.prepare('SELECT education_json FROM profiles WHERE user_id=?').get(userId) as { education_json: string } | undefined
      let resumeProcessed = false
      for (let questionIndex = 0; questionIndex < questions.length; questionIndex += 1) {
        if (stopForManualPause()) return
        const question = questions[questionIndex]!
        if (question.answered) continue
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
            update(runId, 'FILLING_APPLICATION', 'RESOLVING_QUESTIONS', { job, questions })
            event(runId, 'FILLING_APPLICATION', `Read ${options.length} choices for “${question.text}”.`, { options })
          }
        }
        if (stopForManualPause()) return
        event(runId, 'FILLING_APPLICATION', `Inspecting “${question.text}”.`, { fieldType: question.fieldType, inputType: question.inputType, required: question.required })
        if (question.inputType === 'file' && question.id === '_systemfield_resume') {
          if (resume?.resume_storage_name) {
            const resumePath = resume.tailored ? resolve(tailoredResumeDir, resume.resume_storage_name) : resolve(uploadDir, resume.resume_storage_name)
            const expectedRoot = resume.tailored ? tailoredResumeDir : uploadDir
            if (resumePath.startsWith(expectedRoot) && existsSync(resumePath)) {
              await adapter.uploadResume(active.page, { name: basename(resume.resume_filename || 'resume.pdf'), mimeType: resume.resume_mime || 'application/pdf', buffer: readFileSync(resumePath) })
              resumeProcessed = true
              event(runId, 'FILLING_APPLICATION', 'Waiting for résumé parsing to finish before filling the form.')
              if (adapter.waitForResumeParsing) await adapter.waitForResumeParsing(active.page)
              else await this.waitForResumeParsing(active.page)
              if (stopForManualPause()) return
              await this.waitForFormStability(active.page)
              if (await stopForBlocker()) return
              event(runId, 'FILLING_APPLICATION', resume.tailored ? 'Attached the approved job-specific resume.' : 'Attached the saved resume.', { filename: resume.resume_filename })
              questions = await adapter.extractQuestions(active.page)
              update(runId, 'FILLING_APPLICATION', 'RESOLVING_REMAINING_QUESTIONS', { job, questions })
              event(runId, 'FILLING_APPLICATION', 'Résumé parsing finished. Refreshed the form and will fill only the remaining empty fields.', { remainingCount: questions.filter((item) => !item.answered && item.id !== '_systemfield_resume').length })
              questionIndex = -1
              continue
            }
          }
          if (question.required) return this.pause(runId, question, 'A saved resume is required for this application.')
          continue
        }
        if (question.inputType === 'file') {
          const isCoverLetter = /cover.?letter/i.test(`${question.id} ${question.text}`)
          if (!question.required) {
            event(runId, 'FILLING_APPLICATION', `Skipped optional file field “${question.text}”.`, { fieldId: question.id })
            continue
          }
          if (isCoverLetter && resume?.resume_storage_name) {
            const resumePath = resume.tailored ? resolve(tailoredResumeDir, resume.resume_storage_name) : resolve(uploadDir, resume.resume_storage_name)
            const expectedRoot = resume.tailored ? tailoredResumeDir : uploadDir
            if (resumePath.startsWith(expectedRoot) && existsSync(resumePath)) {
              await adapter.uploadFile(active.page, question, { name: basename(resume.resume_filename || 'resume.pdf'), mimeType: resume.resume_mime || 'application/pdf', buffer: readFileSync(resumePath) })
              await active.page.waitForTimeout(700)
              if (await stopForBlocker()) return
              event(runId, 'FILLING_APPLICATION', 'Attached the saved resume to the required cover-letter upload.', { filename: resume.resume_filename })
              continue
            }
          }
          return this.pause(runId, question, isCoverLetter ? 'A saved resume is required for this mandatory cover-letter upload.' : `“${question.text}” requires a file.`)
        }
        if (question.locator.kind === 'education') {
          try {
            const education = JSON.parse(profileEducation?.education_json || '[]') as EducationRecord[]
            await adapter.fillEducation(active.page, education)
            if (await stopForBlocker()) return
            event(runId, 'FILLING_APPLICATION', 'Filled education history from your profile.', { count: education.length })
          } catch (error) {
            return this.pause(runId, question, error instanceof Error ? error.message : 'Complete the education section in the visible browser.')
          }
          continue
        }
        const resolution = await answerResolver.resolve(userId, question, job, { testMode: Boolean(row.test_mode) })
        if (stopForManualPause()) return
        if (resolution.status === 'RESOLVED') {
          try { await adapter.fillAnswer(active.page, question, resolution.answer) }
          catch {
            if (await stopForBlocker()) return
            return this.pause(runId, question, 'JobCopilot could not complete this control reliably. Check or complete it in the visible browser.')
          }
          if (stopForManualPause()) return
          if (await stopForBlocker()) return
          event(runId, 'FILLING_APPLICATION', `Filled “${question.text}” from ${resolution.source}.`, { source: resolution.source, confidence: resolution.confidence, requiresReview: resolution.requiresReview })
          if (this.isChoiceControl(question)) {
            const refreshed = await adapter.extractQuestions(active.page)
            const knownIds = new Set(questions.map((item) => item.id))
            const revealed = refreshed.filter((item) => !knownIds.has(item.id))
            if (revealed.length) {
              questions = refreshed
              update(runId, 'FILLING_APPLICATION', 'RESOLVING_REVEALED_QUESTIONS', { job, questions })
              event(runId, 'FILLING_APPLICATION', `Found ${revealed.length} additional field${revealed.length === 1 ? '' : 's'} revealed by “${question.text}”.`, { fields: revealed.map((item) => item.text) })
              questionIndex = -1
            }
          }
          continue
        }
        if (question.required) return this.pause(runId, question, resolution.reason)
        event(runId, 'FILLING_APPLICATION', `Skipped optional field “${question.text}”.`, { reason: resolution.reason })
      }
      if (stopForManualPause()) return
      if (await stopForBlocker()) return
      if (!await adapter.isReviewReady(active.page)) throw new Error('The application form did not reach the review boundary.')
      update(runId, 'READY_FOR_REVIEW', 'AWAITING_FINAL_REVIEW', { job, questions: await adapter.extractQuestions(active.page) })
      event(runId, 'READY_FOR_REVIEW', row.test_mode ? 'Testing complete. The form was filled for inspection and submission is disabled.' : row.auto_submit ? 'Application is filled and passed the pre-submission checks.' : 'Application is filled and ready for your review and submission approval.')
      if (row.auto_submit) {
        event(runId, 'READY_FOR_REVIEW', 'Auto-submit mode is enabled. Submitting the completed application now.')
        queueMicrotask(() => void this.submit(userId, runId))
      }
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
      if (failedRun) await failedRun.page.close().catch(() => undefined)
    } finally {
      const current = activeRuns.get(runId)
      if (current) current.processing = false
    }
  }

  private pause(runId: string, question: AdapterQuestion, reason: string) {
    const pause = { question, reason, instruction: 'Complete this field in the visible browser, then click Continue automation.' }
    update(runId, 'PAUSED_NEEDS_INPUT', 'WAITING_FOR_USER', { pause }); event(runId, 'PAUSED_NEEDS_INPUT', `Waiting for “${question.text}”.`, pause)
  }

  private pauseForBlocker(runId: string, status: 'PAUSED_LOGIN' | 'PAUSED_CAPTCHA', message: string, currentStep = 'WAITING_FOR_USER') {
    const pause = { reason: message, instruction: 'Complete the step in the visible browser, then click Continue automation.' }
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

  private async waitForFormStability(page: Page) {
    await page.waitForTimeout(1_200)
    const fields = page.locator('form input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]), form textarea, form select')
    let previous = ''; let stableSamples = 0
    const stabilizationDeadline = Date.now() + 15_000
    while (Date.now() < stabilizationDeadline && stableSamples < 3) {
      const snapshot = JSON.stringify(await fields.evaluateAll((controls) => controls.map((control) => (control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value)))
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
