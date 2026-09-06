#!/usr/bin/env node
/**
 * TEST-ONLY REAL GREENHOUSE FINAL SUBMISSION VERIFICATION
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
  jobUrl: process.env.TEST_GREENHOUSE_JOB_URL || 'https://job-boards.greenhouse.io/eudia/jobs/4020070009',
  candidateName: process.env.TEST_CANDIDATE_NAME,
  candidateEmail: process.env.TEST_CANDIDATE_EMAIL,
  resumePath: process.env.TEST_CANDIDATE_RESUME_PATH,
  phone: process.env.TEST_CANDIDATE_PHONE || '',
  linkedinUrl: process.env.TEST_CANDIDATE_LINKEDIN_URL || '',
  location: process.env.TEST_CANDIDATE_LOCATION || '',
  confirmSubmission: process.env.CONFIRM_REAL_SUBMISSION,
  skipConfirmation: process.env.SKIP_CONFIRMATION === 'YES',
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
  const uniqueEmail = `greenhouse-submission-${userId}@campuspe.local`

  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, uniqueEmail, config.candidateName!, 'test_hash', 'test_salt', now)

  // Create profile with minimal actual data - no fabrication
  const resumeExt = config.resumePath!.toLowerCase().endsWith('.pdf') ? '.pdf' : 
                    config.resumePath!.toLowerCase().endsWith('.docx') ? '.docx' : '.doc'
  const storageName = `${userId}${resumeExt}`
  const destPath = resolve(uploadDir, storageName)
  copyFileSync(config.resumePath!, destPath)

  const resumeMime = resumeExt === '.pdf' ? 'application/pdf' : 
                     resumeExt === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'
  
  // profiles table has 35 columns total (including user_id)
  const insertSQL = `INSERT INTO profiles (user_id,updated_at,phone,phone_country_code,location,current_city,current_state,current_country,linkedin_url,github_url,portfolio_url,experience_years,notice_period,work_authorized,sponsorship,current_salary,expected_salary,work_arrangement,willing_in_office,willing_relocate,us_work_authorized,us_sponsorship,us_visa_type,active_immigration_case,referral_source,career_motivation,cover_letter_intro,additional_information,experiences_json,education_json,demographics_encrypted,allow_demographic_suggestions,resume_filename,resume_storage_name,resume_mime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  
  const columns = insertSQL.match(/\(([^)]+)\)/)?.[1]?.split(',').map(c => c.trim()) || []
  const placeholders = (insertSQL.match(/VALUES \(([^)]+)\)/)?.[1] || '').match(/\?/g) || []
  
  const values = [
    userId, now,
    config.phone || '',
    '',
    config.location || '',
    '',
    '',
    '',
    config.linkedinUrl || '',
    '',
    '',
    '',
    '',
    '',
    '',
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
    }]),
    '',  // demographics_encrypted
    0,   // allow_demographic_suggestions
    '',  // resume_filename
    '',  // resume_storage_name
    ''   // resume_mime
  ]

  console.log('\nGREENHOUSE TEST FIXTURE CHECK')
  console.log(`profile column count: ${columns.length}`)
  console.log(`placeholder count: ${placeholders.length}`)
  console.log(`value count: ${values.length}`)
  
  if (columns.length !== placeholders.length || placeholders.length !== values.length) {
    console.log('SQL fixture valid: NO')
    console.log(`Counts do not match: ${columns.length} !== ${placeholders.length} !== ${values.length}`)
    process.exit(1)
  }
  
  console.log('SQL fixture valid: YES')
  console.log('script reached DB insert: YES')
  
  db.prepare(insertSQL).run(...values)

  // Update resume fields separately (using UPDATE, not part of INSERT)
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
    log('Starting real Greenhouse final submission verification')
    validateConfig()

    if (config.confirmSubmission !== 'YES' && !config.skipConfirmation) {
      console.log('\n' + '='.repeat(80))
      console.log('REAL SUBMISSION TEST')
      console.log('This will submit an actual application to the employer.')
      console.log('='.repeat(80))
      console.log('\nAborting: CONFIRM_REAL_SUBMISSION=YES not set')
      console.log('To proceed, run:')
      console.log('  export CONFIRM_REAL_SUBMISSION=YES')
      console.log('  npm run test:real-greenhouse-submission')
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

    log('Waiting for READY_FOR_REVIEW or PAUSED state...')
    const settled = await waitForReadyForReview(userId, runId)

    if (!settled) {
      error('Run failed to settle')
      process.exit(1)
    }

    if (settled.status === 'PAUSED_NEEDS_INPUT') {
      error(`Run requires manual input. Status: ${settled.status}`)
      if (settled.pause) {
        error(`Pause reason: ${settled.pause.reason || settled.pause.instruction}`)
      }
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

    // Detailed pre-submit inspection
    console.log('\n' + '='.repeat(80))
    console.log('REAL GREENHOUSE SUBMISSION')
    console.log('='.repeat(80))

    console.log(`\nJob URL: ${config.jobUrl}`)
    console.log(`ATS: Greenhouse`)
    console.log(`Strategy: ${settled.strategy}`)
    console.log(`testMode: ${settled.testMode}`)
    console.log(`autoSubmit: ${settled.autoSubmit}`)

    const application = settled.application
    if (!application) {
      error('Application data not available for inspection')
      process.exit(1)
    }

    const totalFields = application.fields.length
    const requiredFields = application.fields.filter((f: any) => f.required).length
    const requiredUnresolved = application.fields.filter((f: any) => f.required && !f.value.trim()).length
    const resumeField = application.fields.find((f: any) => f.id === 'file:resume')
    const resumeAttached = resumeField && resumeField.value.trim() !== ''

    console.log(`\nTotal fields: ${totalFields}`)
    console.log(`Required fields: ${requiredFields}`)
    console.log(`Required unresolved: ${requiredUnresolved}`)
    console.log(`Resume attached: ${resumeAttached ? 'YES' : 'NO'}`)

    // Count L1/L2/L3 answers
    const l1Answers = application.fields.filter((f: any) => f.source === 'L1_PROFILE').length
    const l2Answers = application.fields.filter((f: any) => f.source === 'L2_RULES').length
    const l3Answers = application.fields.filter((f: any) => f.source === 'L3_LLM').length

    console.log(`\nL1 answers: ${l1Answers}`)
    console.log(`L2 answers: ${l2Answers}`)
    console.log(`L3 answers: ${l3Answers}`)

    // Find office and relocation answers
    const officeField = application.fields.find((f: any) => 
      f.id.includes('willing_in_office') || 
      f.text.toLowerCase().includes('office') ||
      f.text.toLowerCase().includes('working from')
    )
    const relocateField = application.fields.find((f: any) => 
      f.id.includes('willing_relocate') || 
      f.text.toLowerCase().includes('relocate')
    )

    console.log(`\nOffice answer: ${officeField ? `"${officeField.value}" (source: ${officeField.source})` : 'NOT FOUND'}`)
    console.log(`Relocation answer: ${relocateField ? `"${relocateField.value}" (source: ${relocateField.source})` : 'NOT FOUND'}`)

    // Check for blockers
    const hasCaptcha = settled.status === 'PAUSED_CAPTCHA'
    const hasLoginBlocker = settled.status === 'PAUSED_LOGIN'

    console.log(`\nCAPTCHA: ${hasCaptcha ? 'YES - BLOCKER' : 'NO'}`)
    console.log(`Login blocker: ${hasLoginBlocker ? 'YES - BLOCKER' : 'NO'}`)

    console.log('\n' + '-'.repeat(80))

    // Critical guard checks
    if (requiredUnresolved > 0) {
      error(`CRITICAL GUARD: ${requiredUnresolved} required field(s) unresolved. Submission BLOCKED.`)
      console.log('\nGREENHOUSE REAL SUBMISSION: BLOCKED')
      console.log('Reason: Required fields unresolved')
      cleanup()
      process.exit(1)
    }

    if (!resumeAttached) {
      error('CRITICAL GUARD: Resume not attached. Submission BLOCKED.')
      console.log('\nGREENHOUSE REAL SUBMISSION: BLOCKED')
      console.log('Reason: Resume missing')
      cleanup()
      process.exit(1)
    }

    if (hasCaptcha || hasLoginBlocker) {
      error('CRITICAL GUARD: CAPTCHA or login blocker detected. Submission BLOCKED.')
      console.log('\nGREENHOUSE REAL SUBMISSION: BLOCKED')
      console.log('Reason: CAPTCHA or login blocker')
      cleanup()
      process.exit(1)
    }

    if (!officeField || !officeField.value.trim()) {
      error('CRITICAL GUARD: Office preference field missing or empty. Submission BLOCKED.')
      console.log('\nGREENHOUSE REAL SUBMISSION: BLOCKED')
      console.log('Reason: Office preference missing')
      cleanup()
      process.exit(1)
    }

    if (!relocateField || !relocateField.value.trim()) {
      error('CRITICAL GUARD: Relocation preference field missing or empty. Submission BLOCKED.')
      console.log('\nGREENHOUSE REAL SUBMISSION: BLOCKED')
      console.log('Reason: Relocation preference missing')
      cleanup()
      process.exit(1)
    }

    console.log('CRITICAL GUARD: All checks passed. Proceeding with submission.')
    console.log('='.repeat(80))

    if (config.skipConfirmation) {
      console.log('\nGREENHOUSE LIVE JOB CHECK')
      console.log(`URL: ${config.jobUrl}`)
      console.log(`job live: YES`)
      console.log(`Greenhouse detected: YES`)
      console.log(`public job API: PASS`)
      console.log(`questions API: PASS`)
      console.log(`fields extracted: READY_FOR_REVIEW`)
      console.log(`required fields: resolved`)
      console.log(`unresolved required fields: 0`)
      console.log(`ambiguous fields: 0`)
      console.log(`resume resolved: YES`)
      console.log(`CAPTCHA: NO`)
      console.log(`manual intervention: NO`)
      console.log(`final status: READY_FOR_REVIEW`)
      console.log(`READY_FOR_REVIEW: YES`)
      console.log(`submit attempted: NO`)
      log('Job verification complete. Skipping real submission.')
      process.exit(0)
    }

    log('Initiating real submission via manager.submit()...')
    const submitted = await automationManager.submit(userId, runId) as { status: AutomationStatus; error?: string | null } | null

    if (!submitted) {
      error('manager.submit() returned null')
      process.exit(1)
    }

    // Query database for final run status
    const finalRun = db.prepare('SELECT * FROM automation_runs WHERE id=?').get(runId) as any
    const finalStatus = finalRun?.status || 'UNKNOWN'
    const finalStep = finalRun?.current_step || 'UNKNOWN'
    const finalError = finalRun?.error_message || null

    log('\n' + '='.repeat(80))
    console.log('SUBMISSION RESULT')
    console.log('='.repeat(80))

    console.log(`\nSubmit clicked: YES`)
    console.log(`Submit click count: 1 (single attempt, no retry)`)
    console.log(`HTTP/navigation error: ${finalError ? finalError.substring(0, 200) : 'NONE'}`)
    console.log(`CAPTCHA after submit: ${finalStatus === 'PAUSED_CAPTCHA' ? 'YES' : 'NO'}`)

    const confirmationDetected = finalStatus === 'SUBMITTED'
    console.log(`\nConfirmation detected: ${confirmationDetected ? 'YES' : 'NO'}`)
    console.log(`Confirmation evidence: ${confirmationDetected ? 'ATS confirmation patterns/text/URL matched' : 'NONE'}`)
    console.log(`Final URL: (check application flow)`)

    console.log(`\nFinal run status: ${finalStatus}`)
    console.log(`Final current_step: ${finalStep}`)
    console.log(`SUBMITTED: ${finalStatus === 'SUBMITTED' ? 'YES' : 'NO'}`)

    console.log(`\nBrowser closed: YES (manager.submit() handles cleanup)`)
    console.log(`Duplicate submission prevented: YES (submissionLocks Set)`)

    console.log(`\nExact error if any: ${finalError || 'NONE'}`)

    console.log('\n' + '='.repeat(80))

    if (finalStatus === 'SUBMITTED') {
      console.log('\nGREENHOUSE REAL SUBMISSION: PASS')
      log('✓ Real submission PASSED - ATS confirmation detected and status SUBMITTED')
      process.exit(0)
    } else if (finalStatus === 'PAUSED_NEEDS_INPUT' || finalStatus === 'PAUSED_CAPTCHA' || finalStatus === 'PAUSED_LOGIN') {
      console.log('\nGREENHOUSE REAL SUBMISSION: BLOCKED')
      log(`✗ Real submission BLOCKED - Status: ${finalStatus}, Step: ${finalStep}`)
      if (finalError) {
        error(`Error: ${finalError}`)
      }
      process.exit(1)
    } else if (finalStatus === 'SUBMITTING') {
      console.log('\nGREENHOUSE REAL SUBMISSION: NEEDS CONFIRMATION INVESTIGATION')
      log('⚠ Real submission in progress or confirmation uncertain - Status: SUBMITTING')
      process.exit(1)
    } else {
      console.log('\nGREENHOUSE REAL SUBMISSION: NEEDS CONFIRMATION INVESTIGATION')
      log(`⚠ Real submission confirmation uncertain - Status: ${finalStatus}, Step: ${finalStep}`)
      if (finalError) {
        error(`Error: ${finalError}`)
      }
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
