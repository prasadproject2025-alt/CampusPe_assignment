#!/usr/bin/env node
/**
 * TEST-ONLY STANDALONE LIVE ASHBY TERMINAL SCRIPT
 * 
 * This script exercises the real live Ashby flow using the existing production
 * automation pipeline. It never submits a real application.
 * 
 * Environment variables required:
 * - TEST_ASHBY_JOB_URL: Real Ashby job URL
 * - TEST_CANDIDATE_NAME: Candidate name
 * - TEST_CANDIDATE_EMAIL: Candidate email
 * - TEST_CANDIDATE_RESUME_PATH: Path to resume file
 * 
 * Optional:
 * - TEST_CANDIDATE_PHONE: Candidate phone
 * - TEST_CANDIDATE_LINKEDIN_URL: LinkedIn URL
 * - TEST_CANDIDATE_LOCATION: Location
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '../database.js'
import { automationManager } from '../automation/manager.js'
import { assistedSessionExists, cancelAssistedSession } from '../automation/application/assistedSession.js'
import { uploadDir, dataDir } from '../config.js'

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

  // Validate resume file
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

  // Validate job URL is Ashby
  if (!config.jobUrl.includes('ashbyhq.com')) {
    error('Job URL must be an Ashby URL (jobs.ashbyhq.com)')
    process.exit(1)
  }

  log('Configuration validated successfully')
}

function createTestUser(): string {
  const userId = randomUUID()
  const now = new Date().toISOString()
  const uniqueEmail = `test-live-ashby-${userId}@campuspe.local`

  // Create user
  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, uniqueEmail, config.candidateName!, 'test_hash', 'test_salt', now)

  // Create profile
  db.prepare(`INSERT INTO profiles (user_id,updated_at,phone,linkedin_url,location,current_city,current_state,current_country) VALUES (?,?,?,?,?,?,?,?)`)
    .run(userId, now, config.phone || '', config.linkedinUrl || '', config.location || '', (config.location || '').split(',')[0]?.trim() || '', '', (config.location || '').split(',').slice(1).join(',').trim() || '')

  // Copy resume to upload directory
  const resumeExt = config.resumePath!.toLowerCase().endsWith('.pdf') ? '.pdf' : 
                    config.resumePath!.toLowerCase().endsWith('.docx') ? '.docx' : '.doc'
  const storageName = `${userId}${resumeExt}`
  const destPath = resolve(uploadDir, storageName)
  copyFileSync(config.resumePath!, destPath)

  // Update profile with resume
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
    // Cancel assisted session if exists
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
    // Delete automation runs
    db.prepare('DELETE FROM automation_events WHERE run_id IN (SELECT id FROM automation_runs WHERE user_id=?)').run(tempUserId)
    db.prepare('DELETE FROM automation_runs WHERE user_id=?').run(tempUserId)
    log('Deleted automation runs')

    // Delete sessions
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(tempUserId)
    log('Deleted sessions')

    // Delete profile
    db.prepare('DELETE FROM profiles WHERE user_id=?').run(tempUserId)
    log('Deleted profile')

    // Delete user
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

function printDiagnostics(run: any) {
  console.log('\n' + '='.repeat(80))
  console.log('LIVE ASHBY TERMINAL CHECK')
  console.log('='.repeat(80))

  console.log(`\nJob URL: ${config.jobUrl}`)
  console.log(`ATS: ${run.jobBoard}`)
  console.log(`Strategy: ${run.strategy}`)

  console.log(`\nBrowser launched: ${run.browserActive ? 'YES' : 'NO'}`)
  console.log(`Ashby opened: ${run.status !== 'FAILED' ? 'YES' : 'NO'}`)
  console.log(`Form detected: ${run.application ? 'YES' : 'NO'}`)

  if (run.application?.fields) {
    console.log(`\nNumber of fields extracted: ${run.application.fields.length}`)

    console.log('\n--- Field Details ---')
    for (const field of run.application.fields) {
      console.log(`\nLabel: ${field.text}`)
      console.log(`  Canonical type: ${field.fieldType}`)
      console.log(`  Required: ${field.required ? 'YES' : 'NO'}`)
      console.log(`  Resolution source: ${field.source || 'none'}`)
      console.log(`  Resolved: ${field.value ? 'YES' : 'NO'}`)
      console.log(`  Status: ${field.status}`)
      console.log(`  Input type: ${field.inputType || 'text'}`)
    }
  }

  const nameField = run.application?.fields?.find((f: any) => f.path === '_systemfield_name' || /name/i.test(f.text))
  const emailField = run.application?.fields?.find((f: any) => f.path === '_systemfield_email' || /email/i.test(f.text))
  const resumeField = run.application?.fields?.find((f: any) => f.path === '_systemfield_resume' || /resume/i.test(f.text))
  const linkedinField = run.application?.fields?.find((f: any) => /linkedin/i.test(f.text))

  console.log(`\n--- Key Fields ---`)
  console.log(`Candidate name filled: ${nameField?.value ? 'YES' : 'NO'}`)
  console.log(`Candidate email filled: ${emailField?.value ? 'YES' : 'NO'}`)
  console.log(`Resume uploaded: ${resumeField?.value ? 'YES' : 'NO'}`)
  console.log(`LinkedIn handled: ${linkedinField ? 'YES' : 'NO'}`)

  const customQuestions = run.application?.fields?.filter((f: any) => 
    !f.path.startsWith('_systemfield_') && f.path !== '_systemfield_eeoc_gender')
  console.log(`\nCustom questions handled: ${customQuestions?.length || 0}`)

  const unresolvedRequired = run.application?.fields?.filter((f: any) => f.required && !f.value)
  console.log(`\nUnresolved required fields: ${unresolvedRequired?.length || 0}`)
  if (unresolvedRequired?.length) {
    for (const field of unresolvedRequired) {
      console.log(`  - ${field.text}`)
    }
  }

  const ambiguousFields = run.application?.fields?.filter((f: any) => f.status === 'AMBIGUOUS')
  console.log(`\nAmbiguous fields: ${ambiguousFields?.length || 0}`)
  if (ambiguousFields?.length) {
    for (const field of ambiguousFields) {
      console.log(`  - ${field.text}`)
    }
  }

  console.log(`\n--- Blockers ---`)
  console.log(`CAPTCHA detected: ${run.status === 'PAUSED_CAPTCHA' ? 'YES' : 'NO'}`)
  console.log(`Login blocker detected: ${run.status === 'PAUSED_LOGIN' ? 'YES' : 'NO'}`)
  console.log(`Manual intervention triggered: ${run.status.startsWith('PAUSED_') ? 'YES' : 'NO'}`)

  if (run.pause) {
    console.log(`Manual reason: ${run.pause.reason || run.pause.instruction || 'none'}`)
  }

  console.log(`\n--- Submit ---`)
  console.log(`Submit button detected: ${run.status !== 'FAILED' ? 'YES (assumed)' : 'NO'}`)
  console.log(`Submit button enabled: ${run.status === 'READY_FOR_REVIEW' ? 'YES' : 'NO'}`)
  console.log(`Submit click attempted: NO (test mode)`)
  console.log(`READY_FOR_REVIEW reached: ${run.status === 'READY_FOR_REVIEW' ? 'YES' : 'NO'}`)

  console.log(`\n--- Final Status ---`)
  console.log(`Final status: ${run.status}`)
  console.log(`Current step: ${run.currentStep}`)

  if (run.error) {
    console.log(`Exact error: ${run.error}`)
  }

  if (run.events && run.events.length > 0) {
    console.log(`\n--- Event Log ---`)
    for (const event of run.events) {
      console.log(`  [${event.createdAt}] ${event.status}: ${event.message}`)
    }
  }

  console.log('\n' + '='.repeat(80))
}

async function main() {
  try {
    log('Starting live Ashby terminal check')
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

    log('Waiting for run to settle...')
    const settled = await waitForSettled(userId, runId)

    if (!settled) {
      error('Run failed to settle')
      process.exit(1)
    }

    printDiagnostics(settled)

    // Determine exit code based on result
    if (settled.status === 'READY_FOR_REVIEW') {
      log('✓ Test PASSED: Reached READY_FOR_REVIEW')
      process.exit(0)
    } else if (settled.status === 'FAILED') {
      log('✗ Test FAILED: Run failed')
      process.exit(1)
    } else if (settled.status.startsWith('PAUSED_')) {
      log('⚠ Test BLOCKED: Manual intervention required')
      process.exit(2)
    } else {
      log(`? Test UNKNOWN: Unexpected status ${settled.status}`)
      process.exit(3)
    }

  } catch (err) {
    error(`Fatal error: ${err}`)
    process.exit(1)
  } finally {
    cleanup()
  }
}

main()
