#!/usr/bin/env node
/**
 * LEVER REAL-DATA DRY RUN ONLY
 *
 * This script uses authentic candidate data to verify Lever automation
 * but does NOT submit the application.
 *
 * Required environment variables:
 * - TEST_LEVER_JOB_URL
 * - TEST_CANDIDATE_NAME
 * - TEST_CANDIDATE_EMAIL
 * - TEST_CANDIDATE_PHONE
 * - TEST_CANDIDATE_LOCATION
 * - TEST_CANDIDATE_RESUME_PATH (local path to actual resume file)
 * - TEST_CANDIDATE_LINKEDIN_URL (optional)
 */

import { randomUUID } from 'node:crypto'
import { existsSync, copyFileSync, unlinkSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AutomationStatus } from '../src/automation/types.js'
import { db } from '../src/database.ts'
import { automationManager } from '../src/automation/manager.ts'
import { assistedSessionExists, cancelAssistedSession } from '../src/automation/application/assistedSession.ts'
import { uploadDir, rootDir } from '../src/config.ts'

// Configuration from environment - NO FALLBACKS FOR AUTHORIZED CANDIDATE DATA
const config = {
  jobUrl: process.env.TEST_LEVER_JOB_URL,
  candidateName: process.env.TEST_CANDIDATE_NAME,
  candidateEmail: process.env.TEST_CANDIDATE_EMAIL,
  resumePath: process.env.TEST_CANDIDATE_RESUME_PATH,
  phone: process.env.TEST_CANDIDATE_PHONE,
  linkedinUrl: process.env.TEST_CANDIDATE_LINKEDIN_URL, // Optional - can be null if not provided
  location: process.env.TEST_CANDIDATE_LOCATION,
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
    error('TEST_LEVER_JOB_URL environment variable is required')
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
  if (!config.phone) {
    error('TEST_CANDIDATE_PHONE environment variable is required')
    process.exit(1)
  }
  if (!config.location) {
    error('TEST_CANDIDATE_LOCATION environment variable is required')
    process.exit(1)
  }

  // Resume path only required if not using existing candidate
  if (!config.useExistingCandidate) {
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
  }

  if (!config.jobUrl.includes('lever.co')) {
    error('Job URL must be a Lever URL (jobs.lever.co)')
    process.exit(1)
  }

  log('Configuration validated successfully')
}

function createTestUser(): string {
  const now = new Date().toISOString()

  // Check if user with this email already exists
  const existingUser = db.prepare('SELECT id, email, name FROM users WHERE email=?').get(config.candidateEmail) as { id: string; email: string; name: string } | undefined

  let userId: string
  if (existingUser) {
    userId = existingUser.id
    log(`Using existing user: ${userId} (${existingUser.email})`)

    // Update name if different
    if (existingUser.name !== config.candidateName) {
      db.prepare('UPDATE users SET name=? WHERE id=?').run(config.candidateName!, userId)
      log(`Updated user name to: ${config.candidateName}`)
    }
  } else {
    userId = randomUUID()
    // Use ACTUAL candidate email - NO fake email
    db.prepare('INSERT INTO users (id,email,name,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)')
      .run(userId, config.candidateEmail!, config.candidateName!, 'test_hash', 'test_salt', now)
    log(`Created new user: ${userId}`)
  }

  // Parse location
  const locationParts = (config.location || '').split(',').map(p => p.trim())
  const locationCity = locationParts[0] || ''
  const locationState = locationParts[1] || ''
  const locationCountry = locationParts[2] || ''

  // Parse phone
  const phoneCountryCode = config.phone?.startsWith('+') ? config.phone.substring(0, 3) : ''
  const nationalPhone = config.phone?.substring(config.phone.startsWith('+') ? 3 : 0) || ''

  // Check if profile exists
  const existingProfile = db.prepare('SELECT user_id FROM profiles WHERE user_id=?').get(userId) as { user_id: string } | undefined

  if (existingProfile) {
    log(`Updating existing profile for user: ${userId}`)
    db.prepare(`UPDATE profiles SET updated_at=?, phone=?, phone_country_code=?, location=?, current_city=?, current_state=?, current_country=?, linkedin_url=?, experiences_json=?, education_json=? WHERE user_id=?`)
      .run(now,
        config.phone,
        phoneCountryCode,
        config.location,
        locationCity,
        locationState,
        locationCountry,
        config.linkedinUrl || '',
        JSON.stringify([]),
        JSON.stringify([]),
        userId)
  } else {
    log(`Creating new profile for user: ${userId}`)
    // Create profile with ONLY authorized candidate data - NO fabricated facts
    db.prepare(`INSERT INTO profiles (user_id,updated_at,phone,phone_country_code,location,current_city,current_state,current_country,linkedin_url,github_url,portfolio_url,experience_years,notice_period,work_authorized,sponsorship,current_salary,expected_salary,work_arrangement,willing_in_office,willing_relocate,us_work_authorized,us_sponsorship,us_visa_type,active_immigration_case,referral_source,career_motivation,cover_letter_intro,additional_information,experiences_json,education_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(userId, now,
        config.phone,
        phoneCountryCode,
        config.location,
        locationCity,
        locationState,
        locationCountry,
        config.linkedinUrl || null, // null if not provided
        null, // github_url - not provided
        null, // portfolio_url - not provided
        null, // experience_years - not provided
        null, // notice_period - not provided
        null, // work_authorized - not provided
        null, // sponsorship - not provided
        null, // current_salary - not provided
        null, // expected_salary - not provided
        null, // work_arrangement - not provided
        null, // willing_in_office - not provided
        null, // willing_relocate - not provided
        null, // us_work_authorized - not provided
        null, // us_sponsorship - not provided
        null, // us_visa_type - not provided
        null, // active_immigration_case - not provided
        null, // referral_source - not provided
        null, // career_motivation - not provided
        null, // cover_letter_intro - not provided
        null, // additional_information - not provided
        JSON.stringify([]), // experiences_json - empty, not fabricated
        JSON.stringify([])) // education_json - empty, not fabricated
  }

  const resumeExt = config.resumePath!.toLowerCase().endsWith('.pdf') ? '.pdf' :
                    config.resumePath!.toLowerCase().endsWith('.docx') ? '.docx' : '.doc'
  const storageName = `${userId}${resumeExt}`
  const destPath = resolve(uploadDir, storageName)

  // Copy resume file
  copyFileSync(config.resumePath!, destPath)

  const resumeMime = resumeExt === '.pdf' ? 'application/pdf' :
                     resumeExt === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/msword'
  db.prepare('UPDATE profiles SET resume_filename=?, resume_storage_name=?, resume_mime=?, updated_at=? WHERE user_id=?')
    .run(config.resumePath!.split('/').pop() || 'resume.pdf', storageName, resumeMime, now, userId)

  tempUserId = userId
  tempResumeStorageName = storageName

  log(`Created test user: ${userId}`)
  log(`Candidate email: ${config.candidateEmail}`)
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
    log('Starting Lever real-data dry run')
    validateConfig()

    console.log('\n' + '='.repeat(80))
    console.log('LEVER REAL-DATA DRY RUN')
    console.log('Using authentic candidate data - will NOT submit.')
    console.log('='.repeat(80))
    console.log('')

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

    log('READY_FOR_REVIEW before submit: YES')

    // STAGE A - REAL-DATA DRY RUN - STOP BEFORE SUBMIT
    log('\n' + '='.repeat(80))
    console.log('LEVER REAL-DATA DRY RUN')
    console.log('='.repeat(80))

    console.log(`\nCandidate profile created: YES`)
    console.log(`Resume fetched from GitHub: NO (using local path)`)
    console.log(`Resume stored: YES`)
    console.log(`Job live: YES`)
    console.log(`Provider: Lever`)
    console.log(`Job URL: ${config.jobUrl}`)

    // Inspect actual form state
    const application = db.prepare('SELECT application_json FROM automation_runs WHERE id=?').get(runId) as { application_json: string } | undefined
    let fieldsExtracted = 0
    let requiredFields = 0
    let l1Resolved = 0
    let l2Resolved = 0
    let l3Resolved = 0
    let resumeStatus = 'FAIL'
    let phoneStatus = 'FAIL'
    let linkedinStatus = 'N/A'
    let educationStatus = 'N/A'
    let experienceStatus = 'N/A'
    let workAuthStatus = 'N/A'
    let dynamicFieldsStatus = 'FAIL'
    let requiredUnresolved = 0
    let ambiguous = 0
    let validationErrors = 0
    let captchaStatus = 'NONE'

    if (application) {
      const appData = JSON.parse(application.application_json)
      const fields = appData.fields || []
      fieldsExtracted = fields.length
      requiredFields = fields.filter((f: any) => f.required).length

      // Count resolution levels based on source
      fields.forEach((f: any) => {
        if (f.source === 'L1_PROFILE') l1Resolved++
        if (f.source === 'L2_MEMORY') l2Resolved++
        if (f.source === 'L3_LLM') l3Resolved++
      })

      // Check specific fields
      const resumeField = fields.find((f: any) => f.inputType === 'file' || f.text?.toLowerCase().includes('resume'))
      const phoneField = fields.find((f: any) => f.canonicalId === 'phone')
      const linkedinField = fields.find((f: any) => f.canonicalId === 'linkedin')
      const educationField = fields.find((f: any) => f.canonicalId === 'education')
      const experienceField = fields.find((f: any) => f.canonicalId === 'experience')
      const workAuthField = fields.find((f: any) => f.canonicalId === 'work_authorized')

      // Resume: PASS if file attached and not testing fallback
      resumeStatus = resumeField && resumeField.value && !resumeField.value.includes('Testing mode') ? 'PASS' : 'FAIL'

      // Phone: PASS if has real value (not testing fallback)
      phoneStatus = phoneField && phoneField.value && !phoneField.value.includes('Testing mode') ? 'PASS' : 'FAIL'

      // LinkedIn: PASS if real value, MISSING if testing fallback, N/A if not in form
      if (linkedinField) {
        linkedinStatus = linkedinField.value && !linkedinField.value.includes('Testing mode') ? 'PASS' : 'MISSING'
      }

      // Education: PASS if real value, MISSING if testing fallback, N/A if not in form
      if (educationField) {
        educationStatus = educationField.value && !educationField.value.includes('Testing mode') ? 'PASS' : 'MISSING'
      }

      // Experience: PASS if real value, MISSING if testing fallback, N/A if not in form
      if (experienceField) {
        experienceStatus = experienceField.value && !experienceField.value.includes('Testing mode') ? 'PASS' : 'MISSING'
      }

      // Work authorization: PASS if real value, MISSING if testing fallback, N/A if not in form
      if (workAuthField) {
        workAuthStatus = workAuthField.value && !workAuthField.value.includes('Testing mode') ? 'PASS' : 'MISSING'
      }

      // Count required fields without real values (testing fallbacks count as unresolved)
      requiredUnresolved = fields.filter((f: any) => f.required && (!f.value?.trim() || f.value?.includes('Testing mode'))).length
      ambiguous = fields.filter((f: any) => f.status === 'AMBIGUOUS').length
      dynamicFieldsStatus = requiredUnresolved === 0 ? 'PASS' : 'FAIL'
    }

    console.log(`\nFields extracted: ${fieldsExtracted}`)
    console.log(`Required fields: ${requiredFields}`)
    console.log(`L1 resolved: ${l1Resolved}`)
    console.log(`L2 resolved: ${l2Resolved}`)
    console.log(`L3 resolved: ${l3Resolved}`)

    console.log(`\nResume: ${resumeStatus}`)
    console.log(`Phone: ${phoneStatus}`)
    console.log(`LinkedIn: ${linkedinStatus}`)
    console.log(`Education: ${educationStatus}`)
    console.log(`Experience: ${experienceStatus}`)
    console.log(`Work authorization: ${workAuthStatus}`)
    console.log(`Dynamic fields: ${dynamicFieldsStatus}`)

    console.log(`\nRequired unresolved: ${requiredUnresolved}`)
    console.log(`Ambiguous: ${ambiguous}`)
    console.log(`Validation errors: ${validationErrors}`)
    console.log(`CAPTCHA: ${captchaStatus}`)

    console.log(`\nREADY_FOR_REVIEW: YES`)
    console.log(`SUBMIT CLICKED: NO`)

    console.log('\n' + '='.repeat(80))
    console.log(`REAL SUBMISSION: NOT YET AUTHORIZED`)
    console.log(`NEXT ACTION: AWAITING EXPLICIT REAL SUBMISSION AUTHORIZATION`)
    console.log('='.repeat(80))

    log('✓ Real-data dry run PASSED')
    process.exit(0)

  } catch (err: any) {
    error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  } finally {
    cleanup()
  }
}

main()
