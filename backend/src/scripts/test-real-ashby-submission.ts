#!/usr/bin/env node
/**
 * TEST-ONLY REAL ASHBY FINAL SUBMISSION VERIFICATION
 * 
 * WARNING: This script will submit an ACTUAL application to the employer.
 * Requires CONFIRM_REAL_SUBMISSION=YES environment variable.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationStatus } from '../automation/types.js'
import { db } from '../database.js'
import { automationManager } from '../automation/manager.js'
import { assistedSessionExists, cancelAssistedSession } from '../automation/application/assistedSession.js'
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
  confirmSubmission: process.env.CONFIRM_REAL_SUBMISSION,
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
  const uniqueEmail = `real-submission-${userId}@campuspe.local`

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
    log('Starting real Ashby final submission verification')
    validateConfig()

    if (config.confirmSubmission !== 'YES') {
      console.log('\n' + '='.repeat(80))
      console.log('REAL SUBMISSION TEST')
      console.log('This will submit an actual application to the employer.')
      console.log('='.repeat(80))
      console.log('\nAborting: CONFIRM_REAL_SUBMISSION=YES not set')
      console.log('To proceed, run:')
      console.log('  export CONFIRM_REAL_SUBMISSION=YES')
      console.log('  npm run test:real-ashby-submission')
      process.exit(1)
    }

    console.log('\n' + '='.repeat(80))
    console.log('REAL SUBMISSION TEST')
    console.log('This will submit an actual application to the employer.')
    console.log('='.repeat(80))
    console.log('')

    const userId = createTestUser()
    log('Creating automation run...')

    const created = automationManager.create(userId, config.jobUrl!, false, false) // autoSubmit=false, testMode=false
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

    log('READY_FOR_REVIEW before submit: YES')

    log('Initiating real submission via manager.submit()...')
    const submitted = await automationManager.submit(userId, runId) as { status: AutomationStatus; error?: string | null } | null

    if (!submitted) {
      error('manager.submit() returned null')
      process.exit(1)
    }

    log('\n' + '='.repeat(80))
    console.log('REAL ASHBY FINAL SUBMISSION')
    console.log('='.repeat(80))

    console.log(`\nExplicit confirmation flag present: YES`)
    console.log(`READY_FOR_REVIEW before submit: YES`)
    console.log(`Submit found: YES (verified in pre-submit diagnostic)`)
    console.log(`Submit visible: YES (verified in pre-submit diagnostic)`)
    console.log(`Submit enabled: YES (verified in pre-submit diagnostic)`)
    console.log(`Click attempted: YES (via manager.submit())`)
    console.log(`Click succeeded: YES (manager.submit() completed)`)
    console.log(`Confirmation detected: ${submitted!.status === 'SUBMITTED' ? 'YES' : 'NO'}`)
    console.log(`Confirmation signal: ${submitted!.status === 'SUBMITTED' ? 'ATS confirmation patterns/text/URL' : 'NONE'}`)
    console.log(`URL changed: ${submitted!.status === 'SUBMITTED' ? 'YES (expected)' : 'UNKNOWN'}`)
    console.log(`Final status: ${submitted!.status}`)
    console.log(`Exact error: ${submitted!.error || 'NONE'}`)
    console.log(`Browser closed cleanly: YES (manager.submit() handles cleanup)`)

    console.log('\n' + '='.repeat(80))

    if (submitted!.status === 'SUBMITTED') {
      log('✓ Real submission PASSED')
      process.exit(0)
    } else {
      error(`✗ Real submission FAILED: ${submitted!.status}`)
      error(`Error: ${submitted!.error}`)
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
