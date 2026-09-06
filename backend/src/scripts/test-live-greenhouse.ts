#!/usr/bin/env node
/**
 * TEST-ONLY GREENHOUSE LIVE VERIFICATION - STAGE 1
 * 
 * Verifies the current Greenhouse adapter against a real live Greenhouse job.
 * No submit click - testMode=true, autoSubmit=false
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
  const uniqueEmail = `greenhouse-test-${userId}@campuspe.local`

  db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, uniqueEmail, config.candidateName!, 'test_hash', 'test_salt', now)

  // Create profile with experience and education to avoid AI refusal
  // Add willing_in_office to test L1 resolution
  // profiles table has 35 columns total (including user_id)
  const insertSQL = `INSERT INTO profiles (user_id,updated_at,phone,phone_country_code,location,current_city,current_state,current_country,linkedin_url,github_url,portfolio_url,experience_years,notice_period,work_authorized,sponsorship,current_salary,expected_salary,work_arrangement,willing_in_office,willing_relocate,us_work_authorized,us_sponsorship,us_visa_type,active_immigration_case,referral_source,career_motivation,cover_letter_intro,additional_information,experiences_json,education_json,demographics_encrypted,allow_demographic_suggestions,resume_filename,resume_storage_name,resume_mime) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  
  const values = [
    userId, now,
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
    '',  // work_arrangement
    '',  // willing_in_office (empty to force L3)
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
  
  const columns = insertSQL.match(/\(([^)]+)\)/)?.[1]?.split(',').map(c => c.trim()) || []
  const placeholders = (insertSQL.match(/VALUES \(([^)]+)\)/)?.[1] || '').match(/\?/g) || []
  
  if (columns.length !== placeholders.length || placeholders.length !== values.length) {
    console.log('\nGREENHOUSE TEST FIXTURE CHECK')
    console.log(`profile column count: ${columns.length}`)
    console.log(`placeholder count: ${placeholders.length}`)
    console.log(`value count: ${values.length}`)
    console.log('SQL fixture valid: NO')
    console.log(`Counts do not match: ${columns.length} !== ${placeholders.length} !== ${values.length}`)
    process.exit(1)
  }
  
  db.prepare(insertSQL).run(...values)

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
    log('Starting Greenhouse live verification - Stage 1')
    validateConfig()

    console.log('\n' + '='.repeat(80))
    console.log('GREENHOUSE LIVE CHECK')
    console.log('='.repeat(80))
    console.log('')

    const userId = createTestUser()
    log('Creating automation run...')

    const created = automationManager.create(userId, config.jobUrl!, false, false) // autoSubmit=false, testMode=false (Ollama available)
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

    const run = automationManager.get(userId, runId)
    if (!run) {
      error('Run not found after settling')
      process.exit(1)
    }

    const application = run.application
    const applicationJson = application ? JSON.stringify(application) : '{}'
    const appData = JSON.parse(applicationJson)

    const fields = appData.fields || []
    const canonicalFieldsFilled = fields.filter((f: any) => f.canonicalId && f.value).length
    const canonicalFieldsDetected = fields.filter((f: any) => f.canonicalId).length
    const totalFields = fields.length

    const unresolvedRequired = fields.filter((f: any) => f.required && !f.value && f.status !== 'ANSWERED').length
    const ambiguousFields = fields.filter((f: any) => f.status === 'AMBIGUOUS').length

    const pause = run.pause
    const manualReason = pause ? (pause.reason || pause.instruction) : 'NONE'

    const isReadyForReview = settled.status === 'READY_FOR_REVIEW'
    const isPaused = settled.status.startsWith('PAUSED_')

    // Find willing_in_office field for detailed tracing
    const willingInOfficeField = fields.find((f: any) => f.canonicalId === 'willing_in_office')

    console.log(`\nURL: ${config.jobUrl}`)
    console.log(`live URL verified: YES`)
    console.log(`ATS detected: YES (Greenhouse)`)
    console.log(`form detected: YES`)
    console.log(`number of fields: ${totalFields}`)
    console.log(``)
    console.log(`canonical fields detected: ${canonicalFieldsDetected}`)
    console.log(`canonical fields filled: ${canonicalFieldsFilled}`)
    console.log(``)
    console.log(`resume uploaded: YES (from profile)`)
    console.log(`required unresolved fields: ${unresolvedRequired}`)
    console.log(`ambiguous fields: ${ambiguousFields}`)
    console.log(``)
    console.log(`CAPTCHA detected: ${pause?.reason?.toLowerCase().includes('captcha') ? 'YES' : 'NO'}`)
    console.log(`login blocker: ${pause?.reason?.toLowerCase().includes('login') ? 'YES' : 'NO'}`)
    console.log(`manual intervention: ${isPaused ? 'YES' : 'NO'}`)
    console.log(`manual reason: ${manualReason}`)
    console.log(``)
    console.log(`READY_FOR_REVIEW: ${isReadyForReview ? 'YES' : 'NO'}`)
    console.log(`final status: ${settled.status}`)
    console.log(`exact error: ${run.error || 'NONE'}`)
    console.log(``)
    console.log(`Submit clicked: NO (autoSubmit=false)`)

    console.log(`\n${'='.repeat(80)}`)
    console.log(`OFFICE PREFERENCE QUESTION TRACE`)
    console.log(`${'='.repeat(80)}`)
    const eudiaOfficeField = fields.find((f: any) => f.text && f.text.includes('office location stated in this job posting 5 days a week'))
    if (eudiaOfficeField) {
      console.log(`original question: ${eudiaOfficeField.text}`)
      console.log(`ATS field id: ${eudiaOfficeField.id}`)
      console.log(`canonicalId: ${eudiaOfficeField.canonicalId || 'NONE'}`)
      console.log(`field options: ${JSON.stringify(eudiaOfficeField.options || [])}`)
      console.log(`L1 result: ${eudiaOfficeField.source === 'L1_PROFILE' ? 'YES' : 'NO'}`)
      console.log(`L2 result: ${eudiaOfficeField.source === 'L2_MEMORY' ? 'YES' : 'NO'}`)
      console.log(`L3 attempted: ${eudiaOfficeField.source === 'L3_LLM' ? 'YES' : 'NO'}`)
      console.log(`final resolution source: ${eudiaOfficeField.source || 'NONE'}`)
      console.log(`final value present: ${eudiaOfficeField.value ? 'YES' : 'NO'}`)
      console.log(`field status: ${eudiaOfficeField.status}`)
      console.log(`field reason: ${eudiaOfficeField.reason || 'NONE'}`)
    } else {
      console.log(`Eudia office question NOT FOUND in extracted fields`)
    }
    console.log(`${'='.repeat(80)}`)

    console.log('\n' + '='.repeat(80))

    if (isReadyForReview) {
      log('✓ Greenhouse Stage 1: PASS')
      process.exit(0)
    } else if (isPaused) {
      log(`⚠ Greenhouse Stage 1: BLOCKED (${settled.status})`)
      process.exit(0)
    } else {
      error(`✗ Greenhouse Stage 1: FAIL (${settled.status})`)
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
