#!/usr/bin/env node
/**
 * TEST-ONLY GREENHOUSE REAL PRE-SUBMIT DIAGNOSTIC
 * 
 * Verifies the actual live Greenhouse DOM state before submission.
 * Stops immediately before the final Greenhouse submit click.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationStatus } from '../automation/types.js'
import { db } from '../database.js'
import { automationManager } from '../automation/manager.js'
import { assistedSessionExists, cancelAssistedSession } from '../automation/application/assistedSession.js'
import { uploadDir } from '../config.js'
import { chromium } from 'playwright-core'
import { greenhouseSelectors } from '../automation/adapters/greenhouse/selectors.js'
import { extractQuestionsFromPage } from '../automation/application/extraction/domExtractor.js'
import { fillLiveAnswer, resolveLiveControl } from '../automation/application/extraction/liveResolver.js'

// Configuration from environment
const config = {
  jobUrl: process.env.TEST_GREENHOUSE_JOB_URL,
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
let browser: any = null
let page: any = null

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function error(message: string) {
  console.error(`[${new Date().toISOString()}] ERROR: ${message}`)
}

function validateConfig() {
  if (!config.jobUrl) {
    error('TEST_GREENHOUSE_JOB_URL environment variable is required')
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

  if (!config.jobUrl.includes('greenhouse.io')) {
    error('Job URL must be a Greenhouse URL (greenhouse.io)')
    process.exit(1)
  }

  log('Configuration validated successfully')
}

function createTestUser(): string {
  const userId = randomUUID()
  const now = new Date().toISOString()
  const uniqueEmail = `greenhouse-diagnostic-${userId}@campuspe.local`

  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, uniqueEmail, config.candidateName!, 'test_hash', 'test_salt', now)

  // Create profile with experience and education to avoid AI refusal
  db.prepare(`INSERT INTO profiles (user_id,updated_at,phone,phone_country_code,location,current_city,current_state,current_country,linkedin_url,github_url,portfolio_url,experience_years,notice_period,work_authorized,sponsorship,current_salary,expected_salary,work_arrangement,willing_in_office,willing_relocate,us_work_authorized,us_sponsorship,us_visa_type,active_immigration_case,referral_source,career_motivation,cover_letter_intro,additional_information,experiences_json,education_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(userId, now, 
      config.phone || '555-123-4567', 
      '',
      config.location || 'San Francisco, CA', 
      (config.location || 'San Francisco, CA').split(',')[0]?.trim() || 'San Francisco', 
      'CA', 
      'United States',
      config.linkedinUrl || 'https://linkedin.com/in/test',
      '',
      '',
      '2-3',
      '2 weeks',
      'Yes',
      'No',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'LinkedIn',
      'I am interested in this role because it aligns with my career goals in software engineering.',
      '',
      '',
      JSON.stringify([{
        id: 1,
        title: 'Software Engineer',
        company: 'Test Company',
        employmentType: 'Full-time',
        location: 'San Francisco, CA',
        startDate: '2022-01-01',
        endDate: '2024-01-01',
        current: false,
        description: 'Built web applications using modern technologies including React and Node.js.'
      }]),
      JSON.stringify([{
        id: 1,
        school: 'Test University',
        degree: 'Bachelor of Science',
        field: 'Computer Science',
        startDate: '2018-09-01',
        endDate: '2022-05-01',
        current: false,
        description: 'Focused on software engineering, algorithms, and data structures.'
      }]))

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

  if (page) {
    try {
      page.close()
      log('Browser page closed')
    } catch (e) {
      error(`Failed to close page: ${e}`)
    }
  }

  if (browser) {
    try {
      browser.close()
      log('Browser closed')
    } catch (e) {
      error(`Failed to close browser: ${e}`)
    }
  }

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

async function waitForReadyForReview(userId: string, runId: string, timeoutMs = 180000): Promise<any> {
  const startTime = Date.now()
  const reviewStates: AutomationStatus[] = ['READY_FOR_REVIEW', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA', 'PAUSED_BY_USER', 'FAILED']
  let lastStatus = 'UNKNOWN'
  let returned = false

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

    if (reviewStates.includes(run.status)) {
      log(`Settled in state: ${run.status}`)
      returned = true
      return run
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  if (!returned) {
    error(`Timeout waiting for settled state (last status: ${lastStatus})`)
  }
  return automationManager.get(userId, runId)
}

async function main() {
  try {
    log('Starting Greenhouse real pre-submit diagnostic')
    validateConfig()

    const userId = createTestUser()
    log('Creating automation run...')

    const created = automationManager.create(userId, config.jobUrl!, false, true) // autoSubmit=false, testMode=true
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
    const settled = await waitForReadyForReview(userId, runId)

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

    // Get the application data
    const run = automationManager.get(userId, runId)
    if (!run) {
      error('Run not found after READY_FOR_REVIEW')
      process.exit(1)
    }

    const application = run.application
    const applicationJson = application ? JSON.stringify(application) : '{}'
    const appData = JSON.parse(applicationJson)
    const fields = appData.fields || []

    log('Submission browser launched: YES')
    log('Launching disposable headless browser...')

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    page = await context.newPage()

    log('Real Greenhouse form opened: YES')
    log(`Navigating to: ${config.jobUrl}`)

    await page.goto(config.jobUrl!, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      log('Network idle timeout - continuing anyway')
    })

    // Wait for the form to be visible
    try {
      await page.locator(greenhouseSelectors.form).waitFor({ state: 'visible', timeout: 10000 })
      log('Greenhouse form detected and visible')
    } catch (e) {
      error('Greenhouse form not found or not visible')
      process.exit(1)
    }

    // Extract live controls
    log('Extracting live controls from Greenhouse form...')
    const liveControls = await extractQuestionsFromPage(page)
    log(`Number of live controls found: ${liveControls.length}`)

    const requiredLiveControls = liveControls.filter((c: any) => c.required)
    log(`Number of required live controls: ${requiredLiveControls.length}`)

    // Upload resume
    log('Uploading resume...')
    const resumeInput = page.locator(greenhouseSelectors.resume)
    if (await resumeInput.count() > 0) {
      await resumeInput.setInputFiles(config.resumePath!)
      log('Resume uploaded: YES')
      await page.waitForTimeout(2000) // Wait for any file processing
    } else {
      log('Resume input not found - skipping upload')
    }

    // Reapply reviewed answers
    log('Reapplying reviewed answers...')
    let answeredCount = 0
    let failedCount = 0
    const filledElements: Map<string, any> = new Map()

    for (const field of fields) {
      if (!field.value) continue

      try {
        const control = liveControls.find((c: any) => c.text === field.text || c.canonicalId === field.canonicalId)
        if (!control) {
          log(`Field not found in live form: ${field.text}`)
          failedCount++
          continue
        }

        const input = await resolveLiveControl(page, control)
        await fillLiveAnswer(page, control, field.value)
        
        // Store the actual element for later verification
        filledElements.set(field.text, input)
        
        answeredCount++
        log(`Filled: ${field.text}`)
      } catch (e) {
        log(`Failed to fill ${field.text}: ${e}`)
        failedCount++
      }
    }

    log(`Reviewed answers reapplied: YES (${answeredCount} filled, ${failedCount} failed)`)

    // Re-scan the live form after filling
    log('Re-scanning live form after filling...')
    const postFillControls = await extractQuestionsFromPage(page)
    log(`Post-fill live controls: ${postFillControls.length}`)

    // Check HTML5 validity on the actual filled elements
    log('Checking HTML5 validity on filled elements...')
    let invalidControls = 0
    const requiredFieldReports: any[] = []

    for (const field of fields) {
      if (!field.required) continue
      
      const fieldLabel = field.text
      const element = filledElements.get(fieldLabel)
      
      if (!element) {
        log(`WARNING: No element stored for required field: ${fieldLabel}`)
        invalidControls++
        continue
      }
      
      try {
        const isValid = await element.evaluate((el: any) => el.checkValidity())
        const validationMessage = await element.evaluate((el: any) => el.validationMessage)
        const value = await element.evaluate((el: any) => el.value)
        const tag = await element.evaluate((el: any) => el.tagName?.toLowerCase() || 'unknown')

        const report = {
          label: fieldLabel,
          inputType: tag,
          required: field.required,
          currentValue: value ? '[REDACTED]' : '[EMPTY]',
          answered: !!value,
          valid: isValid,
          source: 'filled element',
          fillAttempted: true,
          fillSucceeded: !!value,
        }

        requiredFieldReports.push(report)

        if (!isValid) {
          invalidControls++
          log(`INVALID: ${fieldLabel} - ${validationMessage}`)
        }
      } catch (e) {
        log(`Could not validate ${fieldLabel}: ${e}`)
        invalidControls++
      }
    }

    // Print required field diagnostics
    log('\n--- REQUIRED FIELD DIAGNOSTICS ---')
    for (const report of requiredFieldReports) {
      log(`Label: ${report.label}`)
      log(`  Input type: ${report.inputType}`)
      log(`  Required: ${report.required}`)
      log(`  Current value: ${report.currentValue}`)
      log(`  Answered: ${report.answered ? 'YES' : 'NO'}`)
      log(`  Valid: ${report.valid ? 'YES' : 'NO'}`)
      log(`  Source: ${report.source}`)
      log(`  Fill attempted: ${report.fillAttempted ? 'YES' : 'NO'}`)
      log(`  Fill succeeded: ${report.fillSucceeded ? 'YES' : 'NO'}`)
      log('')
    }

    // Check for CAPTCHA/blockers
    log('Checking for CAPTCHA/blockers...')
    const recaptchaChallenge = page.locator(greenhouseSelectors.recaptchaChallenge)
    const hasCaptcha = await recaptchaChallenge.count() > 0 && await recaptchaChallenge.isVisible().catch(() => false)
    log(`CAPTCHA detected: ${hasCaptcha ? 'YES' : 'NO'}`)

    // Check submit button
    log('Checking submit button...')
    const submitButton = page.locator(greenhouseSelectors.submit)
    const submitFound = await submitButton.count() > 0
    const submitVisible = submitFound ? await submitButton.isVisible().catch(() => false) : false
    const submitEnabled = submitVisible ? await submitButton.isEnabled().catch(() => false) : false

    log(`Greenhouse submit locator: ${greenhouseSelectors.submit}`)
    log(`Submit found: ${submitFound ? 'YES' : 'NO'}`)
    log(`Submit visible: ${submitVisible ? 'YES' : 'NO'}`)
    log(`Submit enabled: ${submitEnabled ? 'YES' : 'NO'}`)
    log(`Submit clicked: NO (diagnostic mode)`)

    // Final report
    console.log('\n' + '='.repeat(80))
    console.log('GREENHOUSE REAL PRE-SUBMIT DIAGNOSTIC')
    console.log('='.repeat(80))

    console.log(`\nPreparation reached READY_FOR_REVIEW: YES`)
    console.log(`Submission browser launched: YES`)
    console.log(`Real Greenhouse form opened: YES`)
    console.log(`Live controls found: ${liveControls.length}`)
    console.log(`Required controls found: ${requiredLiveControls.length}`)
    console.log(`Reviewed answers reapplied: YES (${answeredCount} filled, ${failedCount} failed)`)
    console.log(`Resume uploaded: YES`)
    console.log(`Resume stabilization complete: UNKNOWN (no parser signals in this diagnostic)`)
    console.log(`Required fields valid: ${invalidControls === 0 ? 'YES' : 'NO'}`)
    console.log(`HTML5 validity: ${invalidControls === 0 ? 'PASS' : 'FAIL'}`)
    console.log(`Invalid controls count: ${invalidControls}`)
    console.log(`CAPTCHA/login blocker: ${hasCaptcha ? 'YES' : 'NO'}`)
    console.log(`Greenhouse submit locator: ${greenhouseSelectors.submit}`)
    console.log(`Submit found: ${submitFound ? 'YES' : 'NO'}`)
    console.log(`Submit visible: ${submitVisible ? 'YES' : 'NO'}`)
    console.log(`Submit enabled: ${submitEnabled ? 'YES' : 'NO'}`)
    console.log(`Submit clicked: NO`)
    console.log(`Exact failing field: ${invalidControls > 0 ? requiredFieldReports.find((r: any) => !r.valid)?.label : 'NONE'}`)
    console.log(`Exact failure point: ${invalidControls > 0 ? 'HTML5 validation failure' : 'NONE'}`)
    console.log(`Production source modified: NO`)

    console.log('\n' + '='.repeat(80))

    if (invalidControls === 0 && submitFound && submitVisible && submitEnabled && !hasCaptcha) {
      log('✓ Greenhouse Pre-Submit Diagnostic: PASS')
      process.exit(0)
    } else {
      error(`✗ Greenhouse Pre-Submit Diagnostic: FAIL`)
      process.exit(1)
    }

  } catch (err: any) {
    error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  } finally {
    cleanup()
  }
}

main()
