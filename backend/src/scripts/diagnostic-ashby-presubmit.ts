#!/usr/bin/env node
/**
 * TEST-ONLY REAL ASHBY PRE-SUBMIT DIAGNOSTIC
 * 
 * This script exercises the real Ashby submission preparation path but stops
 * immediately before the final submit click.
 * 
 * Environment variables required:
 * - TEST_ASHBY_JOB_URL: Real Ashby job URL
 * - TEST_CANDIDATE_NAME: Candidate name
 * - TEST_CANDIDATE_EMAIL: Candidate email
 * - TEST_CANDIDATE_RESUME_PATH: Path to resume file
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from 'playwright-core'
import { db } from '../database.js'
import { automationManager } from '../automation/manager.js'
import { assistedSessionExists, cancelAssistedSession } from '../automation/application/assistedSession.js'
import { launchHeadlessAutomationBrowser, runWithBrowserPermit } from '../automation/browserLauncher.js'
import { detectAdapter } from '../automation/registry.js'
import { fillReviewedApplicationOnPage } from '../automation/application/submission.js'
import { detectManualBlocker } from '../automation/application/submissionConfirmation.js'
import { matchCanonicalField } from '../automation/application/matchCanonical.js'
import { uploadDir } from '../config.js'

// Configuration from environment
const config = {
  jobUrl: process.env.TEST_ASHBY_JOB_URL,
  candidateName: process.env.TEST_CANDIDATE_NAME,
  candidateEmail: process.env.TEST_CANDIDATE_EMAIL,
  resumePath: process.env.TEST_CANDIDATE_RESUME_PATH,
  phone: process.env.TEST_CANDIDATE_PHONE || '',
  linkedinUrl: process.env.TEST_CANDIDATE_LINKEDIN_URL || '',
  location: process.env.TEST_CANDIDATE_LOCATION || '',
}

let tempUserId: string | null = null
let tempResumeStorageName: string | null = null
let runId: string | null = null

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function error(message: string) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`)
}

function validateConfig() {
  if (!config.jobUrl) {
    error('TEST_ASHBY_JOB_URL environment variable is required')
    process.exit(1)
  }
  if (!config.candidateName) {
    error('TEST_CANDIDATE_NAME environment variable is required')
    process.exit(1)
  }
  if (!config.candidateEmail) {
    error('TEST_CANDIDATE_EMAIL environment variable is required')
    process.exit(1)
  }
  if (!config.resumePath) {
    error('TEST_CANDIDATE_RESUME_PATH environment variable is required')
    process.exit(1)
  }

  if (!existsSync(config.resumePath)) {
    error(`Resume file does not exist: ${config.resumePath}`)
    process.exit(1)
  }

  const resumeStats = statSync(config.resumePath)
  if (resumeStats.size === 0) {
    error(`Resume file is empty: ${config.resumePath}`)
    process.exit(1)
  }

  const resumeExt = config.resumePath.toLowerCase()
  if (!resumeExt.endsWith('.pdf') && !resumeExt.endsWith('.doc') && !resumeExt.endsWith('.docx')) {
    error(`Resume file must be PDF, DOC, or DOCX: ${config.resumePath}`)
    process.exit(1)
  }

  if (!config.jobUrl.includes('ashbyhq.com')) {
    error('Job URL must be an Ashby URL (jobs.ashbyhq.com)')
    process.exit(1)
  }

  log('Configuration validated successfully')
}

function createTestUser(): string {
  const userId = randomUUID()
  const now = new Date().toISOString()
  const uniqueEmail = `diagnostic-ashby-${userId}@campuspe.local`

  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, uniqueEmail, config.candidateName!, 'test_hash', 'test_salt', now)

  db.prepare(`INSERT INTO profiles (user_id,updated_at,phone,linkedin_url,location,current_city,current_state,current_country) VALUES (?,?,?,?,?,?,?,?)`)
    .run(userId, now, config.phone || '', config.linkedinUrl || '', config.location || '', (config.location || '').split(',')[0]?.trim() || '', '', (config.location || '').split(',').slice(1).join(',').trim() || '')

  const resumeExt = config.resumePath!.toLowerCase().endsWith('.pdf') ? '.pdf' : 
                    config.resumePath!.toLowerCase().endsWith('.docx') ? '.docx' : '.doc'
  const storageName = `${userId}${resumeExt}`
  const destPath = resolve(uploadDir, storageName)
  copyFileSync(config.resumePath!, destPath)

  const resumeMime = resumeExt === '.pdf' ? 'application/pdf' : 
                     resumeExt === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'
  db.prepare('UPDATE profiles SET resume_filename=?, resume_storage_name=?, resume_mime=?, updated_at=? WHERE user_id=?')
    .run('test-resume.pdf', storageName, resumeMime, now, userId)

  tempUserId = userId
  tempResumeStorageName = storageName

  log(`Created test user: ${userId}`)
  log(`Test email: ${uniqueEmail}`)
  log(`Resume copied to: ${destPath}`)

  return userId
}

function cleanup() {
  log('Starting cleanup...')

  if (runId && tempUserId) {
    if (assistedSessionExists(runId)) {
      try {
        cancelAssistedSession(tempUserId, runId)
        log('Cancelled assisted session')
      } catch (e) {
        error(`Failed to cancel assisted session: ${e}`)
      }
    }
  }

  if (tempUserId) {
    db.prepare('DELETE FROM automation_events WHERE run_id IN (SELECT id FROM automation_runs WHERE user_id=?)').run(tempUserId)
    db.prepare('DELETE FROM automation_runs WHERE user_id=?').run(tempUserId)
    log('Deleted automation runs')

    db.prepare('DELETE FROM sessions WHERE user_id=?').run(tempUserId)
    log('Deleted sessions')

    db.prepare('DELETE FROM profiles WHERE user_id=?').run(tempUserId)
    log('Deleted profile')

    db.prepare('DELETE FROM users WHERE id=?').run(tempUserId)
    log('Deleted user')
  }

  if (tempResumeStorageName) {
    const resumePath = resolve(uploadDir, tempResumeStorageName)
    if (existsSync(resumePath)) {
      try {
        unlinkSync(resumePath)
        log(`Deleted resume: ${resumePath}`)
      } catch (e) {
        error(`Failed to delete resume: ${e}`)
      }
    }
  }

  log('Cleanup complete')
}

async function waitForSettled(userId: string, runId: string, timeoutMs = 120000): Promise<any> {
  const startTime = Date.now()
  const settledStates = ['READY_FOR_REVIEW', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA', 'PAUSED_BY_USER', 'FAILED']
  let lastStatus = 'UNKNOWN'

  while (Date.now() - startTime < timeoutMs) {
    const run = automationManager.get(userId, runId)
    if (!run) {
      error(`Run not found: ${runId}`)
      return null
    }

    if (run.status !== lastStatus) {
      log(`Status transition: ${lastStatus} → ${run.status}`)
      lastStatus = run.status
    }

    if (settledStates.includes(run.status)) {
      log(`Settled in state: ${run.status}`)
      return run
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  error(`Timeout waiting for settled state (last status: ${lastStatus})`)
  return automationManager.get(userId, runId)
}

async function assertLiveFormReadyToSubmit(adapter: any, page: Page, fields: any[]) {
  const questions = await adapter.extractQuestions(page)
  for (const question of questions) {
    if (!question.required || question.answered) continue
    if (question.inputType === 'file' && /resume|\bcv\b/i.test(question.text)) continue
    const match = matchCanonicalField(question, fields)
    if (match.status === 'AMBIGUOUS') throw new Error(`Ambiguous field: ${question.text}`)
    const value = match.field?.value.trim() || ''
    if (!value) throw new Error(`Required field not answered: ${question.text}`)
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
      if (style.display === 'none' || style.visibility !== 'hidden') continue;
      var label = el.getAttribute('aria-label') || el.getAttribute('name') || el.id || 'Required field';
      return { valid: false, label: String(label) };
    }
    return { valid: true, label: '' };
  })()`) as { valid: boolean; label: string }
  if (!validity.valid) throw new Error(`Invalid form field: ${validity.label}`)
  if (!await adapter.isReviewReady(page)) {
    throw new Error('The live application is not ready to submit.')
  }
}

async function runPreSubmitDiagnostic(userId: string, runId: string, jobUrl: string, fields: any[]) {
  log('Starting pre-submit diagnostic...')

  const adapter = detectAdapter(jobUrl)
  if (!adapter) {
    error('Could not detect adapter')
    return false
  }

  log(`Adapter detected: ${adapter.id}`)

  let launched: Awaited<ReturnType<typeof launchHeadlessAutomationBrowser>>
  try {
    launched = await runWithBrowserPermit('submit', () => launchHeadlessAutomationBrowser())
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    error(`Failed to launch browser: ${errorMessage}`)
    return false
  }

  const { browser, context } = launched
  const page = await context.newPage()

  try {
    log('Opening real Ashby application...')
    await adapter.openApplication(page, jobUrl)
    await adapter.waitForApplication(page)
    log('Real Ashby live form opened: YES')

    log('Checking for initial blockers...')
    const initialBlocker = await detectManualBlocker(page, adapter)
    if (initialBlocker) {
      error(`Initial blocker detected: ${initialBlocker.type}`)
      return false
    }
    log('Initial blockers: NONE')

    log('Reapplying reviewed answers...')
    const filled = await fillReviewedApplicationOnPage({
      adapter,
      page,
      userId,
      jobUrl,
      fields,
    })

    if (!filled.ok) {
      error(`Failed to fill application: ${filled.code}`)
      if (filled.code === 'MANUAL_REQUIRED') {
        error(`Blocker: ${filled.blocker?.type} - ${filled.blocker?.message}`)
      }
      return false
    }
    log('Reviewed answers reapplied: YES')

    log('Checking for post-fill blockers...')
    const postFillBlocker = await detectManualBlocker(page, adapter)
    if (postFillBlocker) {
      error(`Post-fill blocker detected: ${postFillBlocker.type}`)
      return false
    }
    log('Post-fill blockers: NONE')

    log('Running pre-submit validation...')
    try {
      await assertLiveFormReadyToSubmit(adapter, page, fields)
      log('Pre-submit validation: PASS')
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      error(`Pre-submit validation: FAIL`)
      error(`Error: ${errorMessage}`)
      return false
    }

    log('Extracting live questions for detailed diagnostics...')
    const liveQuestions = await adapter.extractQuestions(page)
    log(`Number of live controls found: ${liveQuestions.length}`)

    log('\n--- Required Field Details ---')
    for (const question of liveQuestions) {
      if (!question.required) continue
      log(`\nLabel: ${question.text}`)
      log(`  Control type: ${question.inputType || 'text'}`)
      log(`  Answered: ${question.answered ? 'YES' : 'NO'}`)
    }

    const resumeField = liveQuestions.find((q: any) => q.inputType === 'file' && /resume|cv/i.test(q.text))
    log(`\n--- Resume Status ---`)
    log(`Resume file input found: ${resumeField ? 'YES' : 'NO'}`)
    if (resumeField) {
      log(`Resume uploaded: ${resumeField.answered ? 'YES' : 'NO'}`)
    }

    log('\n--- HTML5 Validity Check ---')
    const html5Valid = await page.evaluate(() => {
      const form = document.querySelector('form')
      if (!form) return { valid: true, invalidCount: 0 }
      const invalid = Array.from(form.querySelectorAll(':invalid'))
      const visibleInvalid = invalid.filter(el => {
        const style = window.getComputedStyle(el)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
      return { valid: visibleInvalid.length === 0, invalidCount: visibleInvalid.length }
    })
    log(`HTML5 validity: ${html5Valid.valid ? 'PASS' : 'FAIL'}`)
    if (!html5Valid.valid) {
      log(`Invalid controls: ${html5Valid.invalidCount}`)
    }

    log('Locating Submit Application button...')
    const submitButton = page.getByRole('button', { name: /submit application/i })
    const submitVisible = await submitButton.isVisible().catch(() => false)
    const submitEnabled = await submitButton.isEnabled().catch(() => false)

    log(`Submit button found: ${submitVisible ? 'YES' : 'NO'}`)
    log(`Submit button visible: ${submitVisible ? 'YES' : 'NO'}`)
    log(`Submit button enabled: ${submitEnabled ? 'YES' : 'NO'}`)

    if (!submitVisible) {
      error('Submit button not visible')
      return false
    }

    if (!submitEnabled) {
      error('Submit button not enabled')
      return false
    }

    log('Submit click attempted: NO (diagnostic mode)')
    log('REAL ASHBY PRE-SUBMIT: PASS')

    return true

  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    error(`Diagnostic error: ${errorMessage}`)
    return false
  } finally {
    await page.close().catch(() => undefined)
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
    log('Browser closed')
  }
}

async function main() {
  try {
    log('Starting real Ashby pre-submit diagnostic')
    validateConfig()

    const userId = createTestUser()
    log('Creating automation run...')

    const created = automationManager.create(userId, config.jobUrl!, false, true)
    if (!created) {
      error('Failed to create automation run')
      process.exit(1)
    }

    runId = created.id
    log(`Automation run created: ${runId}`)
    log(`Strategy: ${created.strategy}`)
    log(`Test mode: ${created.testMode}`)
    log(`Auto submit: ${created.autoSubmit}`)

    log('Waiting for READY_FOR_REVIEW...')
    const settled = await waitForSettled(userId, runId)

    if (!settled) {
      error('Run failed to settle')
      process.exit(1)
    }

    if (settled.status !== 'READY_FOR_REVIEW') {
      error(`Run did not reach READY_FOR_REVIEW. Status: ${settled.status}`)
      if (settled.pause) {
        error(`Pause reason: ${settled.pause.reason || settled.pause.instruction}`)
      }
      process.exit(1)
    }

    log('Preparation reached READY_FOR_REVIEW: YES')

    if (!settled.application?.fields) {
      error('No application fields available')
      process.exit(1)
    }

    log(`Fields available: ${settled.application.fields.length}`)

    const diagnosticPassed = await runPreSubmitDiagnostic(userId, runId, config.jobUrl!, settled.application.fields)

    if (!diagnosticPassed) {
      error('Pre-submit diagnostic failed')
      process.exit(1)
    }

    log('✓ Diagnostic PASSED')
    process.exit(0)

  } catch (err: any) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    error(`Fatal error: ${errorMessage}`)
    process.exit(1)
  } finally {
    cleanup()
  }
}

main()
